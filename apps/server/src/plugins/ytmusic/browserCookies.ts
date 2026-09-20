import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PluginError } from '../../core/plugin'
import { fromNetscape, hasRequiredCookie } from './cookie'
import type { SpawnFn } from './stream'

// Import des cookies YouTube depuis le navigateur **de la machine qui héberge Kasbah**
// (`yt-dlp --cookies-from-browser`). Pas la tablette : yt-dlp ne voit que le disque local.

export const YTM_BROWSERS = ['chrome', 'edge', 'firefox', 'chromium', 'brave'] as const
export type YtmBrowser = (typeof YTM_BROWSERS)[number]

function runCapture(command: string, args: string[], spawnImpl: SpawnFn): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (c: string) => { stdout += c })
    proc.stderr.on('data', (c: string) => { stderr += c })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/** Erreur d'auth InnerTube / yt-dlp typique d'un cookie mort. */
export function isAuthError(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? String(err)).toLowerCase()
  return /401|403|unauthoriz|login[_ ]?required|sign[_ ]?in|sapisid|cookie.*(expir|invalid|dead)|not logged|authentication/i.test(msg)
}

/** Message d'échec lisible (DB verrouillée yt-dlp#7271 ; DPAPI Chrome Win yt-dlp#10927). */
export function browserImportFailureMessage(browser: string, stderr: string): string {
  const lines = [...new Set(stderr.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean))]
  const joined = lines.join(' ').toLowerCase()
  if (/could not copy .* cookie database|cookie database/i.test(joined)) {
    return (
      `cannot read ${browser} cookies while the browser is running — ` +
      `quit ${browser} completely on this server host (all windows), then click Import again; ` +
      `or paste the cookie manually`
    )
  }
  // Chrome/Edge Windows : chiffrement lié à l'appli — --cookies-from-browser casse souvent.
  if (/failed to decrypt with dpapi|decrypt.*dpapi|application.?bound.?encryption/i.test(joined)) {
    return (
      `${browser} cookie decryption failed on Windows (Chrome/Edge App-Bound Encryption) — ` +
      `paste the Cookie header instead (see steps below), or try Firefox logged in to music.youtube.com`
    )
  }
  const tail = lines.slice(-2).join(' ; ')
  return `yt-dlp --cookies-from-browser failed${tail ? `: ${tail}` : ''} — log in to music.youtube.com in ${browser} on this server host`
}

/**
 * Lit les cookies YouTube du profil navigateur local via yt-dlp, les écrit en Netscape, puis
 * renvoie la chaîne `Cookie:` pour InnerTube. Le navigateur doit être connecté à
 * music.youtube.com **sur cette machine** (fermer la fenêtre privée sans se déconnecter).
 * Chrome/Edge : quitter le navigateur entièrement avant l'import (sinon DB verrouillée).
 */
export async function importCookiesFromBrowser(opts: {
  ytdlpPath: string
  browser: string
  netscapePath: string
  spawnImpl?: SpawnFn
}): Promise<string> {
  if (!YTM_BROWSERS.includes(opts.browser as YtmBrowser)) {
    throw new PluginError('INVALID_BODY', `unsupported browser "${opts.browser}" (use ${YTM_BROWSERS.join(', ')})`)
  }
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnFn)
  await mkdir(dirname(opts.netscapePath), { recursive: true })
  try { await unlink(opts.netscapePath) } catch { /* absent */ }
  // yt-dlp dump le jar navigateur dans `--cookies` en fin de course. L'URL doit être
  // extractible (music.youtube.com/ home → "Unsupported URL") ; les cookies .youtube.com
  // couvrent aussi Music.
  const args = [
    '--ignore-config',
    '--cookies-from-browser', opts.browser,
    '--cookies', opts.netscapePath,
    '--skip-download',
    '--no-warnings',
    '--print', 'id',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  ]
  const { code, stderr } = await runCapture(opts.ytdlpPath, args, spawnImpl)
  // Parfois le Netscape est déjà écrit même si l'extract échoue ensuite — on le tente.
  let netscape: string | null = null
  try { netscape = await readFile(opts.netscapePath, 'utf8') } catch { /* absent */ }
  if (code !== 0) {
    if (!netscape || !hasRequiredCookie(fromNetscape(netscape))) {
      throw new PluginError('UPSTREAM_ERROR', browserImportFailureMessage(opts.browser, stderr))
    }
  } else if (!netscape) {
    throw new PluginError('UPSTREAM_ERROR', 'yt-dlp did not write a cookies file — check browser profile on the server host')
  }
  const raw = fromNetscape(netscape)
  if (!hasRequiredCookie(raw)) {
    throw new PluginError(
      'NEEDS_PAIRING',
      `no __Secure-3PAPISID in ${opts.browser} cookies — open music.youtube.com in a normal (non-private) ${opts.browser} window, stay logged in, quit, then retry`,
    )
  }
  await writeFile(opts.netscapePath, netscape, 'utf8')
  return raw
}
