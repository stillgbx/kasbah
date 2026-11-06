import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import { z } from 'zod'

// What the podcasts plugin reads from outside:
//  - the Apple Podcasts directory (iTunes Search API: free, no key) to FIND a show, and to know the
//    address of its RSS feed from its numeric id (`lookup`). Apple no longer gives the feed of some
//    shows (all of Radio France's, seen on 2026-11-06), although those feeds are still public;
//  - the Podcast Index directory (free key and secret, optional), which keeps those addresses;
//  - the show's RSS feed itself, for its episodes and the address of each audio file.
// A show is known by its directory id (`123`, `pi-123`): nothing else has to be kept to find it
// again. A show added by its feed address (`rss-<hash>`) is only known through the subscriptions
// that hold that address.

export interface PodcastShow {
  /** Apple id (digits), Podcast Index id (`pi-<digits>`) or added by address (`rss-<12 hex>`). */
  id: string
  title: string
  author: string
  artUrl: string | null
  feedUrl: string
  genre: string | null
}

export interface PodcastEpisode {
  /** `<show id>:<16 hex>`: the show, and a hash of the episode's guid (or of its file address). */
  id: string
  showId: string
  showTitle: string
  title: string
  /** Publication time (ms), if the feed gives a readable date. */
  publishedAt: number | null
  durationS: number | null
  artUrl: string | null
  /** The audio file, as the feed gives it (often a tracking redirect). */
  audioUrl: string
  audioType: string | null
}

export interface PodcastFeed {
  title: string
  author: string
  artUrl: string | null
  /** Newest first. */
  episodes: PodcastEpisode[]
}

const SHOW_ID = String.raw`\d{1,15}|pi-\d{1,15}|rss-[0-9a-f]{12}`
export const SHOW_ID_RE = new RegExp(`^(?:${SHOW_ID})$`)
export const EPISODE_ID_RE = new RegExp(`^(${SHOW_ID}):([0-9a-f]{16})$`)

/** The id of a show added by its feed address. */
export const rssShowId = (feedUrl: string) => `rss-${createHash('sha1').update(feedUrl).digest('hex').slice(0, 12)}`

/**
 * An address typed by a user that the server may fetch: http(s), and not a name or a literal IP of
 * this machine or of the local network (the server must not become a way to probe it). The check is
 * on the address as written, not on what its name resolves to.
 */
export function isPublicFeedUrl(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host.includes('.') && !host.includes(':')) return false // localhost, a bare LAN name
  if (/\.(local|lan|home|internal|localhost)$/.test(host)) return false
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127))
  }
  if (host.includes(':')) return !(host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:'))
  return true
}

/** A feed of several thousand episodes weighs a few MB; beyond this, it is refused. */
const FEED_MAX_BYTES = 20 * 1024 * 1024

const itunesResult = z.object({
  collectionId: z.number(),
  collectionName: z.string().optional(),
  artistName: z.string().optional(),
  feedUrl: z.string().optional(),
  artworkUrl600: z.string().optional(),
  artworkUrl100: z.string().optional(),
  primaryGenreName: z.string().optional(),
}).passthrough()
const itunesResponse = z.object({ results: z.array(z.unknown()) })

/** A directory entry as a show; none without an http(s) feed (shows reserved to Apple subscribers). */
export function toShow(raw: unknown): PodcastShow | null {
  const r = itunesResult.safeParse(raw)
  if (!r.success) return null
  const feedUrl = r.data.feedUrl?.trim() ?? ''
  if (!/^https?:\/\//i.test(feedUrl)) return null
  return {
    id: String(r.data.collectionId),
    title: r.data.collectionName?.trim() || '',
    author: r.data.artistName?.trim() || '',
    artUrl: r.data.artworkUrl600 ?? r.data.artworkUrl100 ?? null,
    feedUrl,
    genre: r.data.primaryGenreName ?? null,
  }
}

export interface PodcastDirectory {
  search(q: string): Promise<PodcastShow[]>
  lookup(id: string): Promise<PodcastShow | null>
}

export function createPodcastDirectory(baseUrl: string, country: string, fetchImpl: typeof fetch, signal?: AbortSignal): PodcastDirectory {
  async function get(path: string, params: Record<string, string>): Promise<PodcastShow[]> {
    const url = new URL(path, baseUrl)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Apple Podcasts directory answered ${res.status}`)
    const body = itunesResponse.parse(await res.json())
    return body.results.map(toShow).filter((s): s is PodcastShow => s !== null)
  }
  return {
    search: (q) => get('/search', { media: 'podcast', entity: 'podcast', term: q, limit: '30', country }),
    async lookup(id) {
      if (!/^\d{1,15}$/.test(id)) return null
      return (await get('/lookup', { id, entity: 'podcast', country }))[0] ?? null
    },
  }
}

// ---- Podcast Index (api.podcastindex.org) ----------------------------------------------------------

const piFeed = z.object({
  id: z.number(),
  title: z.string().optional(),
  url: z.string().optional(),
  author: z.string().optional(),
  ownerName: z.string().optional(),
  image: z.string().optional(),
  artwork: z.string().optional(),
  itunesId: z.number().nullable().optional(),
  categories: z.record(z.string(), z.string()).nullable().optional(),
}).passthrough()

/** A Podcast Index entry as a show (with its Apple id, to avoid listing a show twice). */
export function toIndexShow(raw: unknown): (PodcastShow & { itunesId: string | null }) | null {
  const r = piFeed.safeParse(raw)
  if (!r.success) return null
  const feedUrl = r.data.url?.trim() ?? ''
  if (!/^https?:\/\//i.test(feedUrl)) return null
  return {
    id: `pi-${r.data.id}`,
    title: r.data.title?.trim() || '',
    author: (r.data.author || r.data.ownerName || '').trim(),
    artUrl: r.data.artwork || r.data.image || null,
    feedUrl,
    genre: Object.values(r.data.categories ?? {})[0] ?? null,
    itunesId: r.data.itunesId ? String(r.data.itunesId) : null,
  }
}

export interface PodcastIndex {
  search(q: string): Promise<(PodcastShow & { itunesId: string | null })[]>
  byId(id: string): Promise<PodcastShow | null>
}

/** Each request is signed: sha1(key + secret + unix time), with the time in a header. */
export function createPodcastIndex(baseUrl: string, key: string, secret: string, fetchImpl: typeof fetch, signal?: AbortSignal, now: () => number = Date.now): PodcastIndex {
  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`/api/1.0${path}`, baseUrl)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const date = String(Math.floor(now() / 1000))
    const timeout = AbortSignal.timeout(10_000)
    const res = await fetchImpl(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        'user-agent': 'Kasbah/1.0',
        'x-auth-key': key,
        'x-auth-date': date,
        authorization: createHash('sha1').update(key + secret + date).digest('hex'),
      },
    })
    if (!res.ok) throw new Error(`Podcast Index answered ${res.status}`)
    return res.json()
  }
  return {
    async search(q) {
      const body = z.object({ feeds: z.array(z.unknown()).default([]) }).parse(await get('/search/byterm', { q, max: '30' }))
      return body.feeds.map(toIndexShow).filter((s): s is NonNullable<typeof s> => s !== null)
    },
    async byId(id) {
      const m = /^pi-(\d{1,15})$/.exec(id)
      if (!m) return null
      const body = z.object({ feed: z.unknown() }).parse(await get('/podcasts/byfeedid', { id: m[1]! }))
      const show = toIndexShow(body.feed)
      if (!show) return null
      const { itunesId: _apple, ...rest } = show
      return rest
    },
  }
}

// ---- the RSS feed ----------------------------------------------------------------------------------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // a guid or a title made of digits stays a string
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => name === 'item',
})

type Node = Record<string, unknown>
/** The text of a node: a plain string, or the `#text` of a node that has attributes. */
function text(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return text(v[0])
  if (v && typeof v === 'object' && '#text' in v) return text((v as Node)['#text'])
  return ''
}
function attr(v: unknown, name: string): string {
  const node = Array.isArray(v) ? v[0] : v
  return node && typeof node === 'object' ? text((node as Node)[`@_${name}`]) : ''
}

/** `itunes:duration`: seconds, `MM:SS` or `HH:MM:SS`. */
export function parseDuration(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const parts = s.split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n) || n < 0) || parts.length > 3) return null
  const total = parts.reduce((acc, n) => acc * 60 + n, 0)
  return total > 0 ? Math.round(total) : null
}

const isAudio = (type: string, url: string) => (type ? /^audio\//i.test(type) : /\.(mp3|m4a|aac|ogg|opus)(\?|$)/i.test(url))

/** The episodes of a feed, newest first; an item without an audio file is skipped (video, article). */
export function parseFeed(xml: string, show: { id: string; title: string; artUrl: string | null }): PodcastFeed {
  const doc = parser.parse(xml) as Node
  const channel = ((doc.rss as Node | undefined)?.channel ?? null) as Node | null
  if (!channel) throw new Error('not an RSS feed')
  const title = text(channel.title) || show.title
  const author = text(channel['itunes:author']) || text(channel.managingEditor)
  const artUrl = attr(channel['itunes:image'], 'href') || text((channel.image as Node | undefined)?.url) || show.artUrl
  const items = (channel.item as Node[] | undefined) ?? []
  const episodes: PodcastEpisode[] = []
  for (const item of items) {
    const enclosure = item.enclosure
    const audioUrl = attr(enclosure, 'url')
    const audioType = attr(enclosure, 'type')
    if (!/^https?:\/\//i.test(audioUrl) || !isAudio(audioType, audioUrl)) continue
    const guid = text(item.guid) || audioUrl
    const date = Date.parse(text(item.pubDate))
    episodes.push({
      id: `${show.id}:${createHash('sha1').update(guid).digest('hex').slice(0, 16)}`,
      showId: show.id,
      showTitle: title,
      title: text(item.title) || text(item['itunes:title']) || title,
      publishedAt: Number.isFinite(date) ? date : null,
      durationS: parseDuration(text(item['itunes:duration'])),
      artUrl: attr(item['itunes:image'], 'href') || artUrl || null,
      audioUrl,
      audioType: audioType || null,
    })
  }
  // most feeds are already newest first, not all; an undated episode goes last
  episodes.sort((a, b) => (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity))
  return { title, author, artUrl: artUrl || null, episodes }
}

export async function fetchFeed(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(20_000)
  const res = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' } })
  if (!res.ok) throw new Error(`podcast feed answered ${res.status}`)
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > FEED_MAX_BYTES) throw new Error('podcast feed too large')
  const body = await res.text()
  if (body.length > FEED_MAX_BYTES) throw new Error('podcast feed too large')
  return body
}
