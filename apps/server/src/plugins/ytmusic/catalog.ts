import { ClientType, Innertube } from 'youtubei.js'
import {
  bestThumb,
  mapAlbums,
  mapArtists,
  mapPlaylist,
  mapPlaylists,
  mapTrack,
  mapTracks,
  parseReleaseType,
  partitionAlbums,
  SEARCH_SECTION_LIMIT,
  textOf,
  type RawAlbum,
  type RawArtist,
  type RawPlaylist,
  type RawTrack,
} from './mapping'
import type { YtmusicPlaylist, YtmusicSearchResult, YtmusicTrack } from './types'

// Catalogue via youtubei.js `yt.music` (client InnerTube Music / WEB_REMIX).
// Pas de flux audio ici — c'est le rôle de yt-dlp + PO Token (`stream.ts`).

export type InnertubeLike = {
  music: {
    search(query: string, filters?: { type?: string }): Promise<{
      songs?: { contents?: unknown[] }
      videos?: { contents?: unknown[] }
      albums?: { contents?: unknown[] }
      artists?: { contents?: unknown[] }
      contents?: unknown[]
    }>
    getPlaylist(id: string): Promise<{
      items?: unknown[]
      contents?: unknown[]
    }>
    getAlbum?(id: string): Promise<{
      contents?: unknown[]
      header?: unknown
    }>
    getArtist?(id: string): Promise<{
      sections?: unknown[]
      header?: unknown
    }>
    getLibrary(): Promise<{
      contents?: unknown[]
      applyFilter?(filter: string): Promise<{ contents?: unknown[] }>
    }>
  }
}

export type CreateSession = (cookie: string) => Promise<InnertubeLike>

/** WEB_REMIX : même client que music.youtube.com (pas le client WEB générique). */
const defaultCreate: CreateSession = async (cookie) =>
  Innertube.create({ cookie, client_type: ClientType.MUSIC }) as unknown as InnertubeLike

/** Session InnerTube morte (HMR / body déjà consommé) — typiquement `null.read`. */
function isDeadSession(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /reading ['"]read['"]|body.*used|ECONNRESET|fetch failed/i.test(msg)
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? v as Record<string, unknown> : null
}

function thumbsOf(o: Record<string, unknown>): Array<{ url?: string; width?: number }> | undefined {
  const out: Array<{ url?: string; width?: number }> = []
  const pushEntry = (t: unknown) => {
    const r = asRecord(t)
    if (!r) return
    if (typeof r.url === 'string' && r.url.trim()) {
      out.push({ url: r.url.trim(), width: typeof r.width === 'number' ? r.width : undefined })
      return
    }
    // ThumbnailDetails / MusicThumbnail imbriqués
    for (const n of asList(r.contents)) pushEntry(n)
    for (const n of asList(r.thumbnails)) pushEntry(n)
    for (const n of asList(r.sources)) pushEntry(n)
  }
  const pushAll = (v: unknown) => { for (const t of asList(v)) pushEntry(t) }

  pushAll(o.thumbnails)
  if (!out.length) {
    const th = o.thumbnail
    const nested = asRecord(th)
    // MusicResponsiveListItem : MusicThumbnail ; MusicTwoRowItem : Thumbnail[]
    if (nested && !Array.isArray(th) && typeof (th as { [Symbol.iterator]?: unknown })?.[Symbol.iterator] !== 'function') {
      pushAll(nested.contents)
      pushAll(nested.thumbnails)
    } else {
      pushAll(th)
    }
  }
  if (!out.length) {
    pushAll(o.avatar)
    pushAll(asRecord(o.avatar)?.contents)
    pushAll(asRecord(o.avatar)?.thumbnails)
  }
  return out.length ? out : undefined
}

/** Année YYYY dans le sous-titre / flex_columns (ex. « … · 2021 »). */
function yearOf(o: Record<string, unknown>): string | null {
  if (typeof o.year === 'string') {
    const y = o.year.trim()
    if (/^[12]\d{3}$/.test(y)) return y
  }
  for (const p of subtitlePartsOf(o)) {
    const t = p.trim()
    if (/^[12]\d{3}$/.test(t)) return t
  }
  return null
}

function itemToRawTrack(item: unknown): RawTrack | null {
  const o = asRecord(item)
  if (!o) return null
  const id = typeof o.id === 'string' ? o.id : null
  const title = textOf(o.title)
  if (!id && !title) return null
  let artists = Array.isArray(o.artists)
    ? o.artists.map((a) => {
      const ar = asRecord(a)
      return typeof a === 'string' ? a : (typeof ar?.name === 'string' ? ar.name : null)
    }).filter((a): a is string => !!a)
    : []
  // Music Video (TwoRow) : souvent pas de `artists[]`, crédit dans le sous-titre.
  if (!artists.length) {
    const parts = subtitlePartsOf(o).map((p) => p.trim()).filter(Boolean)
    const skip = /^(views?|view|vues?|\d[\d.,]*\s*[kmb]?\s*views?)$/i
    for (const p of parts) {
      if (skip.test(p) || /^[12]\d{3}$/.test(p)) continue
      if (p.includes('·') || p.includes('•')) continue
      artists = [p]
      break
    }
  }
  const duration = asRecord(o.duration)
  const album = asRecord(o.album)
  return {
    videoId: id,
    title,
    artists,
    artUrl: bestThumb(thumbsOf(o)),
    durationS: typeof duration?.seconds === 'number' ? duration.seconds : null,
    album: textOf(album?.name) ?? (typeof o.album === 'string' ? o.album : null),
    year: yearOf(o),
    explicit: isExplicit(o),
  }
}

function itemToRawPlaylist(item: unknown): RawPlaylist | null {
  const o = asRecord(item)
  if (!o) return null
  // Bibliothèque : albums / artistes mélangés si le filtre échoue — ne garder que les playlists.
  if (typeof o.item_type === 'string' && o.item_type !== 'playlist') return null
  const id = typeof o.id === 'string' ? o.id
    : (typeof o.playlistId === 'string' ? o.playlistId : null)
  const title = textOf(o.title) ?? textOf(o.name)
  if (!id) return null
  return {
    id,
    title,
    artUrl: bestThumb(thumbsOf(o)),
    item_count: (o.item_count ?? o.song_count ?? o.trackCount) as string | number | null | undefined,
  }
}

/** Liste utilisable : Array ou ObservedArray (Proxy youtubei.js). */
function asList(v: unknown): unknown[] {
  if (!v) return []
  if (Array.isArray(v)) return v
  if (typeof v === 'object' && typeof (v as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    return Array.from(v as Iterable<unknown>)
  }
  return []
}

/** Badges : tableau, ObservedArray, ou objet unique (`subtitle_badge`). */
function badgeList(v: unknown): unknown[] {
  const list = asList(v)
  if (list.length) return list
  if (v && typeof v === 'object') return [v]
  return []
}

/** Badge InnerTube `MUSIC_EXPLICIT_BADGE` / `EXPLICIT`, ou booléen exposé par youtubei. */
function isExplicit(o: Record<string, unknown>): boolean {
  if (o.is_explicit === true || o.isExplicit === true || o.explicit === true) return true
  const lists = [o.badges, o.subtitle_badges, o.subtitle_badge]
  for (const list of lists) {
    for (const raw of badgeList(list)) {
      const b = asRecord(raw)
      if (!b) continue
      const icon = typeof b.icon_type === 'string' ? b.icon_type
        : (typeof asRecord(b.icon)?.iconType === 'string' ? String(asRecord(b.icon)!.iconType) : null)
      if (icon === 'MUSIC_EXPLICIT_BADGE' || icon === 'EXPLICIT') return true
      const label = typeof b.label === 'string' ? b.label
        : textOf(asRecord(asRecord(b.accessibility)?.accessibility_data)?.label)
      if (label && /explicit/i.test(label)) return true
    }
  }
  return false
}

function browseIdFromEndpoint(ep: unknown): string | null {
  const payload = asRecord(asRecord(ep)?.payload)
  return typeof payload?.browseId === 'string' ? payload.browseId : null
}

function pageTypeFromEndpoint(ep: unknown): string | null {
  return browsePageType(asRecord(asRecord(ep)?.payload))
}

/**
 * browseId : on_tap, endpoint racine, ou title.runs (souvent le seul chemin
 * pour la carte top résultat — cf. musicCardShelfRenderer.title.runs[].navigationEndpoint).
 */
function browseIdOf(o: Record<string, unknown>): string | null {
  const fromTap = browseIdFromEndpoint(o.on_tap) ?? browseIdFromEndpoint(o.endpoint)
  if (fromTap) return fromTap
  const title = asRecord(o.title)
  const fromTitle = browseIdFromEndpoint(title?.endpoint)
  if (fromTitle) return fromTitle
  for (const run of asList(title?.runs)) {
    const id = browseIdFromEndpoint(asRecord(run)?.endpoint)
    if (id) return id
  }
  for (const btn of asList(o.buttons)) {
    const id = browseIdFromEndpoint(asRecord(btn)?.endpoint)
    if (id) return id
  }
  const overlay = asRecord(o.thumbnail_overlay)
  const overlayContent = asRecord(overlay?.content)
  const fromOverlay = browseIdFromEndpoint(overlayContent?.endpoint) ?? browseIdFromEndpoint(overlay?.endpoint)
  if (fromOverlay) return fromOverlay
  return typeof o.id === 'string' ? o.id : null
}

function nameKey(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

function artistNameKey(a: string | { name?: string | null } | null | undefined): string {
  if (!a) return ''
  if (typeof a === 'string') return nameKey(a)
  return nameKey(a.name ?? '')
}

function albumDedupeKey(a: { title?: unknown; name?: unknown; artists?: RawAlbum['artists'] }): string {
  const title = nameKey(textOf(a.title) ?? textOf(a.name) ?? '')
  const arts = (a.artists ?? []).map(artistNameKey).filter(Boolean).sort().join(',')
  return `${title}|${arts}`
}

/**
 * Channel IDs d'artistes portés par un item album/titre (author / artists / runs UC).
 * Sert de repli quand la carte top résultat / filtre Artistes rate (ex. Jäde).
 */
function artistRefsFromItem(item: unknown): RawArtist[] {
  const o = asRecord(item)
  if (!o) return []
  const art = bestThumb(thumbsOf(o))
  const out: RawArtist[] = []
  const seen = new Set<string>()
  const push = (id: string | null | undefined, name: string | null | undefined) => {
    if (!id || !name?.trim() || seen.has(id)) return
    if (!id.startsWith('UC') && !id.startsWith('FEmusic_library_privately_owned_artist')) return
    seen.add(id)
    out.push({ id, name: name.trim(), artUrl: art, subscribers: null })
  }
  const author = asRecord(o.author)
  push(
    (typeof author?.channel_id === 'string' ? author.channel_id : null)
      ?? (typeof author?.id === 'string' ? author.id : null)
      ?? browseIdFromEndpoint(author?.endpoint),
    typeof author?.name === 'string' ? author.name : textOf(author?.name),
  )
  for (const a of asList(o.artists)) {
    if (typeof a === 'string') continue
    const ar = asRecord(a)
    if (!ar) continue
    push(
      (typeof ar.channel_id === 'string' ? ar.channel_id : null)
        ?? (typeof ar.id === 'string' ? ar.id : null)
        ?? browseIdFromEndpoint(ar.endpoint),
      typeof ar.name === 'string' ? ar.name : textOf(ar.name),
    )
  }
  for (const col of asList(o.flex_columns)) {
    for (const run of asList(asRecord(asRecord(col)?.title)?.runs)) {
      const rr = asRecord(run)
      const id = browseIdFromEndpoint(rr?.endpoint)
      if (id) push(id, typeof rr?.text === 'string' ? rr.text : null)
    }
  }
  for (const run of asList(asRecord(o.subtitle)?.runs)) {
    const rr = asRecord(run)
    const id = browseIdFromEndpoint(rr?.endpoint)
    if (id) push(id, typeof rr?.text === 'string' ? rr.text : null)
  }
  return out
}

/** Artistes dont le nom colle à la requête (accents ignorés). */
function artistsMatchingQuery(artists: RawArtist[], query: string): RawArtist[] {
  const q = nameKey(query)
  if (!q) return []
  return artists.filter((a) => {
    const n = nameKey(textOf(a.name) ?? textOf(a.title) ?? '')
    return !!n && (n === q || n.includes(q) || q.includes(n))
  })
}

function pageTypeOf(o: Record<string, unknown>): string | null {
  return pageTypeFromEndpoint(o.on_tap)
    ?? pageTypeFromEndpoint(o.endpoint)
    ?? pageTypeFromEndpoint(asRecord(o.title)?.endpoint)
    ?? (() => {
      for (const run of asList(asRecord(o.title)?.runs)) {
        const pt = pageTypeFromEndpoint(asRecord(run)?.endpoint)
        if (pt) return pt
      }
      return null
    })()
}

/** Sous-titre « Artiste · 12,3 k abonnés » / « 12.3K subscribers ». */
function subscribersOf(o: Record<string, unknown>): string | null {
  if (typeof o.subscribers === 'string' && o.subscribers.trim()) return o.subscribers.trim()
  for (const p of subtitlePartsOf(o)) {
    if (/abonné|subscriber|audience/i.test(p)) return p
  }
  return null
}

function itemToRawArtist(item: unknown): RawArtist | null {
  const o = asRecord(item)
  if (!o) return null
  const id = typeof o.id === 'string' ? o.id : browseIdOf(o)
  if (!id) return null
  return {
    id,
    name: textOf(o.name) ?? textOf(o.title),
    artUrl: bestThumb(thumbsOf(o)),
    subscribers: subscribersOf(o),
  }
}

function runTexts(v: unknown): string[] {
  const o = asRecord(v)
  if (!o) {
    if (typeof v !== 'string') return []
    const t = v.trim()
    if (!t) return []
    // MusicTwoRowItem : subtitle souvent une string « EP · 2025 », pas un Text.
    return t.split(/\s*[·•|]\s*/).map((s) => s.trim()).filter(Boolean)
  }
  if (typeof o.text === 'string' && o.text.trim()) {
    // Text entier : aussi découper sur · / • pour « Album · Artiste · 1997 »
    return o.text.split(/\s*[·•|]\s*/).map((s) => s.trim()).filter(Boolean)
  }
  if (Array.isArray(o.runs)) {
    return o.runs.flatMap((r) => {
      if (typeof r === 'string') return r.trim() ? [r.trim()] : []
      const rr = asRecord(r)
      const t = typeof rr?.text === 'string' ? rr.text.trim() : ''
      return t ? [t] : []
    })
  }
  return []
}

/** Morceaux de sous-titre où InnerTube écrit Album / Single / EP / Compilation. */
function subtitlePartsOf(o: Record<string, unknown>): string[] {
  const parts: string[] = []
  parts.push(...runTexts(o.subtitle))
  // MusicResponsiveListItem : type de release dans flex_columns[1] (« Album · Jäde · 2021 »).
  for (const col of asList(o.flex_columns).slice(1)) {
    const c = asRecord(col)
    parts.push(...runTexts(c?.title))
  }
  return parts
}

function itemToRawAlbum(item: unknown): RawAlbum | null {
  const o = asRecord(item)
  if (!o) return null
  const id = (typeof o.id === 'string' ? o.id : null) ?? browseIdOf(o)
  if (!id) return null
  // Page artiste : MusicTwoRowItem album ; ignorer vidéos / playlists mélangées.
  const itemType = typeof o.item_type === 'string' ? o.item_type : null
  if (itemType && itemType !== 'album') return null
  if (!itemType && !id.startsWith('MPRE')) return null
  const artists = Array.isArray(o.artists)
    ? o.artists.map((a) => {
      const ar = asRecord(a)
      return typeof a === 'string' ? a : (typeof ar?.name === 'string' ? ar.name : null)
    }).filter((a): a is string => !!a)
    : []
  const author = asRecord(o.author)
  const yearRaw = o.year
  const year = typeof yearRaw === 'string' ? yearRaw
    : (typeof yearRaw === 'number' && Number.isFinite(yearRaw) ? String(Math.trunc(yearRaw)) : null)
  return {
    id,
    title: textOf(o.title) ?? textOf(o.name),
    artUrl: bestThumb(thumbsOf(o)),
    artists,
    author: typeof author?.name === 'string' ? { name: author.name } : null,
    year,
    subtitleParts: subtitlePartsOf(o),
    explicit: isExplicit(o),
  }
}

/** Ref album portée par un titre (`track.album.id`). */
function albumRefFromTrackItem(item: unknown): RawAlbum | null {
  const o = asRecord(item)
  if (!o) return null
  const album = asRecord(o.album)
  if (!album) return null
  const id = (typeof album.id === 'string' ? album.id : null) ?? browseIdFromEndpoint(album.endpoint)
  if (!id || !id.startsWith('MPRE')) return null
  const artists = Array.isArray(o.artists)
    ? o.artists.map((a) => {
      const ar = asRecord(a)
      return typeof a === 'string' ? a : (typeof ar?.name === 'string' ? ar.name : null)
    }).filter((a): a is string => !!a)
    : []
  return {
    id,
    title: textOf(album.name) ?? textOf(album.title),
    artUrl: bestThumb(thumbsOf(o)),
    artists,
    author: null,
    year: null,
    subtitleParts: [],
    explicit: false,
  }
}

function trackArtistNames(item: unknown): string[] {
  const o = asRecord(item)
  if (!o) return []
  const out: string[] = []
  for (const a of asList(o.artists)) {
    if (typeof a === 'string') { if (a.trim()) out.push(a.trim()); continue }
    const ar = asRecord(a)
    const n = typeof ar?.name === 'string' ? ar.name.trim() : textOf(ar?.name)
    if (n) out.push(n)
  }
  return out
}

/** Titre dont l'artiste colle à la requête (évite karaoke / feat. parasites). */
function trackMatchesPrimary(item: unknown, primaryName: string): boolean {
  const q = nameKey(primaryName)
  if (!q) return false
  return trackArtistNames(item).some((n) => {
    const k = nameKey(n)
    return k === q || k.includes(q) || q.includes(k)
  })
}

/**
 * Albums déduits des titres quand le filtre InnerTube `album` est vide.
 * Type provisoire selon le nb d'occurrences dans la page de résultats :
 * 1× + titre = nom du morceau → single ; ≤5 → ep ; sinon album.
 * Affiné ensuite via `getAlbum` (sous-titre Album/EP/Single réel).
 */
function albumsInferredFromTracks(items: unknown[], primaryName: string | null): RawAlbum[] {
  const byId = new Map<string, { raw: RawAlbum; count: number; titleHits: number }>()
  for (const item of items) {
    if (primaryName && !trackMatchesPrimary(item, primaryName)) continue
    const ref = albumRefFromTrackItem(item)
    if (!ref?.id) continue
    const trackTitle = textOf(asRecord(item)?.title) ?? ''
    const cur = byId.get(ref.id)
    const titleHit = trackTitle && nameKey(trackTitle) === nameKey(ref.title ?? '') ? 1 : 0
    if (!cur) {
      byId.set(ref.id, { raw: ref, count: 1, titleHits: titleHit })
    } else {
      cur.count += 1
      cur.titleHits += titleHit
      // Union des artistes cités sur les titres (compil multi-artistes).
      if (ref.artists?.length) {
        const seen = new Set((cur.raw.artists ?? []).map(artistNameKey).filter(Boolean))
        for (const a of ref.artists) {
          const k = artistNameKey(a)
          if (!k || seen.has(k)) continue
          seen.add(k)
          ;(cur.raw.artists ??= []).push(a)
        }
      }
    }
  }
  const out: RawAlbum[] = []
  for (const { raw, count, titleHits } of byId.values()) {
    // 1× avec titre = nom de la sortie → simple morceau (ex. Chrome), pas une colonne.
    if (count === 1 && titleHits > 0) continue
    const releaseType: RawAlbum['releaseType'] = count <= 5 ? 'ep' : 'album'
    raw.releaseType = releaseType
    raw.subtitleParts = releaseType === 'ep' ? ['EP'] : ['Album']
    out.push(raw)
  }
  return out
}

/**
 * Discographie page artiste — carrousels Albums + Singles & EPs
 * (Singles type « brand new teeth » inclus ; les morceaux 1× hors page
 * artiste restent exclus via l'inférence titres).
 */
function releasesFromArtistPage(page: { sections?: unknown[] }, artistName?: string | null): RawAlbum[] {
  const out: RawAlbum[] = []
  for (const section of asList(page.sections)) {
    const s = asRecord(section)
    if (!s) continue
    const header = asRecord(s.header)
    const headerTitle = nameKey(textOf(header?.title) ?? textOf(s.title) ?? '')
    if (s.type === 'MusicCarouselShelf' || s.type === 'MusicShelf') {
      const isAlbums = /\balbums?\b/.test(headerTitle) || /\bsorties?\b/.test(headerTitle)
      const isSinglesEps = /\bsingles?\b/.test(headerTitle) || /\beps?\b/.test(headerTitle)
      if (headerTitle && !isAlbums && !isSinglesEps) continue
      for (const item of asList(s.contents)) {
        const raw = itemToRawAlbum(item)
        if (!raw) continue
        if (artistName?.trim() && !(raw.artists?.length)) raw.artists = [artistName.trim()]
        out.push(raw)
      }
    }
  }
  return out
}

/**
 * Sous-titre `getAlbum` = source de vérité (Album / EP / Single · année).
 * Corrige l'heuristique d'occurrences (ex. Detour 3 titres → Album, pas EP).
 * Explicit album = badge header / au moins un titre badgeé.
 * Explicit titre = uniquement le badge du titre (jamais déduit de l'album).
 */
async function refineAlbumsViaGetAlbum(
  yt: InnertubeLike,
  raws: RawAlbum[],
  tracks?: RawTrack[],
): Promise<void> {
  if (typeof yt.music.getAlbum !== 'function') return
  const seen = new Set<string>()
  const need = raws.filter((r) => {
    const id = r.id?.trim()
    if (!id?.startsWith('MPRE') || seen.has(id)) return false
    seen.add(id)
    const typed = parseReleaseType(r.subtitleParts)
    const needsType = !typed || r.releaseType === 'ep' || r.releaseType === 'single'
    const needsExplicit = !r.explicit
    return needsType || needsExplicit
  })
  // Albums / EP d'abord : les Singles nombreux ne doivent pas épuiser le budget getAlbum.
  need.sort((a, b) => {
    const rank = (r: RawAlbum) => {
      const t = r.releaseType ?? parseReleaseType(r.subtitleParts)
      if (t === 'single') return 2
      if (t === 'ep') return 1
      return 0
    }
    return rank(a) - rank(b)
  })
  const queue = need.slice(0, 12)
  /** videoId → explicit uniquement si le titre porte le badge. */
  const explicitByVideo = new Map<string, true>()
  /** videoId → année album (les titres de recherche n'ont pas d'année). */
  const yearByVideo = new Map<string, string>()
  for (const raw of queue) {
    try {
      const page = await yt.music.getAlbum!(raw.id!)
      const header = asRecord(page.header)
      if (!header) continue
      const parts = runTexts(header.subtitle)
      const typed = parseReleaseType(parts)
      if (typed) {
        raw.releaseType = typed
        raw.subtitleParts = parts
      }
      const year = parts.find((p) => /^[12]\d{3}$/.test(p))
      if (year) raw.year = year
      if (!raw.title) {
        const t = textOf(header.title)
        if (t) raw.title = t
      }
      if (isExplicit(header)) raw.explicit = true
      for (const item of asList(page.contents)) {
        const o = asRecord(item)
        if (!o) continue
        const vid = typeof o.id === 'string' ? o.id
          : (typeof o.video_id === 'string' ? o.video_id : null)
        if (vid && year) yearByVideo.set(vid, year)
        if (!isExplicit(o)) continue
        raw.explicit = true
        // Ne marquer que ce titre — pas les autres de l'album.
        if (vid) explicitByVideo.set(vid, true)
      }
    } catch { /* album indisponible */ }
  }
  if (tracks?.length) {
    for (const t of tracks) {
      if (!t.videoId) continue
      if (explicitByVideo.has(t.videoId)) t.explicit = true
      if (!t.year && yearByVideo.has(t.videoId)) t.year = yearByVideo.get(t.videoId)!
    }
  }
}

/** Année absente sur les titres de recherche → reprise depuis l'album homonyme. */
function stampTrackYearsFromAlbums(tracks: RawTrack[], albums: RawAlbum[]): void {
  const byAlbum = new Map<string, string>()
  for (const a of albums) {
    const y = a.year?.trim()
    const title = nameKey(textOf(a.title) ?? '')
    if (!y || !title || !/^[12]\d{3}$/.test(y)) continue
    if (!byAlbum.has(title)) byAlbum.set(title, y)
  }
  if (!byAlbum.size) return
  for (const t of tracks) {
    if (t.year) continue
    const al = nameKey(t.album ?? '')
    if (al && byAlbum.has(al)) t.year = byAlbum.get(al)!
  }
}

function pickPrimaryArtist(candidates: RawArtist[], query: string): RawArtist | null {
  const q = nameKey(query)
  if (!q) return null
  // Uniquement un artiste dont le nom porte toute la requête (évite « Samara » / « Cyn »
  // quand on cherche « samara cyn » — mauvaise page artiste).
  const strong = artistsMatchingQuery(candidates, query).filter((a) => {
    const n = nameKey(textOf(a.name) ?? textOf(a.title) ?? '')
    return n === q || n.includes(q)
  })
  if (!strong.length) return null
  strong.sort((a, b) => {
    const na = nameKey(textOf(a.name) ?? '')
    const nb = nameKey(textOf(b.name) ?? '')
    return nb.length - na.length
  })
  return strong[0] ?? null
}

function shelfItems(contents: unknown[] | undefined): unknown[] {
  if (!contents) return []
  const out: unknown[] = []
  for (const shelf of contents) {
    const s = asRecord(shelf)
    const items = s?.contents ?? s?.items
    if (Array.isArray(items)) out.push(...items)
    else out.push(shelf)
  }
  return out
}

function isMusicCard(b: Record<string, unknown>): boolean {
  if (b.type === 'MusicCardShelf') return true
  // Carte top hit : titre + on_tap, pas de item_type (les list items en ont un).
  return b.on_tap != null && b.title != null && typeof b.item_type !== 'string'
}

/** Collecte les items d'une réponse search (étagères + carte top résultat, y compris ItemSection). */
function searchItems(result: {
  songs?: { contents?: unknown[] }
  albums?: { contents?: unknown[] }
  artists?: { contents?: unknown[] }
  contents?: unknown[]
}): unknown[] {
  const out: unknown[] = []
  const visit = (nodes: unknown[], depth: number) => {
    if (depth > 5) return
    for (const block of nodes) {
      const b = asRecord(block)
      if (!b) continue
      // MusicCardShelf : la carte EST le hit (artiste/album) ; `contents` = titres liés.
      if (isMusicCard(b)) {
        out.push(block)
        visit(asList(b.contents), depth + 1)
        continue
      }
      if (typeof b.item_type === 'string' || typeof b.id === 'string') {
        out.push(block)
        continue
      }
      const kids = asList(b.contents)
      const items = kids.length ? kids : asList(b.items)
      if (items.length) visit(items, depth + 1)
    }
  }
  visit(asList(result.contents), 0)
  // Recherche filtrée / sans `contents` : repli sur les étagères typées.
  if (!out.length) {
    visit(asList(result.artists?.contents), 0)
    visit(asList(result.albums?.contents), 0)
    visit(asList(result.songs?.contents), 0)
  }
  return out
}

/**
 * Exact match / « contient la requête » NE doit pas réordonner : InnerTube renvoie
 * déjà par pertinence (ex. NTM → Kool Shen avant « NTM Sound »).
 * On ne fait qu'ajouter en queue les artistes déduits des albums absents du filtre.
 */
function mergeArtistsInOrder(
  primary: RawArtist[],
  extras: RawArtist[],
): RawArtist[] {
  return dedupeArtists([...primary, ...extras])
}

function browsePageType(payload: Record<string, unknown> | null): string | null {
  const cfg = asRecord(asRecord(payload?.browseEndpointContextSupportedConfigs)?.browseEndpointContextMusicConfig)
  return typeof cfg?.pageType === 'string' ? cfg.pageType : null
}

function subtitleKind(parts: string[]): 'artist' | 'album' | null {
  const head = parts[0]?.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '') ?? ''
  if (head === 'artiste' || head === 'artist') return 'artist'
  if (
    head === 'album' || head === 'lp' || head === 'ep' || head === 'single'
    || head === 'compilation' || head === 'maxi'
  ) return 'album'
  return null
}

function cardToTypedRaw(item: unknown): { kind: 'artist'; raw: RawArtist } | { kind: 'album'; raw: RawAlbum } | null {
  const o = asRecord(item)
  if (!o) return null
  const browseId = browseIdOf(o)
  if (!browseId) return null
  const pt = pageTypeOf(o)
  const parts = subtitlePartsOf(o)
  const fromSub = subtitleKind(parts)
  const title = textOf(o.title) ?? textOf(o.name)
  const art = bestThumb(thumbsOf(o))
  const isArtist = pt === 'MUSIC_PAGE_TYPE_ARTIST' || browseId.startsWith('UC') || fromSub === 'artist'
  if (isArtist) {
    return {
      kind: 'artist',
      raw: { id: browseId, name: title, artUrl: art, subscribers: subscribersOf(o) },
    }
  }
  const isAlbum = pt === 'MUSIC_PAGE_TYPE_ALBUM' || browseId.startsWith('MPRE') || fromSub === 'album'
  if (isAlbum) {
    return {
      kind: 'album',
      raw: { id: browseId, title, artUrl: art, subtitleParts: parts, explicit: isExplicit(o) },
    }
  }
  return null
}

function dedupeArtists(raws: RawArtist[]): RawArtist[] {
  const out: RawArtist[] = []
  const seen = new Set<string>()
  for (const a of raws) {
    const id = a.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(a)
  }
  return out
}

export class YtmusicCatalog {
  private session: InnertubeLike | null = null
  private sessionCookie: string | null = null

  constructor(private readonly createSession: CreateSession = defaultCreate) {}

  /** Invalide la session (cookie changé / oublié). */
  reset(): void {
    this.session = null
    this.sessionCookie = null
  }

  private async ensure(cookie: string, force = false): Promise<InnertubeLike> {
    if (!force && this.session && this.sessionCookie === cookie) return this.session
    this.session = await this.createSession(cookie)
    this.sessionCookie = cookie
    return this.session
  }

  /** Une tentative ; si la session InnerTube est morte, reset + retry. */
  private async withSession<T>(cookie: string, fn: (yt: InnertubeLike) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.ensure(cookie))
    } catch (err) {
      if (!isDeadSession(err)) throw err
      this.reset()
      return await fn(await this.ensure(cookie, true))
    }
  }

  /**
   * Recherche classée artiste / album·single·compilation / titre.
   * Trois requêtes filtrées en parallèle (artist / album / song) — le mix seul
   * ne remonte qu'une poignée de résultats par catégorie.
   */
  async search(cookie: string, query: string): Promise<YtmusicSearchResult> {
    return this.withSession(cookie, (yt) => this.searchWith(yt, query))
  }

  private async searchWith(yt: InnertubeLike, query: string): Promise<YtmusicSearchResult> {
    const soft = <T,>(p: Promise<T>): Promise<T | null> =>
      p.catch((err) => {
        if (isDeadSession(err)) throw err
        return null
      })
    // Songs + Videos : certains titres explicites n'existent que comme Music Video
    // (ex. « Good Is A LIE » — absent du filtre Songs et de l'album Detour YTM).
    const [artistsOnly, albumsOnly, songsOnly, videosOnly] = await Promise.all([
      soft(yt.music.search(query, { type: 'artist' })),
      soft(yt.music.search(query, { type: 'album' })),
      soft(yt.music.search(query, { type: 'song' })),
      soft(yt.music.search(query, { type: 'video' })),
    ])
    const topArtists: RawArtist[] = []
    const shelfArtists: RawArtist[] = []
    const impliedArtists: RawArtist[] = []
    const albums: RawAlbum[] = []
    const tracks: RawTrack[] = []
    const seenVideoIds = new Set<string>()

    const noteImplied = (item: unknown) => {
      for (const ref of artistRefsFromItem(item)) impliedArtists.push(ref)
    }

    const pushTrack = (item: unknown) => {
      const t = itemToRawTrack(item)
      if (!t?.videoId || seenVideoIds.has(t.videoId)) return
      seenVideoIds.add(t.videoId)
      tracks.push(t)
      noteImplied(item)
    }

    const ingest = (items: unknown[], artistBucket: RawArtist[]) => {
      for (const item of items) {
        const o = asRecord(item)
        const type = typeof o?.item_type === 'string' ? o.item_type : null
        if (type === 'artist' || type === 'library_artist') {
          const a = itemToRawArtist(item)
          if (a) artistBucket.push(a)
          continue
        }
        if (type === 'album') {
          const a = itemToRawAlbum(item)
          if (a) {
            albums.push(a)
            noteImplied(item)
          }
          continue
        }
        if (type === 'song' || type === 'video') {
          pushTrack(item)
          continue
        }
        // MusicCardShelf / item sans item_type : déduire du browseId / sous-titre.
        if (!type) {
          const card = cardToTypedRaw(item)
          if (card?.kind === 'artist') topArtists.push(card.raw)
          else if (card?.kind === 'album') {
            albums.push(card.raw)
            noteImplied(item)
          } else {
            const t = itemToRawTrack(item)
            if (t?.videoId && t.videoId.length === 11) pushTrack(item)
          }
        }
      }
    }

    // Ordre filtre artiste (pertinence YTM) + carte top + artistes déduits des albums.
    let albumFilterHits = 0
    if (artistsOnly) ingest(searchItems(artistsOnly), shelfArtists)
    if (albumsOnly) {
      const before = albums.length
      ingest(searchItems(albumsOnly), shelfArtists)
      albumFilterHits = albums.length - before
    }
    if (songsOnly) ingest(searchItems(songsOnly).slice(0, 12), shelfArtists)
    // Videos après, avec places réservées : certains titres n'existent que comme Music Video.
    if (videosOnly) ingest(searchItems(videosOnly).slice(0, 12), shelfArtists)
    // Remonter les titres qui collent à la requête (ex. vidéo « Good Is A LIE »).
    {
      const qTokens = nameKey(query).split(/\s+/).filter((w) => w.length > 2)
      const score = (t: RawTrack) => {
        const title = nameKey(textOf(t.title) ?? '')
        if (!title || !qTokens.length) return 0
        return qTokens.reduce((n, w) => n + (title.includes(w) ? 1 : 0), 0)
      }
      tracks.sort((a, b) => score(b) - score(a))
    }

    const primary = pickPrimaryArtist([...topArtists, ...shelfArtists, ...impliedArtists], query)
    const primaryName = primary ? (textOf(primary.name) ?? textOf(primary.title)) : null

    // Filtre Albums vide (ex. Samara Cyn) : page artiste + albums cités par les titres.
    if (albumFilterHits === 0) {
      if (primary?.id && typeof yt.music.getArtist === 'function') {
        try {
          const page = await yt.music.getArtist(primary.id)
          albums.push(...releasesFromArtistPage(page, primaryName))
        } catch { /* page artiste optionnelle */ }
      }
      if (songsOnly) {
        const inferred = albumsInferredFromTracks(searchItems(songsOnly), primaryName)
        // Ne pas re-ajouter une sortie déjà vue (autre MPRE id) via les titres.
        const known = new Set(albums.map(albumDedupeKey))
        for (const a of inferred) {
          const key = albumDedupeKey(a)
          if (known.has(key)) continue
          known.add(key)
          albums.push(a)
        }
      }
    } else if (primary?.id && typeof yt.music.getArtist === 'function') {
      // Filtre OK : compléter quand même la discographie artiste.
      try {
        const page = await yt.music.getArtist(primary.id)
        albums.push(...releasesFromArtistPage(page, primaryName))
      } catch { /* ignore */ }
    }

    // getAlbum : type réel + badges explicit (absents de la recherche songs).
    try {
      await refineAlbumsViaGetAlbum(yt, albums, tracks)
    } catch { /* refine optionnel */ }
    stampTrackYearsFromAlbums(tracks, albums)

    const partitioned = partitionAlbums(mapAlbums(albums))
    const artists = mapArtists(mergeArtistsInOrder(
      [...topArtists, ...shelfArtists],
      artistsMatchingQuery(impliedArtists, query),
    )).slice(0, SEARCH_SECTION_LIMIT)
    return {
      artists,
      albums: partitioned.albums,
      singles: partitioned.singles,
      compilations: partitioned.compilations,
      tracks: mapTracks(tracks).slice(0, SEARCH_SECTION_LIMIT),
    }
  }

  /** Titres aimés : playlist système `LM` (Liked Music). */
  async liked(cookie: string): Promise<YtmusicTrack[]> {
    return this.playlistTracks(cookie, 'LM')
  }

  async playlists(cookie: string): Promise<YtmusicPlaylist[]> {
    return this.withSession(cookie, async (yt) => {
      let lib = await yt.music.getLibrary()
      if (typeof lib.applyFilter === 'function') {
        try { lib = await lib.applyFilter('playlists') }
        catch { /* filtre absent : on lit le contenu tel quel */ }
      }
      const items = shelfItems(lib.contents)
      const raws = items.map(itemToRawPlaylist).filter((r): r is RawPlaylist => !!r)
      return mapPlaylists(raws)
    })
  }

  async playlistTracks(cookie: string, playlistId: string): Promise<YtmusicTrack[]> {
    return this.withSession(cookie, async (yt) => {
      const pl = await yt.music.getPlaylist(playlistId)
      const items = pl.items ?? pl.contents ?? []
      const raws = items.map(itemToRawTrack).filter((r): r is RawTrack => !!r)
      return mapTracks(raws)
    })
  }

  async albumTracks(cookie: string, albumId: string): Promise<YtmusicTrack[]> {
    return this.withSession(cookie, async (yt) => {
      if (typeof yt.music.getAlbum !== 'function') return []
      const album = await yt.music.getAlbum(albumId)
      const header = asRecord(album.header)
      const albumYear = header
        ? runTexts(header.subtitle).find((p) => /^[12]\d{3}$/.test(p)) ?? null
        : null
      const items = album.contents ?? []
      const raws = items.map(itemToRawTrack).filter((r): r is RawTrack => !!r)
      if (albumYear) {
        for (const r of raws) {
          if (!r.year) r.year = albumYear
        }
      }
      return mapTracks(raws)
    })
  }

  /** Titres déjà présents sur la page artiste (Top songs) — pas de 2ᵉ requête localisée. */
  async artistTracks(cookie: string, artistId: string): Promise<YtmusicTrack[]> {
    return this.withSession(cookie, async (yt) => {
      if (typeof yt.music.getArtist !== 'function') return []
      const artist = await yt.music.getArtist(artistId)
      const items = shelfItems(artist.sections)
      const raws = items.map(itemToRawTrack).filter((r): r is RawTrack => !!r)
      return mapTracks(raws)
    })
  }
}

/** Export pour les tests de mapping depuis des items déjà aplatis. */
export { mapTrack, mapTracks, mapPlaylist, mapPlaylists, mapArtist, mapAlbum, parseReleaseType, partitionAlbums }
