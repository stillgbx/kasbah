import { spawn } from 'node:child_process'
import type { ResolvedStream, SpawnFn } from '../../music/proxy'
import { runCapture } from '../../music/ytdlp'

// Where a Mixcloud mix's stream is: yt-dlp (`mixcloud` extractor) on the mix page. It offers a
// direct m4a (AAC ~64 kb/s on a free account), HLS and DASH; only the direct file can be relayed as
// is. yt-dlp does not give its size: a HEAD request reads it (`content-length`, ranges accepted) —
// it is what makes it a "file" for the speaker. Seen on 2026-09-23.

interface YtdlpFormat { url?: string; format_id?: string; ext?: string; protocol?: string; acodec?: string; vcodec?: string; abr?: number; tbr?: number; filesize?: number }

export interface MixcloudResolveOpts {
  key: string
  ytdlpPath: string
  spawnImpl?: SpawnFn
  fetchImpl?: typeof fetch
}

/** A format the speaker can play as a file: direct HTTP(S), audio, not a manifest. */
function isDirectAudio(f: YtdlpFormat): boolean {
  if (!f.url || !/^https?:\/\//i.test(f.url)) return false
  if (f.protocol && !/^https?$/.test(f.protocol)) return false
  if (f.vcodec && f.vcodec !== 'none') return false
  return f.acodec !== 'none'
}

export async function resolveMixcloud(opts: MixcloudResolveOpts): Promise<ResolvedStream> {
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnFn)
  const page = `https://www.mixcloud.com${opts.key}`
  const { code, stdout, stderr } = await runCapture(opts.ytdlpPath, ['--ignore-config', '-J', '--no-download', '--no-warnings', page], spawnImpl)
  if (code !== 0) {
    const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ; ')
    throw new Error(`yt-dlp failed (${code})${tail ? `: ${tail}` : ''}`)
  }
  let info: { formats?: YtdlpFormat[]; duration?: number }
  try { info = JSON.parse(stdout) as typeof info }
  catch { throw new Error('yt-dlp returned non-JSON') }
  const formats = info.formats ?? []
  const direct = formats.filter(isDirectAudio).sort((a, b) => ((b.ext === 'm4a' ? 1 : 0) - (a.ext === 'm4a' ? 1 : 0)))
  const pick = direct[0]
  if (!pick?.url) throw new Error(`no direct audio format for this mix (${formats.length} formats reported)`)
  // the direct file does not announce its bitrate: that of the HLS / DASH variants of the same file, if they say it
  const rate = pick.abr ?? pick.tbr ?? formats.map((f) => f.abr ?? f.tbr).find((r): r is number => typeof r === 'number') ?? null
  const sizeBytes = pick.filesize ?? await contentLength(pick.url, opts.fetchImpl ?? fetch)
  return {
    url: pick.url,
    formatId: pick.format_id ?? null,
    ext: pick.ext ?? null,
    abrKbps: rate ? Math.round(rate) : null,
    sizeBytes,
    durationS: typeof info.duration === 'number' && info.duration > 0 ? info.duration : null,
  }
}

/** File size, if the server announces it AND accepts ranges (otherwise it is not a file for the speaker). */
async function contentLength(url: string, fetchImpl: typeof fetch): Promise<number | null> {
  try {
    const res = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length'))
    const ranges = res.headers.get('accept-ranges')
    return Number.isFinite(len) && len > 0 && ranges === 'bytes' ? Math.floor(len) : null
  } catch {
    return null
  }
}
