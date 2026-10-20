import type { Logger } from 'pino'
import { z } from 'zod'
import type { Clock } from '../../../core/clock'

// Cover of a track the device names WITHOUT illustrating it. Observed on the Android TV: the YouTube
// app publishes title and artist ("Horizon" / "Northwind et Lumen") but no image, and its `contentId`
// is empty — so the video thumbnail cannot be reached locally (the `youtube.mdx` channel only returns
// a `screenId`, see the wiki 3_6_google-cast). What remains is the track name: two public catalogs
// find it WITHOUT a key or account, and return the album cover.
//
//  - iTunes Search (`itunes.apple.com/search`): wide coverage, but it ALWAYS answers something —
//    observed: a piano set by "SLOW RIVERS" made it offer Tim McGraw. That is why the match is
//    CHECKED before accepting an image (`matches`): the app logo is better than a cover that is not
//    the track's.
//  - Deezer (`api.deezer.com/search`) as a second resort: stricter (it returns nothing for a
//    non-music video) and its cover goes up to 1000 px, but it only names the main artist.
//
// It is not the video thumbnail but the ALBUM cover: for music that is what we want to see; for
// everything else, no match will be found and the call does not happen twice (failures are
// remembered — the plugin republishes the state every ten seconds during playback). Unofficial in the
// sense that neither API is contractual: every failure is swallowed.

const ITUNES = 'https://itunes.apple.com/search'
const DEEZER = 'https://api.deezer.com/search'
/** A cover does not change; a failure may come from a hiccuping network, we retry it sooner. */
const HIT_TTL_MS = 7 * 24 * 3_600_000
const MISS_TTL_MS = 6 * 3_600_000
const CACHE_MAX = 256
const REQUEST_TIMEOUT_MS = 6000
/** Size requested from iTunes: its URLs carry the template, `100x100bb` by default. */
const ITUNES_SIZE = '600x600bb'

const itunesSchema = z.looseObject({
  results: z.array(z.looseObject({
    trackName: z.string().nullish(),
    artistName: z.string().nullish(),
    artworkUrl100: z.string().nullish(),
  })).nullish(),
})
const deezerSchema = z.looseObject({
  data: z.array(z.looseObject({
    title: z.string().nullish(),
    artist: z.looseObject({ name: z.string().nullish() }).nullish(),
    album: z.looseObject({ cover_big: z.string().nullish(), cover_xl: z.string().nullish() }).nullish(),
  })).nullish(),
})

/** The bare minimum of `fetch` to query a catalog (JSON response). */
export type CoverFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface Track { title: string; artist: string }

/** Without accents (NFD decomposition, combining marks removed) and lowercased. */
const strip = (s: string) => [...s.normalize('NFD')].filter((c) => c.codePointAt(0)! < 0x300 || c.codePointAt(0)! > 0x36f).join('').toLowerCase()
/** Comparable title: without accents, without what is in brackets ("(Live)", "[Official Video]"), without punctuation. */
export const normTitle = (s: string) => strip(s).replace(/[([][^)\]]*[)\]]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
/**
 * Comparable artist: on top of that, joining words go — the same duo is written "A & B" at iTunes,
 * "A et B" on a device set to French (observed), "A feat. B" elsewhere.
 */
export const normArtist = (s: string) => normTitle(s).replace(/\b(feat|ft|featuring|avec|with|and|et)\b/g, ' ').replace(/\s+/g, ' ').trim()

const tokens = (s: string) => new Set(normArtist(s).split(' ').filter(Boolean))
const subset = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every((t) => b.has(t))

/**
 * Is the result about THE track playing? Same title once normalized, and compatible artists: one of
 * the two word sets contains the other, which accepts "Northwind" (Deezer only names the first)
 * against "Northwind et Lumen", and refuses "Tim McGraw".
 */
export function matches(played: Track, found: { title?: string | null; artist?: string | null }): boolean {
  if (!found.title || !found.artist) return false
  if (normTitle(found.title) !== normTitle(played.title)) return false
  const a = tokens(played.artist), b = tokens(found.artist)
  return subset(a, b) || subset(b, a)
}

export interface CoverFinderOptions {
  fetchImpl?: CoverFetch
  clock: Clock
  logger: Logger
  signal: AbortSignal
}

export class CoverFinder {
  private readonly cache = new Map<string, { url: string | null; at: number }>()
  private readonly pending = new Map<string, Promise<string | null>>()
  private readonly fetchImpl: CoverFetch

  constructor(private readonly opts: CoverFinderOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  }

  /** Cache key: what identifies the track for us, regardless of case and accents. */
  static key(track: Track): string { return `${normArtist(track.artist)}|${normTitle(track.title)}` }

  /** Cover already found (or recent failure: `null`), without a request; `undefined` if never asked or stale. */
  cached(track: Track): string | null | undefined {
    const hit = this.cache.get(CoverFinder.key(track))
    if (!hit) return undefined
    return this.opts.clock.now() - hit.at < (hit.url ? HIT_TTL_MS : MISS_TTL_MS) ? hit.url : undefined
  }

  /** Looks up the cover (iTunes then Deezer); a single request in flight per track, `null` if nothing certain. */
  lookup(track: Track): Promise<string | null> {
    const known = this.cached(track)
    if (known !== undefined) return Promise.resolve(known)
    const key = CoverFinder.key(track)
    const inflight = this.pending.get(key)
    if (inflight) return inflight
    const p = this.search(track)
      .catch((err) => { this.opts.logger.debug({ track, err }, 'cover lookup failed'); return null })
      .then((url) => { this.remember(key, url); return url })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, p)
    return p
  }

  private remember(key: string, url: string | null): void {
    this.cache.delete(key)
    this.cache.set(key, { url, at: this.opts.clock.now() })
    while (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!)
  }

  private async search(track: Track): Promise<string | null> {
    return (await this.fromItunes(track)) ?? (await this.fromDeezer(track))
  }

  private async get(url: string): Promise<unknown | null> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.any([this.opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
    return res.ok ? res.json() : null
  }

  private async fromItunes(track: Track): Promise<string | null> {
    const term = encodeURIComponent(`${track.artist} ${track.title}`)
    const body = await this.get(`${ITUNES}?term=${term}&entity=song&media=music&limit=5`)
    const parsed = itunesSchema.safeParse(body ?? {})
    if (!parsed.success) return null
    for (const r of parsed.data.results ?? []) {
      if (!r.artworkUrl100 || !matches(track, { title: r.trackName, artist: r.artistName })) continue
      return r.artworkUrl100.replace(/\/100x100bb\.(jpg|png)$/, `/${ITUNES_SIZE}.$1`)
    }
    return null
  }

  private async fromDeezer(track: Track): Promise<string | null> {
    const q = encodeURIComponent(`${track.artist} ${track.title}`)
    const body = await this.get(`${DEEZER}?q=${q}&limit=5`)
    const parsed = deezerSchema.safeParse(body ?? {})
    if (!parsed.success) return null
    for (const r of parsed.data.data ?? []) {
      const cover = r.album?.cover_xl ?? r.album?.cover_big
      if (!cover || !matches(track, { title: r.title, artist: r.artist?.name })) continue
      return cover
    }
    return null
  }
}
