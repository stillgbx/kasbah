import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createBackoff, type Backoff } from '../../core/backoff'
import { sleep } from '../../core/clock'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { isBravia, probeBravia, sameAudioOutput, type AudioOutput, type BraviaFetch } from './bravia'
import { CastConnection, tlsSocketFactory, type SocketFactory } from './channel'
import { createMdnsDiscovery, type CastDiscovery } from './discovery'
import { createKnownDevicesFile, type KnownDevices } from './known'
import { sendError } from '../../http/errors'
import { AppIconResolver, registryAppId, type RegistryFetch } from './enrich/appIcon'
import { CoverFinder, type CoverFetch, type Track } from './enrich/cover'
import { CrunchyrollEnricher, isCrunchyrollApp, type EnrichFetch } from './enrich/crunchyroll'
import { applyEnrichment, artProxyUrl, toDescriptor, toMediaPatch, toReceiverPatch, withFallbackArt, type PlayUrlMeta } from './mapping'
import type { CastService, MediaStatus, ReceiverApplication, ReceiverStatus } from './types'
import type { StatePatch } from '@kasbah/shared'

// Plugin Google Cast : enceintes et réveils Google / Nest, Chromecast, TV et barres de son
// « Chromecast built-in ». Tout est LOCAL : découverte mDNS, une connexion TLS persistante par
// appareil, aucun compte ni secret. Le récepteur pousse ses changements (volume, appli, lecture) ;
// il n'y a pas de sondage, hors la relecture de la position pendant une lecture.
//
// Ce que le protocole ne sait pas : lancer un titre d'un service à abonnement (YouTube Music,
// Spotify) — il n'a pas de notion de compte. Il sait piloter ce qui joue déjà, et lire une URL
// (récepteur média par défaut) : ce sera l'étape suivante.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

export const googleCastConfigSchema = z.object({
  /** IPv4 de l'interface réseau qui porte le multicast mDNS (machine à plusieurs cartes : VPN, VM). */
  CAST_MDNS_INTERFACE: optionalKey,
  /** Temps laissé aux appareils pour répondre à la première question mDNS avant de rendre la liste. */
  CAST_DISCOVERY_WAIT_MS: z.coerce.number().int().min(500).max(15_000).default(3000),
  /** Cadence des questions mDNS suivantes (appareils rallumés, annonces perdues). */
  CAST_MDNS_REFRESH_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
  /**
   * Où retenir les appareils déjà vus (voir `known.ts`) : un Cast éteint ne s'annonce plus, il reste
   * listé grâce à ce fichier. Chaîne vide = ne rien retenir (l'appareil disparaît quand il s'éteint).
   */
  CAST_KNOWN_FILE: z.string().trim().default(stateFile('google-cast-devices.json')),
  /**
   * Enrichir les lectures Crunchyroll (série, saison, épisode, vignette) par l'API interne du service,
   * en anonyme, sans compte — NON OFFICIEL (voir `enrich/crunchyroll.ts`). `false` pour s'en passer.
   */
  CAST_CRUNCHYROLL_ENRICH: bool.default(true),
  /**
   * Chercher la pochette d'un morceau que l'appareil nomme sans l'illustrer (une appli de TV Android
   * n'envoie aucune image), dans les catalogues publics iTunes puis Deezer, sans clé ni compte — la
   * correspondance titre + artiste est vérifiée avant d'accepter une image (`enrich/cover.ts`).
   * `false` pour s'en passer : il reste le logo de l'appli.
   */
  CAST_COVER_LOOKUP: bool.default(true),
  /**
   * Demander à une TV Sony (modèle `BRAVIA…`) où part son son, par son API REST locale, sans clé
   * (`bravia.ts`) : une TV en HDMI ARC fait jouer une barre de son que le protocole Cast voit au repos.
   * Publié dans `audioOutput` ; l'UI y pose l'onde sonore avec le lien `meta.audioOutput` de house.json.
   * `false` pour s'en passer.
   */
  CAST_BRAVIA_PROBE: bool.default(true),
})
export type GoogleCastConfig = z.infer<typeof googleCastConfigSchema>

/** Un récepteur qui ne répond plus est retenté à 5 s, 10 s… jusqu'à deux minutes. */
const RECONNECT_INITIAL_MS = 5000
const RECONNECT_MAX_MS = 120_000
/** Cadence de la question « où part ton son ? » à une TV Sony connectée (deux requêtes HTTP locales). */
const BRAVIA_POLL_MS = 10_000

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
  /** Sortie son d'une TV Sony (dernier relevé de `bravia.ts`) ; `undefined` tant qu'elle n'a pas répondu. */
  audio: AudioOutput | undefined
  audioTimer: unknown
  /** Métadonnées du dernier `play_url` tant que le contentId correspond. */
  stickyPlay?: PlayUrlMeta & { uri: string }
}

export interface GoogleCastPluginDeps {
  /** Injection pour les tests : téléchargement des pochettes. */
  fetchImpl?: ArtFetch
  /** Injection pour les tests : appels à l'API Crunchyroll. */
  enrichFetch?: EnrichFetch
  /** Injection pour les tests : appels aux catalogues de pochettes (iTunes, Deezer). */
  coverFetch?: CoverFetch
  /** Injection pour les tests : registre public des applis Cast (logos). */
  registryFetch?: RegistryFetch
  /** Injection pour les tests : API REST locale d'une TV Sony (sortie son). */
  braviaFetch?: BraviaFetch
  /** Injection pour les tests : fausse découverte. */
  discovery?: CastDiscovery
  /** Injection pour les tests : mémoire des appareils déjà vus (sinon un fichier JSON). */
  known?: KnownDevices
  /** Injection pour les tests : fausse socket. */
  connect?: SocketFactory
  requestTimeoutMs?: number
  heartbeatMs?: number
}

export function createGoogleCastPlugin(deps: GoogleCastPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: GoogleCastConfig | null = null
  let discovery: CastDiscovery | null = null
  /** Mémoire des appareils déjà vus (null si `CAST_KNOWN_FILE` est vide : rien n'est retenu). */
  let known: KnownDevices | null = null
  /** Enrichissement Crunchyroll (absent si désactivé). */
  let crunchyroll: CrunchyrollEnricher | null = null
  /** Recherche de pochette par titre + artiste (absente si désactivée). */
  let covers: CoverFinder | null = null
  /** Logos des applis, pochette de repli. */
  let appIcons: AppIconResolver | null = null
  let refreshTimer: unknown = null
  let stopping = false
  /** URL de pochettes vues dans les états média (les seules que la route /art accepte de servir), les plus récentes en dernier. */
  const knownArt: string[] = []
  const artCache = new Map<string, ArtEntry>()
  const fetchArt: ArtFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init))
  const braviaFetch: BraviaFetch = deps.braviaFetch ?? ((url, init) => fetch(url, init))
  /** Faux jusqu'à « start » : un état émis pendant « discover » arriverait AVANT l'enregistrement des appareils et serait perdu. */
  let started = false
  const entries = new Map<string, Entry>()

  const log = () => ctx!.logger
  const descriptors = (): DeviceDescriptor[] =>
    [...entries.values()].map((e) => toDescriptor(e.service, { controlType: e.controlType }))

  /** Écrit la mémoire des appareils vus (voir `known.ts`) ; sans mémoire configurée, ne fait rien. */
  function remember(): void {
    void known?.save([...entries.values()].map((e) => e.service))
  }

  function addEntry(service: CastService): Entry {
    const entry: Entry = {
      service, connection: null, controlType: undefined,
      backoff: createBackoff({ initialMs: RECONNECT_INITIAL_MS, maxMs: RECONNECT_MAX_MS }), reconnectTimer: null,
      audio: undefined, audioTimer: null,
    }
    entries.set(service.txt.id, entry)
    return entry
  }

  const sameService = (a: CastService, b: CastService): boolean =>
    a.host === b.host && a.port === b.port && a.txt.fn === b.txt.fn && a.txt.md === b.txt.md && a.txt.ca === b.txt.ca

  /**
   * Un appareil annoncé en mDNS : retenu, connecté ; s'il arrive après `discover`, la liste est
   * republiée. L'annonce peut concerner un appareil DÉJÀ connu (réannonce périodique, appareil
   * rallumé, appareil retrouvé dans la mémoire au démarrage) :
   *  - annonce identique et connexion ouverte : rien à faire ;
   *  - adresse ou nom changés (bail DHCP, renommage dans Google Home) : on retient la nouvelle
   *    annonce, on republie les descripteurs et on rouvre la connexion, l'ancienne pointant dans le vide ;
   *  - pas de connexion : l'annonce prouve qu'il est là, on retente TOUT DE SUITE plutôt que
   *    d'attendre la fin du délai courant (qui peut aller à deux minutes).
   */
  function onService(service: CastService, late: boolean): void {
    const prev = entries.get(service.txt.id)
    if (prev) {
      const changed = !sameService(prev.service, service)
      if (changed) {
        log().info({ name: service.txt.fn, host: service.host, was: prev.service.host }, 'cast device announcement changed')
        prev.service = service
        remember()
        if (started) ctx!.emitDevices(descriptors())
      }
      if (!late) return                                         // pendant `discover` : la connexion vient juste après
      if (prev.connection) { if (changed) prev.connection.close('announcement changed') }
      else reconnectNow(prev)
      return
    }
    const entry = addEntry(service)
    remember()
    log().info({ name: service.txt.fn, model: service.txt.md, host: service.host }, 'cast device found')
    if (late) {
      ctx!.emitDevices(descriptors())
      void connect(entry)
    }
  }

  /** Nouvelle tentative immédiate : le délai en cours ne vaut plus rien puisque l'appareil vient de parler. */
  function reconnectNow(entry: Entry): void {
    ctx!.clock.clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
    entry.backoff.reset()
    void connect(entry)
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
      startAudioProbe(entry)
    } catch (err) {
      // `open` échoué : `onClose` n'est pas forcément passé (connexion jamais établie)
      entry.connection = null
      connection.close('open failed')
      log().warn({ externalId: id, host: entry.service.host, err }, 'cast connection failed')
      scheduleReconnect(entry)
    }
  }

  /**
   * TV Sony connectée : lui demander où part son son, tout de suite puis à cadence lente, tant que la
   * connexion Cast tient (elle tombe avec la TV). Publié seulement quand ça change ; une TV qui ne
   * répond pas garde son dernier relevé — rien n'est inventé.
   */
  function startAudioProbe(entry: Entry): void {
    if (!config!.CAST_BRAVIA_PROBE || !isBravia(entry.service.txt.md) || entry.audioTimer) return
    const probe = async () => {
      if (!entry.connection?.isOpen) return
      let audio: AudioOutput | undefined
      try { audio = await probeBravia(entry.service.host, braviaFetch, ctx!.signal) }
      catch (err) { log().debug({ externalId: entry.service.txt.id, err }, 'bravia audio probe failed'); return }
      if (!audio || sameAudioOutput(audio, entry.audio)) return
      entry.audio = audio
      log().info({ externalId: entry.service.txt.id, name: entry.service.txt.fn, ...audio }, 'tv audio output')
      if (started) ctx!.emitState(entry.service.txt.id, { audioOutput: audio })
    }
    entry.audioTimer = ctx!.clock.setInterval(() => { void probe() }, BRAVIA_POLL_MS)
    void probe()
  }

  function stopAudioProbe(entry: Entry): void {
    ctx!.clock.clearInterval(entry.audioTimer)
    entry.audioTimer = null
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

  function rememberArt(url: string | null | undefined): void {
    if (!url || knownArt.includes(url)) return
    knownArt.push(url)
    if (knownArt.length > ART_KNOWN_MAX) knownArt.shift()
  }

  function onMediaStatus(entry: Entry, media: MediaStatus | undefined, app: ReceiverApplication | undefined): void {
    rememberArt(media?.media?.metadata?.images?.[0]?.url)
    if (started) ctx!.emitState(entry.service.txt.id, mediaPatch(entry, media, app))
  }

  /**
   * Patch de lecture complet, du plus précis au plus général : ce que l'appareil dit, enrichi
   * (Crunchyroll), puis la pochette du morceau cherchée par son nom, puis le logo de l'appli. Chaque
   * étage ne parle que si l'image manque encore.
   */
  function mediaPatch(entry: Entry, media: MediaStatus | undefined, app: ReceiverApplication | undefined): StatePatch<'media_player'> {
    const patch = withAppIcon(entry, app, withCover(entry, enrichedPatch(entry, media, app)))
    const sticky = entry.stickyPlay
    if (!sticky) return patch
    if (patch.playback === 'idle') {
      entry.stickyPlay = undefined
      return patch
    }
    const contentId = media?.media?.contentId
    if (contentId && contentId !== sticky.uri) {
      entry.stickyPlay = undefined
      return patch
    }
    const art = sticky.artUrl?.trim()
    if (art) rememberArt(art)
    const base = patch.nowPlaying ?? { title: '' }
    return {
      ...patch,
      nowPlaying: {
        ...base,
        ...(sticky.title?.trim() ? { title: sticky.title.trim() } : {}),
        ...(sticky.artist?.trim() ? { artist: sticky.artist.trim() } : {}),
        ...(art ? { artUrl: artProxyUrl(art) } : {}),
        ...(sticky.explicit ? { explicit: true } : {}),
        ...(sticky.live ? { live: true } : {}),
      },
    }
  }

  /** Le morceau nommé par un patch, s'il a de quoi être cherché (titre ET artiste). */
  function trackOf(patch: StatePatch<'media_player'>): Track | undefined {
    const n = patch.nowPlaying
    return n?.title && n.artist ? { title: n.title, artist: n.artist } : undefined
  }

  /**
   * Pochette de l'album d'un morceau que l'appareil n'illustre pas (relevé : l'appli YouTube d'une TV
   * Android donne titre et artiste, jamais d'image). Cherchée par son nom dans les catalogues publics
   * (`enrich/cover.ts`), avec correspondance vérifiée. En cache : appliquée tout de suite ; sinon on
   * publie ce qu'on a et on republie à la réponse — si le MÊME morceau joue encore.
   */
  function withCover(entry: Entry, patch: StatePatch<'media_player'>): StatePatch<'media_player'> {
    if (!covers || !patch.nowPlaying || patch.nowPlaying.artUrl) return patch
    const track = trackOf(patch)
    if (!track) return patch
    const known = covers.cached(track)
    if (known) { rememberArt(known); return withFallbackArt(patch, known) }
    if (known === undefined) {
      void covers.lookup(track).then((url) => {
        const c = entry.connection
        if (!url || !started || !c?.isOpen) return
        const playing = trackOf(toMediaPatch(c.media, c.app))
        if (!playing || CoverFinder.key(playing) !== CoverFinder.key(track)) return
        rememberArt(url)
        ctx!.emitState(entry.service.txt.id, mediaPatch(entry, c.media, c.app))
      })
    }
    return patch
  }

  /**
   * Patch de lecture, enrichi si l'appli est pauvre et qu'on sait faire mieux (Crunchyroll). Un résultat
   * déjà en cache s'applique tout de suite ; sinon on publie ce qu'on a et on republie quand la réponse
   * arrive — si le même contenu joue encore (l'utilisateur a pu zapper entre-temps).
   */
  function enrichedPatch(entry: Entry, media: MediaStatus | undefined, app: ReceiverApplication | undefined): StatePatch<'media_player'> {
    const patch = toMediaPatch(media, app)
    const contentId = media?.media?.contentId
    if (!crunchyroll || !app || !contentId || !patch.nowPlaying || !isCrunchyrollApp(app)) return patch
    const known = crunchyroll.cached(contentId)
    if (known) { rememberArt(known.artwork); return applyEnrichment(patch, known) }
    if (known === undefined) {
      void crunchyroll.lookup(contentId).then((e) => {
        const c = entry.connection
        if (!e || !started || !c?.isOpen || c.media?.media?.contentId !== contentId) return
        rememberArt(e.artwork)
        ctx!.emitState(entry.service.txt.id, withAppIcon(entry, c.app, applyEnrichment(toMediaPatch(c.media, c.app), e)))
      })
    }
    return patch
  }

  /**
   * Pochette de repli : le logo de l'appli quand le morceau n'a pas d'image (Netflix natif, Crunchyroll avant
   * enrichissement). L'icône que le récepteur donne lui-même d'abord ; sinon le registre public des applis
   * Cast — en cache tout de suite, sinon publié après coup si la même appli est encore à l'écran.
   */
  function withAppIcon(entry: Entry, app: ReceiverApplication | undefined, patch: StatePatch<'media_player'>): StatePatch<'media_player'> {
    if (!app || !patch.nowPlaying || patch.nowPlaying.artUrl) return patch
    const direct = app.iconUrl?.trim()
    if (direct) { rememberArt(direct); return withFallbackArt(patch, direct) }
    const registryId = appIcons ? registryAppId(app) : undefined
    if (!registryId) return patch
    const known = appIcons!.cached(registryId)
    if (known) { rememberArt(known); return withFallbackArt(patch, known) }
    if (known === undefined) {
      void appIcons!.lookup(registryId).then((url) => {
        const c = entry.connection
        if (!url || !started || !c?.isOpen || c.app?.sessionId !== app.sessionId) return
        ctx!.emitState(entry.service.txt.id, mediaPatch(entry, c.media, c.app))
      })
    }
    return patch
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
    ctx!.emitState(entry.service.txt.id, { ...toReceiverPatch(c.lastReceiverStatus), ...mediaPatch(entry, c.media, c.app), ...(entry.audio ? { audioOutput: entry.audio } : {}) })
  }

  function onClose(entry: Entry, reason: string): void {
    const id = entry.service.txt.id
    if (!entry.connection) return                                   // échec d'ouverture déjà traité
    entry.connection = null
    stopAudioProbe(entry)
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

  /**
   * Oublie un appareil : connexion fermée, entrée sortie de la liste ET de la mémoire. Un appareil
   * encore sur le réseau reviendra à sa prochaine annonce — c'est bien : on n'oublie que ce qui a
   * disparu (appareil vendu, invité de passage), et l'UI ne le propose qu'aux appareils indisponibles.
   */
  function forget(externalId: string): boolean {
    const entry = entries.get(externalId)
    if (!entry) return false
    ctx!.clock.clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
    stopAudioProbe(entry)
    const c = entry.connection
    entry.connection = null                                     // `onClose` ne doit pas reprogrammer de tentative
    c?.close('device forgotten')
    entries.delete(externalId)
    remember()
    if (started) ctx!.emitDevices(descriptors())
    log().info({ externalId, name: entry.service.txt.fn }, 'cast device forgotten')
    return true
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
      case 'media_player.stop': return c.stopApp()                        // ferme l'appli, pas seulement la lecture
      case 'media_player.next': return c.queueJump(1)
      case 'media_player.previous': return c.previous()                 // début du morceau passé 3 s, sinon le précédent
      case 'media_player.seek': return c.seek(command.positionS)
      case 'media_player.play_url': {
        const meta: PlayUrlMeta = {
          ...(command.title ? { title: command.title } : {}),
          ...(command.artist ? { artist: command.artist } : {}),
          ...(command.artUrl ? { artUrl: command.artUrl } : {}),
          ...(command.explicit ? { explicit: true } : {}),
          ...(command.live ? { live: true } : {}),
        }
        await c.playUrl(command.url, meta)
        if (meta.title || meta.artist || meta.artUrl) {
          entry.stickyPlay = { uri: command.url, ...meta }
          if (meta.artUrl) rememberArt(meta.artUrl)
          if (started) {
            ctx!.emitState(entry.service.txt.id, {
              playback: 'playing',
              nowPlaying: {
                title: meta.title ?? '',
                ...(meta.artist ? { artist: meta.artist } : {}),
                ...(meta.artUrl ? { artUrl: artProxyUrl(meta.artUrl) } : {}),
                ...(meta.explicit ? { explicit: true } : {}),
                ...(meta.live ? { live: true } : {}),
                source: 'Default Media Receiver',
              },
            })
          }
        } else {
          entry.stickyPlay = undefined
        }
        return
      }
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
      crunchyroll = config.CAST_CRUNCHYROLL_ENRICH
        ? new CrunchyrollEnricher({ ...(deps.enrichFetch ? { fetchImpl: deps.enrichFetch } : {}), clock: context.clock, logger: context.logger, signal: context.signal })
        : null
      covers = config.CAST_COVER_LOOKUP
        ? new CoverFinder({ ...(deps.coverFetch ? { fetchImpl: deps.coverFetch } : {}), clock: context.clock, logger: context.logger, signal: context.signal })
        : null
      appIcons = new AppIconResolver({ ...(deps.registryFetch ? { fetchImpl: deps.registryFetch } : {}), clock: context.clock, logger: context.logger, signal: context.signal })
      // Appareils déjà vus : ils entrent dans la liste AVANT la découverte, donc un appareil éteint
      // (qui ne s'annonce plus) reste là, indisponible. Une annonce mDNS mettra son adresse à jour.
      known = deps.known ?? (config.CAST_KNOWN_FILE ? createKnownDevicesFile(config.CAST_KNOWN_FILE, context.logger) : null)
      const remembered = (await known?.load()) ?? []
      for (const service of remembered) addEntry(service)
      if (remembered.length) context.logger.info({ devices: remembered.length }, 'cast devices remembered from a previous run')
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
        stopAudioProbe(e)
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

      // Oublier un appareil retenu (voir `forget`) : c'est le pendant de la mémoire, sans quoi un
      // appareil vu une fois resterait listé pour toujours.
      app.delete<{ Params: { externalId: string } }>('/devices/:externalId', async (req, reply) => {
        if (!forget(req.params.externalId)) return sendError(reply, 404, 'NOT_FOUND', `unknown Cast device ${req.params.externalId}`)
        return { forgotten: req.params.externalId }
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
