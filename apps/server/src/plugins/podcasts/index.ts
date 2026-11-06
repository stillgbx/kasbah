import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Command, PluginHealth } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile, userStateFile } from '../../core/paths'
import { sendError } from '../../http/errors'
import type { ResolvedStream } from '../../music/proxy'
import { musicUserOf, registerMusicSource, type MusicSource, type MusicUser } from '../../music/sources'
import { createPodcastDirectory, createPodcastIndex, EPISODE_ID_RE, fetchFeed, isPublicFeedUrl, parseFeed, rssShowId, SHOW_ID_RE, type PodcastDirectory, type PodcastEpisode, type PodcastFeed, type PodcastIndex, type PodcastShow } from './api'
import { resolveEpisode } from './resolve'
import { createPodcastsFile, memoryPodcasts, noteEpisodeProgress, resumePoint, type PodcastsState, type PodcastsStore } from './store'

// Podcasts plugin (official all the way: the Apple Podcasts directory, Podcast Index if a key is
// given, and each show's public RSS feed — or a feed added by its address). No device published: it is a SOURCE of the shared player (`music/player.ts`), which relays
// the episode's file to the speakers, holds the queue, the transfer and local listening. What this
// plugin adds: the subscriptions, the resume position of each episode and the episodes listened to,
// per account (the house, and each signed-in user). No external account: nothing to link.

export const podcastsConfigSchema = z.object({
  PODCASTS_DIRECTORY_URL: z.string().trim().url().default('https://itunes.apple.com'),
  /** The directory's storefront: search results and availability depend on it. */
  PODCASTS_COUNTRY: z.string().trim().length(2).default('FR'),
  PODCASTS_STATE_FILE: z.string().trim().default(stateFile('podcasts.json')),
  /** Podcast Index (free key at podcastindex.org): finds the shows whose feed Apple no longer gives. */
  PODCASTINDEX_KEY: z.string().trim().min(1).optional(),
  PODCASTINDEX_SECRET: z.string().trim().min(1).optional(),
  PODCASTINDEX_URL: z.string().trim().url().default('https://api.podcastindex.org'),
})
export type PodcastsConfig = z.infer<typeof podcastsConfigSchema>

export interface PodcastsPluginDeps {
  directory?: PodcastDirectory
  /** Podcast Index (tests); otherwise built from the key and secret, if both are given. */
  index?: PodcastIndex
  store?: PodcastsStore
  /** A signed-in user's state (tests); otherwise a file in their state folder. */
  userStore?: (user: string) => PodcastsStore
  fetchImpl?: typeof fetch
}

/** A feed read is kept half an hour (shared by every account: it is public). */
const FEED_TTL_MS = 30 * 60_000
/** A position is written to disk at most every 15 s. */
const SAVE_EVERY_MS = 15_000
/** Episodes per page of a show. */
const PAGE = 50
/** "New": the latest episodes of each subscription, merged. */
const LATEST_PER_SHOW = 20
const LATEST_MAX = 60

/** What the UI receives of a show: no feed address. */
type ShowView = Omit<PodcastShow, 'feedUrl'> & { subscribed: boolean }
/** What the UI receives of an episode: no file address; its resume and whether it was listened to. */
type EpisodeView = Omit<PodcastEpisode, 'audioUrl' | 'audioType'> & { resumeS?: number; played?: true }

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }))
  return out
}

export function createPodcastsPlugin(deps: PodcastsPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: PodcastsConfig | null = null
  let directory: PodcastDirectory | null = null
  let index: PodcastIndex | null = null
  let lastError: string | null = null
  let unregister: (() => void) | null = null
  const fetchImpl = deps.fetchImpl ?? fetch
  /** Shows met in the directory (search, lookup, subscriptions): their feed address. */
  const shows = new Map<string, PodcastShow>()
  const feeds = new Map<string, { at: number; feed: PodcastFeed }>()
  const loading = new Map<string, Promise<PodcastFeed>>()

  interface Account {
    user: MusicUser
    store: PodcastsStore
    state: PodcastsState
    saveTimer: ReturnType<typeof setTimeout> | null
  }
  const accounts = new Map<string, Promise<Account>>()

  const now = () => ctx?.clock.now() ?? Date.now()
  const needDirectory = () => {
    if (!directory) throw new PluginError('DEVICE_UNAVAILABLE', 'podcasts plugin is not started')
    return directory
  }
  function storeOf(user: MusicUser): PodcastsStore {
    const file = config?.PODCASTS_STATE_FILE ?? ''
    if (user === null) return deps.store ?? createPodcastsFile(file, ctx?.logger)
    return deps.userStore?.(user) ?? (file ? createPodcastsFile(userStateFile(user, 'podcasts.json'), ctx?.logger) : memoryPodcasts())
  }
  function accountOf(user: MusicUser): Promise<Account> {
    const key = user ?? ''
    let a = accounts.get(key)
    if (!a) {
      const store = storeOf(user)
      a = store.load().then((state) => {
        for (const s of state.subscriptions) if (!shows.has(s.id)) shows.set(s.id, s)
        return { user, store, state, saveTimer: null }
      })
      // a failed read does not stay cached: the next one retries
      a.catch(() => { if (accounts.get(key) === a) accounts.delete(key) })
      accounts.set(key, a)
    }
    return a
  }
  const accountFor = (req: FastifyRequest) => accountOf(musicUserOf(req))

  /** A call outside (directory, feed): the failure is kept for the health, then rethrown as is. */
  async function ask<T>(call: () => Promise<T>): Promise<T> {
    try {
      const out = await call()
      lastError = null
      return out
    } catch (err) {
      lastError = (err as Error).message
      throw err
    }
  }
  function persistSoon(a: Account) {
    if (a.saveTimer) return
    a.saveTimer = setTimeout(() => {
      a.saveTimer = null
      void a.store.save(a.state).catch((err) => ctx?.logger.warn({ err }, 'could not write the podcasts state file'))
    }, SAVE_EVERY_MS)
  }
  async function persistNow(a: Account) {
    if (a.saveTimer) { clearTimeout(a.saveTimer); a.saveTimer = null }
    await a.store.save(a.state)
  }

  /**
   * A show from its id: already met, or asked again from its directory. A show added by its address
   * is only known through the subscriptions holding it: the caller loads its account first.
   */
  async function showOf(id: string): Promise<PodcastShow | null> {
    if (!SHOW_ID_RE.test(id)) return null
    const known = shows.get(id)
    if (known) return known
    const found = id.startsWith('pi-') ? (index ? await ask(() => index!.byId(id)) : null)
      : id.startsWith('rss-') ? null
        : await ask(() => needDirectory().lookup(id))
    if (found) shows.set(id, found)
    return found
  }
  /**
   * Both directories: Apple first (its order), then what only Podcast Index has — mostly the shows
   * Apple lists without a feed. A Podcast Index entry for a show Apple already gave is dropped.
   */
  async function searchShows(q: string): Promise<PodcastShow[]> {
    const [apple, more] = await Promise.all([
      ask(() => needDirectory().search(q)),
      index ? ask(() => index!.search(q)).catch((err) => { ctx?.logger.warn({ err }, 'Podcast Index search failed'); return [] }) : Promise.resolve([]),
    ])
    const appleIds = new Set(apple.map((s) => s.id))
    const feeds = new Set(apple.map((s) => s.feedUrl))
    const extra = more.filter((s) => !(s.itunesId && appleIds.has(s.itunesId)) && !feeds.has(s.feedUrl))
      .map(({ itunesId: _apple, ...s }) => s)
    return [...apple, ...extra]
  }
  /** A show's feed, read again after half an hour (or right away with `fresh`). */
  async function feedOf(show: PodcastShow, fresh = false): Promise<PodcastFeed> {
    const hit = feeds.get(show.id)
    if (hit && !fresh && now() - hit.at < FEED_TTL_MS) return hit.feed
    let pending = loading.get(show.id)
    if (!pending) {
      pending = ask(async () => parseFeed(await fetchFeed(show.feedUrl, fetchImpl, ctx?.signal), show))
        .then((feed) => { feeds.set(show.id, { at: now(), feed }); return feed })
        .finally(() => loading.delete(show.id))
      loading.set(show.id, pending)
    }
    return pending
  }
  async function episodeOf(id: string, user: MusicUser): Promise<PodcastEpisode> {
    const m = EPISODE_ID_RE.exec(id)
    if (!m) throw new PluginError('UNSUPPORTED_COMMAND', 'invalid podcast episode id')
    // its subscriptions make the shows added by address known
    await accountOf(user)
    const show = await showOf(m[1]!)
    if (!show) throw new PluginError('UNSUPPORTED_COMMAND', `unknown podcast "${m[1]}"`)
    const find = (f: PodcastFeed) => f.episodes.find((e) => e.id === id)
    // an episode missing from a cached feed: the feed may have changed since, read it once more
    const ep = find(await feedOf(show)) ?? find(await feedOf(show, true))
    if (!ep) throw new PluginError('UPSTREAM_ERROR', 'this episode is no longer in the podcast feed')
    return ep
  }

  const showView = (a: Account, s: PodcastShow): ShowView => {
    const { feedUrl: _feed, ...rest } = s
    return { ...rest, subscribed: a.state.subscriptions.some((x) => x.id === s.id) }
  }
  const episodeView = (a: Account, e: PodcastEpisode): EpisodeView => {
    const { audioUrl: _url, audioType: _type, ...rest } = e
    const r = resumePoint(a.state.resume[e.id])
    return { ...rest, ...(r !== null ? { resumeS: r } : {}), ...(a.state.played[e.id] ? { played: true as const } : {}) }
  }

  const source: MusicSource = {
    id: 'podcasts',
    label: 'Podcasts',
    async resolve(id, user): Promise<ResolvedStream> {
      const ep = await episodeOf(id, user)
      return resolveEpisode(ep, fetchImpl)
    },
    onProgress(id, positionS, durationS, ended, user) {
      void accountOf(user).then((a) => {
        const wasPlayed = !!a.state.played[id]
        const before = resumePoint(a.state.resume[id])
        a.state = noteEpisodeProgress(a.state, id, positionS, durationS ?? null, ended, now())
        // finished or forgotten: right away (the UI will read again); a progress: no hurry
        const changed = (!wasPlayed && !!a.state.played[id]) || (before !== null && resumePoint(a.state.resume[id]) === null)
        if (changed) void persistNow(a).catch(() => {})
        else persistSoon(a)
      }).catch((err) => ctx?.logger.warn({ err }, 'podcasts state unreadable, progress not kept'))
    },
  }

  /** The house account, already read (for the health, synchronous). */
  let home: Account | null = null

  const healthOf = (state: PodcastsState): PluginHealth => {
    const keys = Object.keys(podcastsConfigSchema.shape)
    const n = state.subscriptions.length
    const detail = `Podcasts: ${n} subscription${n === 1 ? '' : 's'}, ${index ? 'Apple + Podcast Index' : 'Apple directory only (no Podcast Index key)'}`
    return lastError ? { status: 'degraded', detail: `${detail} — ${lastError}`, keys } : { status: 'ok', detail, keys }
  }

  return {
    id: 'podcasts',
    configSchema: podcastsConfigSchema,

    async init(context) {
      ctx = context
      config = podcastsConfigSchema.parse(context.config)
      directory = deps.directory ?? createPodcastDirectory(config.PODCASTS_DIRECTORY_URL, config.PODCASTS_COUNTRY, fetchImpl, context.signal)
      index = deps.index ?? (config.PODCASTINDEX_KEY && config.PODCASTINDEX_SECRET
        ? createPodcastIndex(config.PODCASTINDEX_URL, config.PODCASTINDEX_KEY, config.PODCASTINDEX_SECRET, fetchImpl, context.signal, () => context.clock.now())
        : null)
      accounts.clear()
      home = await accountOf(null)
      unregister?.()
      unregister = registerMusicSource(source)
    },
    async discover() { return [] },
    async start() {},
    async execute(_externalId, command: Command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `podcasts publishes no device (${command.type})`)
    },
    async stop() {
      unregister?.()
      unregister = null
      for (const p of accounts.values()) {
        const a = await p.catch(() => null)
        if (a?.saveTimer) await persistNow(a).catch(() => {})
      }
      accounts.clear()
      feeds.clear()
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      // Each route acts on the account of whoever calls it: their own if signed in, the house's otherwise.
      app.get('/status', async (req) => {
        const a = await accountFor(req)
        return { subscriptions: a.state.subscriptions.length, account: a.user, lastError }
      })

      app.get<{ Querystring: { q?: string } }>('/search', async (req, reply) => {
        const q = (req.query.q ?? '').trim()
        if (q.length < 2) return sendError(reply, 400, 'INVALID_QUERY', 'q must be at least 2 characters')
        const a = await accountFor(req)
        const found = await searchShows(q)
        for (const s of found) shows.set(s.id, s)
        return { shows: found.map((s) => showView(a, s)) }
      })

      app.get('/subscriptions', async (req) => {
        const a = await accountFor(req)
        return { shows: a.state.subscriptions.map((s) => showView(a, s)) }
      })

      app.put<{ Params: { id: string } }>('/subscriptions/:id', async (req, reply) => {
        const a = await accountFor(req)
        const show = await showOf(req.params.id)
        if (!show) return sendError(reply, 404, 'NOT_FOUND', `unknown podcast "${req.params.id}"`)
        // the latest subscribed comes first
        if (!a.state.subscriptions.some((s) => s.id === show.id)) {
          a.state = { ...a.state, subscriptions: [show, ...a.state.subscriptions] }
          await persistNow(a)
        }
        return { shows: a.state.subscriptions.map((s) => showView(a, s)) }
      })

      // A show missing from the directories, added by its feed address: read once to check it is a
      // podcast (and to name it), then subscribed. Adding it twice makes no duplicate.
      app.post<{ Body: unknown }>('/subscriptions/rss', async (req, reply) => {
        const body = z.object({ url: z.string().trim().max(2048) }).safeParse(req.body)
        if (!body.success || !isPublicFeedUrl(body.data.url)) return sendError(reply, 400, 'INVALID_BODY', 'a public http(s) feed address is required')
        const url = body.data.url
        const a = await accountFor(req)
        const id = rssShowId(url)
        let feed: PodcastFeed
        try {
          feed = parseFeed(await fetchFeed(url, fetchImpl, ctx?.signal), { id, title: '', artUrl: null })
        } catch (err) {
          return sendError(reply, 400, 'INVALID_BODY', `not a podcast feed: ${(err as Error).message}`)
        }
        if (!feed.episodes.length) return sendError(reply, 400, 'INVALID_BODY', 'this feed has no audio episode')
        const show: PodcastShow = { id, title: feed.title || url, author: feed.author, artUrl: feed.artUrl, feedUrl: url, genre: null }
        shows.set(id, show)
        feeds.set(id, { at: now(), feed })
        a.state = { ...a.state, subscriptions: [show, ...a.state.subscriptions.filter((s) => s.id !== id)] }
        await persistNow(a)
        return { show: showView(a, show), shows: a.state.subscriptions.map((s) => showView(a, s)) }
      })

      app.delete<{ Params: { id: string } }>('/subscriptions/:id', async (req) => {
        const a = await accountFor(req)
        a.state = { ...a.state, subscriptions: a.state.subscriptions.filter((s) => s.id !== req.params.id) }
        await persistNow(a)
        return { shows: a.state.subscriptions.map((s) => showView(a, s)) }
      })

      // A show and its episodes, newest first, by pages (`offset` = what the previous page returned in `next`).
      app.get<{ Params: { id: string }; Querystring: { offset?: string } }>('/shows/:id', async (req, reply) => {
        const offset = Number(req.query.offset ?? 0)
        if (!Number.isInteger(offset) || offset < 0) return sendError(reply, 400, 'INVALID_QUERY', 'offset is a non-negative integer')
        const a = await accountFor(req)
        const show = await showOf(req.params.id)
        if (!show) return sendError(reply, 404, 'NOT_FOUND', `unknown podcast "${req.params.id}"`)
        const feed = await feedOf(show)
        const page = feed.episodes.slice(offset, offset + PAGE)
        const next = offset + PAGE < feed.episodes.length ? offset + PAGE : null
        return {
          show: { ...showView(a, show), title: show.title || feed.title, artUrl: show.artUrl ?? feed.artUrl },
          episodes: page.map((e) => episodeView(a, e)),
          next,
        }
      })

      // What is new: the latest episodes of every subscription, merged; a feed that fails is skipped.
      app.get('/latest', async (req) => {
        const a = await accountFor(req)
        const lists = await mapLimit(a.state.subscriptions, 4, (s) => feedOf(s).then((f) => f.episodes.slice(0, LATEST_PER_SHOW)).catch(() => []))
        const episodes = lists.flat().sort((x, y) => (y.publishedAt ?? -Infinity) - (x.publishedAt ?? -Infinity)).slice(0, LATEST_MAX)
        return { episodes: episodes.map((e) => episodeView(a, e)) }
      })

      /** Start over: forget an episode's position, and that it was listened to. */
      app.delete<{ Querystring: { id?: string } }>('/resume', async (req, reply) => {
        const id = req.query.id ?? ''
        if (!EPISODE_ID_RE.test(id)) return sendError(reply, 400, 'INVALID_QUERY', 'an episode id is required')
        const a = await accountFor(req)
        const resume = { ...a.state.resume }
        const played = { ...a.state.played }
        delete resume[id]
        delete played[id]
        a.state = { ...a.state, resume, played }
        await persistNow(a)
        return { ok: true as const }
      })
    },

    // `health`: the house account; `healthFor`: a signed-in user's, who only sees their own.
    health(): PluginHealth {
      return healthOf(home?.state ?? { subscriptions: [], resume: {}, played: {} })
    },
    async healthFor(user: string): Promise<PluginHealth> {
      return healthOf((await accountOf(user)).state)
    },
  }
}
