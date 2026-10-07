import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedStream, SpawnFn } from '../../music/proxy'
import { runCapture } from '../../music/ytdlp'
import { toNetscape } from './cookie'

// Où est le flux d'un titre YouTube Music : yt-dlp (client `web_music`) + cookie du compte + PO Token.
// Sans cookie (utilisateur connecté qui n'a rien relié) : anonyme, ce que YouTube sert sans compte.
// Le proxy commun (`music/proxy.ts`) le sert ensuite aux enceintes.

export interface StreamResolveOpts {
  videoId: string
  /**
   * Conteneurs à PRÉFÉRER quel que soit le débit (ex. `['m4a']`) : pour un relais sans réencodage,
   * c'est ce que l'enceinte sait lire qui décide, pas le meilleur débit — un Sonos ne lit pas WebM.
   */
  preferExts?: string[]
  /** Vide = sans compte. */
  cookieRaw: string
  ytdlpPath: string
  poTokenUrl: string
  /** Fichier Netscape déjà écrit ; sinon on en crée un temporaire. */
  netscapePath?: string
  spawnImpl?: SpawnFn
}

/** Ping du générateur PO Token (Music Assistant : `GET {base}/ping`). */
export async function pingPoToken(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/ping`
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(3_000) })
    return r.ok
  } catch {
    return false
  }
}

/**
 * Résout la meilleure URL audio via yt-dlp (client `web_music` + PO Token + runtime JS node).
 * Même idée que Music Assistant `_get_stream_format` ; sans `--js-runtimes` yt-dlp ≥2026
 * ne livre plus que des storyboards.
 */
export async function resolveStreamUrl(opts: StreamResolveOpts): Promise<ResolvedStream> {
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnFn)
  let netscapePath = opts.netscapePath
  if (!netscapePath && opts.cookieRaw) {
    netscapePath = join(tmpdir(), `kasbah-ytm-${randomBytes(8).toString('hex')}.netscape`)
    await writeFile(netscapePath, toNetscape(opts.cookieRaw), 'utf8')
  }
  const poBase = opts.poTokenUrl.replace(/\/$/, '')
  const pageUrl = `https://music.youtube.com/watch?v=${opts.videoId}`
  // yt-dlp ≥2026.08 : `android_music` n'existe plus (« Skipping unsupported client »).
  // Sans runtime JS, seuls les storyboards restent (challenge n/sig) → « Requested format
  // is not available ». `web_music` + `--js-runtimes node` + PO Token livre m4a/opus.
  // Pas de `-f` : on dump `-J` puis on trie en JS. `--ignore-config` évite un `-f` user.
  const args = [
    '--ignore-config',
    '-J', '--no-download', '--no-warnings',
    ...(netscapePath ? ['--cookies', netscapePath] : []),
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--extractor-args', `youtubepot-bgutilhttp:base_url=${poBase}`,
    '--extractor-args', 'youtube:player_client=web_music;skip=translated_subs',
    pageUrl,
  ]
  const { code, stdout, stderr } = await runCapture(opts.ytdlpPath, args, spawnImpl)
  if (code !== 0) {
    const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ; ')
    throw new Error(`yt-dlp failed (${code})${tail ? `: ${tail}` : ''}`)
  }
  let info: { formats?: Array<{ url?: string; format_id?: string; ext?: string; acodec?: string; vcodec?: string; abr?: number; tbr?: number; filesize?: number; filesize_approx?: number }> ; url?: string; format_id?: string; ext?: string; duration?: number; is_live?: boolean }
  try { info = JSON.parse(stdout) as typeof info }
  catch { throw new Error('yt-dlp returned non-JSON') }
  // Préférer m4a / 140 / 141, sinon opus/webm, sinon premier format avec audio.
  const formats = info.formats ?? []
  const audio = formats
    .filter((f) => f.url && f.acodec && f.acodec !== 'none' && (f.vcodec === 'none' || !f.vcodec))
    .sort((a, b) => {
      const prefer = opts.preferExts?.map((e) => e.toLowerCase())
      const rank = (f: { ext?: string; format_id?: string; abr?: number; tbr?: number }) => {
        let r = 0
        if (prefer?.length) r += prefer.includes((f.ext ?? '').toLowerCase()) ? 10_000 : 0
        if (f.format_id === '141') r += 30
        else if (f.format_id === '140' || f.ext === 'm4a') r += 20
        else if (f.ext === 'webm' || f.ext === 'opus') r += 10
        r += f.abr ?? f.tbr ?? 0
        return r
      }
      return rank(b) - rank(a)
    })
  // Fallback : flux muxé (audio+vidéo) s'il n'y a pas d'audio-only — ffmpeg -vn suffit.
  const muxed = formats
    .filter((f) => f.url && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))
  const pick = audio[0] ?? muxed[0] ?? (info.url ? { url: info.url, format_id: info.format_id, ext: info.ext } : null)
  if (!pick?.url) throw new Error(`no audio stream format found (${formats.length} formats reported)`)
  const durationS = !info.is_live && typeof info.duration === 'number' && info.duration > 0 ? info.duration : null
  const rate = (pick as { abr?: number; tbr?: number }).abr ?? (pick as { tbr?: number }).tbr ?? null
  const size = (pick as { filesize?: number }).filesize ?? (pick as { filesize_approx?: number }).filesize_approx ?? null
  return {
    url: pick.url,
    formatId: pick.format_id ?? null,
    ext: pick.ext ?? null,
    abrKbps: rate ? Math.round(rate) : null,
    sizeBytes: typeof size === 'number' && size > 0 ? Math.floor(size) : null,
    durationS,
  }
}
