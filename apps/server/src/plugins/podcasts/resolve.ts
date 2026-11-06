import type { ResolvedStream } from '../../music/proxy'
import type { PodcastEpisode } from './api'

// Where an episode's audio is: the feed gives the file's address, often behind one or more
// tracking redirects. We follow them once here, so the speaker (through the relay) talks to the
// file's host directly, and we read its size: with a size and byte ranges, it is a "file" the
// speaker can seek in and resume; without, the shared player falls back to MP3 transcoding.

const EXT_OF_MIME: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg' }

function extOf(url: string, mime: string | null): string | null {
  const fromMime = mime ? EXT_OF_MIME[mime.split(';')[0]!.trim().toLowerCase()] : undefined
  if (fromMime) return fromMime
  try {
    const m = /\.([a-z0-9]{2,4})$/i.exec(new URL(url).pathname)
    return m ? m[1]!.toLowerCase() : null
  } catch { return null }
}

interface Probe { url: string; sizeBytes: number | null; mime: string | null }

/** HEAD first; a host that refuses it (or says nothing) gets a one-byte range request. */
async function probe(url: string, fetchImpl: typeof fetch): Promise<Probe> {
  try {
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8_000) })
    if (res.ok) {
      const len = Number(res.headers.get('content-length'))
      const mime = res.headers.get('content-type')
      if (Number.isFinite(len) && len > 0 && res.headers.get('accept-ranges') === 'bytes') return { url: res.url || url, sizeBytes: Math.floor(len), mime }
    }
  } catch { /* try the range request */ }
  try {
    const res = await fetchImpl(url, { headers: { range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(8_000) })
    void res.body?.cancel().catch(() => {})
    const total = res.status === 206 ? Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]) : NaN
    return { url: res.url || url, sizeBytes: Number.isFinite(total) && total > 0 ? total : null, mime: res.headers.get('content-type') }
  } catch {
    return { url, sizeBytes: null, mime: null }
  }
}

export async function resolveEpisode(ep: PodcastEpisode, fetchImpl: typeof fetch): Promise<ResolvedStream> {
  const p = await probe(ep.audioUrl, fetchImpl)
  const durationS = ep.durationS
  return {
    url: p.url,
    formatId: null,
    ext: extOf(p.url, p.mime ?? ep.audioType),
    abrKbps: p.sizeBytes && durationS ? Math.round((p.sizeBytes * 8) / durationS / 1000) : null,
    sizeBytes: p.sizeBytes,
    durationS,
  }
}
