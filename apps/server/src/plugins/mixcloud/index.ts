import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Command, PluginHealth } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile, userStateFile } from '../../core/paths'
import { sendError } from '../../http/errors'
import type { ResolvedStream, SpawnFn } from '../../music/proxy'
import { musicUserOf, registerMusicSource, type MusicSource, type MusicUser } from '../../music/sources'
import { createMixcloudApi, followingUploads, KEY_RE, USERNAME_RE, type MixcloudApi, type MixcloudMix } from './api'
import { buildHome, type HomeSection } from './home'
import { resolveMixcloud } from './resolve'
import { createMixcloudFile, memoryMixcloud, noteProgress, resumePoint, type MixcloudState, type MixcloudStore } from './store'

// Mixcloud plugin (UNOFFICIAL for playback): catalog through the public API (a username is enough,
// no password), stream through yt-dlp. No device published: it is a SOURCE of the shared player
// (`music/player.ts`), which serves the m4a to the speakers, holds the queue and the transfer. What
// this plugin adds: RESUME — the position reached in each mix listened to from here is remembered,
// per account (the house, and each signed-in user who gave their Mixcloud name).

export const mixcloudConfigSchema = z.object({
  MIXCLOUD_API_URL: z.string().trim().url().default('https://api.mixcloud.com'),
  MIXCLOUD_STATE_FILE: z.string().trim().default(stateFile('mixcloud.json')),
  /** yt-dlp: the same binary as YouTube Music, unless it is given here. */
  MIXCLOUD_YTDLP_PATH: z.string().trim().min(1).optional(),
  YTM_YTDLP_PATH: z.string().trim().min(1).optional(),
})
export type MixcloudConfig = z.infer<typeof mixcloudConfigSchema>

export interface MixcloudPluginDeps {
  api?: MixcloudApi
  store?: MixcloudStore
  /** A signed-in user's state (tests); otherwise a file in their state folder. */
  userStore?: (user: string) => MixcloudStore
  spawnImpl?: SpawnFn
  fetchImpl?: typeof fetch
  /** Stream resolution (tests); otherwise yt-dlp. */
  resolve?: (key: string) => Promise<ResolvedStream>
}

/** The "new from follows" feed costs one request per followed account: kept for half an hour. */
const FEED_TTL_MS = 30 * 60_000
/** A mix's position is written to disk at most every 15 s. */
const SAVE_EVERY_MS = 15_000

export function createMixcloudPlugin(deps: MixcloudPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: MixcloudConfig | null = null
  let api: MixcloudApi | null = null
  let lastError: string | null = null
  /** By Mixcloud name: it is public data, two accounts following the same name share it. */
  const feeds = new Map<string, { at: number; items: MixcloudMix[] }>()
  const homes = new Map<string, { at: number; sections: HomeSection[] }>()
  let unregister: (() => void) | null = null

  /**
   * A Kasbah account on the Mixcloud side: the house's (`user: null`, set in the plugin) or a
   * signed-in user's (their state folder). Each has its Mixcloud name and ITS resume positions: a
   * mix listened to by one does not get "resumed" for the other.
   */
  interface Account {
    user: MusicUser
    store: MixcloudStore
    state: MixcloudState
    saveTimer: ReturnType<typeof setTimeout> | null
  }
  const accounts = new Map<string, Promise<Account>>()

  const now = () => ctx?.clock.now() ?? Date.now()
  const needApi = () => {
    if (!api) throw new PluginError('DEVICE_UNAVAILABLE', 'Mixcloud plugin is not started')
    return api
  }
  const needUser = (a: Account) => {
    if (!a.state.username) throw new PluginError('NEEDS_PAIRING', 'no Mixcloud username set')
    return a.state.username
  }
  function storeOf(user: MusicUser): MixcloudStore {
    const file = config?.MIXCLOUD_STATE_FILE ?? ''
    if (user === null) return deps.store ?? createMixcloudFile(file, ctx?.logger)
    return deps.userStore?.(user) ?? (file ? createMixcloudFile(userStateFile(user, 'mixcloud.json'), ctx?.logger) : memoryMixcloud())
  }
  function accountOf(user: MusicUser): Promise<Account> {
    const key = user ?? ''
    let a = accounts.get(key)
    if (!a) {
      const store = storeOf(user)
      a = store.load().then((state) => ({ user, store, state, saveTimer: null }))
      // a failed read does not stay cached: the next one retries
      a.catch(() => { if (accounts.get(key) === a) accounts.delete(key) })
      accounts.set(key, a)
    }
    return a
  }
  const accountFor = (req: FastifyRequest) => accountOf(musicUserOf(req))

  /** A call to Mixcloud: the failure is kept for the health, then rethrown as is. */
  async function ask<T>(call: (a: MixcloudApi) => Promise<T>): Promise<T> {
    try {
      const out = await call(needApi())
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
      void a.store.save(a.state).catch((err) => ctx?.logger.warn({ err }, 'could not write the Mixcloud state file'))
    }, SAVE_EVERY_MS)
  }
  async function persistNow(a: Account) {
    if (a.saveTimer) { clearTimeout(a.saveTimer); a.saveTimer = null }
    await a.store.save(a.state)
  }
  /** The follows feed, kept for half an hour (one request per followed account). */
  async function followingFeed(username: string): Promise<MixcloudMix[]> {
    let hit = feeds.get(username)
    if (!hit || now() - hit.at > FEED_TTL_MS) {
      hit = { at: now(), items: await followingUploads(needApi(), username) }
      feeds.set(username, hit)
    }
    return hit.items
  }
  /** Each mix returned to the UI carries the account's resume position, if it has one. */
  const withResume = (a: Account, items: MixcloudMix[]) => items.map((m) => {
    const r = resumePoint(a.state.resume[m.key])
    return r === null ? m : { ...m, resumeS: r }
  })
  const forgetCaches = (...usernames: (string | null)[]) => {
    for (const u of usernames) if (u) { feeds.delete(u); homes.delete(u) }
  }

  const source: MusicSource = {
    id: 'mixcloud',
    label: 'Mixcloud',
    async resolve(key) {
      if (!KEY_RE.test(key)) throw new PluginError('UNSUPPORTED_COMMAND', 'invalid Mixcloud mix key')
      try {
        const cfg = config ?? mixcloudConfigSchema.parse({})
        const resolved = deps.resolve
          ? await deps.resolve(key)
          : await resolveMixcloud({
            key,
            ytdlpPath: cfg.MIXCLOUD_YTDLP_PATH ?? cfg.YTM_YTDLP_PATH ?? 'yt-dlp',
            ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
            ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          })
        lastError = null
        return resolved
      } catch (err) {
        lastError = (err as Error).message
        if (err instanceof PluginError) throw err
        throw new PluginError('UPSTREAM_ERROR', lastError, { cause: err })
      }
    },
    onProgress(key, positionS, durationS, ended, user) {
      void accountOf(user).then((a) => {
        // a signed-in user without a Mixcloud account listens anonymously: nothing is remembered
        if (a.user !== null && !a.state.username) return
        const before = resumePoint(a.state.resume[key])
        a.state = { ...a.state, resume: noteProgress(a.state.resume, key, positionS, durationS ?? null, ended, now()) }
        // end or forgetting: right away (the UI will read again); a progress: no hurry
        if (ended || (before !== null && resumePoint(a.state.resume[key]) === null)) void persistNow(a).catch(() => {})
        else persistSoon(a)
      }).catch((err) => ctx?.logger.warn({ err }, 'Mixcloud state unreadable, progress not kept'))
    },
  }

  /** The house account, already read (for the health, synchronous). */
  let home: Account | null = null

  return {
    id: 'mixcloud',
    configSchema: mixcloudConfigSchema,

    async init(context) {
      ctx = context
      config = mixcloudConfigSchema.parse(context.config)
      api = deps.api ?? createMixcloudApi(config.MIXCLOUD_API_URL, deps.fetchImpl ?? fetch, context.signal)
      accounts.clear()
      home = await accountOf(null)
      unregister?.()
      unregister = registerMusicSource(source)
    },
    async discover() { return [] },
    async start() {},
    async execute(_externalId, command: Command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `mixcloud publishes no device (${command.type})`)
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
      homes.clear()
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      // Each route acts on the account of whoever calls it (`accountFor`): their own if signed in,
      // the house's otherwise. Without a Mixcloud name, a signed-in user searches and listens anonymously.
      app.get('/status', async (req) => {
        const a = await accountFor(req)
        const user = a.state.username ? await ask((x) => x.user(a.state.username!)).catch(() => null) : null
        return { username: a.state.username, user, lastError, account: a.user }
      })

      // Linking = giving one's username (the one in the profile URL); it must exist at Mixcloud.
      app.put<{ Body: unknown }>('/account', async (req, reply) => {
        const body = z.object({ username: z.string().trim().regex(USERNAME_RE) }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'a Mixcloud username (letters, digits, - and _) is required')
        const a = await accountFor(req)
        const user = await ask((x) => x.user(body.data.username))
        if (!user) return sendError(reply, 404, 'NOT_FOUND', `no Mixcloud account named "${body.data.username}"`)
        forgetCaches(a.state.username, user.username)
        a.state = { ...a.state, username: user.username }
        await persistNow(a)
        ctx?.logger.info({ username: user.username, user: a.user }, 'Mixcloud account set')
        return { username: user.username, user, lastError, account: a.user }
      })

      app.delete('/account', async (req) => {
        const a = await accountFor(req)
        forgetCaches(a.state.username)
        a.state = { ...a.state, username: null }
        await persistNow(a)
        return { username: null, user: null, lastError, account: a.user }
      })

      // The account's lists. `feed`: what is new from followed accounts (rebuilt, cached); the others
      // are read page by page (`next` = cursor returned by the previous page).
      app.get<{ Params: { list: string }; Querystring: { next?: string } }>('/library/:list', async (req, reply) => {
        const a = await accountFor(req)
        const username = needUser(a)
        const { list } = req.params
        const next = req.query.next
        if (list === 'feed') return { items: withResume(a, await ask(() => followingFeed(username))), next: null }
        const call = list === 'favorites' ? (x: MixcloudApi) => x.favorites(username, next)
          : list === 'listens' ? (x: MixcloudApi) => x.listens(username, next)
            : list === 'uploads' ? (x: MixcloudApi) => x.cloudcasts(username, next)
              : null
        if (!call) return sendError(reply, 404, 'NOT_FOUND', `unknown Mixcloud list "${list}"`)
        const page = await ask(call)
        return { items: withResume(a, page.items), next: page.next }
      })

      // The home view, the site's way: your creators, your follows, listen again, more from your
      // creators, the popular ones of your genres — rebuilt from your public listens, kept for half an
      // hour. The resume positions, however, are read again on every call.
      app.get('/home', async (req) => {
        const a = await accountFor(req)
        const username = needUser(a)
        let hit = homes.get(username)
        if (!hit || now() - hit.at > FEED_TTL_MS) {
          hit = { at: now(), sections: await ask((x) => buildHome(x, username, () => followingFeed(username))) }
          homes.set(username, hit)
        }
        return { sections: hit.sections.map((s) => (s.kind === 'mixes' ? { ...s, items: withResume(a, s.items) } : s)) }
      })

      app.get('/playlists', async (req) => {
        const a = await accountFor(req)
        return { playlists: await ask((x) => x.playlists(needUser(a))) }
      })

      app.get<{ Querystring: { key?: string; next?: string } }>('/playlist', async (req, reply) => {
        const key = req.query.key ?? ''
        if (!KEY_RE.test(key)) return sendError(reply, 400, 'INVALID_QUERY', 'a playlist key is required')
        const a = await accountFor(req)
        const page = await ask((x) => x.playlist(key, req.query.next))
        return { items: withResume(a, page.items), next: page.next }
      })

      app.get('/following', async (req) => {
        const a = await accountFor(req)
        return { users: await ask((x) => x.following(needUser(a))) }
      })

      app.get<{ Params: { username: string }; Querystring: { next?: string } }>('/users/:username/cloudcasts', async (req, reply) => {
        if (!USERNAME_RE.test(req.params.username)) return sendError(reply, 400, 'INVALID_QUERY', 'invalid Mixcloud username')
        const a = await accountFor(req)
        const page = await ask((x) => x.cloudcasts(req.params.username, req.query.next))
        return { items: withResume(a, page.items), next: page.next }
      })

      app.get<{ Querystring: { q?: string; next?: string } }>('/search', async (req, reply) => {
        const q = (req.query.q ?? '').trim()
        if (q.length < 2) return sendError(reply, 400, 'INVALID_QUERY', 'q must be at least 2 characters')
        const a = await accountFor(req)
        const page = await ask((x) => x.search(q, req.query.next))
        return { items: withResume(a, page.items), next: page.next }
      })

      /** Start over: forget a mix's remembered position. */
      app.delete<{ Querystring: { key?: string } }>('/resume', async (req, reply) => {
        const key = req.query.key ?? ''
        if (!KEY_RE.test(key)) return sendError(reply, 400, 'INVALID_QUERY', 'a mix key is required')
        const a = await accountFor(req)
        const resume = { ...a.state.resume }
        delete resume[key]
        a.state = { ...a.state, resume }
        await persistNow(a)
        return { ok: true as const }
      })
    },

    // `health`: the house account; `healthFor`: a signed-in user's, who only sees their own.
    health(): PluginHealth {
      const keys = Object.keys(mixcloudConfigSchema.shape)
      const state = home?.state
      if (!state?.username) return { status: 'needs_pairing', detail: 'Mixcloud: set your username on the Music page', keys }
      const detail = `Mixcloud: ${state.username}, ${Object.keys(state.resume).length} mix(es) to resume`
      return lastError ? { status: 'degraded', detail: `${detail} — ${lastError}`, keys } : { status: 'ok', detail, keys }
    },

    async healthFor(user: string): Promise<PluginHealth> {
      const keys = Object.keys(mixcloudConfigSchema.shape)
      const { state } = await accountOf(user)
      // without a Mixcloud name the user searches and listens anonymously: it works, nothing is remembered
      const detail = state.username
        ? `Mixcloud: ${state.username}, ${Object.keys(state.resume).length} mix(es) to resume`
        : 'Mixcloud: anonymous — search only; set your username for your home, favorites and resume points'
      return lastError ? { status: 'degraded', detail: `${detail} — ${lastError}`, keys } : { status: 'ok', detail, keys }
    },
  }
}
