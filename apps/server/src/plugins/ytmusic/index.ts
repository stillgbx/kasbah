import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { describeError, sendError } from '../../http/errors'
import { getYtmusicBridge } from './bridge'
import { YtmusicCatalog, type CreateSession } from './catalog'
import { createCookieFile, hasRequiredCookie, writeNetscapeBeside, type CookieStore } from './cookie'
import { importCookiesFromBrowser, isAuthError, YTM_BROWSERS } from './browserCookies'
import { pingPoToken, resolveStreamUrl, StreamProxy, type SpawnFn } from './stream'
import type { YtmusicStatus } from './types'

// Plugin YouTube Music (NON OFFICIEL) : catalogue InnerTube via youtubei.js, flux via yt-dlp +
// PO Token, lecture sur Cast/Sonos par `media_player.play_url` d'une URL proxy LAN.
//
// Aucun appareil publié (`discover` → []). Source ≠ lecteur — même découpage que Music Assistant.
// Le cookie du compte perso vit dans un fichier d'état (jamais `.env`, jamais journalisé).

export const ytmusicConfigSchema = z.object({
  /** Fichier cookie brut. Chaîne vide = mémoire seule (tests). */
  YTM_COOKIE_FILE: z.string().trim().default(stateFile('ytmusic-cookie.txt')),
  /** Générateur PO Token (bgutil), port 4416 comme Music Assistant. */
  YTM_PO_TOKEN_URL: z.string().trim().url().default('http://127.0.0.1:4416'),
  /** Binaire yt-dlp (PATH ou chemin complet). */
  YTM_YTDLP_PATH: z.string().trim().min(1).default('yt-dlp'),
  /** Binaire ffmpeg du proxy audio (clé commune Nest / caméras). */
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  /**
   * Base URL publiée pour Cast/Sonos (ex. `http://192.168.1.10:8787`). Vide = dérivée de la
   * requête `POST /play` (Host de la tablette) — adapté au LAN.
   */
  YTM_PUBLISH_BASE: z.string().trim().default(''),
})
export type YtmusicConfig = z.infer<typeof ytmusicConfigSchema>

export interface YtmusicPluginDeps {
  cookieStore?: CookieStore
  catalog?: YtmusicCatalog
  createSession?: CreateSession
  fetchImpl?: typeof fetch
  spawnImpl?: SpawnFn
  playUrl?: (deviceId: string, url: string, meta?: { title?: string; artist?: string; artUrl?: string }) => Promise<void>
  getDevice?: (deviceId: string) => { descriptor: { kind: string; capabilities: string[] } } | undefined
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
  return { status: 'ok', detail: `${base}: catalog + play_url proxy`, keys }
}

export function createYtmusicPlugin(deps: YtmusicPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: YtmusicConfig | null = null
  let cookies: CookieStore | null = null
  let catalog: YtmusicCatalog | null = null
  let proxy: StreamProxy | null = null
  let lastError: string | null = null
  let poTokenOk = false
  /** Cache pour `health()` synchrone — mis à jour à chaque lecture cookie. */
  let linked = false
  /** Cookie présent mais refusé par InnerTube. */
  let cookieExpired = false
  let lastProbeAt = 0

  const log = () => ctx!.logger
  const keys = () => Object.keys(ytmusicConfigSchema.shape)
  const PROBE_MS = 5 * 60_000

  async function loadCookie(): Promise<string | null> {
    const raw = (await cookies!.read())?.trim() ?? null
    linked = !!(raw && hasRequiredCookie(raw))
    if (!linked) cookieExpired = false
    return linked ? raw : null
  }

  async function refreshPo(): Promise<boolean> {
    poTokenOk = await pingPoToken(config!.YTM_PO_TOKEN_URL, deps.fetchImpl ?? fetch)
    return poTokenOk
  }

  /** Sonde légère : likes (`LM`) — échoue en 401 si le cookie est mort. */
  async function probeCookie(raw: string): Promise<void> {
    try {
      await catalog!.liked(raw)
      cookieExpired = false
    } catch (err) {
      if (isAuthError(err)) {
        cookieExpired = true
        lastError = 'cookie expired or rejected by YouTube'
        log().warn('YouTube Music cookie expired — reconnect via Settings')
      } else {
        log().debug({ err }, 'ytmusic cookie probe failed (non-auth)')
      }
    } finally {
      lastProbeAt = ctx!.clock.now()
    }
  }

  async function status(opts?: { probe?: boolean }): Promise<YtmusicStatus> {
    await loadCookie()
    await refreshPo().catch(() => { poTokenOk = false })
    const now = ctx?.clock.now() ?? 0
    const due = linked && catalog && (opts?.probe === true || cookieExpired || now - lastProbeAt > PROBE_MS)
    if (due) {
      const raw = (await cookies!.read())?.trim()
      if (raw && hasRequiredCookie(raw)) await probeCookie(raw)
    }
    return {
      linked,
      cookieExpired,
      poTokenOk,
      unofficial: true,
      cookieFile: cookies?.path ?? null,
      poTokenUrl: config!.YTM_PO_TOKEN_URL,
      lastError,
      browsers: [...YTM_BROWSERS],
    }
  }

  function publishBase(req: FastifyRequest): string {
    if (config!.YTM_PUBLISH_BASE) return config!.YTM_PUBLISH_BASE.replace(/\/$/, '')
    const host = req.headers['x-forwarded-host'] ?? req.headers.host
    if (!host || typeof host !== 'string') {
      throw new PluginError('UPSTREAM_ERROR', 'cannot derive LAN publish URL: set YTM_PUBLISH_BASE')
    }
    const hostname = host.split(':')[0]!
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      throw new PluginError('UPSTREAM_ERROR', 'YTM_PUBLISH_BASE required when the UI talks to localhost (Cast/Sonos need the LAN IP)')
    }
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
    return `${proto}://${host}`
  }

  async function requireCookie(): Promise<string> {
    const raw = await loadCookie()
    if (!raw) throw new PluginError('NEEDS_PAIRING', 'no YouTube Music cookie linked (unofficial)')
    if (cookieExpired) throw new PluginError('NEEDS_PAIRING', 'YouTube Music cookie expired — reconnect in Settings')
    return raw
  }

  function resolvePlay() {
    const get = deps.getDevice ?? ((id: string) => getYtmusicBridge()?.getDevice(id))
    const play = deps.playUrl ?? ((id: string, url: string, meta?: { title?: string; artist?: string; artUrl?: string }) => {
      const b = getYtmusicBridge()
      if (!b) return Promise.reject(new PluginError('DEVICE_UNAVAILABLE', 'playback bridge not ready'))
      return b.playUrl(id, url, meta)
    })
    return { get, play }
  }

  function noteAuthFailure(err: unknown) {
    if (isAuthError(err)) {
      cookieExpired = true
      lastError = 'cookie expired or rejected by YouTube'
    } else {
      lastError = (err as Error).message
    }
  }

  function catalogError(reply: FastifyReply, err: unknown) {
    noteAuthFailure(err)
    const d = describeError(err instanceof PluginError ? err : new PluginError('UPSTREAM_ERROR', lastError ?? 'upstream error', { cause: err }))
    return sendError(reply, d.status, d.code, d.message)
  }

  return {
    id: 'ytmusic',
    configSchema: ytmusicConfigSchema,

    async init(c) {
      ctx = c
      config = c.config as YtmusicConfig
      cookies = deps.cookieStore ?? createCookieFile(config.YTM_COOKIE_FILE)
      catalog = deps.catalog ?? new YtmusicCatalog(deps.createSession)
      proxy = new StreamProxy({
        ffmpegPath: config.FFMPEG_PATH,
        ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
        now: () => c.clock.now(),
      })
      lastError = null
      linked = false
      cookieExpired = false
      poTokenOk = false
    },

    async discover(): Promise<DeviceDescriptor[]> { return [] },

    async start() {
      await loadCookie()
      if (!linked) log().info('YouTube Music (unofficial): no cookie yet — paste or import from browser on server host')
      else {
        log().info('YouTube Music (unofficial): cookie present')
        const raw = await cookies!.read()
        if (raw) void probeCookie(raw)
      }
      void refreshPo().then((ok) => {
        if (!ok) log().warn({ url: config!.YTM_PO_TOKEN_URL }, 'PO Token generator unreachable')
      })
    },

    async execute(_externalId: string, command: Command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `ytmusic publishes no devices (${command.type})`)
    },

    async stop() {
      proxy?.clear()
      catalog?.reset()
      cookies = null
      catalog = null
      proxy = null
      ctx = null
      config = null
      linked = false
      cookieExpired = false
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status({ probe: true }))

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
        await cookies!.write(raw)
        if (cookies!.path) await writeNetscapeBeside(cookies!.path, raw)
        catalog!.reset()
        linked = true
        cookieExpired = false
        lastError = null
        log().info('YouTube Music cookie saved (unofficial)')
        return status({ probe: true })
      })

      app.post<{ Body: unknown }>('/cookie/from-browser', async (req, reply) => {
        const body = z.object({
          browser: z.enum(YTM_BROWSERS).default('chrome'),
        }).safeParse(req.body ?? {})
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', `browser must be one of ${YTM_BROWSERS.join(', ')}`)
        if (!cookies!.path) {
          return sendError(reply, 400, 'INVALID_BODY', 'YTM_COOKIE_FILE is empty — cannot persist browser cookies')
        }
        try {
          const netscapePath = `${cookies!.path}.netscape`
          const raw = await importCookiesFromBrowser({
            ytdlpPath: config!.YTM_YTDLP_PATH,
            browser: body.data.browser,
            netscapePath,
            ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
          })
          await cookies!.write(raw)
          catalog!.reset()
          linked = true
          cookieExpired = false
          lastError = null
          log().info({ browser: body.data.browser }, 'YouTube Music cookie imported from browser (unofficial)')
          return status({ probe: true })
        } catch (err) {
          noteAuthFailure(err)
          if (err instanceof PluginError) {
            const d = describeError(err)
            return sendError(reply, d.status, d.code, d.message)
          }
          throw err
        }
      })

      app.delete('/cookie', async () => {
        await cookies!.clear()
        catalog!.reset()
        proxy!.clear()
        linked = false
        cookieExpired = false
        lastError = null
        log().info('YouTube Music cookie cleared')
        return status({ probe: false })
      })
      app.get<{ Querystring: { q?: string } }>('/search', async (req, reply) => {
        const q = (req.query.q ?? '').trim()
        if (!q) return sendError(reply, 400, 'INVALID_BODY', 'q is required')
        try {
          const cookie = await requireCookie()
          const result = await catalog!.search(cookie, q)
          lastError = null
          cookieExpired = false
          return result
        } catch (err) {
          return catalogError(reply, err)
        }
      })

      app.get('/library/liked', async (_req, reply) => {
        try {
          const cookie = await requireCookie()
          const tracks = await catalog!.liked(cookie)
          lastError = null
          cookieExpired = false
          return { tracks }
        } catch (err) {
          return catalogError(reply, err)
        }
      })

      app.get('/library/playlists', async (_req, reply) => {
        try {
          const cookie = await requireCookie()
          const playlists = await catalog!.playlists(cookie)
          lastError = null
          return { playlists }
        } catch (err) {
          return catalogError(reply, err)
        }
      })

      app.get<{ Params: { id: string } }>('/playlists/:id', async (req, reply) => {
        try {
          const cookie = await requireCookie()
          const tracks = await catalog!.playlistTracks(cookie, req.params.id)
          lastError = null
          return { tracks }
        } catch (err) {
          return catalogError(reply, err)
        }
      })

      app.get<{ Params: { id: string } }>('/albums/:id', async (req, reply) => {
        try {
          const cookie = await requireCookie()
          const tracks = await catalog!.albumTracks(cookie, req.params.id)
          lastError = null
          return { tracks }
        } catch (err) {
          return catalogError(reply, err)
        }
      })

      app.get<{ Params: { id: string } }>('/artists/:id', async (req, reply) => {
        try {
          const cookie = await requireCookie()
          const tracks = await catalog!.artistTracks(cookie, req.params.id)
          lastError = null
          return { tracks }
        } catch (err) {
          return catalogError(reply, err)
        }
      })

      app.post<{ Body: unknown }>('/play', async (req, reply) => {
        const body = z.object({
          videoId: z.string().trim().min(1),
          deviceId: z.string().trim().min(1),
          title: z.string().trim().min(1).max(512).optional(),
          artist: z.string().trim().min(1).max(512).optional(),
          artUrl: z.string().trim().min(1).max(2048).transform((u) => (u.startsWith('//') ? `https:${u}` : u))
            .pipe(z.string().url().refine((u) => /^https?:\/\//i.test(u), 'http or https only'))
            .optional(),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'videoId and deviceId are required')

        const { get, play } = resolvePlay()
        const entry = get(body.data.deviceId)
        if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${body.data.deviceId}"`)
        if (entry.descriptor.kind !== 'media_player' || !entry.descriptor.capabilities.includes('play_url')) {
          return sendError(reply, 400, 'UNSUPPORTED_COMMAND', 'device does not support play_url')
        }

        const cookie = await requireCookie()
        if (!(await refreshPo())) {
          lastError = 'PO Token generator unreachable'
          return sendError(reply, 503, 'DEVICE_UNAVAILABLE', lastError)
        }

        try {
          let netscapePath: string | undefined
          if (cookies!.path) netscapePath = await writeNetscapeBeside(cookies!.path, cookie)
          const resolved = await resolveStreamUrl({
            videoId: body.data.videoId,
            cookieRaw: cookie,
            ytdlpPath: config!.YTM_YTDLP_PATH,
            poTokenUrl: config!.YTM_PO_TOKEN_URL,
            ...(netscapePath ? { netscapePath } : {}),
            ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
          })
          const session = proxy!.open(body.data.videoId, body.data.deviceId, resolved.url)
          const streamUrl = `${publishBase(req)}/api/plugins/ytmusic/stream/${session.sid}`
          const meta = {
            ...(body.data.title ? { title: body.data.title } : {}),
            ...(body.data.artist ? { artist: body.data.artist } : {}),
            ...(body.data.artUrl ? { artUrl: body.data.artUrl } : {}),
          }
          await play(body.data.deviceId, streamUrl, Object.keys(meta).length ? meta : undefined)
          lastError = null
          log().info({
            videoId: body.data.videoId,
            deviceId: body.data.deviceId,
            title: body.data.title ?? null,
          }, 'ytmusic play_url dispatched')
          return { ok: true as const, streamUrl, sid: session.sid }
        } catch (err) {
          noteAuthFailure(err)
          if (err instanceof PluginError) throw err
          throw new PluginError('UPSTREAM_ERROR', lastError ?? (err as Error).message, { cause: err })
        }
      })

      app.get<{ Params: { sid: string } }>('/stream/:sid', async (req, reply) => {
        const session = proxy!.get(req.params.sid)
        if (!session) return sendError(reply, 404, 'NOT_FOUND', 'stream session expired or unknown')

        const proc = proxy!.spawnFfmpeg(session.sourceUrl)
        reply.hijack()
        const res = reply.raw
        res.writeHead(200, {
          'content-type': session.mime,
          'cache-control': 'no-store',
          connection: 'close',
        })
        proc.stdout.pipe(res)
        proc.on('error', () => { if (!res.writableEnded) res.end() })
        proc.on('close', () => { if (!res.writableEnded) res.end() })
        res.on('close', () => { try { proc.kill('SIGKILL') } catch { /* gone */ } })
      })
    },

    health(): PluginHealth {
      return healthFrom(linked, cookieExpired, poTokenOk, lastError, keys())
    },
  }
}
