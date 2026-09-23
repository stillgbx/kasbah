import { z } from 'zod'
import { PluginError } from '../../core/plugin'

// API publique de Mixcloud (api.mixcloud.com) : sans clé ni connexion, tout ce qu'un compte montre
// publiquement se lit par son nom d'utilisateur — ses mix, favoris, écoutes, playlists, suivis. Le
// fil « nouveautés de mes suivis » du site, lui, demande une connexion : on le recompose à partir
// des derniers mix de chaque compte suivi (`followingUploads`).

const picturesSchema = z.record(z.string(), z.string()).optional()
const userSchema = z.object({ username: z.string(), name: z.string().optional().default(''), pictures: picturesSchema })
const cloudcastSchema = z.object({
  key: z.string(),
  name: z.string(),
  user: userSchema,
  pictures: picturesSchema,
  audio_length: z.number().optional(),
  created_time: z.string().optional(),
  tags: z.array(z.object({ name: z.string() })).optional().default([]),
})
const pageSchema = <T extends z.ZodTypeAny>(item: T) => z.object({
  data: z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = item.safeParse(r); return p.success ? [p.data as z.infer<T>] : [] })),
  paging: z.object({ next: z.string().optional() }).optional(),
})

export interface MixcloudMix {
  /** `/<user>/<slug>/` : l'id de la piste pour le lecteur commun, et la page à donner à yt-dlp. */
  key: string
  name: string
  user: { username: string; name: string }
  /** Pochette carrée, la plus grande que l'API donne (jusqu'à 1024 px). */
  artUrl: string | null
  durationS: number | null
  createdAt: string | null
  tags: string[]
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
  /** Curseur de la page suivante (l'URL `paging.next` de l'API), ou null en bout de liste. */
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
  }
}

/** Un nom d'utilisateur Mixcloud tel qu'il apparaît dans l'URL du profil. */
export const USERNAME_RE = /^[A-Za-z0-9_-]{1,64}$/
/** Une clé de mix ou de playlist : `/user/slug/`, rien d'autre (elle part telle quelle dans une URL). */
export const KEY_RE = /^\/[A-Za-z0-9_-]{1,64}\/(playlists\/)?[A-Za-z0-9_.%-]{1,200}\/$/

export interface MixcloudApi {
  user(username: string): Promise<MixcloudUser | null>
  cloudcasts(username: string, next?: string): Promise<MixcloudPage<MixcloudMix>>
  favorites(username: string, next?: string): Promise<MixcloudPage<MixcloudMix>>
  listens(username: string, next?: string): Promise<MixcloudPage<MixcloudMix>>
  playlists(username: string): Promise<MixcloudPlaylist[]>
  playlist(key: string, next?: string): Promise<MixcloudPage<MixcloudMix>>
  following(username: string): Promise<MixcloudUser[]>
  search(q: string, next?: string): Promise<MixcloudPage<MixcloudMix>>
}

const PAGE = 40

export function createMixcloudApi(base: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): MixcloudApi {
  const root = base.replace(/\/+$/, '')
  /** Seules les URL de l'API elle-même sont suivies : un curseur venu de l'UI n'ouvre rien d'autre. */
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
    // `async` : un nom invalide se rend en promesse rejetée, comme toute autre erreur de ces appels
    cloudcasts: async (u, next) => mixes(userPath(u, 'cloudcasts/'), next),
    favorites: async (u, next) => mixes(userPath(u, 'favorites/'), next),
    listens: async (u, next) => mixes(userPath(u, 'listens/'), next),
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
  }
}

/**
 * « Nouveautés de mes suivis » sans connexion : les derniers mix de chaque compte suivi, fusionnés du
 * plus récent au plus ancien. `max` comptes au plus, `perUser` mix chacun, `concurrency` requêtes à la
 * fois — l'API publique n'annonce pas son quota, on ne la martèle pas. Un compte qui échoue est sauté.
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
      try { found.push(...(await api.cloudcasts(u.username)).items.slice(0, perUser)) } catch { /* compte injoignable : sauté */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, users.length) }, worker))
  return found
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, limit)
}
