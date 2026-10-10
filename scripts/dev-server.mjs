#!/usr/bin/env node
/**
 * Serveur de développement relancé quand une source change (`apps/server/src`, `packages/<x>/src`).
 * Remplace `node --watch` : sous Windows, libuv abonne `fs.watch` à l'heure de DERNIER ACCÈS, et NTFS
 * la réécrit à la lecture d'un fichier non lu depuis plus d'une heure. Le simple chargement des
 * modules arrivait donc comme une modification, et le serveur se relançait en cascade au premier
 * démarrage de la journée. Ici, un événement ne compte que si la date de modification ou la taille a
 * bougé, et une rafale d'écritures ne relance qu'une fois. Détail et issues :
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

/** Les sources que le serveur charge ; un test modifié ne le relance pas. */
const watched = (name) => /\.[cm]?[jt]s$/.test(name) && !/\.test\.[cm]?[jt]s$/.test(name)

/** Ce qui change à une écriture, pas à une lecture. `null` : fichier absent. */
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
      console.log(`[dev-server] serveur arrêté (code ${code}), relance à la prochaine modification`)
    }
  })
}

/** Sous Windows, `kill()` coupe net : le `shutdown()` de `main.ts` ne tourne pas (comme sous `node --watch`). */
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
    if (stamps.get(file) === now) return   // lecture (heure d'accès) ou doublon d'événement
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
  // sous Windows, l'enfant reçoit le même Ctrl+C de la console : le tuer couperait son arrêt propre
  if (process.platform !== 'win32') child.kill(signal)
  setTimeout(() => child?.kill(), 10_000).unref()
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

run()
