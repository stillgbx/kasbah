import type { YtmusicAlbum, YtmusicAlbumReleaseType, YtmusicArtist, YtmusicPlaylist, YtmusicTrack } from './types'

// Mappage PUR : formes déjà aplaties (fixtures ou extrait de youtubei.js) → DTO UI.
// Pas d'appel réseau ici — leçon MELCloud / Tahoma : schémas souples sur le mappé, pas sur le brut.

export interface RawTrack {
  videoId?: string | null
  id?: string | null
  title?: unknown
  artists?: Array<string | { name?: string | null } | null> | null
  artUrl?: string | null
  thumbnail?: string | null
  durationS?: number | null
  duration?: { seconds?: number | null } | null
  album?: string | { name?: unknown } | null
  explicit?: boolean | null
  year?: string | null
}

export interface RawPlaylist {
  id?: string | null
  playlistId?: string | null
  title?: unknown
  name?: unknown
  artUrl?: string | null
  thumbnail?: string | null
  trackCount?: number | null
  item_count?: string | number | null
}

export interface RawArtist {
  id?: string | null
  name?: unknown
  title?: unknown
  artUrl?: string | null
  thumbnail?: string | null
  subscribers?: string | null
}

export interface RawAlbum {
  id?: string | null
  title?: unknown
  name?: unknown
  artUrl?: string | null
  thumbnail?: string | null
  artists?: Array<string | { name?: string | null } | null> | null
  author?: { name?: string | null } | null
  year?: string | null
  /** Libellés bruts du sous-titre (ex. « Album », « Single ») pour en déduire le type. */
  subtitleParts?: string[] | null
  releaseType?: YtmusicAlbumReleaseType | null
  explicit?: boolean | null
}

/**
 * InnerTube n'a pas de champ `releaseType` : le type est dans le sous-titre
 * (« Album · Artiste · 1997 », « Single · … », « EP · … », « Compilation · … »).
 * Repli : titres du genre « Best of », « Greatest Hits », etc.
 */
export function parseReleaseType(parts: Iterable<string> | null | undefined): YtmusicAlbumReleaseType | null {
  if (!parts) return null
  for (const raw of parts) {
    const n = raw.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    if (!n) continue
    if (n === 'single' || n === 'singles' || n === 'maxi') return 'single'
    if (n === 'ep' || n === 'eps') return 'ep'
    if (n === 'compilation' || n === 'compilations' || n === 'anthology' || n === 'anthologie') return 'compilation'
    if (n === 'album' || n === 'albums' || n === 'lp' || n === 'lps') return 'album'
  }
  return null
}

/** Titres typiques de compil même si InnerTube dit « Album ». */
export function inferCompilationFromTitle(title: string | null | undefined): 'compilation' | null {
  if (!title) return null
  const n = title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  if (
    /\bbest\s*of\b/.test(n)
    || /\bgreatest\s*hits\b/.test(n)
    || /\bthe\s+very\s+best\b/.test(n)
    || /\bantholog/.test(n)
    || /\bcompilation\b/.test(n)
    || /\bintegrale\b/.test(n)
    || /\bessentiel(s|les)?\b/.test(n)
    || /\bedition\b/.test(n)
    || /\bessential\s+collection\b/.test(n)
  ) return 'compilation'
  return null
}

/**
 * youtubei.js expose souvent un `Text` ({ text, runs }) et non une string.
 * Sans ça, le titre d'une playlist tombe sur l'id (VLLM, VLPL…).
 */
export function textOf(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim()
    return t || null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.text === 'string') {
    const t = o.text.trim()
    if (t) return t
  }
  if (Array.isArray(o.runs)) {
    const t = o.runs.map((r) => {
      if (typeof r === 'string') return r
      if (r && typeof r === 'object' && typeof (r as { text?: unknown }).text === 'string') {
        return (r as { text: string }).text
      }
      return ''
    }).join('').trim()
    if (t) return t
  }
  if (typeof o.toString === 'function' && o.toString !== Object.prototype.toString) {
    const t = String(o.toString()).trim()
    if (t && t !== '[object Object]') return t
  }
  return null
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
  const album = textOf(typeof raw.album === 'string' ? raw.album : raw.album?.name ?? null)
  return {
    videoId,
    title: textOf(raw.title) || videoId,
    artists,
    artUrl: upgradeArtUrl(raw.artUrl ?? raw.thumbnail ?? null),
    durationS: typeof durationS === 'number' && Number.isFinite(durationS) && durationS >= 0
      ? Math.round(durationS) : null,
    album,
    year: raw.year?.trim() || null,
    explicit: !!raw.explicit,
  }
}

export function mapTracks(raws: RawTrack[]): YtmusicTrack[] {
  const out: YtmusicTrack[] = []
  const seen = new Set<string>()
  for (const r of raws) {
    const t = mapTrack(r)
    if (!t || seen.has(t.videoId)) continue
    seen.add(t.videoId)
    out.push(t)
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
  const title = textOf(raw.title) ?? textOf(raw.name) ?? ''
  return {
    id,
    title: title || id,
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

export function mapArtist(raw: RawArtist): YtmusicArtist | null {
  const id = (raw.id ?? '').trim()
  if (!id) return null
  const name = textOf(raw.name) ?? textOf(raw.title) ?? ''
  return {
    id,
    name: name || id,
    artUrl: upgradeArtUrl(raw.artUrl ?? raw.thumbnail ?? null),
    subscribers: raw.subscribers?.trim() || null,
  }
}

export function mapArtists(raws: RawArtist[]): YtmusicArtist[] {
  const out: YtmusicArtist[] = []
  const seen = new Set<string>()
  for (const r of raws) {
    const a = mapArtist(r)
    if (!a || seen.has(a.id)) continue
    seen.add(a.id)
    out.push(a)
  }
  return out
}

export function mapAlbum(raw: RawAlbum): YtmusicAlbum | null {
  const id = (raw.id ?? '').trim()
  if (!id) return null
  const artists = (raw.artists ?? [])
    .map((a) => (typeof a === 'string' ? a : a?.name ?? '').trim())
    .filter(Boolean)
  if (!artists.length && raw.author?.name?.trim()) artists.push(raw.author.name.trim())
  const title = textOf(raw.title) ?? textOf(raw.name) ?? ''
  const fromSub = parseReleaseType(raw.subtitleParts)
  const fromTitle = inferCompilationFromTitle(title)
  // « Best of » reste une compil même si InnerTube affiche « Album · … ».
  const releaseType = raw.releaseType
    ?? (fromTitle && fromSub !== 'single' && fromSub !== 'ep' ? fromTitle : null)
    ?? fromSub
    ?? null
  return {
    id,
    title: title || id,
    artUrl: upgradeArtUrl(raw.artUrl ?? raw.thumbnail ?? null),
    artists,
    year: raw.year?.trim() || null,
    releaseType,
    explicit: !!raw.explicit,
  }
}

export function mapAlbums(raws: RawAlbum[]): YtmusicAlbum[] {
  const out: YtmusicAlbum[] = []
  const seen = new Set<string>()
  for (const r of raws) {
    const a = mapAlbum(r)
    if (!a || seen.has(a.id)) continue
    seen.add(a.id)
    out.push(a)
  }
  return out
}

/** Plafond par section de recherche (UI en colonnes). */
export const SEARCH_SECTION_LIMIT = 20

/**
 * Répartit LP/album → albums, Single+EP → singles (colonne EP), Compilation → compilations.
 * Inconnu → albums. Chaque liste est bornée à {@link SEARCH_SECTION_LIMIT}.
 */
export function partitionAlbums(albums: YtmusicAlbum[]): {
  albums: YtmusicAlbum[]
  singles: YtmusicAlbum[]
  compilations: YtmusicAlbum[]
} {
  const out = {
    albums: [] as YtmusicAlbum[],
    singles: [] as YtmusicAlbum[],
    compilations: [] as YtmusicAlbum[],
  }
  for (const a of albums) {
    if (a.releaseType === 'single' || a.releaseType === 'ep') out.singles.push(a)
    else if (a.releaseType === 'compilation') out.compilations.push(a)
    else out.albums.push(a) // album | lp | null
  }
  return {
    albums: out.albums.slice(0, SEARCH_SECTION_LIMIT),
    singles: out.singles.slice(0, SEARCH_SECTION_LIMIT),
    compilations: out.compilations.slice(0, SEARCH_SECTION_LIMIT),
  }
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
