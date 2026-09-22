import { Readable } from 'node:stream'
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
import { LengthLock, OUT_BITRATE_KBPS, OUT_CHANNELS, OUT_SAMPLE_RATE_HZ, parseRange, pingPoToken, resolveStreamUrl, seekFor, StreamProxy, type ProxySession, type SessionMeta, type SpawnFn } from './stream'
import type { YtmusicStatus } from './types'
import { ART_PLAY_SIZE, upgradeArtUrl } from './mapping'

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
  /** Commande à un lecteur d'un autre plugin (tests) ; sinon le pont `app.ts`. */
  execute?: (deviceId: string, command: Command) => Promise<void>
  getDevice?: (deviceId: string) => { descriptor: { kind: string; capabilities: string[] }; state?: unknown } | undefined
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

  // HMR tsx : le module peut être rechargé et ses routes réenregistrées SANS repasser par init() —
  // tout ce que init() construit se reconstruit alors à la demande, et les réglages ont un défaut.
  const log = () => ctx?.logger ?? (console as unknown as PluginContext['logger'])
  const now = () => ctx?.clock.now() ?? Date.now()
  const cfg = () => config ?? ytmusicConfigSchema.parse({})
  function getProxy(): StreamProxy {
    proxy ??= new StreamProxy({
      ffmpegPath: cfg().FFMPEG_PATH,
      ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
      now,
    })
    return proxy
  }
  const keys = () => Object.keys(ytmusicConfigSchema.shape)
  const PROBE_MS = 5 * 60_000

  async function loadCookie(): Promise<string | null> {
    // HMR tsx : routes parfois rechargées sans repasser par init().
    if (!cookies) {
      cookies = deps.cookieStore ?? createCookieFile(
        config?.YTM_COOKIE_FILE ?? stateFile('ytmusic-cookie.txt'),
      )
    }
    if (!catalog) catalog = deps.catalog ?? new YtmusicCatalog(deps.createSession)
    const raw = (await cookies.read())?.trim() ?? null
    linked = !!(raw && hasRequiredCookie(raw))
    if (!linked) cookieExpired = false
    return linked ? raw : null
  }

  async function refreshPo(): Promise<boolean> {
    const url = config?.YTM_PO_TOKEN_URL ?? 'http://127.0.0.1:4416'
    poTokenOk = await pingPoToken(url, deps.fetchImpl ?? fetch)
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
      lastProbeAt = ctx?.clock.now() ?? Date.now()
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
      poTokenUrl: config?.YTM_PO_TOKEN_URL ?? 'http://127.0.0.1:4416',
      lastError,
      browsers: [...YTM_BROWSERS],
    }
  }

  function publishBase(req: FastifyRequest): string {
    if (cfg().YTM_PUBLISH_BASE) return cfg().YTM_PUBLISH_BASE.replace(/\/$/, '')
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
    const execute = deps.execute ?? ((id: string, command: Command) => {
      const b = getYtmusicBridge()
      if (!b) return Promise.reject(new PluginError('DEVICE_UNAVAILABLE', 'playback bridge not ready'))
      return b.execute(id, command)
    })
    const play = (id: string, url: string, meta: SessionMeta) => execute(id, {
      type: 'media_player.play_url',
      url,
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.artist ? { artist: meta.artist } : {}),
      ...(meta.artUrl ? { artUrl: meta.artUrl } : {}),
      ...(meta.explicit ? { explicit: true } : {}),
    })
    return { get, play, execute }
  }

  /** Le lecteur peut recevoir `play_url` ; sinon l'erreur HTTP à rendre. */
  function playableOrError(reply: FastifyReply, get: (id: string) => { descriptor: { kind: string; capabilities: string[] } } | undefined, deviceId: string) {
    const entry = get(deviceId)
    if (!entry) return { error: sendError(reply, 404, 'NOT_FOUND', `unknown device "${deviceId}"`) }
    if (entry.descriptor.kind !== 'media_player' || !entry.descriptor.capabilities.includes('play_url')) {
      return { error: sendError(reply, 400, 'UNSUPPORTED_COMMAND', 'device does not support play_url') }
    }
    return { entry }
  }

  /**
   * Position ACTUELLE de la source dans le morceau. Le relevé publié date du dernier sondage (Sonos :
   * jusqu'à 2 s) : tant que ça joue, on y ajoute le temps écoulé depuis `updatedAt` — jamais plus que
   * le vrai retard, puisqu'un autre changement d'état l'aurait rafraîchi entre-temps.
   */
  function trackPosition(get: (id: string) => { state?: unknown } | undefined, session: ProxySession): number {
    const st = get(session.deviceId)?.state as { kind?: string; playback?: string; updatedAt?: number; nowPlaying?: { positionS?: number } } | undefined
    if (st?.kind !== 'media_player') return 0
    const pos = st.nowPlaying?.positionS ?? 0
    const sinceS = st.playback === 'playing' && typeof st.updatedAt === 'number' ? Math.max(0, (now() - st.updatedAt) / 1000) : 0
    return Math.max(0, pos + sinceS)
  }

  /** Ouvre une session pour ce lecteur (la précédente du même lecteur est fermée) et lui envoie `play_url`. */
  async function launch(
    req: FastifyRequest,
    videoId: string,
    deviceId: string,
    sourceUrl: string,
    meta: SessionMeta,
    raw?: { mime: string; sizeBytes: number; ext: string },
  ) {
    const { play } = resolvePlay()
    const session = getProxy().open(videoId, deviceId, sourceUrl, meta, raw)
    // L'extension n'est pas décorative : `streamLoad` (Sonos) en déduit le type annoncé dans le DIDL.
    const streamUrl = raw
      ? `${publishBase(req)}/api/plugins/ytmusic/raw/${session.sid}.${raw.ext}`
      : `${publishBase(req)}/api/plugins/ytmusic/stream/${session.sid}`
    await play(deviceId, streamUrl, meta)
    return { session, streamUrl }
  }

  /** La cible d'un transfert met environ une seconde à démarrer : on la place d'autant plus loin. */
  const TRANSFER_LEAD_S = 1

  /**
   * Se placer dans le morceau juste après `play_url` : l'enceinte n'a pas forcément fini de charger,
   * la première commande peut être refusée — on réessaie un peu. Le « fichier » ayant une taille, le
   * déplacement est le sien (plage d'octets), précis à la trame.
   */
  async function seekWhenReady(deviceId: string, positionS: number): Promise<void> {
    const { execute } = resolvePlay()
    let lastErr: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600))
      try {
        await execute(deviceId, { type: 'media_player.seek', positionS: Math.max(0, positionS) })
        return
      } catch (err) { lastErr = err }
    }
    throw lastErr
  }

  /**
   * Une session n'est « vivante » que si l'enceinte joue (ou a mis en pause) NOTRE titre : elle survit
   * sinon à ce que l'enceinte joue ensuite (une radio lancée depuis Google Home), et l'UI aurait
   * montré notre titre, notre durée, et transféré le mauvais morceau. L'enceinte le dit par son titre :
   * le nôtre, ou rien de lisible (identifiant de flux, URL : elle ne sait pas mieux). Les cinq
   * premières secondes sont accordées d'office, le temps que l'état de l'enceinte suive la commande.
   */
  function sessionActive(s: ProxySession): boolean {
    if (now() - s.createdAt < 5_000) return true
    const { get } = resolvePlay()
    const st = get(s.deviceId)?.state as { kind?: string; playback?: string; nowPlaying?: { title?: string } } | undefined
    if (st?.kind !== 'media_player') return false
    if (st.playback !== 'playing' && st.playback !== 'paused') return false
    const t = st.nowPlaying?.title?.trim() ?? ''
    if (!t || /^[0-9a-f]{24}$/i.test(t) || /^https?:\/\//i.test(t)) return true
    return !!s.meta.title && t.toLowerCase() === s.meta.title.trim().toLowerCase()
  }

  /** Type de contenu d'un flux source relayé tel quel (le conteneur décide, pas le codec). */
  const RAW_MIME: Record<string, string> = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg' }

  const sessionView = (s: ProxySession) => ({
    deviceId: s.deviceId, videoId: s.videoId, sid: s.sid,
    durationS: s.meta.durationS ?? null, title: s.meta.title ?? null, artist: s.meta.artist ?? null, artUrl: s.meta.artUrl ?? null,
    // Ce que l'enceinte reçoit de NOUS, et ce que nous recevons de YouTube : de quoi juger à l'œil
    // ce que vaut la chaîne, sans ouvrir le journal.
    quality: {
      mime: s.mime,
      // relais : ce que sert le proxy EST ce que YouTube a donné, il n'y a plus de sortie à nous
      bitrateKbps: s.raw ? s.meta.source?.abrKbps ?? null : OUT_BITRATE_KBPS,
      sampleRateHz: s.raw ? null : OUT_SAMPLE_RATE_HZ,
      channels: s.raw ? null : OUT_CHANNELS,
      lengthBytes: s.lengthBytes,
      source: s.meta.source ?? null,
    },
  })

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
        if (!ok) log().warn({ url: cfg().YTM_PO_TOKEN_URL }, 'PO Token generator unreachable')
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
            ytdlpPath: cfg().YTM_YTDLP_PATH,
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
        proxy?.clear()
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
          /** Durée catalogue, si yt-dlp n'en donne pas : elle fixe la taille du « fichier ». */
          durationS: z.number().positive().optional(),
          /** Ce que le catalogue dit du morceau : l'enceinte, elle, ne le saura jamais. */
          explicit: z.boolean().optional(),
          /**
           * Par défaut le flux source est RELAYÉ tel quel ; `false` force le réencodage MP3 (échappatoire
           * si un lecteur bute sur le conteneur d'origine).
           */
          raw: z.boolean().optional(),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'videoId and deviceId are required')

        const { get, execute } = resolvePlay()
        const target = playableOrError(reply, get, body.data.deviceId)
        if ('error' in target) return target.error

        const cookie = await requireCookie()
        if (!(await refreshPo())) {
          lastError = 'PO Token generator unreachable'
          return sendError(reply, 503, 'DEVICE_UNAVAILABLE', lastError)
        }

        // Un de nos flux joue déjà là : le mettre en pause TOUT DE SUITE, avant les secondes de
        // résolution yt-dlp — la tablette montre un sablier, l'enceinte se tait, le nouveau titre
        // remplace l'ancien. Pas `stop` : sur un Cast il fermerait l'appli, qu'il faudrait relancer.
        if (getProxy().forDevice(body.data.deviceId)) {
          void execute(body.data.deviceId, { type: 'media_player.pause' }).catch((err) => log().debug({ err }, 'ytmusic: pause before replace failed'))
        }

        try {
          let netscapePath: string | undefined
          if (cookies!.path) netscapePath = await writeNetscapeBeside(cookies!.path, cookie)
          const resolved = await resolveStreamUrl({
            videoId: body.data.videoId,
            // Viser un conteneur que les enceintes lisent (AAC en MP4) plutôt que le plus gros débit :
            // c'est lui qu'on relaiera tel quel, et un Sonos ne lit pas le WebM/Opus que YouTube
            // propose parfois plus haut. Sans m4a, on tombera dans le repli ffmpeg, qui lit tout.
            preferExts: ['m4a', 'mp4'],
            cookieRaw: cookie,
            ytdlpPath: cfg().YTM_YTDLP_PATH,
            poTokenUrl: cfg().YTM_PO_TOKEN_URL,
            ...(netscapePath ? { netscapePath } : {}),
            ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
          })
          const durationS = resolved.durationS ?? body.data.durationS
          const meta: SessionMeta = {
            ...(body.data.title ? { title: body.data.title } : {}),
            ...(body.data.artist ? { artist: body.data.artist } : {}),
            ...(body.data.artUrl
              ? { artUrl: upgradeArtUrl(body.data.artUrl, ART_PLAY_SIZE) ?? body.data.artUrl }
              : {}),
            ...(durationS ? { durationS } : {}),
            ...(body.data.explicit ? { explicit: true } : {}),
            source: { ext: resolved.ext, formatId: resolved.formatId, abrKbps: resolved.abrKbps },
          }
          // RELAIS PAR DÉFAUT : la source est déjà un fichier de taille exacte, découpable en plages —
          // le réencoder ne fait que perdre de la qualité. Deux conditions : un conteneur que les
          // enceintes lisent, et une taille annoncée (c'est elle qui en fait un « fichier »). Sinon,
          // repli sur le MP3 à trames fixes, qui fabrique cette taille à partir de la durée.
          const rawExt = resolved.ext?.toLowerCase() ?? ''
          const rawMime = RAW_MIME[rawExt]
          const raw = body.data.raw !== false && rawMime && resolved.sizeBytes
            ? { mime: rawMime, sizeBytes: resolved.sizeBytes, ext: rawExt }
            : undefined
          if (!raw && body.data.raw !== false) {
            log().info({ ext: resolved.ext, sizeBytes: resolved.sizeBytes }, 'ytmusic: source not relayable, falling back to MP3 transcoding')
          }
          const { session, streamUrl } = await launch(req, body.data.videoId, body.data.deviceId, resolved.url, meta, raw)
          lastError = null
          log().info({
            videoId: body.data.videoId,
            deviceId: body.data.deviceId,
            title: body.data.title ?? null,
            durationS: durationS ?? null,
            mode: raw ? `relay ${raw.ext}` : 'mp3',
            sourceKbps: resolved.abrKbps,
          }, 'ytmusic play_url dispatched')
          return { ok: true as const, streamUrl, sid: session.sid }
        } catch (err) {
          noteAuthFailure(err)
          if (err instanceof PluginError) throw err
          throw new PluginError('UPSTREAM_ERROR', lastError ?? (err as Error).message, { cause: err })
        }
      })

      /** Ce que nos lecteurs jouent de nous en ce moment : titre, durée et transfert côté UI. */
      app.get('/sessions', async () => ({ sessions: getProxy().list().filter(sessionActive).map(sessionView) }))

      // Transfert : le titre que joue `from` repart sur `to` (même « fichier »), la cible se place à la
      // position où `from` en était (relevée dans l'état publié du lecteur), puis `from` s'arrête. Pas de
      // nouvelle résolution yt-dlp : l'URL googlevideo de la session source est encore bonne.
      app.post<{ Body: unknown }>('/transfer', async (req, reply) => {
        const body = z.object({
          fromDeviceId: z.string().trim().min(1),
          toDeviceId: z.string().trim().min(1),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'fromDeviceId and toDeviceId are required')
        if (body.data.fromDeviceId === body.data.toDeviceId) return sendError(reply, 400, 'INVALID_BODY', 'source and target are the same device')

        const { get, execute } = resolvePlay()
        const source = getProxy().forDevice(body.data.fromDeviceId)
        if (!source || !sessionActive(source)) return sendError(reply, 404, 'NOT_FOUND', 'source device is not playing a YouTube Music stream')
        const target = playableOrError(reply, get, body.data.toDeviceId)
        if ('error' in target) return target.error
        const positionS = trackPosition(get, source)

        try {
          const srcExt = source.meta.source?.ext?.toLowerCase() ?? ''
          const raw = source.raw && source.lengthBytes !== null && RAW_MIME[srcExt]
            ? { mime: source.mime, sizeBytes: source.lengthBytes, ext: srcExt }
            : undefined
          const { session, streamUrl } = await launch(req, source.videoId, body.data.toDeviceId, source.sourceUrl, source.meta, raw)
          if (positionS > 1 && session.lengthBytes !== null) {
            await seekWhenReady(body.data.toDeviceId, positionS + TRANSFER_LEAD_S)
              .catch((err) => log().warn({ err, deviceId: body.data.toDeviceId, positionS }, 'ytmusic transfer: seek on target failed, playing from start'))
          }
          // la source ne s'arrête qu'une fois la cible lancée : un échec laisse la musique où elle était
          await execute(body.data.fromDeviceId, { type: 'media_player.stop' })
            .catch((err) => log().warn({ err, deviceId: body.data.fromDeviceId }, 'ytmusic transfer: source stop failed'))
          getProxy().closeDevice(body.data.fromDeviceId)
          log().info({ videoId: source.videoId, from: body.data.fromDeviceId, to: body.data.toDeviceId, positionS }, 'ytmusic playback transferred')
          return { ok: true as const, streamUrl, sid: session.sid, positionS }
        } catch (err) {
          if (err instanceof PluginError) throw err
          throw new PluginError('UPSTREAM_ERROR', (err as Error).message, { cause: err })
        }
      })

      /**
       * En-têtes du « fichier » : taille annoncée et plages acceptées quand la durée est connue ; sinon
       * un flux vivant sans taille (direct). `connection: close` : une connexion par service ffmpeg.
       */
      const fileHeaders = (session: ProxySession): Record<string, string> => ({
        'content-type': session.mime,
        'cache-control': 'no-store',
        connection: 'close',
        ...(session.lengthBytes !== null
          ? { 'accept-ranges': 'bytes', 'content-length': String(session.lengthBytes) }
          : { 'accept-ranges': 'none' }),
      })

      // Les lecteurs sondent le fichier par HEAD (taille, plages) : répondre sans lancer ffmpeg —
      // Fastify dérive sinon HEAD du GET et exécuterait tout le handler, flux compris.
      app.head<{ Params: { sid: string } }>('/stream/:sid', async (req, reply) => {
        const session = getProxy().get(req.params.sid)
        if (!session) return sendError(reply, 404, 'NOT_FOUND', 'stream session expired or unknown')
        log().debug({ sid: session.sid, deviceId: session.deviceId, ua: req.headers['user-agent'] ?? null }, 'ytmusic stream HEAD')
        reply.hijack()
        reply.raw.writeHead(200, fileHeaders(session))
        reply.raw.end()
      })

      /**
       * SONDE — relais SANS reencodage. googlevideo annonce une taille exacte et accepte les plages :
       * le « fichier » que le MP3 fabrique, la source le fournit deja, en AAC 258 kb/s. On se contente
       * de repasser les octets, en reportant la plage demandee par l'enceinte. L'extension de l'URL
       * (`.m4a`) est ce qui fait annoncer `audio/mp4` dans le DIDL Sonos.
       */
      const rawSession = (file: string) => {
        const sid = file.split('.')[0] ?? ''
        const s = getProxy().get(sid)
        return s?.raw ? s : undefined
      }

      app.head<{ Params: { file: string } }>('/raw/:file', async (req, reply) => {
        const session = rawSession(req.params.file)
        if (!session) return sendError(reply, 404, 'NOT_FOUND', 'raw session expired or unknown')
        log().debug({ sid: session.sid, deviceId: session.deviceId, ua: req.headers['user-agent'] ?? null }, 'ytmusic raw HEAD')
        reply.hijack()
        reply.raw.writeHead(200, {
          'content-type': session.mime,
          'cache-control': 'no-store',
          'accept-ranges': 'bytes',
          ...(session.lengthBytes !== null ? { 'content-length': String(session.lengthBytes) } : {}),
        })
        reply.raw.end()
      })

      app.get<{ Params: { file: string } }>('/raw/:file', async (req, reply) => {
        const session = rawSession(req.params.file)
        if (!session) return sendError(reply, 404, 'NOT_FOUND', 'raw session expired or unknown')
        const range = req.headers.range
        const abort = new AbortController()
        let upstream: Response
        try {
          upstream = await (deps.fetchImpl ?? fetch)(session.sourceUrl, {
            signal: abort.signal,
            ...(range ? { headers: { range } } : {}),
          })
        } catch (err) {
          log().warn({ err, sid: session.sid }, 'ytmusic raw GET: upstream failed')
          return sendError(reply, 502, 'UPSTREAM_ERROR', 'source stream unreachable')
        }
        if (!upstream.ok || !upstream.body) {
          log().warn({ sid: session.sid, status: upstream.status }, 'ytmusic raw GET: upstream refused')
          return sendError(reply, 502, 'UPSTREAM_ERROR', `source stream answered ${upstream.status}`)
        }
        const len = upstream.headers.get('content-length')
        const contentRange = upstream.headers.get('content-range')
        log().info({
          sid: session.sid, deviceId: session.deviceId, range: range ?? null, status: upstream.status,
          len, contentRange, ua: req.headers['user-agent'] ?? null,
        }, 'ytmusic raw GET')
        reply.hijack()
        reply.raw.writeHead(upstream.status === 206 ? 206 : 200, {
          'content-type': session.mime,
          'cache-control': 'no-store',
          'accept-ranges': 'bytes',
          ...(len ? { 'content-length': len } : {}),
          ...(contentRange ? { 'content-range': contentRange } : {}),
        })
        // Le lecteur coupe quand il veut (pause, changement de titre, fin de sonde) : on arrête alors
        // de tirer sur googlevideo. PIÈGE : l'annulation fait émettre une AbortError au flux ; sans
        // écouteur d'erreur, Node la remonte en exception non gérée et le SERVEUR tombe.
        const body = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
        const stop = () => { if (!reply.raw.writableEnded) reply.raw.end() }
        body.on('error', (err) => {
          log().debug({ err, sid: session.sid }, 'ytmusic raw GET: source stream cut')
          stop()
        })
        reply.raw.on('close', () => { abort.abort(); body.destroy() })
        body.pipe(reply.raw)
      })

      app.get<{ Params: { sid: string } }>('/stream/:sid', async (req, reply) => {
        const session = getProxy().get(req.params.sid)
        if (!session) return sendError(reply, 404, 'NOT_FOUND', 'stream session expired or unknown')

        // Plage d'octets → instant où lancer ffmpeg (à la trame), octets de la première trame à sauter,
        // et nombre d'octets promis. Sans durée connue : tout, depuis le début, sans taille.
        const range = session.lengthBytes !== null ? parseRange(req.headers.range, session.lengthBytes) : null
        const start = range?.start ?? 0
        const end = range?.end ?? (session.lengthBytes !== null ? session.lengthBytes - 1 : null)
        const { startS, skipBytes } = seekFor(start)
        const headers = fileHeaders(session)
        if (range && session.lengthBytes !== null) {
          headers['content-range'] = `bytes ${range.start}-${range.end}/${session.lengthBytes}`
          headers['content-length'] = String(range.end - range.start + 1)
        }
        log().info({
          sid: session.sid, deviceId: session.deviceId, range: req.headers.range ?? null, startS: Number(startS.toFixed(3)),
          ua: req.headers['user-agent'] ?? null,
        }, 'ytmusic stream GET')

        const proc = getProxy().spawnFfmpeg(session.sourceUrl, startS)
        reply.hijack()
        const res = reply.raw
        res.writeHead(range ? 206 : 200, headers)
        const finish = () => { if (!res.writableEnded) res.end() }
        if (end !== null) {
          const lock = new LengthLock(end - start + 1, skipBytes, await getProxy().silentFrame())
          proc.stdout.pipe(lock).pipe(res)
          lock.on('error', finish)
        } else {
          proc.stdout.pipe(res)
        }
        proc.on('error', finish)
        proc.on('close', () => { if (end === null) finish() })
        res.on('close', () => { try { proc.kill('SIGKILL') } catch { /* gone */ } })
      })
    },

    health(): PluginHealth {
      return healthFrom(linked, cookieExpired, poTokenOk, lastError, keys())
    },
  }
}
