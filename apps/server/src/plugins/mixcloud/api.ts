import { z } from 'zod'
import { PluginError } from '../../core/plugin'

// Mixcloud's public API (api.mixcloud.com): without a key or sign-in, everything an account shows
// publicly can be read by its username — its mixes, favorites, listens, playlists, follows. The
// site's "new from the accounts I follow" feed, however, requires a sign-in: we rebuild it from the
// latest mixes of each followed account (`followingUploads`).

const picturesSchema = z.record(z.string(), z.string()).optional()
const userSchema = z.object({ username: z.string(), name: z.string().optional().default(''), pictures: picturesSchema })
const cloudcastSchema = z.object({
  key: z.string(),
  name: z.string(),
  user: userSchema,
  pictures: picturesSchema,
  audio_length: z.number().optional(),
  created_time: z.string().optional(),
  tags: z.array(z.object({ name: z.string(), key: z.string().optional() })).optional().default([]),
})
const pageSchema = <T extends z.ZodTypeAny>(item: T) => z.object({
  data: z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = item.safeParse(r); return p.success ? [p.data as z.infer<T>] : [] })),
  paging: z.object({ next: z.string().optional() }).optional(),
})

export interface MixcloudMix {
  /** `/<user>/<slug>/`: the track id for the shared player, and the page to give yt-dlp. */
  key: string
  name: string
  user: { username: string; name: string }
  /** Square cover, the largest the API gives (up to 1024 px). */
  artUrl: string | null
  durationS: number | null
  createdAt: string | null
  tags: string[]
  /** The mix's genres as the API names them in its URLs (`/genres/jazz/` → `jazz`), in tag order. */
  genres: { slug: string; name: string }[]
}

export interface MixcloudUser {
  username: string
  name: string
  artUrl: string | null
}

export interface MixcloudPlaylist {
  key: string
  name: string
}

export interface MixcloudPage<T> {
  items: T[]
  /** Cursor of the next page (the API's `paging.next` URL), or null at the end of the list. */
  next: string | null
}

const ART_ORDER = ['1024wx1024h', '768wx768h', '640wx640h', 'extra_large', '320wx320h', 'large', 'medium']
function bestPicture(p: Record<string, string> | undefined): string | null {
  if (!p) return null
  for (const k of ART_ORDER) if (p[k]) return p[k]!
  return null
}

export function toMix(c: z.infer<typeof cloudcastSchema>): MixcloudMix {
  return {
    key: c.key,
    name: c.name,
    user: { username: c.user.username, name: c.user.name || c.user.username },
    artUrl: bestPicture(c.pictures),
    durationS: typeof c.audio_length === 'number' && c.audio_length > 0 ? c.audio_length : null,
    createdAt: c.created_time ?? null,
    tags: c.tags.map((t) => t.name).slice(0, 5),
    genres: c.tags.flatMap((t) => {
      const slug = /^\/genres\/([a-z0-9-]+)\/$/.exec(t.key ?? '')?.[1]
      return slug ? [{ slug, name: t.name }] : []
    }),
  }
}

/** A Mixcloud username as it appears in the profile URL. */
export const USERNAME_RE = /^[A-Za-z0-9_-]{1,64}$/
/** A mix or playlist key: `/user/slug/`, nothing else (it goes as is into a URL). */
export const KEY_RE = /^\/[A-Za-z0-9_-]{1,64}\/(playlists\/)?[A-Za-z0-9_.%-]{1,200}\/$/

export interface MixcloudApi {
  user(username: string): Promise<MixcloudUser | null>
  cloudcasts(username: string, next?: string): Promise<MixcloudPage<MixcloudMix>>
  favorites(username: string, next?: string): Promise<MixcloudPage<MixcloudMix>>
  /** `limit`: up to 100 per page (the home view derives the most listened creators and genres from it). */
  listens(username: string, next?: string, limit?: number): Promise<MixcloudPage<MixcloudMix>>
  playlists(username: string): Promise<MixcloudPlaylist[]>
  playlist(key: string, next?: string): Promise<MixcloudPage<MixcloudMix>>
  following(username: string): Promise<MixcloudUser[]>
  search(q: string, next?: string): Promise<MixcloudPage<MixcloudMix>>
  /** A genre's popular shows (`/discover/<slug>/popular/`). */
  popular(genreSlug: string): Promise<MixcloudPage<MixcloudMix>>
}

const PAGE = 40

export function createMixcloudApi(base: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): MixcloudApi {
  const root = base.replace(/\/+$/, '')
  /** Only the API's own URLs are followed: a cursor coming from the UI opens nothing else. */
  function urlFor(path: string, params: Record<string, string>, next?: string): string {
    if (next) {
      if (!next.startsWith(`${root}/`)) throw new PluginError('UNSUPPORTED_COMMAND', 'invalid page cursor')
      return next
    }
    const qs = new URLSearchParams(params).toString()
    return `${root}${path}${qs ? `?${qs}` : ''}`
  }
  async function get(url: string): Promise<unknown> {
    let res: Response
    try {
      res = await fetchImpl(url, { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) })
    } catch (err) {
      throw new PluginError('DEVICE_UNAVAILABLE', `Mixcloud unreachable: ${(err as Error).message}`)
    }
    if (res.status === 404) return null
    if (res.status === 429 || res.status === 403) throw new PluginError('RATE_LIMITED', `Mixcloud answered ${res.status}`)
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `Mixcloud answered ${res.status}`)
    return res.json()
  }
  async function mixes(path: string, next?: string, params: Record<string, string> = {}): Promise<MixcloudPage<MixcloudMix>> {
    const body = await get(urlFor(path, { limit: String(PAGE), ...params }, next))
    if (body === null) return { items: [], next: null }
    const page = pageSchema(cloudcastSchema).parse(body)
    return { items: page.data.map(toMix), next: page.paging?.next ?? null }
  }
  const userPath = (u: string, rest = '') => {
    if (!USERNAME_RE.test(u)) throw new PluginError('UNSUPPORTED_COMMAND', 'invalid Mixcloud username')
    return `/${u}/${rest}`
  }
  return {
    async user(username) {
      const body = await get(urlFor(userPath(username), {}))
      if (body === null) return null
      const u = userSchema.parse(body)
      return { username: u.username, name: u.name || u.username, artUrl: bestPicture(u.pictures) }
    },
    // `async`: an invalid name comes back as a rejected promise, like any other error from these calls
    cloudcasts: async (u, next) => mixes(userPath(u, 'cloudcasts/'), next),
    favorites: async (u, next) => mixes(userPath(u, 'favorites/'), next),
    listens: async (u, next, limit) => mixes(userPath(u, 'listens/'), next, limit ? { limit: String(Math.min(100, limit)) } : {}),
    async playlists(u) {
      const body = await get(urlFor(userPath(u, 'playlists/'), { limit: '100' }))
      if (body === null) return []
      return pageSchema(z.object({ key: z.string(), name: z.string() })).parse(body).data
    },
    async playlist(key, next) {
      if (!KEY_RE.test(key) || !key.includes('/playlists/')) throw new PluginError('UNSUPPORTED_COMMAND', 'invalid Mixcloud playlist key')
      return mixes(`${key}cloudcasts/`, next)
    },
    async following(u) {
      const body = await get(urlFor(userPath(u, 'following/'), { limit: '200' }))
      if (body === null) return []
      return pageSchema(userSchema).parse(body).data.map((x) => ({ username: x.username, name: x.name || x.username, artUrl: bestPicture(x.pictures) }))
    },
    search: async (q, next) => mixes('/search/', next, { q, type: 'cloudcast' }),
    async popular(slug) {
      if (!/^[a-z0-9-]{1,64}$/.test(slug)) throw new PluginError('UNSUPPORTED_COMMAND', 'invalid Mixcloud genre')
      return mixes(`/discover/${slug}/popular/`)
    },
  }
}

/**
 * "New from the accounts I follow" without a sign-in: the latest mixes of each followed account,
 * merged from newest to oldest. At most `max` accounts, `perUser` mixes each, `concurrency` requests
 * at a time — the public API does not announce its quota, we do not hammer it. An account that fails
 * is skipped.
 */
export async function followingUploads(
  api: MixcloudApi,
  username: string,
  opts: { max?: number; perUser?: number; concurrency?: number; limit?: number } = {},
): Promise<MixcloudMix[]> {
  const { max = 60, perUser = 3, concurrency = 4, limit = 60 } = opts
  const users = (await api.following(username)).slice(0, max)
  const found: MixcloudMix[] = []
  let cursor = 0
  async function worker() {
    while (cursor < users.length) {
      const u = users[cursor++]!
      try { found.push(...(await api.cloudcasts(u.username)).items.slice(0, perUser)) } catch { /* unreachable account: skipped */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, users.length) }, worker))
  return found
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, limit)
}
