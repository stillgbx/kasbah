#!/usr/bin/env node
/**
 * Development server restarted when a source changes (`apps/server/src`, `packages/<x>/src`).
 * Replaces `node --watch`: on Windows, libuv subscribes `fs.watch` to the LAST ACCESS time, and NTFS
 * rewrites it when reading a file not read for more than an hour. Merely loading the
 * modules thus arrived as a modification, and the server restarted in cascade at the first
 * start of the day. Here, an event only counts if the modification date or the size has
 * moved, and a burst of writes only restarts once. Details and issues:
 * doc/6_faq/6_0_pieges-outillage.md (2026-10-10).
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = join(root, 'apps', 'server')
const dirs = [join(serverDir, 'src'), ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'src'))]
  .filter((d) => existsSync(d))
const DEBOUNCE_MS = 300

/** The sources the server loads; a modified test does not restart it. */
const watched = (name) => /\.[cm]?[jt]s$/.test(name) && !/\.test\.[cm]?[jt]s$/.test(name)

/** What changes on a write, not on a read. `null`: file absent. */
function stamp(file) {
  try {
    const s = statSync(file)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return null
  }
}

const stamps = new Map()
function scan(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) scan(p)
    else if (watched(e.name)) stamps.set(p, stamp(p))
  }
}

let child = null
let restartQueued = false
let stopping = false

function run() {
  child = spawn(process.execPath, ['--import', 'tsx', '--env-file-if-exists=.env', 'src/main.ts'], {
    cwd: serverDir,
    stdio: 'inherit',
  })
  child.on('exit', (code) => {
    child = null
    if (stopping) process.exit(code ?? 0)
    if (restartQueued) {
      restartQueued = false
      run()
    } else {
      console.log(`[dev-server] server stopped (code ${code}), restarting on the next change`)
    }
  })
}

/** On Windows, `kill()` cuts dead: the `shutdown()` of `main.ts` does not run (as under `node --watch`). */
function restart(files) {
  console.log(`[dev-server] relance : ${files.map((f) => f.slice(root.length + 1)).join(', ')}`)
  if (child) {
    restartQueued = true
    child.kill()
  } else {
    run()
  }
}

let timer = null
const changed = new Set()
for (const dir of dirs) {
  scan(dir)
  watch(dir, { recursive: true }, (_, name) => {
    if (!name || !watched(name)) return
    const file = join(dir, name)
    const now = stamp(file)
    if (stamps.get(file) === now) return   // read (access time) or duplicate event
    stamps.set(file, now)
    changed.add(file)
    clearTimeout(timer)
    timer = setTimeout(() => {
      const files = [...changed]
      changed.clear()
      restart(files)
    }, DEBOUNCE_MS)
  })
}

function stop(signal) {
  stopping = true
  if (!child) process.exit(0)
  // on Windows, the child receives the same Ctrl+C from the console: killing it would cut its clean shutdown
  if (process.platform !== 'win32') child.kill(signal)
  setTimeout(() => child?.kill(), 10_000).unref()
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

run()
