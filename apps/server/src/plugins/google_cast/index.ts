import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createBackoff, type Backoff } from '../../core/backoff'
import { sleep } from '../../core/clock'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { CastConnection, tlsSocketFactory, type SocketFactory } from './channel'
import { createMdnsDiscovery, type CastDiscovery } from './discovery'
import { sendError } from '../../http/errors'
import { toDescriptor, toMediaPatch, toReceiverPatch } from './mapping'
import type { CastService, MediaStatus, ReceiverApplication, ReceiverStatus } from './types'

// Plugin Google Cast : enceintes et réveils Google / Nest, Chromecast, TV et barres de son
// « Chromecast built-in ». Tout est LOCAL : découverte mDNS, une connexion TLS persistante par
// appareil, aucun compte ni secret. Le récepteur pousse ses changements (volume, appli, lecture) ;
// il n'y a pas de sondage, hors la relecture de la position pendant une lecture.
//
// Ce que le protocole ne sait pas : lancer un titre d'un service à abonnement (YouTube Music,
// Spotify) — il n'a pas de notion de compte. Il sait piloter ce qui joue déjà, et lire une URL
// (récepteur média par défaut) : ce sera l'étape suivante.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const googleCastConfigSchema = z.object({
  /** IPv4 de l'interface réseau qui porte le multicast mDNS (machine à plusieurs cartes : VPN, VM). */
  CAST_MDNS_INTERFACE: optionalKey,
  /** Temps laissé aux appareils pour répondre à la première question mDNS avant de rendre la liste. */
  CAST_DISCOVERY_WAIT_MS: z.coerce.number().int().min(500).max(15_000).default(3000),
  /** Cadence des questions mDNS suivantes (appareils rallumés, annonces perdues). */
  CAST_MDNS_REFRESH_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
})
export type GoogleCastConfig = z.infer<typeof googleCastConfigSchema>

/** Un récepteur qui ne répond plus est retenté à 5 s, 10 s… jusqu'à deux minutes. */
const RECONNECT_INITIAL_MS = 5000
const RECONNECT_MAX_MS = 120_000

/** Pochettes : combien d'URL récemment vues on accepte de servir, durée de cache d'une image, d'un échec. */
const ART_KNOWN_MAX = 64
const ART_CACHE_MAX = 32
const ART_TTL_MS = 6 * 3_600_000
const ART_FAIL_TTL_MS = 60_000
const ART_FETCH_TIMEOUT_MS = 8000
/** Google répond parfois 429 : on réessaie avec un délai croissant avant d'abandonner. */
const ART_ATTEMPTS = 3
const ART_RETRY_MS = 800

/** Le strict nécessaire de `fetch` pour télécharger une image (le `fetch` global convient). */
export type ArtFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}>

interface ArtEntry { status: number; type: string; body: Buffer; at: number }

interface Entry {
  service: CastService
  connection: CastConnection | null
  /** `fixed` retire les capacités volume / muet du descripteur. */
  controlType: string | undefined
  backoff: Backoff
  reconnectTimer: unknown
}

export interface GoogleCastPluginDeps {
  /** Injection pour les tests : téléchargement des pochettes. */
  fetchImpl?: ArtFetch
  /** Injection pour les tests : fausse découverte. */
  discovery?: CastDiscovery
  /** Injection pour les tests : fausse socket. */
  connect?: SocketFactory
  requestTimeoutMs?: number
  heartbeatMs?: number
}

export function createGoogleCastPlugin(deps: GoogleCastPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: GoogleCastConfig | null = null
  let discovery: CastDiscovery | null = null
  let refreshTimer: unknown = null
  let stopping = false
  /** URL de pochettes vues dans les états média (les seules que la route /art accepte de servir), les plus récentes en dernier. */
  const knownArt: string[] = []
  const artCache = new Map<string, ArtEntry>()
  const fetchArt: ArtFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init))
  /** Faux jusqu'à « start » : un état émis pendant « discover » arriverait AVANT l'enregistrement des appareils et serait perdu. */
  let started = false
  const entries = new Map<string, Entry>()

  const log = () => ctx!.logger
  const descriptors = (): DeviceDescriptor[] =>
    [...entries.values()].map((e) => toDescriptor(e.service, { controlType: e.controlType }))

  /** Un appareil annoncé en mDNS : retenu, connecté ; s'il arrive après `discover`, la liste est republiée. */
  function onService(service: CastService, late: boolean): void {
    if (entries.has(service.txt.id)) return
    const entry: Entry = {
      service, connection: null, controlType: undefined,
      backoff: createBackoff({ initialMs: RECONNECT_INITIAL_MS, maxMs: RECONNECT_MAX_MS }), reconnectTimer: null,
    }
    entries.set(service.txt.id, entry)
    log().info({ name: service.txt.fn, model: service.txt.md, host: service.host }, 'cast device found')
    if (late) {
      ctx!.emitDevices(descriptors())
      void connect(entry)
    }
  }

  /** Ouvre la connexion d'un appareil ; en cas d'échec, programme une nouvelle tentative. */
  async function connect(entry: Entry): Promise<void> {
    if (stopping || entry.connection) return
    const id = entry.service.txt.id
    const connection = new CastConnection({
      host: entry.service.host, port: entry.service.port,
      connect: deps.connect ?? tlsSocketFactory, clock: ctx!.clock, logger: log(),
      onReceiverStatus: (status) => onReceiverStatus(entry, status),
      onMediaStatus: (media, app) => onMediaStatus(entry, media, app),
      onClose: (reason) => onClose(entry, reason),
      ...(deps.requestTimeoutMs ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
      ...(deps.heartbeatMs ? { heartbeatMs: deps.heartbeatMs } : {}),
    })
    entry.connection = connection
    try {
      await connection.open()
      entry.backoff.reset()
      log().info({ externalId: id, name: entry.service.txt.fn }, 'cast device connected')
    } catch (err) {
      // `open` échoué : `onClose` n'est pas forcément passé (connexion jamais établie)
      entry.connection = null
      connection.close('open failed')
      log().warn({ externalId: id, host: entry.service.host, err }, 'cast connection failed')
      scheduleReconnect(entry)
    }
  }

  function onReceiverStatus(entry: Entry, status: ReceiverStatus): void {
    const controlType = status.volume?.controlType
    if (controlType !== undefined && controlType !== entry.controlType) {
      const wasFixed = entry.controlType === 'fixed', isFixed = controlType === 'fixed'
      entry.controlType = controlType
      if (wasFixed !== isFixed && started) ctx!.emitDevices(descriptors())      // les capacités ont changé
    }
    if (started) ctx!.emitState(entry.service.txt.id, toReceiverPatch(status))
  }

  function onMediaStatus(entry: Entry, media: MediaStatus | undefined, app: ReceiverApplication | undefined): void {
    const art = media?.media?.metadata?.images?.[0]?.url
    if (art && !knownArt.includes(art)) {
      knownArt.push(art)
      if (knownArt.length > ART_KNOWN_MAX) knownArt.shift()
    }
    if (started) ctx!.emitState(entry.service.txt.id, toMediaPatch(media, app))
  }

  /** Télécharge une pochette, avec quelques tentatives espacées quand le serveur d'images se plaint (429, 5xx). */
  async function downloadArt(url: string): Promise<ArtEntry> {
    let status = 0
    for (let attempt = 0; attempt < ART_ATTEMPTS && !stopping; attempt++) {
      if (attempt > 0) await sleep(ctx!.clock, ART_RETRY_MS * attempt, ctx!.signal)
      try {
        const res = await fetchArt(url, { signal: AbortSignal.any([ctx!.signal, AbortSignal.timeout(ART_FETCH_TIMEOUT_MS)]) })
        status = res.status
        if (res.ok) {
          const type = res.headers.get('content-type') ?? 'image/jpeg'
          if (!type.startsWith('image/')) { status = 415; break }
          return { status: 200, type, body: Buffer.from(await res.arrayBuffer()), at: ctx!.clock.now() }
        }
        if (status !== 429 && status < 500) break
      } catch (err) {
        log().debug({ url, err }, 'artwork download failed')
        status = 0
      }
    }
    return { status, type: '', body: Buffer.alloc(0), at: ctx!.clock.now() }
  }

  async function artFor(url: string): Promise<ArtEntry> {
    const hit = artCache.get(url)
    const now = ctx!.clock.now()
    if (hit && now - hit.at < (hit.status === 200 ? ART_TTL_MS : ART_FAIL_TTL_MS)) return hit
    const fresh = await downloadArt(url)
    artCache.delete(url)
    artCache.set(url, fresh)
    while (artCache.size > ART_CACHE_MAX) artCache.delete(artCache.keys().next().value!)
    return fresh
  }

  /** État courant d'un appareil connecté, publié d'un bloc (au « start », après le silence de « discover »). */
  function emitCurrent(entry: Entry): void {
    const c = entry.connection
    if (!c?.isOpen || !c.lastReceiverStatus) { ctx!.setAvailable(entry.service.txt.id, false); return }
    ctx!.emitState(entry.service.txt.id, { ...toReceiverPatch(c.lastReceiverStatus), ...toMediaPatch(c.media, c.app) })
  }

  function onClose(entry: Entry, reason: string): void {
    const id = entry.service.txt.id
    if (!entry.connection) return                                   // échec d'ouverture déjà traité
    entry.connection = null
    ctx!.setAvailable(id, false)
    if (stopping) return
    log().warn({ externalId: id, name: entry.service.txt.fn, reason }, 'cast device disconnected')
    scheduleReconnect(entry)
  }

  function scheduleReconnect(entry: Entry): void {
    if (stopping || entry.reconnectTimer) return
    const delay = entry.backoff.next()
    entry.reconnectTimer = ctx!.clock.setTimeout(() => { entry.reconnectTimer = null; void connect(entry) }, delay)
  }

  /** Commande vers un appareil connecté ; résout quand le récepteur a répondu (son état suit par ses messages). */
  async function run(externalId: string, command: Command): Promise<void> {
    const entry = entries.get(externalId)
    if (!entry) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Cast device ${externalId}`)
    const c = entry.connection
    if (!c || !c.isOpen) throw new PluginError('DEVICE_UNAVAILABLE', `${entry.service.txt.fn} is not connected`)
    switch (command.type) {
      case 'media_player.play': return c.mediaCommand('PLAY')
      case 'media_player.pause': return c.mediaCommand('PAUSE')
      case 'media_player.next': return c.queueJump(1)
      case 'media_player.previous': return c.previous()                 // début du morceau passé 3 s, sinon le précédent
      case 'media_player.seek': return c.seek(command.positionS)
      case 'media_player.set_volume':
        if (entry.controlType === 'fixed') throw new PluginError('UNSUPPORTED_COMMAND', 'volume is fixed on this device (set it on the TV)')
        return c.setVolume({ level: Math.min(100, Math.max(0, command.volume)) / 100 })
      case 'media_player.set_mute':
        if (entry.controlType === 'fixed') throw new PluginError('UNSUPPORTED_COMMAND', 'volume is fixed on this device (set it on the TV)')
        return c.setVolume({ muted: command.muted })
      default:
        throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on a Cast device`)
    }
  }

  return {
    id: 'google_cast',
    configSchema: googleCastConfigSchema,

    async init(context) {
      ctx = context
      config = context.config as GoogleCastConfig
      discovery = deps.discovery ?? createMdnsDiscovery({ ...(config.CAST_MDNS_INTERFACE ? { iface: config.CAST_MDNS_INTERFACE } : {}), logger: context.logger })
    },

    /**
     * Écoute le mDNS le temps configuré, puis connecte chaque appareil trouvé pour connaître son
     * type de volume avant de rendre les descripteurs. Un appareil injoignable est listé quand même
     * (indisponible) : il est sur le réseau, il reviendra.
     */
    async discover() {
      let discovered = false
      discovery!.start((service) => onService(service, discovered))
      await sleep(ctx!.clock, config!.CAST_DISCOVERY_WAIT_MS, ctx!.signal)
      await Promise.all([...entries.values()].map((e) => connect(e)))
      discovered = true
      return descriptors()
    },

    async start() {
      // les appareils sont enregistrés : publier l'état de chacun (connecté, ou indisponible), puis
      // laisser les connexions pousser la suite et relancer la question mDNS à cadence lente
      started = true
      for (const e of entries.values()) emitCurrent(e)
      refreshTimer = ctx!.clock.setInterval(() => discovery?.refresh(), config!.CAST_MDNS_REFRESH_MS)
    },

    execute: run,

    async stop() {
      stopping = true
      ctx!.clock.clearInterval(refreshTimer)
      refreshTimer = null
      discovery?.stop()
      for (const e of entries.values()) {
        ctx!.clock.clearTimeout(e.reconnectTimer)
        e.reconnectTimer = null
        e.connection?.close('plugin stopped')
        e.connection = null
      }
    },

    registerRoutes(app: FastifyInstance) {
      // Pochette d'un morceau, téléchargée par le serveur et mise en cache (voir `artProxyUrl`). Seules
      // les URL vues dans un état média sont servies : ce n'est pas un relais ouvert.
      app.get<{ Querystring: { url?: string } }>('/art', async (req, reply) => {
        const url = req.query.url
        if (!url || !knownArt.includes(url)) return sendError(reply, 404, 'NOT_FOUND', 'unknown artwork')
        const art = await artFor(url)
        if (art.status !== 200) return sendError(reply, 502, 'UPSTREAM_ERROR', `artwork fetch failed (${art.status || 'network'})`)
        return reply.header('content-type', art.type).header('cache-control', 'public, max-age=86400').send(art.body)
      })

      // Dernier état brut reçu de chaque appareil : sert à relever des fixtures réelles (voir __fixtures__).
      app.get('/raw', async () => ({
        devices: [...entries.values()].map((e) => ({
          service: e.service, connected: e.connection?.isOpen ?? false,
          receiver: e.connection?.lastReceiverStatus, media: e.connection?.lastMediaRaw,
        })),
      }))
    },

    health(): PluginHealth {
      if (entries.size === 0) return { status: 'degraded', detail: 'no Cast device found yet (mDNS _googlecast._tcp — set CAST_MDNS_INTERFACE on a multi-homed machine)' }
      const connected = [...entries.values()].filter((e) => e.connection?.isOpen).length
      const playing = [...entries.values()].filter((e) => e.connection?.media?.playerState === 'PLAYING').length
      return {
        status: connected === 0 ? 'degraded' : 'ok',
        detail: `${entries.size} device(s), ${connected} connected${playing ? `, ${playing} playing` : ''}`,
      }
    },
  }
}
