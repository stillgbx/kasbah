import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { REPO_ROOT } from '../../core/paths'
import type { SpawnFn } from '../../music/proxy'

// The PO Token generator (bgutil) launched by the plugin, so that `npm run start` gets it as
// `npm run dev` does: only when it is built in `_external/` (gitignored, see the wiki page
// 3_16), only for an address on this machine, and only when nothing answers there yet.

/** Where the setup procedure builds the generator. */
export const POT_SERVER_MAIN = resolve(REPO_ROOT, '_external/bgutil-ytdlp-pot-provider/server/build/main.js')

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Launches the generator on the port of `url`; a string = why it was not launched. */
export function spawnPoTokenServer(spawnImpl: SpawnFn, url: string, main: string): ChildProcessWithoutNullStreams | string {
  const u = new URL(url)
  if (!LOOPBACK.has(u.hostname)) return `not launched: ${url} is not on this machine`
  if (!existsSync(main)) return `not launched: ${main} is missing (see doc/3_plugins/3_16_ytmusic.md)`
  return spawnImpl(process.execPath, [main, '--port', u.port || '80'], { cwd: dirname(dirname(main)), windowsHide: true })
}
