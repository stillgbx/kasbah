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

/** Taille demandée au CDN Google pour les pochettes (écrans Nest / TV). */
export const ART_CDN_SIZE = 544

/**
 * Passe d'une vignette catalogue (~60 px) à une taille adaptée à l'écran.
 * Les URL `googleusercontent` / `ggpht` acceptent `=wN-hN` ; hors ça, inchangé.
 * Indépendant du client yt-dlp (`android_music` vs `web_music`).
 */
export function upgradeArtUrl(url: string | null | undefined): string | null {
  const u = absHttpUrl(url)
  if (!u) return null
  if (/googleusercontent\.com|ggpht\.com/i.test(u)) {
    const size = `=w${ART_CDN_SIZE}-h${ART_CDN_SIZE}-l90-rj`
    if (/=w\d+-h\d+/i.test(u)) return u.replace(/=w\d+-h\d+[^=/?#]*/i, size)
    return `${u}${size}`
  }
  if (/i\.ytimg\.com/i.test(u)) {
    return u
      .replace(/\/default\.jpg/i, '/hqdefault.jpg')
      .replace(/\/mqdefault\.jpg/i, '/hqdefault.jpg')
      .replace(/\/sddefault\.jpg/i, '/hqdefault.jpg')
  }
  return u
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
    artUrl: upgradeArtUrl(raw.artUrl ?? raw.thumbnail ?? null),
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
    artUrl: upgradeArtUrl(raw.artUrl ?? raw.thumbnail ?? null),
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
  return best?.url ? upgradeArtUrl(best.url.startsWith('//') ? `https:${best.url}` : best.url) : null
}
