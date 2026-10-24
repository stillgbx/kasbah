import { readFile, unlink } from 'node:fs/promises'
import { writeFileAtomic } from '../../core/atomic-file'

// YouTube Music cookie: pasted from Settings (like the Renault/MELCloud password), never in
// `.env`, never logged. yt-dlp requires the Netscape format; InnerTube wants the raw string. Both
// copies are the whole Google session: written 0600, and both removed when the account is unlinked.

/** Domain of the Music cookies (same as Music Assistant). */
export const YTM_COOKIE_DOMAIN = '.youtube.com'

/** Must be present for an authenticated Music session. */
export const REQUIRED_COOKIE = '__Secure-3PAPISID'

export function hasRequiredCookie(raw: string): boolean {
  return raw.includes(REQUIRED_COOKIE)
}

/**
 * Netscape → `Cookie:` string for InnerTube. Ignores comment lines.
 */
export function fromNetscape(text: string): string {
  const pairs: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const parts = line.split('\t')
    if (parts.length < 7) continue
    const name = parts[5]?.trim()
    const value = parts[6] ?? ''
    if (!name) continue
    pairs.push(`${name}=${value}`)
  }
  return pairs.join('; ')
}

/**
 * Converts a `Cookie:` string (or `a=b; c=d` pairs) into a Netscape file for yt-dlp.
 * Same logic as Music Assistant's `convert_to_netscape`.
 */
export function toNetscape(raw: string, domain = YTM_COOKIE_DOMAIN): string {
  const lines = ['# Netscape HTTP Cookie File']
  for (const part of raw.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!key) continue
    lines.push(`${domain}\tTRUE\t/\tTRUE\t0\t${key}\t${value}`)
  }
  return `${lines.join('\n')}\n`
}

export interface CookieStore {
  read(): Promise<string | null>
  write(raw: string): Promise<void>
  clear(): Promise<void>
  path: string | null
}

/** State file under `KASBAH_STATE_DIR` (or a forced path). Empty string = memory only (tests). */
export function createCookieFile(filePath: string): CookieStore {
  if (!filePath) {
    let mem: string | null = null
    return {
      path: null,
      async read() { return mem },
      async write(raw) { mem = raw },
      async clear() { mem = null },
    }
  }
  return {
    path: filePath,
    async read() {
      try { return await readFile(filePath, 'utf8') }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw err
      }
    },
    async write(raw) {
      await writeFileAtomic(filePath, raw, { mode: 0o600 })
    },
    async clear() {
      for (const path of [filePath, `${filePath}.netscape`]) {
        try { await unlink(path) }
        catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }
      }
    },
  }
}

/** Writes the Netscape file next to the raw cookie (same folder, `.netscape` suffix) for yt-dlp. */
export async function writeNetscapeBeside(cookieFile: string, raw: string): Promise<string> {
  const netscapePath = `${cookieFile}.netscape`
  await writeFileAtomic(netscapePath, toNetscape(raw), { mode: 0o600 })
  return netscapePath
}
