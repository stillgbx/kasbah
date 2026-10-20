#!/usr/bin/env node
/**
 * Production supervisor: starts the server (`apps/server/dist/main.js`), restarts it if it goes down,
 * and applies an update when Settings asks for it. The server passes it over the
 * Node parent-child channel (IPC): a server cannot replace itself.
 *
 * Update: `git fetch` then fast-forward to `origin/main`, `npm ci` if `package-lock.json` has
 * changed (server stopped: Windows locks native modules in use), build, restart, and
 * the new server must say "ready". A step that fails goes back to the previous commit, rebuilds
 * and restarts. Progress is written in the state file that the server designates (`update-status.json`),
 * which Settings re-reads during the update, outage included.
 *
 * Log: `logs/kasbah.log` (server and supervisor), a copy `kasbah.1.log` beyond 10 MB.
 * Launch at machine startup: doc/5_setup/5_2_production.md.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = join(root, 'apps', 'server')
const logDir = join(root, 'logs')
const logFile = join(logDir, 'kasbah.log')
const LOG_MAX = 10 * 1024 * 1024
/** The time left for the new server to listen and start its plugins. */
const READY_TIMEOUT_MS = 3 * 60_000
const STOP_TIMEOUT_MS = 15_000
/** Output lines kept in the state file: enough to read an error from Settings. */
const TAIL = 60

mkdirSync(logDir, { recursive: true })
let logSize = existsSync(logFile) ? statSync(logFile).size : 0

function log(text) {
  process.stdout.write(text)
  try {
    if (logSize > LOG_MAX) { renameSync(logFile, join(logDir, 'kasbah.1.log')); logSize = 0 }
    appendFileSync(logFile, text)
    logSize += Buffer.byteLength(text)
  } catch { /* a locked or full log does not stop the server */ }
}
const say = (msg) => log(`[supervisor] ${new Date().toISOString()} ${msg}\n`)

let child = null
/** The server that starts during an update: its output also goes into the state file. */
let capture = null
/** False while the supervisor shuts down: no more restarts. */
let wanted = true
let updating = false
let crashes = 0

function startServer() {
  const c = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/main.js'], {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })
  child = c
  const startedAt = Date.now()
  const out = (d) => { log(d.toString()); if (capture) keep(capture, d.toString()) }
  c.stdout.on('data', out)
  c.stderr.on('data', out)
  c.on('message', (m) => {
    if (m?.type === 'update' && typeof m.statusFile === 'string') void update(m.statusFile, typeof m.running === 'string' ? m.running : null)
  })
  c.on('exit', (code, signal) => {
    if (child === c) child = null
    say(`server exited (code ${code}${signal ? `, ${signal}` : ''})`)
    // an update stops and restarts the server itself
    if (!wanted || updating) return
    crashes = Date.now() - startedAt > 60_000 ? 1 : crashes + 1
    const delay = Math.min(60_000, 1000 * 2 ** (crashes - 1))
    say(`restarting in ${delay / 1000} s`)
    setTimeout(() => { if (wanted && !updating && !child) startServer() }, delay)
  })
  say(`server started (pid ${c.pid})`)
  return c
}

/** Clean shutdown requested through IPC (the server closes its plugins), then forced shutdown after the delay. */
function stopServer() {
  const c = child
  if (!c) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => c.kill(), STOP_TIMEOUT_MS)
    c.once('exit', () => { clearTimeout(timer); resolve() })
    if (c.connected) c.send({ type: 'shutdown' })
    else c.kill()
  })
}

/** Starts the server and waits for it to say "ready"; false if it goes down or stays silent. */
function startAndWait() {
  const c = startServer()
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), READY_TIMEOUT_MS)
    const onMessage = (m) => { if (m?.type === 'ready') done(true) }
    const onExit = () => done(false)
    function done(ok) {
      clearTimeout(timer)
      c.off('message', onMessage)
      c.off('exit', onExit)
      resolve(ok)
    }
    c.on('message', onMessage)
    c.on('exit', onExit)
  })
}

/** The last non-empty lines of `text` into `tail`, without the terminal color codes. */
function keep(tail, text) {
  // eslint-disable-next-line no-control-regex
  tail.push(...text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter((l) => l.trim()))
  if (tail.length > TAIL) tail.splice(0, tail.length - TAIL)
}

/** A fixed command (no user input), its output to the log and into `tail`. */
function run(cmd, tail) {
  say(`$ ${cmd}`)
  return new Promise((resolve) => {
    let out = ''
    const p = spawn(cmd, { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const take = (d) => {
      const s = d.toString()
      out += s
      log(s)
      keep(tail, s)
    }
    p.stdout.on('data', take)
    p.stderr.on('data', take)
    p.on('error', (err) => take(`${err.message}\n`))
    p.on('close', (code) => resolve({ code, out: out.trim() }))
  })
}

/**
 * `running`: the commit the server has loaded. It may differ from HEAD (a `git pull` done by hand
 * without a build): we then compare against it, so as not to declare up to date a server that is not.
 */
async function update(statusFile, running) {
  if (updating) return
  updating = true
  const status = {
    state: 'running', step: 'fetch', steps: ['fetch'], failedStep: null,
    from: running, to: null, startedAt: Date.now(), finishedAt: null,
    error: null, rolledBack: false, supervisorChanged: false, log: [],
  }
  // On Windows, the replacement fails (EPERM) if the server reads the file at the same instant: we
  // retry, otherwise an "in progress" would stay displayed after the end.
  const save = () => {
    for (let i = 0; ; i++) {
      try {
        writeFileSync(`${statusFile}.tmp`, JSON.stringify(status, null, 2))
        renameSync(`${statusFile}.tmp`, statusFile)
        return
      } catch (err) {
        if (i === 9) { say(`update status not written: ${err.message}`); return }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
      }
    }
  }
  // The kept output is that of the current step: that of a step that fails stays displayed, the
  // rollback writes elsewhere (`tail`).
  const step = async (name, cmd, tail = null) => {
    if (!tail && status.step !== name) status.log = []
    status.step = name
    save()
    const r = await run(cmd, tail ?? status.log)
    if (r.code !== 0) throw new Error(`${cmd} (code ${r.code})`)
    return r.out
  }
  const finish = (state) => {
    status.state = state
    status.step = null
    status.finishedAt = Date.now()
    save()
    updating = false
    if (wanted && !child) startServer()
  }

  let head = null
  let lockChanged = false
  /** True as soon as the code, the dependencies or the build have moved: before that, nothing to undo. */
  let touched = false
  try {
    const branch = await step('fetch', 'git rev-parse --abbrev-ref HEAD')
    if (branch !== 'main') throw new Error(`the checkout is on branch "${branch}", not main`)
    head = await step('fetch', 'git rev-parse HEAD')
    await step('fetch', 'git fetch origin main')
    const to = status.to = await step('fetch', 'git rev-parse origin/main')
    const base = status.from ??= head
    if (to === head && to === base) { say('already up to date'); finish('done'); return }
    const changed = (await step('fetch', `git diff --name-only ${base} ${to}`)).split(/\r?\n/)
    lockChanged = changed.includes('package-lock.json')
    status.supervisorChanged = changed.includes('scripts/supervisor.mjs')
    status.steps = ['fetch', ...(lockChanged ? ['deps'] : []), 'build', 'restart']
    touched = true
    if (to !== head) await step('fetch', `git merge --ff-only ${to}`)
    if (lockChanged) {
      status.step = 'deps'
      save()
      await stopServer()
      await step('deps', 'npm ci')
    }
    await step('build', 'npm run build')
    status.step = 'restart'
    status.log = []
    save()
    await stopServer()
    capture = status.log
    const started = await startAndWait()
    capture = null
    if (!started) throw new Error('the new server did not start')
    say(`updated to ${to}`)
    finish('done')
  } catch (err) {
    status.failedStep = status.step
    status.error = err.message
    say(`update failed at ${status.step}: ${err.message}`)
    if (touched) await rollback(head, lockChanged, status, (cmd) => step('rollback', cmd, []))
    finish('failed')
  }
}

/** Back to the previous commit: its code, its dependencies, its build, and a server that restarts. */
async function rollback(head, lockChanged, status, exec) {
  try {
    if ((await exec('git rev-parse HEAD')) !== head) await exec(`git reset --keep ${head}`)
    if (lockChanged) {
      await stopServer()
      await exec('npm ci')
    }
    await exec('npm run build')
    await stopServer()
    if (!(await startAndWait())) throw new Error('the previous version did not start either')
    status.rolledBack = true
    say(`rolled back to ${head}`)
  } catch (err) {
    status.error = `${status.error} — rollback failed: ${err.message}`
    say(`rollback failed: ${err.message}`)
  }
}

async function quit(signal) {
  if (!wanted) return
  wanted = false
  say(`${signal}: stopping`)
  await stopServer()
  process.exit(0)
}
process.on('SIGINT', () => void quit('SIGINT'))
process.on('SIGTERM', () => void quit('SIGTERM'))

say(`supervisor started in ${root}`)
// First installation, or `dist/` erased: we build before launching.
if (!existsSync(join(serverDir, 'dist', 'main.js'))) {
  const r = await run('npm run build', [])
  if (r.code !== 0) say('initial build failed: starting anyway, the server will say what is missing')
}
startServer()
