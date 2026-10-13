#!/usr/bin/env node
/**
 * Superviseur de production : lance le serveur (`apps/server/dist/main.js`), le relance s'il tombe,
 * et applique une mise à jour quand Réglages la demande. Le serveur la lui transmet par le canal
 * parent-enfant de Node (IPC) : un serveur ne peut pas se remplacer lui-même.
 *
 * Mise à jour : `git fetch` puis avance rapide sur `origin/main`, `npm ci` si `package-lock.json` a
 * changé (serveur arrêté : Windows verrouille les modules natifs en service), build, redémarrage, et
 * le nouveau serveur doit dire « prêt ». Une étape qui échoue ramène au commit précédent, reconstruit
 * et relance. L'avancement s'écrit dans le fichier d'état que le serveur désigne (`update-status.json`),
 * que Réglages relit pendant la mise à jour, coupure comprise.
 *
 * Journal : `logs/kasbah.log` (serveur et superviseur), une copie `kasbah.1.log` au-delà de 10 Mo.
 * Lancement au démarrage de la machine : doc/5_setup/5_2_production.md.
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
/** Le temps laissé au nouveau serveur pour écouter et démarrer ses plugins. */
const READY_TIMEOUT_MS = 3 * 60_000
const STOP_TIMEOUT_MS = 15_000
/** Lignes de sortie gardées dans le fichier d'état : de quoi lire une erreur depuis Réglages. */
const TAIL = 60

mkdirSync(logDir, { recursive: true })
let logSize = existsSync(logFile) ? statSync(logFile).size : 0

function log(text) {
  process.stdout.write(text)
  try {
    if (logSize > LOG_MAX) { renameSync(logFile, join(logDir, 'kasbah.1.log')); logSize = 0 }
    appendFileSync(logFile, text)
    logSize += Buffer.byteLength(text)
  } catch { /* un journal verrouillé ou plein n'arrête pas le serveur */ }
}
const say = (msg) => log(`[supervisor] ${new Date().toISOString()} ${msg}\n`)

let child = null
/** Le serveur qui démarre pendant une mise à jour : sa sortie va aussi dans le fichier d'état. */
let capture = null
/** Faux pendant l'arrêt du superviseur : plus de relance. */
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
    // une mise à jour arrête et relance elle-même le serveur
    if (!wanted || updating) return
    crashes = Date.now() - startedAt > 60_000 ? 1 : crashes + 1
    const delay = Math.min(60_000, 1000 * 2 ** (crashes - 1))
    say(`restarting in ${delay / 1000} s`)
    setTimeout(() => { if (wanted && !updating && !child) startServer() }, delay)
  })
  say(`server started (pid ${c.pid})`)
  return c
}

/** Arrêt propre demandé par IPC (le serveur ferme ses plugins), puis arrêt forcé passé le délai. */
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

/** Démarre le serveur et attend qu'il dise « prêt » ; faux s'il tombe ou se tait. */
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

/** Les dernières lignes non vides de `text` dans `tail`, sans les codes de couleur du terminal. */
function keep(tail, text) {
  // eslint-disable-next-line no-control-regex
  tail.push(...text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter((l) => l.trim()))
  if (tail.length > TAIL) tail.splice(0, tail.length - TAIL)
}

/** Une commande fixe (aucune entrée utilisateur), sa sortie au journal et dans `tail`. */
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
 * `running` : le commit que le serveur a chargé. Il peut différer de HEAD (un `git pull` fait à la main
 * sans build) : on compare alors à lui, pour ne pas déclarer à jour un serveur qui ne l'est pas.
 */
async function update(statusFile, running) {
  if (updating) return
  updating = true
  const status = {
    state: 'running', step: 'fetch', steps: ['fetch'], failedStep: null,
    from: running, to: null, startedAt: Date.now(), finishedAt: null,
    error: null, rolledBack: false, supervisorChanged: false, log: [],
  }
  // Sous Windows, le remplacement échoue (EPERM) si le serveur lit le fichier au même instant : on
  // réessaie, sinon un « en cours » resterait affiché après la fin.
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
  // La sortie gardée est celle de l'étape en cours : celle d'une étape qui échoue reste affichée, le
  // retour en arrière écrit ailleurs (`tail`).
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
  /** Vrai dès que le code, les dépendances ou le build ont bougé : avant, rien à défaire. */
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

/** Retour au commit d'avant : son code, ses dépendances, son build, et un serveur qui redémarre. */
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
// Première installation, ou `dist/` effacé : on construit avant de lancer.
if (!existsSync(join(serverDir, 'dist', 'main.js'))) {
  const r = await run('npm run build', [])
  if (r.code !== 0) say('initial build failed: starting anyway, the server will say what is missing')
}
startServer()
