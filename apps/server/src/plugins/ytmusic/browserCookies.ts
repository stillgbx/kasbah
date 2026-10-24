import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic } from '../../core/atomic-file'
import { PluginError } from '../../core/plugin'
import { fromNetscape, hasRequiredCookie } from './cookie'
import type { SpawnFn } from '../../music/proxy'

// Import of the YouTube cookies from the browser **of the machine hosting Kasbah**
// (`yt-dlp --cookies-from-browser`). Not the screen's: yt-dlp only sees the local disk.

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

/** InnerTube / yt-dlp auth error typical of a dead cookie. */
export function isAuthError(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? String(err)).toLowerCase()
  return /401|403|unauthoriz|login[_ ]?required|sign[_ ]?in|sapisid|cookie.*(expir|invalid|dead)|not logged|authentication/i.test(msg)
}

/** Readable failure message (locked DB yt-dlp#7271; Chrome Win DPAPI yt-dlp#10927). */
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
  // Chrome/Edge Windows: app-bound encryption — --cookies-from-browser often breaks.
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
 * Reads the YouTube cookies of the local browser profile through yt-dlp, writes them as Netscape,
 * then returns the `Cookie:` string for InnerTube. The browser must be signed in to
 * music.youtube.com **on this machine** (close the private window without signing out).
 * Chrome/Edge: quit the browser entirely before the import (otherwise locked DB).
 */
export async function importCookiesFromBrowser(opts: {
  ytdlpPath: string
  browser: string
  netscapePath: string
  spawnImpl?: SpawnFn
}): Promise<string> {
  if (!YTM_BROWSERS.includes(opts.browser as YtmBrowser)) {
    throw new PluginError('UNSUPPORTED_COMMAND', `unsupported browser "${opts.browser}" (use ${YTM_BROWSERS.join(', ')})`)
  }
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnFn)
  await mkdir(dirname(opts.netscapePath), { recursive: true })
  try { await unlink(opts.netscapePath) } catch { /* absent */ }
  // yt-dlp dumps the browser jar into `--cookies` at the end of the run. The URL must be
  // extractable (music.youtube.com/ home → "Unsupported URL"); the .youtube.com cookies
  // cover Music too.
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
  // Sometimes the Netscape file is already written even if the extract fails afterwards — try it.
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
  await writeFileAtomic(opts.netscapePath, netscape, { mode: 0o600 })
  return raw
}
