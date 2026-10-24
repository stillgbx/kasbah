import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedStream, SpawnFn } from '../../music/proxy'
import { runCapture } from '../../music/ytdlp'
import { toNetscape } from './cookie'

// Where a YouTube Music track's stream is: yt-dlp (`web_music` client) + the account's cookie + PO Token.
// Without a cookie (signed-in user who linked nothing): anonymous, what YouTube serves without an account.
// The shared proxy (`music/proxy.ts`) then serves it to the speakers.

export interface StreamResolveOpts {
  videoId: string
  /**
   * Containers to PREFER whatever the bitrate (e.g. `['m4a']`): for a relay without re-encoding,
   * what the speaker can play decides, not the best bitrate — a Sonos does not play WebM.
   */
  preferExts?: string[]
  /** Empty = no account. */
  cookieRaw: string
  ytdlpPath: string
  poTokenUrl: string
  /** Netscape file already written; otherwise a temporary one is created. */
  netscapePath?: string
  spawnImpl?: SpawnFn
}

/** Ping of the PO Token generator (Music Assistant: `GET {base}/ping`). */
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
 * Resolves the best audio URL through yt-dlp (`web_music` client + PO Token + node JS runtime).
 * Same idea as Music Assistant's `_get_stream_format`; without `--js-runtimes` yt-dlp ≥2026
 * only delivers storyboards.
 */
export async function resolveStreamUrl(opts: StreamResolveOpts): Promise<ResolvedStream> {
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnFn)
  let netscapePath = opts.netscapePath
  if (!netscapePath && opts.cookieRaw) {
    netscapePath = join(tmpdir(), `kasbah-ytm-${randomBytes(8).toString('hex')}.netscape`)
    await writeFile(netscapePath, toNetscape(opts.cookieRaw), { encoding: 'utf8', mode: 0o600 })
  }
  const poBase = opts.poTokenUrl.replace(/\/$/, '')
  const pageUrl = `https://music.youtube.com/watch?v=${opts.videoId}`
  // yt-dlp ≥2026.08: `android_music` no longer exists ("Skipping unsupported client").
  // Without a JS runtime, only storyboards remain (n/sig challenge) → "Requested format
  // is not available". `web_music` + `--js-runtimes node` + PO Token delivers m4a/opus.
  // No `-f`: we dump `-J` then sort in JS. `--ignore-config` avoids a user `-f`.
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
  // Prefer m4a / 140 / 141, otherwise opus/webm, otherwise the first format with audio.
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
  // Fallback: muxed stream (audio+video) if there is no audio-only one — ffmpeg -vn is enough.
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
