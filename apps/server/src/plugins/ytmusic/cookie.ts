import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// Cookie YouTube Music : collé depuis les Réglages (comme le mot de passe Renault/MELCloud), jamais
// dans `.env`, jamais journalisé. yt-dlp exige le format Netscape ; InnerTube veut la chaîne brute.

/** Domaine des cookies Music (identique à Music Assistant). */
export const YTM_COOKIE_DOMAIN = '.youtube.com'

/** Présence obligatoire pour une session authentifiée Music. */
export const REQUIRED_COOKIE = '__Secure-3PAPISID'

export function hasRequiredCookie(raw: string): boolean {
  return raw.includes(REQUIRED_COOKIE)
}

/**
 * Convertit une chaîne `Cookie:` (ou paires `a=b; c=d`) en fichier Netscape pour yt-dlp.
 * Même logique que Music Assistant `convert_to_netscape`.
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

/** Fichier d'état sous `KASBAH_STATE_DIR` (ou chemin forcé). Chaîne vide = mémoire seule (tests). */
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
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, raw, 'utf8')
    },
    async clear() {
      try { await unlink(filePath) }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    },
  }
}

/** Écrit le Netscape à côté du cookie brut (même dossier, suffixe `.netscape`) pour yt-dlp. */
export async function writeNetscapeBeside(cookieFile: string, raw: string): Promise<string> {
  const netscapePath = `${cookieFile}.netscape`
  await mkdir(dirname(netscapePath), { recursive: true })
  await writeFile(netscapePath, toNetscape(raw), 'utf8')
  return netscapePath
}
