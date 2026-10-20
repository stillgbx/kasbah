import { ClientType, Innertube } from 'youtubei.js'
import {
  bestThumb,
  mapAlbums,
  mapArtists,
  mapPlaylists,
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
import { carouselsOf, parseMoodsPage } from './explore'
import { exploreCategoryPageSchema, exploreSchema, type YtmusicExplore, type YtmusicExploreCategoryPage, type YtmusicPlaylist, type YtmusicSearchResult, type YtmusicTrack } from './types'

// Catalog through youtubei.js `yt.music` (InnerTube Music client / WEB_REMIX).
// No audio stream here — that is the job of yt-dlp + PO Token (`stream.ts`).

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
  /** InnerTube `browse`, RAW JSON (the "Moods & genres" page: youtubei.js does not keep its colors). */
  browseRaw?(browseId: string, params?: string): Promise<unknown>
  /** InnerTube `browse` parsed by youtubei.js (`MusicCarouselShelf` nodes, like search). */
  browseParsed?(browseId: string, params?: string): Promise<unknown>
}

/** `lang`: language of the texts rendered by InnerTube (genre names…). Absent = today's one. */
export type CreateSession = (cookie: string, lang?: string) => Promise<InnertubeLike>

/**
 * youtubei.js sends ALL its InnerTube requests to www.youtube.com, even for the YouTube Music
 * client. Yet www.youtube.com HOLDS BACK explicit tracks: the page of the album "Paradise" has 5
 * tracks there (Ride, Cola, Gods & Monsters missing, "8 songs" header nonetheless), music.youtube.com
 * returns 8 — with or without an account, whatever the client version (probed on 2026-09-23). So we
 * redirect them to music.youtube.com, as the site does; the cookies are valid for all of
 * `.youtube.com` and the SAPISIDHASH signature stays accepted (library, likes and account answer).
 */
export const musicHostFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://www.youtube.com/youtubei/')) return fetch(input, init)
  const next = url.replace('https://www.youtube.com/youtubei/', 'https://music.youtube.com/youtubei/')
  return fetch(input instanceof Request ? new Request(next, input) : next, init)
}

/** WEB_REMIX: same client as music.youtube.com (not the generic WEB client). Without a cookie: anonymous. */
const defaultCreate: CreateSession = async (cookie, lang) => {
  const yt = await Innertube.create({ ...(cookie ? { cookie } : {}), client_type: ClientType.MUSIC, fetch: musicHostFetch, ...(lang ? { lang } : {}) })
  const browse = (browseId: string, params: string | undefined, parse: boolean) =>
    yt.actions.execute('/browse', { browseId, ...(params ? { params } : {}), client: 'YTMUSIC', ...(parse ? { parse: true } : {}) } as never)
  return Object.assign(yt, {
    browseRaw: async (browseId: string, params?: string) => ((await browse(browseId, params, false)) as { data: unknown }).data,
    browseParsed: (browseId: string, params?: string) => browse(browseId, params, true) as Promise<unknown>,
  }) as unknown as InnertubeLike
}

/** Dead InnerTube session (HMR / body already consumed) — typically `null.read`. */
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
    // nested ThumbnailDetails / MusicThumbnail
    for (const n of asList(r.contents)) pushEntry(n)
    for (const n of asList(r.thumbnails)) pushEntry(n)
    for (const n of asList(r.sources)) pushEntry(n)
  }
  const pushAll = (v: unknown) => { for (const t of asList(v)) pushEntry(t) }

  pushAll(o.thumbnails)
  if (!out.length) {
    const th = o.thumbnail
    const nested = asRecord(th)
    // MusicResponsiveListItem: MusicThumbnail; MusicTwoRowItem: Thumbnail[]
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

/** YYYY year in the subtitle / flex_columns (e.g. "… · 2021"). */
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
  // Music Video (TwoRow): often no `artists[]`, credit in the subtitle.
  if (!artists.length) {
    const parts = subtitlePartsOf(o).map((p) => p.trim()).filter(Boolean)
    // a counter (views, plays) is not an artist: an ALBUM track's line has only that
    const skip = /^(views?|view|vues?|\d[\d.,]*\s*[kmb]?\s*(views?|vues|plays?|lectures|(d['’]\s*)?écoutes))$/i
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
  // Library: albums / artists mixed in if the filter fails — keep only the playlists.
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

/** Usable list: Array or ObservedArray (youtubei.js Proxy). */
function asList(v: unknown): unknown[] {
  if (!v) return []
  if (Array.isArray(v)) return v
  // youtubei.js `SuperParsedResult` (parsed `browse` responses: an album tile's badges…): an
  // envelope without keys, readable only through its methods — without this, the explicit badges of
  // new releases and categories went unnoticed.
  const spr = v as { is_null?: unknown; is_array?: unknown; array?: unknown; item?: unknown }
  if (typeof spr.array === 'function' && typeof spr.item === 'function' && typeof spr.is_array === 'boolean') {
    if (spr.is_null === true) return []
    return spr.is_array ? asList((spr.array as () => unknown)()) : [(spr.item as () => unknown)()]
  }
  if (typeof v === 'object' && typeof (v as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    return Array.from(v as Iterable<unknown>)
  }
  return []
}

/** Badges: array, ObservedArray, or single object (`subtitle_badge`). */
function badgeList(v: unknown): unknown[] {
  const list = asList(v)
  if (list.length) return list
  if (v && typeof v === 'object') return [v]
  return []
}

/** InnerTube badge `MUSIC_EXPLICIT_BADGE` / `EXPLICIT`, or boolean exposed by youtubei. */
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
 * browseId: on_tap, root endpoint, or title.runs (often the only path
 * for the top result card — cf. musicCardShelfRenderer.title.runs[].navigationEndpoint).
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
 * Artist channel IDs carried by an album/track item (author / artists / UC runs).
 * Serves as a fallback when the top result card / Artists filter misses (e.g. Jäde).
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
  // A credit leading to a personal channel is not an artist: "… Fan Page" has no business in the
  // Artists row.
  const pushRun = (run: unknown) => {
    const rr = asRecord(run)
    if (pageTypeFromEndpoint(rr?.endpoint) === USER_CHANNEL_PAGE) return
    const id = browseIdFromEndpoint(rr?.endpoint)
    if (id) push(id, typeof rr?.text === 'string' ? rr.text : null)
  }
  for (const col of asList(o.flex_columns)) {
    for (const run of asList(asRecord(asRecord(col)?.title)?.runs)) pushRun(run)
  }
  for (const run of asList(asRecord(o.subtitle)?.runs)) pushRun(run)
  return out
}

/** Artists whose name matches the query (accents ignored). */
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

/** Subtitle "Artiste · 12,3 k abonnés" / "12.3K subscribers". */
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
    // MusicTwoRowItem: subtitle often a string "EP · 2025", not a Text.
    return t.split(/\s*[·•|]\s*/).map((s) => s.trim()).filter(Boolean)
  }
  if (typeof o.text === 'string' && o.text.trim()) {
    // whole Text: also split on · / • for "Album · Artist · 1997"
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

/** Subtitle pieces where InnerTube writes Album / Single / EP / Compilation. */
function subtitlePartsOf(o: Record<string, unknown>): string[] {
  const parts: string[] = []
  parts.push(...runTexts(o.subtitle))
  // MusicResponsiveListItem: release type in flex_columns[1] ("Album · Jäde · 2021").
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
  // Artist page: MusicTwoRowItem album; ignore mixed-in videos / playlists.
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

/** Album ref carried by a track (`track.album.id`). */
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

/** Track whose artist matches the query (avoids karaoke / stray feats). */
function trackMatchesPrimary(item: unknown, primaryName: string): boolean {
  const q = nameKey(primaryName)
  if (!q) return false
  return trackArtistNames(item).some((n) => {
    const k = nameKey(n)
    return k === q || k.includes(q) || q.includes(k)
  })
}

/**
 * Albums deduced from the tracks when the InnerTube `album` filter is empty.
 * Provisional type based on the number of occurrences in the results page:
 * 1× + title = track name → single; ≤5 → ep; otherwise album.
 * Refined afterwards through `getAlbum` (real Album/EP/Single subtitle).
 */
function albumsInferredFromTracks(items: unknown[], primaryName: string | null): RawAlbum[] {
  const byId = new Map<string, { raw: RawAlbum; count: number; titleHits: number }>()
  for (const item of items) {
    if (primaryName && !trackMatchesPrimary(item, primaryName)) continue
    const ref = albumRefFromTrackItem(item)
    if (!ref?.id) continue
    const trackTitle = textOf(asRecord(item)?.title) ?? ''
    const cur = byId.get(ref.id)
    const titleHit = trackTitle && nameKey(trackTitle) === nameKey(textOf(ref.title) ?? '') ? 1 : 0
    if (!cur) {
      byId.set(ref.id, { raw: ref, count: 1, titleHits: titleHit })
    } else {
      cur.count += 1
      cur.titleHits += titleHit
      // Union of the artists credited on the tracks (multi-artist compilation).
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
    // 1× with title = release name → a plain track (e.g. Chrome), not a column.
    if (count === 1 && titleHits > 0) continue
    const releaseType: RawAlbum['releaseType'] = count <= 5 ? 'ep' : 'album'
    raw.releaseType = releaseType
    raw.subtitleParts = releaseType === 'ep' ? ['EP'] : ['Album']
    out.push(raw)
  }
  return out
}

/**
 * Artist page discography — Albums + Singles & EPs carousels
 * (Singles like "brand new teeth" included; 1× tracks outside the artist
 * page stay excluded through the tracks inference).
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
 * `getAlbum` subtitle = source of truth (Album / EP / Single · year).
 * Corrects the occurrences heuristic (e.g. Detour 3 tracks → Album, not EP).
 * Explicit album = header badge / at least one badged track.
 * Explicit track = only the track's badge (never deduced from the album).
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
  // Albums / EPs first: the numerous Singles must not exhaust the getAlbum budget.
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
  /** videoId → explicit only if the track carries the badge. */
  const explicitByVideo = new Map<string, true>()
  /** videoId → album year (search tracks have no year). */
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
        // Mark only this track — not the album's others.
        if (vid) explicitByVideo.set(vid, true)
      }
    } catch { /* album unavailable */ }
  }
  if (tracks?.length) {
    for (const t of tracks) {
      if (!t.videoId) continue
      if (explicitByVideo.has(t.videoId)) t.explicit = true
      if (!t.year && yearByVideo.has(t.videoId)) t.year = yearByVideo.get(t.videoId)!
    }
  }
}

/** Year missing on search tracks → taken from the album of the same name. */
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
    const al = nameKey(textOf(typeof t.album === 'string' ? t.album : t.album?.name ?? null) ?? '')
    if (al && byAlbum.has(al)) t.year = byAlbum.get(al)!
  }
}

function pickPrimaryArtist(candidates: RawArtist[], query: string): RawArtist | null {
  const q = nameKey(query)
  if (!q) return null
  // Only an artist whose name carries the whole query (avoids "Samara" / "Cyn"
  // when searching "samara cyn" — wrong artist page).
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
  // Top hit card: title + on_tap, no item_type (list items have one).
  return b.on_tap != null && b.title != null && typeof b.item_type !== 'string'
}

/** Collects the items of a search response (shelves + top result card, ItemSection included). */
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
      // MusicCardShelf: the card IS the hit (artist/album); `contents` = related tracks.
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
  // Filtered search / without `contents`: fall back on the typed shelves.
  if (!out.length) {
    visit(asList(result.artists?.contents), 0)
    visit(asList(result.albums?.contents), 0)
    visit(asList(result.songs?.contents), 0)
  }
  return out
}

/**
 * Exact match / "contains the query" must NOT reorder: InnerTube already returns
 * by relevance (e.g. NTM → Kool Shen before "NTM Sound").
 * We only append the artists deduced from the albums missing from the filter.
 */
function mergeArtistsInOrder(
  primary: RawArtist[],
  extras: RawArtist[],
): RawArtist[] {
  return dedupeArtists([...primary, ...extras])
}

/** Catalog artist page vs page of any channel: YouTube Music says it itself. */
const ARTIST_PAGE = 'MUSIC_PAGE_TYPE_ARTIST'
const USER_CHANNEL_PAGE = 'MUSIC_PAGE_TYPE_USER_CHANNEL'

/** Page types cited by an item's credits (2nd line: artists, or channel name). */
function creditPageTypes(o: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  const scan = (runs: unknown) => {
    for (const run of asList(runs)) {
      const pt = pageTypeFromEndpoint(asRecord(run)?.endpoint)
      if (pt) out.add(pt)
    }
  }
  for (const col of asList(o.flex_columns)) scan(asRecord(asRecord(col)?.title)?.runs)
  scan(asRecord(o.subtitle)?.runs)
  return out
}

/**
 * Uploaded by an INDIVIDUAL: slowed-down cover, concert filmed on a phone, choreography,
 * "type beat", fan page. The credit then points to a channel (`USER_CHANNEL`) where a real video is
 * credited to its artists (`ARTIST`) — it is the safest filter: it comes from YouTube Music.
 * An item without any clickable credit is kept (nothing says it is amateur).
 */
function isUserUpload(o: Record<string, unknown>): boolean {
  const pages = creditPageTypes(o)
  return pages.has(USER_CHANNEL_PAGE) && !pages.has(ARTIST_PAGE)
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
  if (pt === USER_CHANNEL_PAGE) return null
  const isArtist = pt === ARTIST_PAGE || browseId.startsWith('UC') || fromSub === 'artist'
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
  /**
   * One session per LANGUAGE ('' = no forced language, the one for search and library): genres
   * show in the app's language without changing the texts that search parses ("Album · …"
   * subtitles, counters).
   */
  private sessions = new Map<string, InnertubeLike>()
  private sessionCookie: string | null = null

  constructor(private readonly createSession: CreateSession = defaultCreate) {}

  /** Invalidates the sessions (cookie changed / forgotten). */
  reset(): void {
    this.sessions.clear()
    this.sessionCookie = null
  }

  private async ensure(cookie: string, force = false, lang = ''): Promise<InnertubeLike> {
    if (this.sessionCookie !== cookie) this.reset()
    const hit = this.sessions.get(lang)
    if (!force && hit) return hit
    const yt = await this.createSession(cookie, ...(lang ? [lang] : []))
    this.sessions.set(lang, yt)
    this.sessionCookie = cookie
    return yt
  }

  /** One attempt; if the InnerTube session is dead, reset + retry. */
  private async withSession<T>(cookie: string, fn: (yt: InnertubeLike) => Promise<T>, lang = ''): Promise<T> {
    try {
      return await fn(await this.ensure(cookie, false, lang))
    } catch (err) {
      if (!isDeadSession(err)) throw err
      this.reset()
      return await fn(await this.ensure(cookie, true, lang))
    }
  }

  /** The "Moods & genres" categories, in the requested language. */
  async explore(cookie: string, lang?: string): Promise<YtmusicExplore> {
    return this.withSession(cookie, async (yt) => {
      if (typeof yt.browseRaw !== 'function') return exploreSchema.parse({ forYou: { title: '', categories: [] }, moods: { title: '', categories: [] }, genres: { title: '', categories: [] } })
      return exploreSchema.parse(parseMoodsPage(await yt.browseRaw('FEmusic_moods_and_genres')))
    }, lang)
  }

  /**
   * A category's page: its rows, each reduced to its tracks, its OFFICIAL playlists (`RDCLAK…`,
   * curated by YouTube Music) and its albums. Videos and user playlists (`PL…`, of very uneven
   * quality) are left aside — the user's choice.
   */
  async exploreCategory(cookie: string, params: string, lang?: string): Promise<YtmusicExploreCategoryPage> {
    return this.browseShelves(cookie, 'FEmusic_moods_and_genres_category', params, lang)
  }

  /**
   * YouTube Music's new releases: flagship playlists ("RELEASED"…) and recent albums and singles;
   * same rows as a category. The new releases home page only shows 24: the full list (~180-200, in
   * one response) is on its "See all" page, `FEmusic_new_releases_albums`, read in parallel — and
   * shown IN FULL, the user's choice.
   */
  async newReleases(cookie: string, lang?: string): Promise<YtmusicExploreCategoryPage> {
    const [home, all] = await Promise.all([
      this.browseShelves(cookie, 'FEmusic_new_releases', undefined, lang),
      this.browseShelves(cookie, 'FEmusic_new_releases_albums', undefined, lang).catch(() => ({ shelves: [] })),
    ])
    const albums = all.shelves.flatMap((sh) => sh.albums)
    if (!albums.length) return home
    const hasAlbums = home.shelves.some((sh) => sh.albums.length)
    return {
      shelves: hasAlbums
        ? home.shelves.map((sh) => (sh.albums.length ? { ...sh, albums } : sh))
        : [...home.shelves, { title: '', tracks: [], playlists: [], albums }],
    }
  }

  private async browseShelves(cookie: string, browseId: string, params: string | undefined, lang?: string): Promise<YtmusicExploreCategoryPage> {
    return this.withSession(cookie, async (yt) => {
      if (typeof yt.browseParsed !== 'function') return { shelves: [] }
      const page = await yt.browseParsed(browseId, params)
      const shelves = carouselsOf(page).map(({ title, items }) => {
        const songs = items.filter((it) => asRecord(it)?.item_type === 'song')
        const playlists = items.filter((it) => {
          const o = asRecord(it)
          return o?.item_type === 'playlist' && typeof o.id === 'string' && o.id.replace(/^VL/, '').startsWith('RDCLAK')
        })
        const albums = items.filter((it) => asRecord(it)?.item_type === 'album')
        // YouTube sometimes repeats an item in the same row (the "RELEASED" playlist twice, same id,
        // in the new releases grid): once is enough, and two tiles cannot share a key.
        // We keep the FIRST copy: the next one may come without a cover.
        const once = <T,>(items: T[], id: (x: T) => string) => {
          const seen = new Set<string>()
          return items.filter((x) => !seen.has(id(x)) && !!seen.add(id(x)))
        }
        return {
          title,
          tracks: once(mapTracks(songs.map(itemToRawTrack).filter((r): r is RawTrack => !!r)), (t) => t.videoId),
          playlists: once(mapPlaylists(playlists.map(itemToRawPlaylist).filter((r): r is RawPlaylist => !!r)), (p) => p.id),
          albums: once(mapAlbums(albums.map(itemToRawAlbum).filter((r): r is RawAlbum => !!r)), (a) => a.id),
        }
      }).filter((sh) => sh.tracks.length + sh.playlists.length + sh.albums.length > 0)
      return exploreCategoryPageSchema.parse({ shelves })
    }, lang)
  }

  /**
   * Search sorted into artist / album·single·compilation / track.
   * Three filtered requests in parallel (artist / album / song) — the mix alone
   * only brings up a handful of results per category.
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
    // Songs + Videos: some explicit tracks only exist as a Music Video
    // (e.g. "Good Is A LIE" — missing from the Songs filter and from the YTM Detour album).
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
      const o = asRecord(item)
      if (o && isUserUpload(o)) return
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
        // MusicCardShelf / item without item_type: deduce from the browseId / subtitle.
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

    // Artist filter order (YTM relevance) + top card + artists deduced from the albums.
    let albumFilterHits = 0
    if (artistsOnly) ingest(searchItems(artistsOnly), shelfArtists)
    if (albumsOnly) {
      const before = albums.length
      ingest(searchItems(albumsOnly), shelfArtists)
      albumFilterHits = albums.length - before
    }
    // Enough CATALOG tracks to fill the section on their own: videos are only there for what exists
    // only as a video, and most of them are discarded (personal channels).
    if (songsOnly) ingest(searchItems(songsOnly).slice(0, SEARCH_SECTION_LIMIT), shelfArtists)
    if (videosOnly) ingest(searchItems(videosOnly).slice(0, 12), shelfArtists)
    // Bring up the tracks that match the query (e.g. the "Good Is A LIE" video).
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

    // Empty Albums filter (e.g. Samara Cyn): artist page + albums cited by the tracks.
    if (albumFilterHits === 0) {
      if (primary?.id && typeof yt.music.getArtist === 'function') {
        try {
          const page = await yt.music.getArtist(primary.id)
          albums.push(...releasesFromArtistPage(page, primaryName))
        } catch { /* artist page optional */ }
      }
      if (songsOnly) {
        const inferred = albumsInferredFromTracks(searchItems(songsOnly), primaryName)
        // Do not re-add a release already seen (other MPRE id) through the tracks.
        const known = new Set(albums.map(albumDedupeKey))
        for (const a of inferred) {
          const key = albumDedupeKey(a)
          if (known.has(key)) continue
          known.add(key)
          albums.push(a)
        }
      }
    } else if (primary?.id && typeof yt.music.getArtist === 'function') {
      // Filter OK: complete the artist discography anyway.
      try {
        const page = await yt.music.getArtist(primary.id)
        albums.push(...releasesFromArtistPage(page, primaryName))
      } catch { /* ignore */ }
    }

    // getAlbum: real type + explicit badges (missing from the songs search).
    try {
      await refineAlbumsViaGetAlbum(yt, albums, tracks)
    } catch { /* refine optional */ }
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

  /** Liked tracks: system playlist `LM` (Liked Music). */
  async liked(cookie: string): Promise<YtmusicTrack[]> {
    return this.playlistTracks(cookie, 'LM')
  }

  async playlists(cookie: string): Promise<YtmusicPlaylist[]> {
    return this.withSession(cookie, async (yt) => {
      let lib = await yt.music.getLibrary()
      if (typeof lib.applyFilter === 'function') {
        try { lib = await lib.applyFilter('playlists') }
        catch { /* filter missing: read the contents as they are */ }
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
    return (await this.album(cookie, albumId)).tracks
  }

  /**
   * An album: its tracks, and the description text YouTube Music shows under the cover (the
   * header's `MusicDescriptionShelf`, often taken from Wikipedia), if there is one. `lang`: the
   * language of that text — the same session serves the tracks (the rows have neither artist nor
   * subtitle to parse, the header gives the year).
   */
  async album(cookie: string, albumId: string, lang?: string): Promise<{ tracks: YtmusicTrack[]; description: string | null }> {
    return this.withSession(cookie, async (yt) => {
      if (typeof yt.music.getAlbum !== 'function') return { tracks: [], description: null }
      const album = await yt.music.getAlbum(albumId)
      const header = asRecord(album.header)
      const albumYear = header
        ? runTexts(header.subtitle).find((p) => /^[12]\d{3}$/.test(p)) ?? null
        : null
      // An album page's rows have neither cover nor artist: both are in the header.
      const albumArt = header ? bestThumb(thumbsOf(header)) : null
      const albumArtist = header ? textOf(header.strapline_text_one) : null
      const albumTitle = header ? textOf(header.title) : null
      const items = album.contents ?? []
      const raws = items.map(itemToRawTrack).filter((r): r is RawTrack => !!r)
      for (const r of raws) {
        if (!r.year && albumYear) r.year = albumYear
        if (!r.artUrl && albumArt) r.artUrl = albumArt
        if (!r.artists?.length && albumArtist) r.artists = [albumArtist]
        if (!r.album && albumTitle) r.album = albumTitle
      }
      const description = header ? textOf(asRecord(header.description)?.description)?.trim() || null : null
      return { tracks: mapTracks(raws), description }
    }, lang)
  }

  /** Tracks already on the artist page (Top songs) — no 2nd localized request. */
  async artistTracks(cookie: string, artistId: string): Promise<YtmusicTrack[]> {
    return (await this.artist(cookie, artistId)).tracks
  }

  /**
   * An artist: their tracks, and the header's description text (`MusicImmersiveHeader`,
   * `description`, often taken from Wikipedia) in the `lang` language, if there is one.
   */
  async artist(cookie: string, artistId: string, lang?: string): Promise<{ tracks: YtmusicTrack[]; description: string | null }> {
    return this.withSession(cookie, async (yt) => {
      if (typeof yt.music.getArtist !== 'function') return { tracks: [], description: null }
      const artist = await yt.music.getArtist(artistId)
      const items = shelfItems(artist.sections)
      // The artist page also files its albums (`MPREb…`), playlists (`VL…`) and related artists
      // (`UC…`) in its rows: 50 items out of 73 for one artist. Only TRACKS play — the others went
      // into the queue and failed at playback. The type given by YouTube first; failing that, the
      // shape of the id (collections' ids are long and prefixed, videos' are not).
      const notTrack = (it: unknown) => {
        const o = asRecord(it)
        const type = typeof o?.item_type === 'string' ? o.item_type : ''
        if (type === 'album' || type === 'playlist' || type === 'artist') return true
        const id = typeof o?.id === 'string' ? o.id : ''
        return id.length > 11 && /^(MPRE|VL|UC|OLAK|PL|RDCLAK)/.test(id)
      }
      const raws = items.filter((it) => !notTrack(it)).map(itemToRawTrack).filter((r): r is RawTrack => !!r)
      const header = asRecord(artist.header)
      const description = header ? textOf(header.description)?.trim() || null : null
      // The "Videos" row often repeats the "Songs" row's songs under another id (the video): each
      // song once, the first one seen — the audio version, filed before.
      const seen = new Set<string>()
      const tracks = mapTracks(raws).filter((t) => {
        const key = `${t.title.trim().toLowerCase()}|${t.artists.join(',').toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      return { tracks, description }
    }, lang)
  }
}

