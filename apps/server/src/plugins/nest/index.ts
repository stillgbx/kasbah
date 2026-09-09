import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import type { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { RtspRelay, type RelayMessage, type RelaySubscriber } from '../../core/video/rtsp-relay'
import { describeError, sendError } from '../../http/errors'
import { NestClient, rtspUrlWithToken } from './client'
import {
  deviceNameToExternalId, isCamera, isThermostat, parseSdmEvent, streamProtocols, thermostatAvailable, toClimatePatch, toDescriptor,
  toThermostatCommands, toThermostatDescriptor,
} from './mapping'
import type { SdmDevice } from './types'

// Plugin Google Nest (caméras, sonnettes, écrans à caméra, thermostats) via l'API cloud Smart
// Device Management. Il n'y a PAS d'API locale : rien à découvrir sur le LAN, tout passe par le
// compte Google.
//
// Mise en route, en deux temps comme Hue et TaHoma :
//  1. côté Google (une fois, par l'utilisateur, hors de Kasbah) : projet Device Access + client
//     OAuth → NEST_PROJECT_ID, NEST_CLIENT_ID, NEST_CLIENT_SECRET dans .env ;
//  2. côté Kasbah : sans NEST_REFRESH_TOKEN le plugin est en `needs_pairing` et propose la liaison
//     du compte (GET /auth/url → consentement Google → GET /auth/callback). Le jeton obtenu est
//     adopté EN MÉMOIRE et rendu à l'utilisateur pour qu'il le colle dans .env : le serveur n'écrit
//     jamais .env.
//
// Les caméras n'ont ni commande (l'API ne sait pas les éteindre) ni état au delà de leur présence ;
// leurs événements viendront plus tard (Pub/Sub). Le thermostat, lui, a un état et deux commandes ;
// comme l'API ne pousse rien sans Pub/Sub, la liste des appareils est relue à cadence lente
// (NEST_POLL_MS, une minute par défaut : Google borne les appels à quelques-uns par minute), ce qui
// suit aussi les ajouts et retraits d'appareils.
//
// Vidéo : tout le parc est en RTSP (caméras de 1re génération), qu'aucun navigateur ne lit. Google
// ouvre une session RTSP à la demande (`GenerateRtspStream`, cinq minutes, prolongeable), un relais
// ffmpeg par caméra regardée la recopie en MP4 fragmenté (`core/video/rtsp-relay.ts`), et la route
// WebSocket `/cameras/<id>/stream` la distribue aux tablettes. Plus personne ne regarde → la
// session Google est arrêtée : rien ne justifie de la laisser courir.

/**
 * Clé optionnelle dont la valeur VIDE vaut « absente » : `.env.example` liste les clés à remplir, et
 * une ligne `NEST_REFRESH_TOKEN=` laissée vide en attendant la liaison ne doit pas désactiver le
 * plugin (c'est ce qui arrivait avec `min(1)` : config invalide → `disabled`, sans rien dire d'utile).
 */
const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const nestConfigSchema = z.object({
  /** Id (UUID) du projet Device Access — pas le projet Google Cloud. */
  NEST_PROJECT_ID: optionalKey,
  NEST_CLIENT_ID: optionalKey,
  NEST_CLIENT_SECRET: optionalKey,
  NEST_REFRESH_TOKEN: optionalKey,
  /** Doit être déclarée telle quelle dans le client OAuth Google (« URI de redirection autorisés »). */
  NEST_REDIRECT_URI: z.string().url().default('http://localhost:8787/api/plugins/nest/auth/callback'),
  /** Cadence de relecture de la liste des appareils (état du thermostat, ajouts / retraits). */
  NEST_POLL_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
  /** Binaire ffmpeg du relais vidéo (dans le PATH, ou chemin complet). Clé commune, pas préfixée NEST_. */
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  /**
   * Sessions RTSP ouvertes en même temps, au plus (directs regardés + vignettes de la vue Caméras).
   * C'est CE qui coûte — une session Google, un ffmpeg, 1 à 2 Mbit/s par caméra — pas la cadence
   * des images. En dessous du nombre de caméras, les vignettes tournent en rotation.
   */
  NEST_LIVE_BUDGET: z.coerce.number().int().min(1).max(32).default(10),
  /** Cadence des vignettes de la vue Caméras (une image JPEG par caméra dont la session est ouverte). */
  NEST_SNAPSHOT_MS: z.coerce.number().int().min(2000).max(120_000).default(10_000),
  /** Abonnement Pub/Sub « pull » d'où tirer les événements (sonnette…). Absent → aucun événement. */
  NEST_PUBSUB_SUBSCRIPTION: optionalKey,
  /** Cadence de tirage de l'abonnement Pub/Sub. Une sonnerie arrive au plus tard au prochain tirage. */
  NEST_PUBSUB_POLL_MS: z.coerce.number().int().min(1000).max(60_000).default(5000),
})
export type NestConfig = z.infer<typeof nestConfigSchema>

/** Google fait expirer une session RTSP au bout de cinq minutes : on prolonge avant. */
const STREAM_EXTEND_MS = 4 * 60_000
/** Messages tirés au plus par appel Pub/Sub. */
const PUBSUB_MAX_MESSAGES = 20
/** Un relais sans abonné attend ce délai avant d'arrêter la session (changement de vue, reconnexion). */
const STREAM_IDLE_MS = 8000
/** Au-delà de ce retard d'envoi, une tablette ne suit plus : on saute des fragments plutôt que d'empiler. */
const WS_MAX_BUFFERED = 8 << 20
/** Ping du flux vidéo : deux battements sans pong et la tablette est considérée partie. */
const WS_HEARTBEAT_MS = 30_000

/** La vue Caméras se signale toutes les 5 s ; sans nouvelle de personne pendant ce délai, les vignettes s'arrêtent. */
const GRID_WATCH_TTL_MS = 15_000
const GRID_TICK_MS = 8000
/** Rotation (budget < nombre de caméras) : temps de présence d'une caméra avant de céder sa place. */
const GRID_DWELL_MS = 20_000
/** Largeur des vignettes JPEG. */
const SNAPSHOT_WIDTH = 480
/**
 * Une caméra dont le flux échoue (éteinte, en veille : Google donne l'URL, son serveur répond 404)
 * n'est pas retentée tout de suite — sinon la rotation la redemanderait toutes les 5 s et
 * épuiserait le quota Google. Attente doublée à chaque échec, bornée.
 */
const GRID_RETRY_MIN_MS = 3 * 60_000
const GRID_RETRY_MAX_MS = 15 * 60_000
/**
 * Google limite les commandes à une dizaine par minute et par utilisateur (constaté : neuf ouvertures
 * d'un coup puis des retentatives ont valu un « Rate limited » sur TOUTES les commandes, liste
 * comprise). Donc UNE ouverture par tick de 8 s — dix caméras en 80 s, puis plus rien que les
 * prolongations — et une pause globale dès que Google se plaint.
 */
const GRID_OPEN_PER_TICK = 1
const GRID_RATE_LIMIT_PAUSE_MS = 90_000

interface StreamSession { relay: RtspRelay; url: string; extensionToken: string; extendTimer: unknown }
/** Prise de la vue Caméras sur une session : un abonné muet qui la tient ouverte le temps d'une vignette. */
interface GridHold { since: number; hold: RelaySubscriber }
/** Caméra dont le flux a échoué : à partir de quand réessayer, et combien d'échecs de suite. */
interface GridFailure { retryAt: number; failures: number; reason: string }

export interface NestPluginDeps {
  /** Injection pour les tests (fetch simulé). */
  fetchImpl?: FetchLike
  /** Injection pour les tests : délai d'abandon d'une requête. */
  requestTimeoutMs?: number
  /** Injection pour les tests : le `state` anti-CSRF de la liaison OAuth. */
  randomState?: () => string
  /** Injection pour les tests : remplace le lancement de ffmpeg. */
  spawnImpl?: typeof spawn
}

export function createNestPlugin(deps: NestPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: NestConfig | null = null
  let client: NestClient | null = null
  /** Appareils retenus (caméras et thermostats), par externalId, dans leur dernière forme reçue. */
  let entries = new Map<string, SdmDevice>()
  let descriptors: DeviceDescriptor[] = []
  /** Appareils de l'API qui ne sont ni caméra ni thermostat : ignorés mais comptés. */
  let ignored = 0
  /** Dernière réponse brute de la liste, pour relever une fixture réelle. */
  let lastRaw: unknown = undefined
  let lastError: string | null = null
  let poller: { stop(): void } | null = null
  let eventsPoller: { stop(): void } | null = null
  /** Sessions vidéo ouvertes, par externalId : un relais ffmpeg et le jeton qui prolonge la session Google. */
  const streams = new Map<string, StreamSession>()
  /** Ouvertures en cours, pour qu'une seconde demande simultanée rejoigne la première. */
  const opening = new Map<string, Promise<RtspRelay>>()
  /** Vue Caméras : jusqu'à quand quelqu'un la regarde, et les sessions qu'elle tient pour ses vignettes. */
  let gridWantedUntil = 0
  const gridHeld = new Map<string, GridHold>()
  /** Dernière fois qu'une caméra a rendu sa place : départage la rotation quand aucune vignette ne date. */
  const gridReleasedAt = new Map<string, number>()
  const gridFailed = new Map<string, GridFailure>()
  /** Google a répondu « Rate limited » : aucune ouverture de vignette avant cette date. */
  let gridCooldownUntil = 0
  /** Caméras dont l'utilisateur a arrêté la vignette depuis la vue (bouton stop) : hors rotation jusqu'à reprise. */
  const gridPaused = new Set<string>()
  let gridTimer: unknown = null
  /** Dossier des vignettes JPEG (une par caméra, réécrite en place par ffmpeg). */
  const snapshotDir = join(tmpdir(), 'kasbah-nest-snapshots')
  const snapshotPath = (externalId: string) => join(snapshotDir, `${externalId}.jpg`)
  /** `state` émis par /auth/url et attendus au retour : une liaison ne s'accepte que si on l'a lancée. */
  const pendingStates = new Set<string>()
  const randomState = deps.randomState ?? (() => randomBytes(16).toString('hex'))

  const log = () => ctx!.logger
  const ready = (): NestClient => {
    if (!client) throw new PluginError('NEEDS_PAIRING', 'Google Device Access is not configured (NEST_PROJECT_ID, NEST_CLIENT_ID, NEST_CLIENT_SECRET)')
    if (!client.linked) throw new PluginError('NEEDS_PAIRING', 'no Google account linked: open /api/plugins/nest/auth/url')
    return client
  }

  /** Relit la liste des appareils et reconstruit les descripteurs. Vrai si l'inventaire a changé. */
  async function refresh(): Promise<boolean> {
    const { raw, devices } = await ready().listDevices(ctx!.signal)
    lastRaw = raw
    const next = new Map<string, SdmDevice>()
    const nextDescriptors: DeviceDescriptor[] = []
    ignored = 0
    for (const device of devices) {
      if (isCamera(device)) nextDescriptors.push(toDescriptor(device))
      else if (isThermostat(device)) nextDescriptors.push(toThermostatDescriptor(device))
      else { ignored += 1; continue }
      next.set(deviceNameToExternalId(device.name), device)
    }
    const changed = next.size !== entries.size || [...next.keys()].some((id) => !entries.has(id))
    entries = next
    descriptors = nextDescriptors
    lastError = null
    return changed
  }

  /** Publie l'état d'UN appareil : présence pour une caméra, état complet pour un thermostat. */
  function emitOne(externalId: string, device: SdmDevice): void {
    if (isThermostat(device)) {
      const patch = toClimatePatch(device)
      if (patch) ctx!.emitState(externalId, patch)
      ctx!.setAvailable(externalId, thermostatAvailable(device))
    } else {
      ctx!.emitState(externalId, {})                    // même vide, le patch marque l'appareil disponible
    }
  }

  function emitAll(): void {
    for (const [externalId, device] of entries) emitOne(externalId, device)
  }

  /** Une passe de relecture : inventaire (republié s'il change) puis états. */
  async function tick(): Promise<void> {
    try {
      if (await refresh()) ctx!.emitDevices(descriptors)
      emitAll()
    } catch (err) {
      lastError = (err as Error).message
      throw err                                         // le poller journalise et applique son backoff
    }
  }

  function startPolling(): void {
    if (poller || !config) return
    poller = createPoller({
      name: 'nest-devices', intervalMs: config.NEST_POLL_MS, fn: tick,
      clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
    })
  }

  /** Boucle Pub/Sub : tire les événements, pousse la sonnette aux clients, acquitte. Optionnelle. */
  function startEvents(): void {
    if (eventsPoller || !config?.NEST_PUBSUB_SUBSCRIPTION || !client?.linked) return
    eventsPoller = createPoller({
      name: 'nest-events', intervalMs: config.NEST_PUBSUB_POLL_MS, fn: pollEvents,
      clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
    })
  }

  async function pollEvents(): Promise<void> {
    const sub = config!.NEST_PUBSUB_SUBSCRIPTION!
    const msgs = await ready().pullEvents(sub, PUBSUB_MAX_MESSAGES, ctx!.signal)
    if (msgs.length === 0) return
    for (const m of msgs) {
      const parsed = m.data ? parseSdmEvent(m.data) : undefined
      if (!parsed || !entries.has(parsed.externalId)) continue
      // Sonnette d'abord : on ne pousse que 'chime'. Mouvement/personne/son sont décodés mais pas
      // encore exposés (ils spammeraient un client qui n'en fait rien) — un seul `if` à ouvrir plus tard.
      for (const kind of parsed.kinds) {
        if (kind !== 'chime') continue
        log().info({ externalId: parsed.externalId, event: kind }, 'nest event')
        ctx!.emitEvent(parsed.externalId, kind)
      }
    }
    // acquitter TOUT ce qu'on a tiré (même les événements ignorés), sinon Google les redonne en boucle
    await ready().acknowledge(sub, msgs.map((m) => m.ackId), ctx!.signal)
  }

  /**
   * Ouvre (ou rejoint) la session vidéo d'une caméra RTSP. Deux tablettes qui arrivent en même
   * temps (ou une tablette qui se connecte deux fois, vu en réel) doivent partager la MÊME
   * ouverture : sans `opening`, chacune demandait sa session à Google et la seconde écrasait la
   * première dans `streams`, dont le ffmpeg et le minuteur de prolongation tournaient alors sans fin.
   */
  function openStream(externalId: string): Promise<RtspRelay> {
    const existing = streams.get(externalId)
    if (existing && !existing.relay.hasEnded) return Promise.resolve(existing.relay)
    if (existing) streams.delete(externalId)
    const pending = opening.get(externalId)
    if (pending) return pending
    const p = createStream(externalId).finally(() => opening.delete(externalId))
    opening.set(externalId, p)
    return p
  }

  async function createStream(externalId: string): Promise<RtspRelay> {
    const c = ready()
    const started = await c.generateRtspStream(externalId, ctx!.signal)
    log().info({ externalId, expiresAt: started.expiresAt }, 'rtsp stream opened')
    const relay = new RtspRelay({
      ffmpegPath: config!.FFMPEG_PATH, url: started.streamUrls.rtspUrl, clock: ctx!.clock, logger: ctx!.logger,
      idleGraceMs: STREAM_IDLE_MS, onIdle: () => void closeStream(externalId, 'no viewer left'),
      onEnded: (reason) => void closeStream(externalId, `relay ended: ${reason}`),
      snapshot: { path: snapshotPath(externalId), intervalMs: config!.NEST_SNAPSHOT_MS, width: SNAPSHOT_WIDTH },
      ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
    })
    const session: StreamSession = { relay, url: started.streamUrls.rtspUrl, extensionToken: started.streamExtensionToken, extendTimer: null }
    // Prolonger ne suffit pas : Google coupe la connexion RTSP à l'échéance INITIALE (constaté :
    // vignettes figées puis ffmpeg en fin de flux pile à `expiresAt`, prolongation ou pas). Le nouveau
    // `streamToken` sert à rouvrir la connexion, et le relais bascule dessus sans coupure.
    session.extendTimer = ctx!.clock.setInterval(() => {
      c.extendRtspStream(externalId, session.extensionToken, ctx!.signal)
        .then((r) => {
          session.extensionToken = r.streamExtensionToken
          if (!r.streamToken) { log().warn({ externalId }, 'ExtendRtspStream returned no streamToken: the stream will end at its original expiry'); return }
          session.url = rtspUrlWithToken(session.url, r.streamToken)
          session.relay.rotateSource(session.url)
        })
        .catch((err) => void closeStream(externalId, `extension failed: ${(err as Error).message}`))
    }, STREAM_EXTEND_MS)
    streams.set(externalId, session)
    relay.start()
    return relay
  }

  /** Ferme la session vidéo : relais arrêté, session Google libérée. */
  async function closeStream(externalId: string, reason: string): Promise<void> {
    const session = streams.get(externalId)
    if (!session) return
    streams.delete(externalId)
    ctx!.clock.clearInterval(session.extendTimer)
    const started = session.relay.ready
    session.relay.stop(reason)
    log().info({ externalId, reason }, 'rtsp stream closed')
    // Une session dont le flux n'a jamais démarré (caméra éteinte : Google donne l'URL, son serveur
    // répond 404) n'a rien à rendre — et chaque commande compte dans le quota par minute de Google,
    // que sept caméras éteintes relancées ensemble suffisent à épuiser. Elle expire seule en cinq minutes.
    if (!started) return
    try { await client?.stopRtspStream(externalId, session.extensionToken, ctx!.signal) }
    catch (err) { log().debug({ err }, 'StopRtspStream failed (the session expires by itself)') }
  }

  // ---- vignettes de la vue Caméras -----------------------------------------------------------
  // La vue se signale toutes les 5 s (`GET /cameras/snapshots?watch=1`). Tant qu'elle le fait, le
  // plugin tient ouvertes des sessions pour les caméras RTSP, dans la limite du budget, et chaque
  // relais écrit sa vignette JPEG. Les directs regardés comptent dans le budget ; s'il ne couvre
  // pas toutes les caméras, les vignettes tournent : la caméra tenue depuis le plus longtemps cède
  // sa place à celle dont la vignette est la plus vieille.

  function rtspCameraIds(): string[] {
    return [...entries].filter(([, d]) => isCamera(d) && streamProtocols(d).includes('rtsp')).map(([id]) => id)
  }

  /** Date de la vignette d'une caméra (mtime du fichier), ou `undefined` sans vignette. */
  async function snapshotAt(externalId: string): Promise<number | undefined> {
    try { return Math.round((await stat(snapshotPath(externalId))).mtimeMs) }
    catch { return undefined }
  }

  function gridFailure(externalId: string, reason: string): void {
    const prev = gridFailed.get(externalId)
    const failures = (prev?.failures ?? 0) + 1
    const wait = Math.min(GRID_RETRY_MAX_MS, GRID_RETRY_MIN_MS * 2 ** (failures - 1))
    gridFailed.set(externalId, { retryAt: ctx!.clock.now() + wait, failures, reason })
    log().warn({ externalId, reason, retryInMs: wait }, 'snapshot session failed')
  }

  function acquireGrid(externalId: string): void {
    let gotInit = false
    const hold: RelaySubscriber = (msg) => {
      if (msg.kind === 'init') { gotInit = true; gridFailed.delete(externalId) }
      // fin AVANT la première image : la caméra ne diffuse pas (éteinte, en veille), on n'insiste pas
      else if (msg.kind === 'ended' && !gotInit) { gridHeld.delete(externalId); gridFailure(externalId, msg.reason) }
    }
    gridHeld.set(externalId, { since: ctx!.clock.now(), hold })
    openStream(externalId)
      .then((relay) => { if (gridHeld.get(externalId)?.hold === hold) relay.subscribe(hold) })
      .catch((err) => {
        gridHeld.delete(externalId)
        // un refus de quota n'est pas la faute de la caméra : pause pour tout le monde, pas de compteur d'échec
        if (err instanceof PluginError && err.code === 'RATE_LIMITED') {
          gridCooldownUntil = ctx!.clock.now() + GRID_RATE_LIMIT_PAUSE_MS
          log().warn({ pauseMs: GRID_RATE_LIMIT_PAUSE_MS }, 'Google rate limit: snapshot sessions paused')
        } else gridFailure(externalId, (err as Error).message)
      })
  }

  function releaseGrid(externalId: string): void {
    const h = gridHeld.get(externalId)
    if (!h) return
    gridHeld.delete(externalId)
    gridReleasedAt.set(externalId, ctx!.clock.now())
    streams.get(externalId)?.relay.unsubscribe(h.hold)   // sans autre abonné, le relais se ferme après la grâce
  }

  async function gridTick(): Promise<void> {
    const now = ctx!.clock.now()
    if (now > gridWantedUntil) {
      for (const id of [...gridHeld.keys()]) releaseGrid(id)
      if (gridTimer !== null) { ctx!.clock.clearInterval(gridTimer); gridTimer = null }
      return
    }
    // une prise dont le relais est mort n'a plus rien à tenir
    for (const id of [...gridHeld.keys()]) { const s = streams.get(id); if (!s || s.relay.hasEnded) gridHeld.delete(id) }
    const ids = rtspCameraIds()
    const budget = config!.NEST_LIVE_BUDGET
    if (ids.length > budget) {
      for (const [id, h] of gridHeld) if (now - h.since >= GRID_DWELL_MS) releaseGrid(id)
    }
    if (now < gridCooldownUntil) return
    const free = Math.min(GRID_OPEN_PER_TICK, budget - streams.size - [...gridHeld.keys()].filter((id) => !streams.has(id)).length)
    if (free <= 0) return
    const candidates = ids.filter((id) => !streams.has(id) && !gridHeld.has(id) && !gridPaused.has(id) && (gridFailed.get(id)?.retryAt ?? 0) <= now)
    // Ordre, avec une ouverture par tick (quota Google) :
    //  0. caméras qui ont une vignette mais n'ont pas encore été rendues par la rotation : ce sont
    //     celles d'une exécution précédente (redémarrage du serveur) ou dont la session est morte —
    //     on SAIT qu'elles diffusent. Sans ce rang, après un redémarrage les six caméras éteintes
    //     (aucune vignette, donc « plus anciennes ») passaient d'abord, et les trois actives
    //     affichaient une image d'il y a plusieurs minutes pendant qu'on les attendait ;
    //  1. jamais essayées ;
    //  2. rendues par la rotation (la plus vieille image en tête) ;
    //  3. en échec dont le délai vient d'expirer — six caméras éteintes à réessayer feraient sinon
    //     attendre plus d'une minute la seule qui marche (vu : « il y a 82 s » sur une caméra active).
    const dated = await Promise.all(candidates.map(async (id) => {
      const at = await snapshotAt(id), released = gridReleasedAt.get(id)
      const tier = gridFailed.has(id) ? 3 : released !== undefined ? 2 : at !== undefined ? 0 : 1
      return [id, tier, Math.max(at ?? 0, released ?? 0)] as const
    }))
    dated.sort((a, b) => a[1] - b[1] || a[2] - b[2])
    for (const [id] of dated.slice(0, free)) acquireGrid(id)
  }

  function watchGrid(): void {
    gridWantedUntil = ctx!.clock.now() + GRID_WATCH_TTL_MS
    if (gridTimer === null) {
      gridTimer = ctx!.clock.setInterval(() => void gridTick().catch((err) => log().warn({ err }, 'snapshot rotation failed')), GRID_TICK_MS)
      void gridTick().catch((err) => log().warn({ err }, 'snapshot rotation failed'))
    }
  }

  function stopGrid(): void {
    gridWantedUntil = 0
    for (const id of [...gridHeld.keys()]) releaseGrid(id)
    if (gridTimer !== null) { ctx!.clock.clearInterval(gridTimer); gridTimer = null }
  }

  return {
    id: 'nest',
    configSchema: nestConfigSchema,

    async init(c) {
      ctx = c
      config = c.config as NestConfig                    // déjà validé/transformé par l'hôte
      if (!config.NEST_PROJECT_ID || !config.NEST_CLIENT_ID || !config.NEST_CLIENT_SECRET) return
      mkdirSync(snapshotDir, { recursive: true })
      client = new NestClient({
        projectId: config.NEST_PROJECT_ID, clientId: config.NEST_CLIENT_ID, clientSecret: config.NEST_CLIENT_SECRET,
        redirectUri: config.NEST_REDIRECT_URI, clock: c.clock, logger: c.logger,
        ...(config.NEST_REFRESH_TOKEN ? { refreshToken: config.NEST_REFRESH_TOKEN } : {}),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.requestTimeoutMs !== undefined ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
      })
    },

    async discover(): Promise<DeviceDescriptor[]> {
      if (!client?.linked) return []
      // Un échec ici (quota Google épuisé, réseau) ne doit pas condamner le plugin jusqu'au prochain
      // redémarrage : on démarre quand même, `health` dit pourquoi la liste est vide, et le sondage
      // réessaie — l'inventaire est publié dès qu'il passe.
      try { await refresh() }
      catch (err) { lastError = (err as Error).message; log().warn({ err }, 'Nest device list unavailable at start') }
      return descriptors
    },

    async start() {
      if (!client?.linked) return
      emitAll()                                          // `discover` vient de remplir les entrées
      startPolling()                                     // le premier tick relit la liste tout de suite : c'est le prix d'un poller simple
      startEvents()                                      // événements Pub/Sub (sonnette) si un abonnement est configuré
    },

    async execute(externalId: string, command: Command) {
      const c = ready()
      const device = entries.get(externalId)
      if (!device) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Nest device ${externalId}`)
      if (!isThermostat(device)) throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on a Nest camera`)
      const commands = toThermostatCommands(device, command)
      if (!commands) {
        const patch = toClimatePatch(device)
        throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} refused by the thermostat in mode "${patch?.mode ?? 'unknown'}"`)
      }
      for (const cmd of commands) await c.executeCommand(externalId, cmd.command, cmd.params, ctx!.signal)
      // Google a accusé ; on relit l'appareil pour publier ce qu'il a RETENU (arrondis, mode
      // effectif) plutôt que ce qu'on a demandé — un sondage à la minute laisserait l'UI en retard.
      const fresh = await c.getDevice(externalId, ctx!.signal)
      entries.set(externalId, fresh)
      emitOne(externalId, fresh)
    },

    async stop() {
      poller?.stop()
      poller = null
      eventsPoller?.stop()
      eventsPoller = null
      stopGrid()
      await Promise.all([...streams.keys()].map((id) => closeStream(id, 'plugin stopped')))
      client = null
    },

    registerRoutes(app: FastifyInstance) {
      // Lien à ouvrir dans un navigateur pour lier le compte Google au projet Device Access.
      app.get('/auth/url', async (_req, reply) => {
        if (!client) return sendError(reply, 409, 'NEEDS_PAIRING', 'set NEST_PROJECT_ID, NEST_CLIENT_ID and NEST_CLIENT_SECRET first')
        const state = randomState()
        pendingStates.add(state)
        return { url: client.authorizationUrl(state), redirectUri: config!.NEST_REDIRECT_URI }
      })

      // Retour de Google après consentement : le code s'échange contre le jeton de rafraîchissement.
      app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/auth/callback', async (req, reply) => {
        if (!client) return sendError(reply, 409, 'NEEDS_PAIRING', 'plugin not configured')
        const { code, state, error } = req.query
        if (error) return sendError(reply, 400, 'OAUTH_DENIED', `Google returned "${error}"`)
        if (!state || !pendingStates.has(state)) return sendError(reply, 400, 'INVALID_STATE', 'unknown or missing state: start again from /auth/url')
        if (!code) return sendError(reply, 400, 'INVALID_BODY', 'missing code')
        pendingStates.delete(state)
        try {
          const { refreshToken } = await client.exchangeCode(code, ctx!.signal)
          await refresh()
          ctx!.emitDevices(descriptors)
          emitAll()
          startPolling()                                 // le plugin avait démarré sans compte : le sondage part maintenant
          return reply.type('text/html; charset=utf-8').send(linkedPage(refreshToken, descriptors.length, ignored))
        } catch (err) {
          lastError = (err as Error).message
          const d = describeError(err)
          return sendError(reply, d.status, d.code, d.message)
        }
      })

      // Flux vidéo d'une caméra : une ligne JSON d'entête (codecs), puis l'entête MP4 et les
      // fragments en binaire. Chaque fragment commence par une image clé : une tablette qui arrive
      // en cours de route décode dès le premier, et une tablette trop lente peut en sauter.
      app.get<{ Params: { id: string } }>('/cameras/:id/stream', { websocket: true }, (socket, req) => {
        const externalId = req.params.id
        const fail = (message: string) => { socket.send(JSON.stringify({ type: 'error', message })); socket.close(1008, message.slice(0, 120)) }
        const device = entries.get(externalId)
        if (!device || !isCamera(device)) return fail(`unknown Nest camera ${externalId}`)
        if (!streamProtocols(device).includes('rtsp')) return fail('this camera does not offer an RTSP stream')
        let relay: RtspRelay | null = null
        let closed = false
        const onMessage = (msg: RelayMessage) => {
          if (socket.readyState !== socket.OPEN) return
          if (msg.kind === 'init') { socket.send(JSON.stringify({ type: 'init', mime: msg.mime })); socket.send(msg.data, { binary: true }); return }
          if (msg.kind === 'ended') { socket.send(JSON.stringify({ type: 'ended', reason: msg.reason })); socket.close(1011, msg.reason.slice(0, 120)); return }
          if (socket.bufferedAmount > WS_MAX_BUFFERED) return
          socket.send(msg.data, { binary: true })
        }
        // une tablette qui disparaît sans fermer (Wi-Fi coupé) laisserait la session Google et ffmpeg
        // tourner : ping toutes les 30 s, et on coupe si le pong ne revient pas
        let alive = true
        socket.on('pong', () => { alive = true })
        const heartbeat = ctx!.clock.setInterval(() => {
          if (!alive) { socket.terminate(); return }
          alive = false
          socket.ping()
        }, WS_HEARTBEAT_MS)
        socket.on('close', () => { closed = true; ctx!.clock.clearInterval(heartbeat); relay?.unsubscribe(onMessage) })
        openStream(externalId)
          .then((r) => { if (closed) return; relay = r; r.subscribe(onMessage) })
          .catch((err) => { if (!closed) fail((err as Error).message) })
      })

      // Vignettes de la vue Caméras : la date de chacune, et `watch=1` pour signaler qu'on regarde
      // (c'est ce qui tient les sessions ouvertes ; sans signal pendant 15 s, elles se ferment).
      app.get<{ Querystring: { watch?: string } }>('/cameras/snapshots', async (req) => {
        if (req.query.watch === '1' && client?.linked) watchGrid()
        const ids = rtspCameraIds()
        const dates = await Promise.all(ids.map(async (id) => [id, await snapshotAt(id)] as const))
        const snapshots: Record<string, { at?: number; live: boolean; inactive?: boolean }> = {}
        for (const [id, at] of dates) {
          const failed = gridFailed.get(id), paused = gridPaused.has(id)
          if (at === undefined && !failed && !paused) continue
          snapshots[id] = { ...(at !== undefined ? { at } : {}), live: streams.has(id), ...(failed ? { inactive: true } : {}), ...(paused ? { paused: true } : {}) }
        }
        return { snapshots, budget: config?.NEST_LIVE_BUDGET ?? 0, sessions: streams.size }
      })

      // Bouton stop d'une tuile : la vignette de CETTE caméra s'arrête (sa session est rendue, l'image
      // reste figée) jusqu'à reprise. Partagé entre les écrans — une tablette qui arrête une caméra
      // l'arrête pour la maison, comme elle éteindrait une lampe. Le direct n'est pas concerné.
      app.put<{ Params: { id: string }; Body: { enabled?: unknown } }>('/cameras/:id/snapshots', async (req, reply) => {
        const device = entries.get(req.params.id)
        if (!device || !isCamera(device)) return sendError(reply, 404, 'NOT_FOUND', `unknown Nest camera ${req.params.id}`)
        if (typeof req.body?.enabled !== 'boolean') return sendError(reply, 400, 'VALIDATION', 'body must be { enabled: boolean }')
        if (req.body.enabled) gridPaused.delete(req.params.id)
        else { gridPaused.add(req.params.id); releaseGrid(req.params.id) }
        return { enabled: req.body.enabled }
      })

      app.get<{ Params: { id: string } }>('/cameras/:id/snapshot.jpg', async (req, reply) => {
        const device = entries.get(req.params.id)
        if (!device || !isCamera(device)) return sendError(reply, 404, 'NOT_FOUND', `unknown Nest camera ${req.params.id}`)
        try {
          const [buf, at] = await Promise.all([readFile(snapshotPath(req.params.id)), snapshotAt(req.params.id)])
          return reply.type('image/jpeg').header('cache-control', 'no-store').header('x-kasbah-snapshot-at', String(at ?? '')).send(buf)
        } catch {
          return sendError(reply, 404, 'NOT_FOUND', 'no snapshot yet')
        }
      })

      // Dernière liste brute reçue de Google : sert à relever une fixture réelle (voir __fixtures__).
      app.get('/devices/raw', async (_req, reply) => {
        if (lastRaw === undefined) return sendError(reply, 404, 'NOT_FOUND', 'no device list received yet')
        return lastRaw
      })
    },

    health(): PluginHealth {
      if (!client) return { status: 'error', detail: 'set NEST_PROJECT_ID, NEST_CLIENT_ID and NEST_CLIENT_SECRET (Google Device Access project + OAuth client)' }
      if (!client.linked) return { status: 'needs_pairing', detail: 'link the Google account: GET /api/plugins/nest/auth/url (or the button in Settings)' }
      if (lastError) return { status: 'error', detail: lastError }
      const cameras = descriptors.filter((d) => d.kind === 'camera').length
      const thermostats = descriptors.length - cameras
      return {
        status: 'ok',
        detail: `${cameras} camera(s)${thermostats ? `, ${thermostats} thermostat(s)` : ''}${ignored ? `, ${ignored} other device(s) ignored` : ''}${streams.size ? `, ${streams.size} live stream(s)` : ''}`,
      }
    },
  }
}

/** Page de fin de liaison : le jeton à coller dans .env, rien d'autre (le serveur n'écrit pas .env). */
function linkedPage(refreshToken: string, devices: number, ignored: number): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><meta charset="utf-8"><title>Kasbah · Google Nest</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#222}code{display:block;padding:.8rem;background:#f3f3f3;border-radius:.5rem;word-break:break-all;user-select:all}</style>
<h1>Compte Google lié</h1>
<p>${devices} appareil(s) partagé(s) avec Kasbah${ignored ? `, ${ignored} autre(s) appareil(s) ignoré(s)` : ''}. Le plugin fonctionne dès maintenant, en mémoire.</p>
<p>Pour conserver la liaison après un redémarrage, ajoutez cette ligne dans <strong>apps/server/.env</strong> :</p>
<code>NEST_REFRESH_TOKEN=${esc(refreshToken)}</code>
<p>Vous pouvez fermer cet onglet.</p>`
}
