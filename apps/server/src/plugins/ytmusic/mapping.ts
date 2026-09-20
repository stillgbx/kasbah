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

/** ≥ N artistes distincts sur une sortie → compilation (hors Single pur). */
export const MULTI_ARTIST_COMPILATION_MIN = 3

function uniqueArtistKeyCount(artists: string[]): number {
  const keys = new Set<string>()
  for (const a of artists) {
    const k = a.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    if (k) keys.add(k)
  }
  return keys.size
}

/**
 * InnerTube n'a pas de champ `releaseType` : le type est dans le sous-titre
 * (« Album · Artiste · 1997 », « Single · … », « EP · … », « Compilation · … »).
 * Repli : titres du genre « Best of », « Greatest Hits », etc.
 * Puis multi-artistes (≥ {@link MULTI_ARTIST_COMPILATION_MIN}) → compil.
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
    || /\bdj[\s-]*kicks\b/.test(n)
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

/** Taille CDN pour vignettes catalogue UI (~44 px × retina). */
export const ART_CDN_SIZE = 120
/** Taille CDN pour stickyPlay / Nest / TV. */
export const ART_PLAY_SIZE = 544

/**
 * Passe d'une vignette catalogue à une taille adaptée.
 * Les URL `googleusercontent` / `ggpht` acceptent `=wN-hN` ; `i.ytimg.com` via default/mq/hq.
 * Indépendant du client yt-dlp (`android_music` vs `web_music`).
 */
export function upgradeArtUrl(
  url: string | null | undefined,
  size: number = ART_CDN_SIZE,
): string | null {
  const u = absHttpUrl(url)
  if (!u) return null
  if (/googleusercontent\.com|ggpht\.com/i.test(u)) {
    const token = `=w${size}-h${size}-l90-rj`
    if (/=w\d+-h\d+/i.test(u)) return u.replace(/=w\d+-h\d+[^=/?#]*/i, token)
    return `${u}${token}`
  }
  if (/i\.ytimg\.com/i.test(u)) {
    const leaf = size <= 120 ? 'default.jpg'
      : size <= 320 ? 'mqdefault.jpg'
        : 'hqdefault.jpg'
    return u
      .replace(/\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.jpg/i, `/${leaf}`)
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
  let releaseType = raw.releaseType ?? fromSub ?? null
  // « Best of » / « Greatest Hits » → compil même si InnerTube / getAlbum dit Album.
  // (les mots-clés titre sont déjà normalisés en minuscules → casse ignorée)
  if (fromTitle && releaseType !== 'single' && releaseType !== 'ep') {
    releaseType = 'compilation'
  }
  // Plusieurs artistes distincts → compil (ex. « whose radio? »), sauf Single.
  if (
    releaseType !== 'single'
    && uniqueArtistKeyCount(artists) >= MULTI_ARTIST_COMPILATION_MIN
  ) {
    releaseType = 'compilation'
  }
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
  const byId = new Map<string, YtmusicAlbum>()
  const byTitleArtist = new Map<string, YtmusicAlbum>()
  const mergeInto = (prev: YtmusicAlbum, a: YtmusicAlbum) => {
    const rank = (t: typeof a.releaseType) =>
      t === 'compilation' ? 4 : t === 'album' ? 3 : t === 'ep' ? 2 : t === 'single' ? 1 : 0
    if (rank(a.releaseType) > rank(prev.releaseType)) prev.releaseType = a.releaseType
    if (!prev.year && a.year) prev.year = a.year
    if (!prev.artUrl && a.artUrl) prev.artUrl = a.artUrl
    if (a.artists.length > prev.artists.length) prev.artists = a.artists
    if (!prev.explicit && a.explicit) prev.explicit = a.explicit
    // Re-évaluer multi-artistes après fusion des crédits.
    if (
      prev.releaseType !== 'single'
      && uniqueArtistKeyCount(prev.artists) >= MULTI_ARTIST_COMPILATION_MIN
    ) {
      prev.releaseType = 'compilation'
    }
  }
  for (const r of raws) {
    const a = mapAlbum(r)
    if (!a) continue
    const prevId = byId.get(a.id)
    if (prevId) {
      mergeInto(prevId, a)
      continue
    }
    // Même sortie, browseId InnerTube différent (ex. Drive Home ×2).
    // Clé = titre + artiste + famille de type (EP ≠ Album du même nom, cas Jäde).
    if (a.artists.length) {
      const family = a.releaseType === 'ep' || a.releaseType === 'single' ? a.releaseType
        : a.releaseType === 'compilation' ? 'compilation'
          : 'album'
      const titleKey = `${albumTitleKey(a.title)}|${albumTitleKey(a.artists.join('\0'))}|${family}`
      const prevTitle = byTitleArtist.get(titleKey)
      if (prevTitle) {
        mergeInto(prevTitle, a)
        continue
      }
      byTitleArtist.set(titleKey, a)
    }
    byId.set(a.id, a)
    out.push(a)
  }
  propagateExplicitByTitle(out)
  return out
}

/**
 * InnerTube omet parfois `MUSIC_EXPLICIT_BADGE` sur l'EP alors que l'Album
 * du même titre / artiste le porte — propager le flag.
 */
export function propagateExplicitByTitle(albums: YtmusicAlbum[]): void {
  const marked = new Set<string>()
  for (const a of albums) {
    if (!a.explicit) continue
    marked.add(`${albumTitleKey(a.title)}|${albumTitleKey(a.artists.join('\0'))}`)
  }
  if (!marked.size) return
  for (const a of albums) {
    if (a.explicit) continue
    if (marked.has(`${albumTitleKey(a.title)}|${albumTitleKey(a.artists.join('\0'))}`)) {
      a.explicit = true
    }
  }
}

function albumTitleKey(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
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
