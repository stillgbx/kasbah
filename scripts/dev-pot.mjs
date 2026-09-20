#!/usr/bin/env node
/**
 * Lance le générateur PO Token (bgutil) pour ytmusic en local.
 * Absent de `_external/` (gitignored) ou déjà joignable sur :4416 → skip sans casser `npm run dev`.
 * (Pas dans vite.config : Vite ne doit pas piloter un service Node hors front.)
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = join(root, '_external', 'bgutil-ytdlp-pot-provider', 'server')
const main = join(serverDir, 'build', 'main.js')
const PING = 'http://127.0.0.1:4416/ping'

async function alreadyUp() {
  try {
    const r = await fetch(PING, { signal: AbortSignal.timeout(800) })
    return r.ok
  } catch {
    return false
  }
}

if (!existsSync(main)) {
  console.warn(
    '[pot] skip — clone/build dans _external/bgutil-ytdlp-pot-provider/server '
    + '(voir doc/3_plugins/3_16_ytmusic.md)',
  )
  process.exit(0)
}

if (await alreadyUp()) {
  console.log('[pot] déjà joignable sur', PING, '— skip')
  process.exit(0)
}

const child = spawn(process.execPath, [main], {
  cwd: serverDir,
  stdio: 'inherit',
  windowsHide: true,
})
child.on('error', (err) => {
  console.error('[pot]', err.message)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.exit(1)
  process.exit(code ?? 1)
})
