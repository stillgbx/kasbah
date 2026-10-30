import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile, userStateFile } from '../../core/paths'
import { describeError, sendError } from '../../http/errors'
import type { ResolvedStream, SpawnFn } from '../../music/proxy'
import { musicUserOf, registerMusicSource, type MusicSource, type MusicUser } from '../../music/sources'
import { YtmusicCatalog, type CreateSession } from './catalog'
import { createCookieFile, hasRequiredCookie, writeNetscapeBeside, type CookieStore } from './cookie'
import { importCookiesFromBrowser, isAuthError, YTM_BROWSERS } from './browserCookies'
import { pingPoToken, resolveStreamUrl } from './resolve'
import { POT_SERVER_MAIN, spawnPoTokenServer } from './potServer'
import type { YtmusicExploreCategory, YtmusicStatus } from './types'
import { ART_PLAY_SIZE, upgradeArtUrl } from './mapping'

// YouTube Music plugin (UNOFFICIAL): InnerTube catalog through youtubei.js, stream through yt-dlp +
// PO Token. Playback (queue, LAN relay to Cast/Sonos, transfer, local listening) is that of the
// SHARED player `music/player.ts` (/api/music), with which this plugin registers as a source.
//
// No device published (`discover` → []). Source ≠ player — same split as Music Assistant.
// The personal account's cookie lives in a state file (never `.env`, never logged): the house's,
// and the one of each signed-in user who linked their own (their state folder).

export const ytmusicConfigSchema = z.object({
  /** Raw cookie file. Empty string = memory only (tests). */
  YTM_COOKIE_FILE: z.string().trim().default(stateFile('ytmusic-cookie.txt')),
  /** PO Token generator (bgutil), port 4416 like Music Assistant. */
  YTM_PO_TOKEN_URL: z.string().trim().url().default('http://127.0.0.1:4416'),
  /** yt-dlp binary (PATH or full path). */
  YTM_YTDLP_PATH: z.string().trim().min(1).default('yt-dlp'),
})
export type YtmusicConfig = z.infer<typeof ytmusicConfigSchema>

export interface YtmusicPluginDeps {
  cookieStore?: CookieStore
  /** A signed-in user's cookie (tests); otherwise a file in their state folder. */
  userCookieStore?: (user: string) => CookieStore
  catalog?: YtmusicCatalog
  createSession?: CreateSession
  fetchImpl?: typeof fetch
  spawnImpl?: SpawnFn
  /** The PO Token generator to launch when nothing answers (`build/main.js`); `null` = never launch. */
  poTokenServer?: string | null
  /** Polling interval while waiting for the launched generator (default 1 s). */
  poTokenWaitMs?: number
}

export function healthFrom(
  linked: boolean,
  cookieExpired: boolean,
  poOk: boolean,
  lastError: string | null,
  keys: string[],
): PluginHealth {
  const base = 'YouTube Music (unofficial)'
  if (!linked) return { status: 'needs_pairing', detail: `${base}: paste cookie or import from browser on server host`, keys }
  if (cookieExpired) return { status: 'needs_pairing', detail: `${base}: cookie expired — reconnect in browser on server host`, keys }
  if (!poOk) return { status: 'degraded', detail: `${base}: PO Token generator unreachable`, keys }
  if (lastError) return { status: 'degraded', detail: `${base}: ${lastError}`, keys }
  return { status: 'ok', detail: `${base}: catalog + stream resolution`, keys }
}

export function createYtmusicPlugin(deps: YtmusicPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: YtmusicConfig | null = null
  let poTokenOk = false

  // tsx HMR: the module may be reloaded and its routes re-registered WITHOUT going through init()
  // again — everything init() builds is then rebuilt on demand, and the settings have a default.
  const log = () => ctx?.logger ?? (console as unknown as PluginContext['logger'])
  const now = () => ctx?.clock.now() ?? Date.now()
  const cfg = () => config ?? ytmusicConfigSchema.parse({})
  const keys = () => Object.keys(ytmusicConfigSchema.shape)
  const PROBE_MS = 5 * 60_000

  /**
   * A YouTube Music account: the house's (`user: null`, the cookie set in the plugin) or a signed-in
   * user's (their own cookie, in their state folder). Each has its own InnerTube sessions, caches and
   * state: one user's searches do not feed the other's suggestions.
   */
  interface Account {
    user: MusicUser
    cookies: CookieStore
    catalog: YtmusicCatalog
    /** Cache for the synchronous `health()` — updated on every cookie read. */
    linked: boolean
    /** Cookie present but refused by InnerTube. */
    cookieExpired: boolean
    lastProbeAt: number
    lastError: string | null
  }
  const accounts = new Map<string, Account>()

  function accountOf(user: MusicUser): Account {
    const key = user ?? ''
    let a = accounts.get(key)
    if (!a) {
      const file = cfg().YTM_COOKIE_FILE
      a = {
        user,
        cookies: user === null
          ? deps.cookieStore ?? createCookieFile(file)
          // empty path = memory only (tests): likewise for the users' accounts
          : deps.userCookieStore?.(user) ?? createCookieFile(file ? userStateFile(user, 'ytmusic-cookie.txt') : ''),
        catalog: deps.catalog ?? new YtmusicCatalog(deps.createSession),
        linked: false, cookieExpired: false, lastProbeAt: 0, lastError: null,
      }
      accounts.set(key, a)
    }
    return a
  }
  const accountFor = (req: FastifyRequest) => accountOf(musicUserOf(req))

  async function loadCookie(a: Account): Promise<string | null> {
    const raw = (await a.cookies.read())?.trim() ?? null
    a.linked = !!(raw && hasRequiredCookie(raw))
    if (!a.linked) a.cookieExpired = false
    return a.linked ? raw : null
  }

  async function refreshPo(): Promise<boolean> {
    const url = config?.YTM_PO_TOKEN_URL ?? 'http://127.0.0.1:4416'
    poTokenOk = await pingPoToken(url, deps.fetchImpl ?? fetch)
    return poTokenOk
  }

  /** The generator launched by the plugin, stopped with it. */
  let potChild: ChildProcessWithoutNullStreams | null = null

  /** Nothing answers: launch the generator if it is installed, then wait until it answers, without blocking startup. */
  async function launchPo(): Promise<void> {
    const url = cfg().YTM_PO_TOKEN_URL
    const main = deps.poTokenServer === undefined ? POT_SERVER_MAIN : deps.poTokenServer
    const launched = main === null ? 'not launched' : spawnPoTokenServer(deps.spawnImpl ?? (spawn as unknown as SpawnFn), url, main)
    if (typeof launched === 'string') { log().warn({ url }, `PO Token generator unreachable — ${launched}`); return }
    potChild = launched
    let tail = ''
    const keep = (d: Buffer) => { tail = (tail + d.toString()).slice(-1000) }
    launched.stdout?.on('data', keep)
    launched.stderr?.on('data', keep)
    launched.on('error', (err) => log().warn({ err: err.message }, 'PO Token generator failed to launch'))
    launched.on('exit', (code) => {
      if (potChild === launched) {
        potChild = null
        poTokenOk = false
        log().warn({ code, tail: tail.trim().split(/\r?\n/).slice(-3).join(' | ') }, 'PO Token generator exited')
      }
    })
    log().info({ url }, 'PO Token generator launched by Kasbah')
    for (let i = 0; i < 30 && potChild === launched; i++) {
      await new Promise((r) => setTimeout(r, deps.poTokenWaitMs ?? 1000))
      if (await refreshPo()) { log().info({ url }, 'PO Token generator ready'); return }
    }
  }

  /** Light probe: likes (`LM`) — fails with a 401 if the cookie is dead. */
  async function probeCookie(a: Account, raw: string): Promise<void> {
    try {
      await a.catalog.liked(raw)
      a.cookieExpired = false
    } catch (err) {
      if (isAuthError(err)) {
        a.cookieExpired = true
        a.lastError = 'cookie expired or rejected by YouTube'
        log().warn({ user: a.user }, 'YouTube Music cookie expired — reconnect via Settings')
      } else {
        log().debug({ err }, 'ytmusic cookie probe failed (non-auth)')
      }
    } finally {
      a.lastProbeAt = ctx?.clock.now() ?? Date.now()
    }
  }

  async function status(a: Account, opts?: { probe?: boolean }): Promise<YtmusicStatus> {
    await loadCookie(a)
    await refreshPo().catch(() => { poTokenOk = false })
    const now = ctx?.clock.now() ?? 0
    const due = a.linked && (opts?.probe === true || a.cookieExpired || now - a.lastProbeAt > PROBE_MS)
    if (due) {
      const raw = (await a.cookies.read())?.trim()
      if (raw && hasRequiredCookie(raw)) await probeCookie(a, raw)
    }
    return {
      linked: a.linked,
      cookieExpired: a.cookieExpired,
      poTokenOk,
      unofficial: true,
      cookieFile: a.cookies.path,
      poTokenUrl: config?.YTM_PO_TOKEN_URL ?? 'http://127.0.0.1:4416',
      lastError: a.lastError,
      // the import reads a browser on the server machine: the house's, not a user's
      browsers: a.user === null ? [...YTM_BROWSERS] : [],
      user: a.user,
      anonymous: a.user !== null && !a.linked,
    }
  }

  /**
   * The account's cookie. A signed-in user who linked nothing goes ANONYMOUS (`''`): public catalog,
   * nothing personal — except `personal` (likes, library), which requires an account. The house
   * without a cookie remains to be linked, as before.
   */
  async function requireCookie(a: Account, opts: { personal?: boolean } = {}): Promise<string> {
    const raw = await loadCookie(a)
    if (raw && a.cookieExpired) throw new PluginError('NEEDS_PAIRING', 'YouTube Music cookie expired — reconnect in Settings')
    if (raw) return raw
    if (a.user !== null && !opts.personal) return ''
    throw new PluginError('NEEDS_PAIRING', 'no YouTube Music cookie linked (unofficial)')
  }

  // ---- source for the shared player (`music/player.ts`) -----------------------------------------

  async function resolveTrack(a: Account, cookie: string, videoId: string): Promise<ResolvedStream> {
    let netscapePath: string | undefined
    if (cookie && a.cookies.path) netscapePath = await writeNetscapeBeside(a.cookies.path, cookie)
    return resolveStreamUrl({
      videoId,
      // Aim for a container the speakers play (AAC in MP4) rather than the highest bitrate: it is
      // what we will relay as is, and a Sonos does not play the WebM/Opus that YouTube sometimes
      // offers higher up. Without m4a, we fall into the ffmpeg fallback, which plays everything.
      preferExts: ['m4a', 'mp4'],
      cookieRaw: cookie,
      ytdlpPath: cfg().YTM_YTDLP_PATH,
      poTokenUrl: cfg().YTM_PO_TOKEN_URL,
      ...(netscapePath ? { netscapePath } : {}),
      ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      onWarnings: (warnings) => log().warn({ user: a.user, videoId, warnings }, 'yt-dlp warnings'),
    })
  }

  /** What the shared player knows of YouTube Music: get ready (cookie, PO Token), find a track's stream. */
  const source: MusicSource = {
    id: 'ytmusic',
    label: 'YouTube Music',
    async prepare(user) {
      const a = accountOf(user)
      await requireCookie(a)
      if (!(await refreshPo())) {
        a.lastError = 'PO Token generator unreachable'
        throw new PluginError('DEVICE_UNAVAILABLE', a.lastError)
      }
    },
    async resolve(videoId, user) {
      const a = accountOf(user)
      const cookie = await requireCookie(a)
      try {
        const resolved = await resolveTrack(a, cookie, videoId)
        a.lastError = null
        return resolved
      } catch (err) {
        noteAuthFailure(a, err)
        if (err instanceof PluginError) throw err
        throw new PluginError('UPSTREAM_ERROR', a.lastError ?? (err as Error).message, { cause: err })
      }
    },
    playArt: (url) => upgradeArtUrl(url, ART_PLAY_SIZE) ?? url,
  }
  let unregister: (() => void) | null = null

  function noteAuthFailure(a: Account, err: unknown) {
    if (isAuthError(err)) {
      a.cookieExpired = true
      a.lastError = 'cookie expired or rejected by YouTube'
    } else {
      a.lastError = (err as Error).message
    }
  }

  function catalogError(a: Account, reply: FastifyReply, err: unknown) {
    noteAuthFailure(a, err)
    const d = describeError(err instanceof PluginError ? err : new PluginError('UPSTREAM_ERROR', a.lastError ?? 'upstream error', { cause: err }))
    return sendError(reply, d.status, d.code, d.message)
  }

  return {
    id: 'ytmusic',
    configSchema: ytmusicConfigSchema,

    async init(c) {
      ctx = c
      config = c.config as YtmusicConfig
      accounts.clear()
      unregister?.()
      unregister = registerMusicSource(source)
      poTokenOk = false
    },

    async discover(): Promise<DeviceDescriptor[]> { return [] },

    async start() {
      const home = accountOf(null)
      const raw = await loadCookie(home)
      if (!raw) log().info('YouTube Music (unofficial): no cookie yet — paste or import from browser on server host')
      else {
        log().info('YouTube Music (unofficial): cookie present')
        void probeCookie(home, raw)
      }
      void refreshPo().then((ok) => (ok ? undefined : launchPo()))
    },

    async execute(_externalId: string, command: Command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `ytmusic publishes no devices (${command.type})`)
    },

    async stop() {
      const child = potChild
      potChild = null
      if (child && child.exitCode === null) child.kill()
      unregister?.()
      unregister = null
      for (const a of accounts.values()) a.catalog.reset()
      accounts.clear()
      ctx = null
      config = null
    },

    registerRoutes(app: FastifyInstance) {
      // Each route acts on the account of whoever asks (`accountFor`): their own if signed in, the
      // house's otherwise.
      app.get('/status', async (req) => status(accountFor(req), { probe: true }))

      app.put<{ Body: unknown }>('/cookie', async (req, reply) => {
        let raw = ''
        if (typeof req.body === 'string') raw = req.body
        else if (req.body && typeof req.body === 'object' && 'cookie' in (req.body as object)) {
          raw = String((req.body as { cookie: unknown }).cookie ?? '')
        }
        raw = raw.trim()
        if (!raw) return sendError(reply, 400, 'INVALID_BODY', 'cookie body is required')
        if (!hasRequiredCookie(raw)) {
          return sendError(reply, 400, 'INVALID_BODY', 'cookie must include __Secure-3PAPISID (export from music.youtube.com)')
        }
        const a = accountFor(req)
        await a.cookies.write(raw)
        if (a.cookies.path) await writeNetscapeBeside(a.cookies.path, raw)
        a.catalog.reset()
        a.linked = true
        a.cookieExpired = false
        a.lastError = null
        log().info({ user: a.user }, 'YouTube Music cookie saved (unofficial)')
        return status(a, { probe: true })
      })

      app.post<{ Body: unknown }>('/cookie/from-browser', async (req, reply) => {
        const body = z.object({
          browser: z.enum(YTM_BROWSERS).default('chrome'),
        }).safeParse(req.body ?? {})
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', `browser must be one of ${YTM_BROWSERS.join(', ')}`)
        const a = accountFor(req)
        // a browser on the server machine carries the house's account, not a user's
        if (a.user !== null) return sendError(reply, 400, 'INVALID_BODY', 'browser import is for the house account only — paste your own cookie')
        if (!a.cookies.path) {
          return sendError(reply, 400, 'INVALID_BODY', 'YTM_COOKIE_FILE is empty — cannot persist browser cookies')
        }
        try {
          const netscapePath = `${a.cookies.path}.netscape`
          const raw = await importCookiesFromBrowser({
            ytdlpPath: cfg().YTM_YTDLP_PATH,
            browser: body.data.browser,
            netscapePath,
            ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
          })
          await a.cookies.write(raw)
          a.catalog.reset()
          a.linked = true
          a.cookieExpired = false
          a.lastError = null
          log().info({ browser: body.data.browser }, 'YouTube Music cookie imported from browser (unofficial)')
          return status(a, { probe: true })
        } catch (err) {
          noteAuthFailure(a, err)
          if (err instanceof PluginError) {
            const d = describeError(err)
            return sendError(reply, d.status, d.code, d.message)
          }
          throw err
        }
      })

      app.delete('/cookie', async (req) => {
        const a = accountFor(req)
        await a.cookies.clear()
        a.catalog.reset()
        a.linked = false
        a.cookieExpired = false
        a.lastError = null
        log().info({ user: a.user }, 'YouTube Music cookie cleared')
        return status(a, { probe: false })
      })
      app.get<{ Querystring: { q?: string } }>('/search', async (req, reply) => {
        const q = (req.query.q ?? '').trim()
        if (!q) return sendError(reply, 400, 'INVALID_BODY', 'q is required')
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a)
          const result = await a.catalog.search(cookie, q)
          a.lastError = null
          if (cookie) a.cookieExpired = false
          return result
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })

      app.get('/library/liked', async (req, reply) => {
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a, { personal: true })
          const tracks = await a.catalog.liked(cookie)
          a.lastError = null
          a.cookieExpired = false
          return { tracks }
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })

      app.get('/library/playlists', async (req, reply) => {
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a, { personal: true })
          const playlists = await a.catalog.playlists(cookie)
          a.lastError = null
          return { playlists }
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })

      app.get<{ Params: { id: string } }>('/playlists/:id', async (req, reply) => {
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a)
          const tracks = await a.catalog.playlistTracks(cookie, req.params.id)
          a.lastError = null
          return { tracks }
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })

      app.get<{ Params: { id: string }; Querystring: { hl?: string } }>('/albums/:id', async (req, reply) => {
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a)
          // `hl`: the language of the album's description text
          const { tracks, description } = await a.catalog.album(cookie, req.params.id, langOf(req.query.hl))
          a.lastError = null
          return { tracks, description }
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })

      app.get<{ Params: { id: string }; Querystring: { hl?: string } }>('/artists/:id', async (req, reply) => {
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a)
          // `hl`: the language of the artist's description text
          const { tracks, description } = await a.catalog.artist(cookie, req.params.id, langOf(req.query.hl))
          a.lastError = null
          return { tracks, description }
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })

      // ---- Moods & genres ---------------------------------------------------------------------------
      // `hl`: the app's language (genre names are rendered by YouTube). Responses kept a few
      // minutes: they change little, and the tab is often reopened. Per account: "For you" is
      // specific to each.
      const langOf = (hl: unknown) => (typeof hl === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(hl) ? hl : undefined)
      const EXPLORE_TTL_MS = 10 * 60_000
      const exploreCache = new Map<string, { at: number; value: unknown }>()
      const cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
        const hit = exploreCache.get(key)
        if (hit && now() - hit.at < EXPLORE_TTL_MS) return hit.value as T
        const value = await load()
        exploreCache.set(key, { at: now(), value })
        return value
      }
      const scope = (a: Account) => `${a.user ?? ''}|`

      /**
       * Category covers: the "Moods & genres" page has NO image, so we take the first two covers of
       * each category page (playlists, otherwise albums, otherwise tracks). One page per category
       * (~37), four at a time, kept 6 h; the pages read also serve when a category is opened. The UI
       * shows the cards first and the covers as they arrive.
       */
      const COVERS_TTL_MS = 6 * 3_600_000
      const COVERS_CONCURRENCY = 4
      /**
       * Per account and language, the covers already found, category by category: "For you" changes
       * from one read of the page to the next, a new category must not wait 6 h for its covers — we
       * only fetch the ones missing (or gone stale).
       */
      const coverStore = new Map<string, Map<string, { at: number; urls: string[] }>>()
      const coversInflight = new Map<string, Promise<void>>()
      const coversOf = (page: { shelves: Array<{ tracks: Array<{ artUrl: string | null }>; playlists: Array<{ artUrl: string | null }>; albums: Array<{ artUrl: string | null }> }> }) => {
        const arts = [
          ...page.shelves.flatMap((sh) => sh.playlists),
          ...page.shelves.flatMap((sh) => sh.albums),
          ...page.shelves.flatMap((sh) => sh.tracks),
        ].map((x) => x.artUrl).filter((u): u is string => !!u)
        // at 240 px: the card shows them around 90 px, on high-density screens
        return [...new Set(arts)].slice(0, 2).map((u) => upgradeArtUrl(u, 240) ?? u)
      }
      async function fillCovers(a: Account, cookie: string, lang: string | undefined, cats: YtmusicExploreCategory[], store: Map<string, { at: number; urls: string[] }>) {
        let next = 0
        await Promise.all(Array.from({ length: COVERS_CONCURRENCY }, async () => {
          while (next < cats.length) {
            const c = cats[next++]!
            try {
              const page = await cached(`${scope(a)}category|${lang ?? ''}|${c.params}`, () => a.catalog.exploreCategory(cookie, c.params, lang))
              store.set(c.params, { at: now(), urls: coversOf(page) })
            } catch (err) {
              log().debug({ err, category: c.title }, 'ytmusic explore: covers of a category failed')
            }
          }
        }))
      }

      app.get<{ Querystring: { hl?: string } }>('/explore', async (req, reply) => {
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a)
          const lang = langOf(req.query.hl)
          const result = await cached(`${scope(a)}explore|${lang ?? ''}`, () => a.catalog.explore(cookie, lang))
          a.lastError = null
          return result
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })

      app.get<{ Querystring: { hl?: string } }>('/explore/covers', async (req, reply) => {
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a)
          const lang = langOf(req.query.hl)
          const key = `${scope(a)}${lang ?? ''}`
          const ex = await cached(`${scope(a)}explore|${lang ?? ''}`, () => a.catalog.explore(cookie, lang))
          const cats = [...new Map([...ex.forYou.categories, ...ex.moods.categories, ...ex.genres.categories].map((c) => [c.params, c])).values()]
          let store = coverStore.get(key)
          if (!store) coverStore.set(key, store = new Map())
          const missing = cats.filter((c) => { const hit = store!.get(c.params); return !hit || now() - hit.at > COVERS_TTL_MS })
          if (missing.length) {
            // two tabs open at the same time do not launch the same reads twice
            let run = coversInflight.get(key)
            if (!run) {
              run = fillCovers(a, cookie, lang, missing, store).finally(() => coversInflight.delete(key))
              coversInflight.set(key, run)
            }
            await run
          }
          return { covers: Object.fromEntries(cats.flatMap((c) => { const hit = store!.get(c.params); return hit ? [[c.params, hit.urls]] : [] })) }
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })

      app.get<{ Querystring: { hl?: string } }>('/explore/new', async (req, reply) => {
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a)
          const lang = langOf(req.query.hl)
          const result = await cached(`${scope(a)}new|${lang ?? ''}`, () => a.catalog.newReleases(cookie, lang))
          a.lastError = null
          return result
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })

      app.get<{ Querystring: { params?: string; hl?: string } }>('/explore/category', async (req, reply) => {
        const params = (req.query.params ?? '').trim()
        if (!params) return sendError(reply, 400, 'INVALID_BODY', 'params is required')
        const a = accountFor(req)
        try {
          const cookie = await requireCookie(a)
          const lang = langOf(req.query.hl)
          const result = await cached(`${scope(a)}category|${lang ?? ''}|${params}`, () => a.catalog.exploreCategory(cookie, params, lang))
          a.lastError = null
          return result
        } catch (err) {
          return catalogError(a, reply, err)
        }
      })
    },

    // `health`: the house's account; `healthFor`: a signed-in user's, who only sees their own.
    health(): PluginHealth {
      const home = accountOf(null)
      return healthFrom(home.linked, home.cookieExpired, poTokenOk, home.lastError, keys())
    },

    async healthFor(user: string): Promise<PluginHealth> {
      const a = accountOf(user)
      await loadCookie(a)
      const base = 'YouTube Music (unofficial)'
      // without a cookie the user listens anonymously: it works, nothing needs linking for all that
      if (!a.linked) {
        return poTokenOk
          ? { status: 'ok', detail: `${base}: anonymous — public catalog only; paste your cookie for likes and playlists`, keys: keys() }
          : { status: 'degraded', detail: `${base}: PO Token generator unreachable`, keys: keys() }
      }
      if (a.cookieExpired) return { status: 'needs_pairing', detail: `${base}: your cookie expired — paste a new one in Settings`, keys: keys() }
      return healthFrom(true, false, poTokenOk, a.lastError, keys())
    },
  }
}
