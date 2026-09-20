import { Innertube } from 'youtubei.js'
import {
  bestThumb,
  mapAlbums,
  mapArtists,
  mapPlaylist,
  mapPlaylists,
  mapTrack,
  mapTracks,
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

const defaultCreate: CreateSession = async (cookie) =>
  Innertube.create({ cookie }) as unknown as InnertubeLike

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
  const artists = Array.isArray(o.artists)
    ? o.artists.map((a) => {
      const ar = asRecord(a)
      return typeof a === 'string' ? a : (typeof ar?.name === 'string' ? ar.name : null)
    })
    : []
  const duration = asRecord(o.duration)
  const album = asRecord(o.album)
  return {
    videoId: id,
    title,
    artists: artists.filter((a): a is string => !!a),
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

/** Badge InnerTube `MUSIC_EXPLICIT_BADGE` / `EXPLICIT` sur badges ou subtitle_badges. */
function isExplicit(o: Record<string, unknown>): boolean {
  const lists = [o.badges, o.subtitle_badges, o.subtitle_badge]
  for (const list of lists) {
    for (const raw of asList(list)) {
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
  if (!o) return typeof v === 'string' ? [v] : []
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
  const id = typeof o.id === 'string' ? o.id : null
  if (!id) return null
  const artists = Array.isArray(o.artists)
    ? o.artists.map((a) => {
      const ar = asRecord(a)
      return typeof a === 'string' ? a : (typeof ar?.name === 'string' ? ar.name : null)
    }).filter((a): a is string => !!a)
    : []
  const author = asRecord(o.author)
  return {
    id,
    title: textOf(o.title) ?? textOf(o.name),
    artUrl: bestThumb(thumbsOf(o)),
    artists,
    author: typeof author?.name === 'string' ? { name: author.name } : null,
    year: typeof o.year === 'string' ? o.year : null,
    subtitleParts: subtitlePartsOf(o),
    explicit: isExplicit(o),
  }
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

  private async ensure(cookie: string): Promise<InnertubeLike> {
    if (this.session && this.sessionCookie === cookie) return this.session
    this.session = await this.createSession(cookie)
    this.sessionCookie = cookie
    return this.session
  }

  /**
   * Recherche classée artiste / album·single·compilation / titre.
   * Trois requêtes filtrées en parallèle (artist / album / song) — le mix seul
   * ne remonte qu'une poignée de résultats par catégorie.
   */
  async search(cookie: string, query: string): Promise<YtmusicSearchResult> {
    const yt = await this.ensure(cookie)
    const [artistsOnly, albumsOnly, songsOnly] = await Promise.all([
      yt.music.search(query, { type: 'artist' }).catch(() => null),
      yt.music.search(query, { type: 'album' }).catch(() => null),
      yt.music.search(query, { type: 'song' }).catch(() => null),
    ])
    const topArtists: RawArtist[] = []
    const shelfArtists: RawArtist[] = []
    const impliedArtists: RawArtist[] = []
    const albums: RawAlbum[] = []
    const tracks: RawTrack[] = []

    const noteImplied = (item: unknown) => {
      for (const ref of artistRefsFromItem(item)) impliedArtists.push(ref)
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
          const t = itemToRawTrack(item)
          if (t) {
            tracks.push(t)
            noteImplied(item)
          }
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
            if (t?.videoId && t.videoId.length === 11) {
              tracks.push(t)
              noteImplied(item)
            }
          }
        }
      }
    }

    // Ordre filtre artiste (pertinence YTM) + carte top + artistes déduits des albums.
    if (artistsOnly) ingest(searchItems(artistsOnly), shelfArtists)
    if (albumsOnly) ingest(searchItems(albumsOnly), shelfArtists)
    if (songsOnly) ingest(searchItems(songsOnly), shelfArtists)

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
    const yt = await this.ensure(cookie)
    let lib = await yt.music.getLibrary()
    if (typeof lib.applyFilter === 'function') {
      try { lib = await lib.applyFilter('playlists') }
      catch { /* filtre absent : on lit le contenu tel quel */ }
    }
    const items = shelfItems(lib.contents)
    const raws = items.map(itemToRawPlaylist).filter((r): r is RawPlaylist => !!r)
    return mapPlaylists(raws)
  }

  async playlistTracks(cookie: string, playlistId: string): Promise<YtmusicTrack[]> {
    const yt = await this.ensure(cookie)
    const pl = await yt.music.getPlaylist(playlistId)
    const items = pl.items ?? pl.contents ?? []
    const raws = items.map(itemToRawTrack).filter((r): r is RawTrack => !!r)
    return mapTracks(raws)
  }

  async albumTracks(cookie: string, albumId: string): Promise<YtmusicTrack[]> {
    const yt = await this.ensure(cookie)
    if (typeof yt.music.getAlbum !== 'function') return []
    const album = await yt.music.getAlbum(albumId)
    const items = album.contents ?? []
    const raws = items.map(itemToRawTrack).filter((r): r is RawTrack => !!r)
    return mapTracks(raws)
  }

  /** Titres déjà présents sur la page artiste (Top songs) — pas de 2ᵉ requête localisée. */
  async artistTracks(cookie: string, artistId: string): Promise<YtmusicTrack[]> {
    const yt = await this.ensure(cookie)
    if (typeof yt.music.getArtist !== 'function') return []
    const artist = await yt.music.getArtist(artistId)
    const items = shelfItems(artist.sections)
    const raws = items.map(itemToRawTrack).filter((r): r is RawTrack => !!r)
    return mapTracks(raws)
  }
}

/** Export pour les tests de mapping depuis des items déjà aplatis. */
export { mapTrack, mapTracks, mapPlaylist, mapPlaylists, mapArtist, mapAlbum, parseReleaseType, partitionAlbums }
