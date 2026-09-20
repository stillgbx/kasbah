import type { YtmusicPlaylist, YtmusicTrack } from './types'

// Mappage PUR : formes déjà aplaties (fixtures ou extrait de youtubei.js) → DTO UI.
// Pas d'appel réseau ici — leçon MELCloud / Tahoma : schémas souples sur le mappé, pas sur le brut.

export interface RawTrack {
  videoId?: string | null
  id?: string | null
  title?: string | null
  artists?: Array<string | { name?: string | null } | null> | null
  artUrl?: string | null
  thumbnail?: string | null
  durationS?: number | null
  duration?: { seconds?: number | null } | null
  album?: string | { name?: string | null } | null
}

export interface RawPlaylist {
  id?: string | null
  playlistId?: string | null
  title?: string | null
  name?: string | null
  artUrl?: string | null
  thumbnail?: string | null
  trackCount?: number | null
  item_count?: string | number | null
}

/** Absolue HTTPS : youtubei renvoie parfois `//i.ytimg.com/…`. */
export function absHttpUrl(url: string | null | undefined): string | null {
  const u = url?.trim()
  if (!u) return null
  if (u.startsWith('//')) return `https:${u}`
  if (/^https?:\/\//i.test(u)) return u
  return null
}

export function mapTrack(raw: RawTrack): YtmusicTrack | null {
  const videoId = (raw.videoId ?? raw.id ?? '').trim()
  if (!videoId) return null
  const artists = (raw.artists ?? [])
    .map((a) => (typeof a === 'string' ? a : a?.name ?? '').trim())
    .filter(Boolean)
  const durationS = raw.durationS ?? raw.duration?.seconds ?? null
  const album = typeof raw.album === 'string' ? raw.album : raw.album?.name ?? null
  return {
    videoId,
    title: (raw.title ?? '').trim() || videoId,
    artists,
    artUrl: absHttpUrl(raw.artUrl ?? raw.thumbnail ?? null),
    durationS: typeof durationS === 'number' && Number.isFinite(durationS) && durationS >= 0
      ? Math.round(durationS) : null,
    album: album?.trim() || null,
  }
}

export function mapTracks(raws: RawTrack[]): YtmusicTrack[] {
  const out: YtmusicTrack[] = []
  for (const r of raws) {
    const t = mapTrack(r)
    if (t) out.push(t)
  }
  return out
}

export function mapPlaylist(raw: RawPlaylist): YtmusicPlaylist | null {
  const id = (raw.id ?? raw.playlistId ?? '').trim()
  if (!id) return null
  let trackCount: number | null = null
  if (typeof raw.trackCount === 'number' && Number.isFinite(raw.trackCount)) trackCount = Math.max(0, Math.round(raw.trackCount))
  else if (typeof raw.item_count === 'number') trackCount = Math.max(0, Math.round(raw.item_count))
  else if (typeof raw.item_count === 'string') {
    const n = Number.parseInt(raw.item_count.replace(/\D/g, ''), 10)
    if (Number.isFinite(n)) trackCount = n
  }
  return {
    id,
    title: (raw.title ?? raw.name ?? '').trim() || id,
    artUrl: absHttpUrl(raw.artUrl ?? raw.thumbnail ?? null),
    trackCount,
  }
}

export function mapPlaylists(raws: RawPlaylist[]): YtmusicPlaylist[] {
  const out: YtmusicPlaylist[] = []
  for (const r of raws) {
    const p = mapPlaylist(r)
    if (p) out.push(p)
  }
  return out
}

/** Meilleure vignette d'une liste youtubei (largeur max). */
export function bestThumb(thumbs: Array<{ url?: string; width?: number } | null> | undefined): string | null {
  if (!thumbs?.length) return null
  let best: { url: string; width: number } | null = null
  for (const t of thumbs) {
    const url = t?.url?.trim()
    if (!url) continue
    const width = t?.width ?? 0
    if (!best || width >= best.width) best = { url, width }
  }
  return best?.url ? (best.url.startsWith('//') ? `https:${best.url}` : best.url) : null
}
