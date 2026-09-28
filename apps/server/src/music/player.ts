import { Readable } from 'node:stream'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { Command } from '@kasbah/shared'
import { stateFile } from '../core/paths'
import { PluginError } from '../core/plugin'
import { getPlaybackBridge } from '../core/playbackBridge'
import { sendError } from '../http/errors'
import { LengthLock, OUT_BITRATE_KBPS, OUT_CHANNELS, OUT_SAMPLE_RATE_HZ, parseRange, seekFor, StreamProxy, type ProxySession, type ResolvedStream, type SessionMeta, type SpawnFn, type TrackRef } from './proxy'
import { afterEnd, insert, jumpTo, removeAt, REPEAT_MODES, upcoming, type PlayQueue, type QueueTrack, type RepeatMode } from './queue'
import { createLastPlayedFile, type LastPlayedByDevice, type LastPlayedStore } from './lastPlayed'
import { getMusicSource, type MusicSource } from './sources'

// Lecteur COMMUN aux sources musicales, monté sous /api/music. Ce qui était le cœur du plugin YouTube
// Music (2026-09-22) en est sorti le 2026-09-23 pour servir aussi Mixcloud : une source ne fournit que
// son catalogue et le flux d'une piste (`sources.ts`) ; tout le reste vit ici.
//
// - Lecture sur une enceinte : `play_url` d'une URL du serveur (proxy LAN, `proxy.ts`), servie comme
//   un « fichier » de taille connue — relais des octets de la source, ou repli MP3 à trames fixes.
// - File d'attente par lecteur : l'enceinte ne connaît jamais qu'un fichier ; la file surveille son
//   état pour enchaîner à la fin de chaque piste.
// - Transfert (bureau → salon) et écoute LOCALE (le navigateur lit lui-même le fichier).

export const musicConfigSchema = z.object({
  /** Binaire ffmpeg du repli MP3 (clé commune Nest / caméras). */
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  /**
   * Base URL publiée pour Cast/Sonos (ex. `http://192.168.1.10:8787`). Vide = dérivée de la requête
   * (Host de la tablette) — adapté au LAN. `YTM_PUBLISH_BASE` (ancien nom) est encore lu.
   */
  MUSIC_PUBLISH_BASE: z.string().trim().default(''),
  YTM_PUBLISH_BASE: z.string().trim().default(''),
  /** La dernière écoute de chaque lecteur, reprise après un redémarrage (`lastPlayed.ts`). */
  MUSIC_STATE_FILE: z.string().trim().default(stateFile('music.json')),
})
export type MusicConfig = z.infer<typeof musicConfigSchema>

/** Une piste telle que l'UI l'envoie (`/play`, la file) : sa source, son id, et ce que le catalogue en dit. */
const trackSchema = z.object({
  source: z.string().trim().min(1),
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(512).optional(),
  artist: z.string().trim().min(1).max(512).optional(),
  artUrl: z.string().trim().min(1).max(2048).transform((u) => (u.startsWith('//') ? `https:${u}` : u))
    .pipe(z.string().url().refine((u) => /^https?:\/\//i.test(u), 'http or https only'))
    .optional(),
  /** Durée catalogue, si la source n'en donne pas : elle fixe la taille du « fichier ». */
  durationS: z.number().positive().optional(),
  /** Ce que le catalogue dit du morceau : l'enceinte, elle, ne le saura jamais. */
  explicit: z.boolean().optional(),
  /** Partir de là (s) : la reprise d'un mix long. */
  startS: z.number().min(0).optional(),
})
/** Une playlist de plusieurs heures tient largement ; au-delà, c'est une erreur de l'appelant. */
const QUEUE_MAX = 1000

export interface MusicPlayerDeps {
  config?: Partial<MusicConfig>
  logger: Logger
  now?: () => number
  spawnImpl?: SpawnFn
  fetchImpl?: typeof fetch
  /** Les sources inscrites (tests) ; sinon le registre `sources.ts`. */
  source?: (id: string) => MusicSource | undefined
  /** Commande à un lecteur d'un autre plugin (tests) ; sinon le pont `app.ts`. */
  execute?: (deviceId: string, command: Command) => Promise<void>
  getDevice?: (deviceId: string) => { descriptor: { kind: string; capabilities: string[] }; state?: unknown } | undefined
  /** Les états publiés par les lecteurs (tests) ; sinon le pont `app.ts`. */
  onState?: (cb: (deviceId: string, state: unknown) => void) => () => void
  /** Où garder la dernière écoute (tests) ; sinon `MUSIC_STATE_FILE`. */
  lastStore?: LastPlayedStore
}

export interface MusicPlayer {
  registerRoutes(app: FastifyInstance): void
  stop(): void
}

/** Chemin commun des routes du lecteur. */
export const MUSIC_PREFIX = '/api/music'

const sameTrack = (a: TrackRef, b: TrackRef) => a.source === b.source && a.id === b.id
const trackKey = (t: TrackRef) => `${t.source}:${t.id}`

export function createMusicPlayer(deps: MusicPlayerDeps): MusicPlayer {
  const cfg = musicConfigSchema.parse(deps.config ?? {})
  const log = deps.logger
  const now = deps.now ?? (() => Date.now())
  const proxy = new StreamProxy({
    ffmpegPath: cfg.FFMPEG_PATH,
    ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
    now,
  })
  const sourceOf = deps.source ?? getMusicSource

  function publishBase(req: FastifyRequest): string {
    const fixed = cfg.MUSIC_PUBLISH_BASE || cfg.YTM_PUBLISH_BASE
    if (fixed) return fixed.replace(/\/$/, '')
    const host = req.headers['x-forwarded-host'] ?? req.headers.host
    if (!host || typeof host !== 'string') {
      throw new PluginError('UPSTREAM_ERROR', 'cannot derive LAN publish URL: set MUSIC_PUBLISH_BASE')
    }
    const hostname = host.split(':')[0]!
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      throw new PluginError('UPSTREAM_ERROR', 'MUSIC_PUBLISH_BASE required when the UI talks to localhost (Cast/Sonos need the LAN IP)')
    }
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
    return `${proto}://${host}`
  }

  /** La source d'une piste, inscrite et active ; sinon une erreur claire (plugin coupé entre-temps). */
  function requireSource(source: string): MusicSource {
    const s = sourceOf(source)
    if (!s) throw new PluginError('UNSUPPORTED_COMMAND', `music source "${source}" is not enabled`)
    return s
  }

  function resolvePlay() {
    const get = deps.getDevice ?? ((id: string) => getPlaybackBridge()?.getDevice(id))
    const execute = deps.execute ?? ((id: string, command: Command) => {
      const b = getPlaybackBridge()
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
    base: string,
    track: TrackRef,
    deviceId: string,
    sourceUrl: string,
    meta: SessionMeta,
    raw?: { mime: string; sizeBytes: number; ext: string },
  ) {
    const { play } = resolvePlay()
    const session = proxy.open(track, deviceId, sourceUrl, meta, raw)
    // L'extension n'est pas décorative : `streamLoad` (Sonos) en déduit le type annoncé dans le DIDL.
    const streamUrl = `${base}${streamPath(session.sid, raw)}`
    await play(deviceId, streamUrl, meta)
    return { session, streamUrl }
  }

  /**
   * Lecture LOCALE : le navigateur de la tablette (ou du téléphone) lit lui-même le « fichier ». Sa
   * session porte un id de lecteur `local:<id du navigateur>` qui n'est aucun appareil : ni `play_url`,
   * ni état publié, ni file côté serveur — le navigateur tient tout ça.
   */
  const LOCAL_PREFIX = 'local:'
  const isLocal = (deviceId: string) => deviceId.startsWith(LOCAL_PREFIX)

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
   * Une session n'est « vivante » que si l'enceinte joue (ou a mis en pause) NOTRE piste : elle survit
   * sinon à ce que l'enceinte joue ensuite (une radio lancée depuis Google Home), et l'UI aurait
   * montré notre titre, notre durée, et transféré le mauvais morceau. L'enceinte le dit par son titre :
   * le nôtre, ou rien de lisible (identifiant de flux, URL : elle ne sait pas mieux). Les cinq
   * premières secondes sont accordées d'office, le temps que l'état de l'enceinte suive la commande.
   */
  function sessionActive(s: ProxySession): boolean {
    // un navigateur (`/local`) tient sa lecture lui-même : elle n'est pas celle d'une enceinte
    if (isLocal(s.deviceId)) return false
    if (now() - s.createdAt < 5_000) return true
    const { get } = resolvePlay()
    const st = get(s.deviceId)?.state as { kind?: string; playback?: string; nowPlaying?: { title?: string } } | undefined
    if (st?.kind !== 'media_player') return false
    if (st.playback !== 'playing' && st.playback !== 'paused') return false
    const t = st.nowPlaying?.title?.trim() ?? ''
    // un relais s'appelle `<sid>.m4a` : le Sonos publie parfois ce NOM DE FICHIER comme titre
    if (!t || /^[0-9a-f]{24}(\.[a-z0-9]{2,4})?$/i.test(t) || /^https?:\/\//i.test(t)) return true
    return !!s.meta.title && t.toLowerCase() === s.meta.title.trim().toLowerCase()
  }

  // ---- lancer une piste ----------------------------------------------------------------------------

  /** Préparer la source puis résoudre ; toute erreur sort en `PluginError`. */
  async function resolveTrack(track: TrackRef): Promise<ResolvedStream> {
    const source = requireSource(track.source)
    try {
      await source.prepare?.()
      return await source.resolve(track.id)
    } catch (err) {
      if (err instanceof PluginError) throw err
      throw new PluginError('UPSTREAM_ERROR', (err as Error).message, { cause: err })
    }
  }

  /**
   * La piste suivante d'une file, résolue PENDANT que la courante joue : la résolution prend quelques
   * secondes, qu'on ne veut pas entendre entre deux morceaux. Une URL googlevideo vaut ~6 h ; on n'en
   * garde qu'une heure, une piste pas encore jouée au bout d'une heure sera résolue à nouveau.
   */
  const prefetched = new Map<string, { at: number; p: Promise<ResolvedStream> }>()
  const PREFETCH_TTL_MS = 3_600_000

  function prefetchUpcoming(q: PlayQueue): void {
    const next = upcoming(q)
    if (next) prefetchTrack(next)
  }

  function prefetchTrack(track: TrackRef): void {
    const key = trackKey(track)
    const hit = prefetched.get(key)
    if (hit && now() - hit.at < PREFETCH_TTL_MS) return
    const entry = { at: now(), p: resolveTrack(track) }
    // un échec ne se garde pas : le lancement réessaiera pour de bon, et dira pourquoi
    entry.p.catch((err) => {
      if (prefetched.get(key) === entry) prefetched.delete(key)
      log.debug({ err, track: key }, 'music queue: prefetch failed')
    })
    prefetched.set(key, entry)
  }

  function takePrefetched(track: TrackRef): Promise<ResolvedStream> | undefined {
    const key = trackKey(track)
    const hit = prefetched.get(key)
    prefetched.delete(key)
    return hit && now() - hit.at < PREFETCH_TTL_MS ? hit.p : undefined
  }

  /** La session d'un relais se relance telle quelle (transfert, piste rejouée) ; sinon le repli MP3. */
  function rawOf(s: ProxySession): { mime: string; sizeBytes: number; ext: string } | undefined {
    const ext = s.meta.source?.ext?.toLowerCase() ?? ''
    return s.raw && s.lengthBytes !== null && RAW_MIME[ext] ? { mime: s.mime, sizeBytes: s.lengthBytes, ext } : undefined
  }

  /** Ce que la session retient d'une piste résolue, et si elle peut être relayée telle quelle. */
  function describeResolved(track: QueueTrack, resolved: ResolvedStream, rawWanted?: boolean) {
    const durationS = resolved.durationS ?? track.durationS
    const art = track.artUrl ? sourceOf(track.source)?.playArt?.(track.artUrl) ?? track.artUrl : undefined
    const meta: SessionMeta = {
      ...(track.title ? { title: track.title } : {}),
      ...(track.artist ? { artist: track.artist } : {}),
      ...(art ? { artUrl: art } : {}),
      ...(durationS ? { durationS } : {}),
      ...(track.explicit ? { explicit: true } : {}),
      source: { ext: resolved.ext, formatId: resolved.formatId, abrKbps: resolved.abrKbps },
    }
    // RELAIS PAR DÉFAUT : la source est déjà un fichier de taille exacte, découpable en plages —
    // le réencoder ne fait que perdre de la qualité. Deux conditions : un conteneur que les
    // enceintes lisent, et une taille annoncée (c'est elle qui en fait un « fichier »). Sinon,
    // repli sur le MP3 à trames fixes, qui fabrique cette taille à partir de la durée.
    const rawExt = resolved.ext?.toLowerCase() ?? ''
    const rawMime = RAW_MIME[rawExt]
    const raw = rawWanted !== false && rawMime && resolved.sizeBytes
      ? { mime: rawMime, sizeBytes: resolved.sizeBytes, ext: rawExt }
      : undefined
    if (!raw && rawWanted !== false) {
      log.info({ source: track.source, ext: resolved.ext, sizeBytes: resolved.sizeBytes }, 'music: source not relayable, falling back to MP3 transcoding')
    }
    return { meta, raw, durationS }
  }

  /** Chemin du « fichier » d'une session, relatif à l'hôte (le relais porte l'extension du conteneur). */
  const streamPath = (sid: string, raw?: { ext: string }) => (raw
    ? `${MUSIC_PREFIX}/raw/${sid}.${raw.ext}`
    : `${MUSIC_PREFIX}/stream/${sid}`)

  /**
   * Résoudre (ou reprendre la résolution préparée) puis envoyer `play_url`. `stillWanted` est relu
   * après la résolution, qui dure plusieurs secondes : une autre commande a pu passer entre-temps, et
   * cette piste-ci ne doit alors plus partir (null).
   */
  async function startTrack(base: string, deviceId: string, track: QueueTrack, opts: { raw?: boolean; stillWanted: () => boolean }) {
    const source = requireSource(track.source)
    await source.prepare?.()
    // Un de nos flux joue déjà là : le mettre en pause TOUT DE SUITE, avant les secondes de
    // résolution — la tablette montre un sablier, l'enceinte se tait, la nouvelle piste remplace
    // l'ancienne. Pas `stop` : sur un Cast il fermerait l'appli, qu'il faudrait relancer.
    // La pause est ATTENDUE avant `play_url` : une piste résolue d'avance part aussitôt, et une pause
    // arrivée après elle laissait la nouvelle piste en pause à 0 s (vu sur le Sonos « Bureau »).
    const { get, execute } = resolvePlay()
    const playing = (get(deviceId)?.state as { playback?: string } | undefined)?.playback === 'playing'
    const paused = proxy.forDevice(deviceId) && playing
      ? execute(deviceId, { type: 'media_player.pause' }).catch((err) => log.debug({ err }, 'music: pause before replace failed'))
      : Promise.resolve()

    const resolved = await (takePrefetched(track) ?? resolveTrack(track))
    await paused
    if (!opts.stillWanted()) return null
    const { meta, raw, durationS } = describeResolved(track, resolved, opts.raw)
    const started = await launch(base, track, deviceId, resolved.url, meta, raw)
    log.info({
      source: track.source,
      id: track.id,
      deviceId,
      title: track.title ?? null,
      durationS: durationS ?? null,
      mode: raw ? `relay ${raw.ext}` : 'mp3',
      sourceKbps: resolved.abrKbps,
    }, 'music play_url dispatched')
    return started
  }

  // ---- file d'attente ------------------------------------------------------------------------------

  /** Une file en cours : ce qu'elle contient, et de quoi voir la piste courante finir. */
  interface RunningQueue extends PlayQueue {
    /** URL publiée aux enceintes (dérivée de la requête qui a créé la file). */
    base: string
    /** `false` : repli MP3 forcé pour toute la file. */
    raw?: boolean
    /** Session du proxy de la piste courante ; une autre session sur ce lecteur = la file est finie. */
    sid: string | null
    /** Dernière position de lecture relevée, et quand : de quoi estimer où en était la piste à l'arrêt. */
    heard: { positionS: number; at: number } | null
    /** Une piste part (résolution, `play_url`, transfert) : les états du lecteur ne disent rien de la file. */
    busy: boolean
  }
  const queues = new Map<string, RunningQueue>()
  /** Plus près de la fin que ça, un lecteur qui s'arrête a fini la piste (Sonos relevé toutes les 2 s). */
  const END_SLACK_S = 5
  /** Juste après `play_url`, le Sonos passe une seconde à l'arrêt, et un relevé en vol peut encore parler de la piste précédente. */
  const SETTLE_MS = 3_000
  /** Précédent au-delà de ce temps de lecture : retour au début de la piste, comme le fait le plugin Sonos. */
  const RESTART_AFTER_S = 3

  const queueView = (q: RunningQueue) => ({ items: q.items, index: q.index, repeat: q.repeat })

  // ---- dernière écoute -----------------------------------------------------------------------------
  // Files et sessions ne survivent pas à un redémarrage : on garde sur disque, par lecteur, la file,
  // la piste courante et la position atteinte. La barre en montre le titre en pause, `/resume` le
  // relance de là. Oubliée quand la file finit d'elle-même : il n'y a plus rien à reprendre.
  const lastStore = deps.lastStore ?? createLastPlayedFile(cfg.MUSIC_STATE_FILE, log)
  let last: LastPlayedByDevice = {}
  const lastLoaded = lastStore.load()
    .then((v) => { last = { ...v, ...last } })
    .catch((err) => log.warn({ err }, 'music: last played state unreadable'))
  /** Une position arrive à chaque relevé d'enceinte : sur disque au plus toutes les 15 s. */
  const LAST_SAVE_MS = 15_000
  let lastTimer: ReturnType<typeof setTimeout> | undefined
  function saveLast(soon: boolean): void {
    if (lastTimer && !soon) return
    clearTimeout(lastTimer)
    lastTimer = setTimeout(() => {
      lastTimer = undefined
      void lastLoaded.then(() => lastStore.save(last)).catch((err) => log.warn({ err }, 'music: last played state not saved'))
    }, soon ? 0 : LAST_SAVE_MS)
  }
  function remember(deviceId: string, q: PlayQueue, positionS: number, durationS: number | undefined): void {
    if (isLocal(deviceId)) return
    last[deviceId] = {
      // la reprise d'un mix vaut pour son premier lancement : `startS` ne se garde pas
      items: q.items.map(({ startS: _startS, ...t }) => t),
      index: q.index, repeat: q.repeat, positionS: Math.max(0, positionS), durationS: durationS ?? null, at: now(),
    }
    saveLast(true)
  }
  /** Une session sans file (écoute arrivée d'un navigateur sans la sienne) : la piste telle qu'elle joue. */
  const trackOfSession = (s: ProxySession): QueueTrack => ({
    source: s.track.source, id: s.track.id,
    ...(s.meta.title ? { title: s.meta.title } : {}),
    ...(s.meta.artist ? { artist: s.meta.artist } : {}),
    ...(s.meta.artUrl ? { artUrl: s.meta.artUrl } : {}),
    ...(s.meta.durationS ? { durationS: s.meta.durationS } : {}),
    ...(s.meta.explicit ? { explicit: true } : {}),
  })
  function forget(deviceId: string): void {
    if (!last[deviceId]) return
    delete last[deviceId]
    saveLast(true)
  }
  /** La file a changé (ajout, retrait, répétition) sans que la piste change : la position reste. */
  function rememberQueue(deviceId: string, q: PlayQueue): void {
    const prev = last[deviceId]
    if (prev) remember(deviceId, q, prev.positionS, prev.durationS ?? undefined)
  }

  /** La file d'un lecteur, tant que sa piste courante est bien celle que joue l'enceinte. */
  function liveQueue(deviceId: string): RunningQueue | undefined {
    const q = queues.get(deviceId)
    if (!q) return undefined
    const s = proxy.forDevice(deviceId)
    if (q.busy || (s && s.sid === q.sid && sessionActive(s))) return q
    return undefined
  }

  let unwatch: (() => void) | null = null
  /** S'abonner aux états des lecteurs à la première file (pas au démarrage : le pont n'est pas encore branché). */
  function watchPlayers(): void {
    if (unwatch) return
    const on = deps.onState ?? getPlaybackBridge()?.onState
    if (!on) {
      log.warn('music queue: no player state feed — tracks will not chain')
      return
    }
    unwatch = on((deviceId, state) => onPlayerState(deviceId, state))
  }

  /**
   * Fin de piste : aucun lecteur ne l'annonce, l'état passe simplement à `idle` (Sonos STOPPED en fin
   * de fichier, Cast IDLE). On l'y reconnaît à la position : partie de là où on l'a entendue jouer
   * pour la dernière fois, elle doit avoir atteint la durée. Un `idle` en milieu de morceau (arrêt
   * voulu, pause d'un flux que le Sonos change en Stop) laisse la file en attente, sans avancer.
   */
  function onPlayerState(deviceId: string, state: unknown): void {
    const q = queues.get(deviceId)
    if (!q || q.busy) return
    const s = q.sid ? proxy.get(q.sid) : undefined
    if (!s || proxy.forDevice(deviceId)?.sid !== s.sid) {
      // notre flux a été remplacé (un autre `play`) ou fermé (TTL) : la file s'en va avec
      queues.delete(deviceId)
      return
    }
    if (now() - s.createdAt < SETTLE_MS) return
    const st = state as { kind?: string; playback?: string; nowPlaying?: { positionS?: number } | null } | undefined
    if (st?.kind !== 'media_player') return
    if (st.playback === 'playing') {
      if (!sessionActive(s)) {
        log.info({ deviceId }, 'music queue: player moved on to something else, queue dropped')
        queues.delete(deviceId)
        return
      }
      // Un état republié pour autre chose (volume) garde l'ANCIENNE position : ne la redater que si
      // elle a bougé, sinon l'estimation à l'arrêt partirait de trop tôt.
      const pos = st.nowPlaying?.positionS
      if (typeof pos === 'number' && pos !== q.heard?.positionS) {
        // reprise après une pause, ou saut dans le morceau : une action, écrite tout de suite
        const expected = q.heard ? q.heard.positionS + (now() - q.heard.at) / 1000 : null
        const acted = expected === null || Math.abs(pos - expected) > END_SLACK_S
        q.heard = { positionS: pos, at: now() }
        sourceOf(s.track.source)?.onProgress?.(s.track.id, pos, s.meta.durationS, false)
        const mine = last[deviceId]
        if (mine) {
          mine.positionS = pos
          mine.at = now()
          saveLast(acted)
        }
      } else if (!q.heard) q.heard = { positionS: 0, at: now() }
      return
    }
    // en pause : la position où l'on s'est arrêté, écrite tout de suite
    const mine = last[deviceId]
    if (st.playback === 'paused' && mine && typeof st.nowPlaying?.positionS === 'number') {
      mine.positionS = st.nowPlaying.positionS
      mine.at = now()
      saveLast(true)
    }
    if (st.playback !== 'idle' || !q.heard) return
    const reached = q.heard.positionS + (now() - q.heard.at) / 1000
    q.heard = null
    const dur = s.meta.durationS
    if (!dur || reached < dur - END_SLACK_S) return
    sourceOf(s.track.source)?.onProgress?.(s.track.id, dur, dur, true)
    void advance(deviceId, q)
  }

  /** Enchaîner après une fin de piste. Une piste qui ne se lance pas est sautée, trois fois au plus d'affilée. */
  async function advance(deviceId: string, q: RunningQueue, failures = 0): Promise<void> {
    const next = afterEnd(q)
    if (!next) {
      log.info({ deviceId, tracks: q.items.length }, 'music queue finished')
      queues.delete(deviceId)
      forget(deviceId)
      return
    }
    try {
      await playAt(deviceId, q, next.index, next.repeat)
    } catch (err) {
      log.warn({ err, deviceId, track: q.items[next.index] ? trackKey(q.items[next.index]!) : null }, 'music queue: next track failed')
      if (queues.get(deviceId) !== q || failures >= 2) return
      q.index = next.index
      q.repeat = 'off'
      await advance(deviceId, q, failures + 1)
    }
  }

  /**
   * Jouer la piste `index` de la file. La même piste rejouée (répétition) repart du flux déjà résolu :
   * l'URL de la source est encore bonne, pas de nouvelle résolution.
   */
  async function playAt(deviceId: string, q: RunningQueue, index: number, repeat: RepeatMode) {
    const track = q.items[index]!
    const stillWanted = () => queues.get(deviceId) === q
    q.busy = true
    try {
      const current = q.sid ? proxy.get(q.sid) : undefined
      const started = current && index === q.index && sameTrack(current.track, track)
        ? await launch(q.base, current.track, deviceId, current.sourceUrl, current.meta, rawOf(current))
        : await startTrack(q.base, deviceId, track, { ...(q.raw === false ? { raw: false } : {}), stillWanted })
      if (!started || !stillWanted()) return null
      Object.assign(q, { index, repeat, sid: started.session.sid, heard: null })
      remember(deviceId, q, track.startS ?? 0, started.session.meta.durationS)
      if (track.startS && track.startS > 1 && started.session.lengthBytes !== null) {
        await seekWhenReady(deviceId, track.startS)
          .catch((err) => log.warn({ err, deviceId, startS: track.startS }, 'music: resume seek failed, playing from start'))
      }
      // la reprise ne vaut qu'une fois : rejouée (répétition, précédent), la piste repart du début
      if (track.startS !== undefined) q.items[index] = { ...track, startS: undefined }
      prefetchUpcoming(q)
      return started
    } finally {
      q.busy = false
    }
  }

  /** Nouvelle file sur ce lecteur (l'ancienne est remplacée), qui joue `tracks[startIndex]`. */
  async function playQueue(reply: FastifyReply, base: string, deviceId: string, tracks: QueueTrack[], startIndex: number, raw?: boolean) {
    for (const t of tracks) requireSource(t.source)
    const q: RunningQueue = {
      items: tracks, index: startIndex, repeat: 'off', base,
      ...(raw === false ? { raw: false } : {}),
      sid: null, heard: null, busy: false,
    }
    queues.set(deviceId, q)
    watchPlayers()
    try {
      const started = await playAt(deviceId, q, startIndex, 'off')
      if (!started) return { error: sendError(reply, 409, 'SUPERSEDED', 'another track was started on this player meanwhile') }
      return { ...started, queue: q }
    } catch (err) {
      if (queues.get(deviceId) === q) queues.delete(deviceId)
      throw err
    }
  }

  /** Type de contenu d'un flux source relayé tel quel (le conteneur décide, pas le codec). */
  const RAW_MIME: Record<string, string> = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg' }

  const sessionView = (s: ProxySession) => ({
    deviceId: s.deviceId, source: s.track.source, id: s.track.id, sid: s.sid,
    durationS: s.meta.durationS ?? null, title: s.meta.title ?? null, artist: s.meta.artist ?? null, artUrl: s.meta.artUrl ?? null,
    // Ce que l'enceinte reçoit de NOUS, et ce que nous recevons de la source : de quoi juger à l'œil
    // ce que vaut la chaîne, sans ouvrir le journal.
    quality: {
      mime: s.mime,
      // relais : ce que sert le proxy EST ce que la source a donné, il n'y a plus de sortie à nous
      bitrateKbps: s.raw ? s.meta.source?.abrKbps ?? null : OUT_BITRATE_KBPS,
      sampleRateHz: s.raw ? null : OUT_SAMPLE_RATE_HZ,
      channels: s.raw ? null : OUT_CHANNELS,
      lengthBytes: s.lengthBytes,
      source: s.meta.source ?? null,
    },
    // de quoi griser précédent / suivant et montrer la répétition sans ouvrir la file
    queue: (() => {
      const q = queues.get(s.deviceId)
      return q && q.sid === s.sid ? { length: q.items.length, index: q.index, repeat: q.repeat } : null
    })(),
  })

  function registerRoutes(app: FastifyInstance) {
    // Une piste seule est une file d'une piste : la répétition vaut aussi pour elle, et c'est la même
    // mécanique qui la lance.
    app.post<{ Body: unknown }>('/play', async (req, reply) => {
      const body = trackSchema.extend({
        deviceId: z.string().trim().min(1),
        /**
         * Par défaut le flux source est RELAYÉ tel quel ; `false` force le réencodage MP3 (échappatoire
         * si un lecteur bute sur le conteneur d'origine).
         */
        raw: z.boolean().optional(),
      }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'source, id and deviceId are required')
      const { deviceId, raw, ...track } = body.data
      const target = playableOrError(reply, resolvePlay().get, deviceId)
      if ('error' in target) return target.error
      const started = await playQueue(reply, publishBase(req), deviceId, [track], 0, raw)
      if ('error' in started) return started.error
      return { ok: true as const, streamUrl: started.streamUrl, sid: started.session.sid }
    })

    // Lecture LOCALE : le navigateur lit lui-même le « fichier » (même relais que les enceintes), et
    // tient sa file. Le chemin rendu est relatif : c'est le navigateur qui parle au serveur, pas une
    // enceinte du réseau. `next` : la piste qui suivra, résolue d'avance pendant l'écoute.
    app.post<{ Body: unknown }>('/local', async (req, reply) => {
      const body = trackSchema.extend({
        clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
        next: z.object({ source: z.string().trim().min(1), id: z.string().trim().min(1) }).optional(),
      }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'source, id and clientId are required')
      const { clientId, next, ...track } = body.data
      requireSource(track.source)
      const resolved = await (takePrefetched(track) ?? resolveTrack(track))
      const { meta, raw } = describeResolved(track, resolved)
      const session = proxy.open(track, `${LOCAL_PREFIX}${clientId}`, resolved.url, meta, raw)
      if (next && sourceOf(next.source)) prefetchTrack(next)
      log.info({ source: track.source, id: track.id, clientId, mode: raw ? `relay ${raw.ext}` : 'mp3' }, 'music local playback opened')
      return { ok: true as const, streamUrl: streamPath(session.sid, raw), session: sessionView(session), ...(track.startS ? { startS: track.startS } : {}) }
    })

    // ---- file d'attente -----------------------------------------------------------------------
    // Elle vit ici, par lecteur : l'enceinte ne connaît jamais qu'un « fichier ». Précédent et
    // suivant passent par ces routes, pas par `media_player.next` — l'enceinte n'aurait rien à sauter.

    app.post<{ Body: unknown }>('/queue', async (req, reply) => {
      const body = z.object({
        deviceId: z.string().trim().min(1),
        tracks: z.array(trackSchema).min(1).max(QUEUE_MAX),
        startIndex: z.number().int().min(0).optional(),
        raw: z.boolean().optional(),
      }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', `deviceId and 1 to ${QUEUE_MAX} tracks are required`)
      const { deviceId, tracks, startIndex = 0, raw } = body.data
      if (startIndex >= tracks.length) return sendError(reply, 400, 'INVALID_BODY', 'startIndex is past the last track')
      const target = playableOrError(reply, resolvePlay().get, deviceId)
      if ('error' in target) return target.error
      const started = await playQueue(reply, publishBase(req), deviceId, tracks, startIndex, raw)
      if ('error' in started) return started.error
      return { ok: true as const, streamUrl: started.streamUrl, sid: started.session.sid, queue: queueView(started.queue) }
    })

    app.get<{ Querystring: { deviceId?: string } }>('/queue', async (req, reply) => {
      const q = liveQueue(req.query.deviceId ?? '')
      if (!q) return sendError(reply, 404, 'NOT_FOUND', 'no music queue on this player')
      return queueView(q)
    })

    /** Ajouter sans interrompre : juste après la piste courante, ou à la fin. Rien ne joue ? Ça part tout de suite. */
    app.post<{ Body: unknown }>('/queue/add', async (req, reply) => {
      const body = z.object({
        deviceId: z.string().trim().min(1),
        tracks: z.array(trackSchema).min(1).max(QUEUE_MAX),
        where: z.enum(['next', 'end']).default('end'),
      }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'deviceId and tracks are required')
      const { deviceId, tracks, where } = body.data
      const q = liveQueue(deviceId)
      if (!q) {
        const target = playableOrError(reply, resolvePlay().get, deviceId)
        if ('error' in target) return target.error
        const started = await playQueue(reply, publishBase(req), deviceId, tracks, 0)
        if ('error' in started) return started.error
        return { ok: true as const, started: true, queue: queueView(started.queue) }
      }
      if (q.items.length + tracks.length > QUEUE_MAX) return sendError(reply, 400, 'INVALID_BODY', `a queue holds at most ${QUEUE_MAX} tracks`)
      for (const t of tracks) requireSource(t.source)
      const { items } = insert(q, tracks, where)
      q.items = items
      prefetchUpcoming(q)
      rememberQueue(deviceId, q)
      return { ok: true as const, started: false, queue: queueView(q) }
    })

    app.post<{ Body: unknown }>('/queue/next', async (req, reply) => {
      const body = z.object({ deviceId: z.string().trim().min(1) }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'deviceId is required')
      const q = liveQueue(body.data.deviceId)
      if (!q) return sendError(reply, 404, 'NOT_FOUND', 'no music queue on this player')
      const step = jumpTo(q, q.index + 1)
      if (!step) return sendError(reply, 409, 'QUEUE_END', 'no next track in the queue')
      await playAt(body.data.deviceId, q, step.index, step.repeat)
      return queueView(q)
    })

    /** Précédent : au début de la piste après quelques secondes de lecture (comme un lecteur de salon), sinon la piste d'avant. */
    app.post<{ Body: unknown }>('/queue/previous', async (req, reply) => {
      const body = z.object({ deviceId: z.string().trim().min(1) }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'deviceId is required')
      const q = liveQueue(body.data.deviceId)
      if (!q) return sendError(reply, 404, 'NOT_FOUND', 'no music queue on this player')
      const { get, execute } = resolvePlay()
      const session = q.sid ? proxy.get(q.sid) : undefined
      const step = jumpTo(q, q.index - 1)
      if (!step || (session && trackPosition(get, session) > RESTART_AFTER_S)) {
        await execute(body.data.deviceId, { type: 'media_player.seek', positionS: 0 })
        return queueView(q)
      }
      await playAt(body.data.deviceId, q, step.index, step.repeat)
      return queueView(q)
    })

    /** Jouer une piste choisie dans la file. */
    app.post<{ Body: unknown }>('/queue/jump', async (req, reply) => {
      const body = z.object({ deviceId: z.string().trim().min(1), index: z.number().int().min(0) }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'deviceId and index are required')
      const q = liveQueue(body.data.deviceId)
      if (!q) return sendError(reply, 404, 'NOT_FOUND', 'no music queue on this player')
      const step = jumpTo(q, body.data.index)
      if (!step) return sendError(reply, 400, 'INVALID_BODY', 'index is outside the queue')
      await playAt(body.data.deviceId, q, step.index, step.repeat)
      return queueView(q)
    })

    app.post<{ Body: unknown }>('/queue/repeat', async (req, reply) => {
      const body = z.object({ deviceId: z.string().trim().min(1), mode: z.enum(REPEAT_MODES) }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', `deviceId and mode (${REPEAT_MODES.join(', ')}) are required`)
      const q = liveQueue(body.data.deviceId)
      if (!q) return sendError(reply, 404, 'NOT_FOUND', 'no music queue on this player')
      q.repeat = body.data.mode
      prefetchUpcoming(q)
      rememberQueue(body.data.deviceId, q)
      return queueView(q)
    })

    app.post<{ Body: unknown }>('/queue/remove', async (req, reply) => {
      const body = z.object({ deviceId: z.string().trim().min(1), index: z.number().int().min(0) }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'deviceId and index are required')
      const q = liveQueue(body.data.deviceId)
      if (!q) return sendError(reply, 404, 'NOT_FOUND', 'no music queue on this player')
      const next = removeAt(q, body.data.index)
      if (!next) return sendError(reply, 400, 'INVALID_BODY', 'cannot remove the playing track or a track outside the queue')
      q.items = next.items
      q.index = next.index
      prefetchUpcoming(q)
      rememberQueue(body.data.deviceId, q)
      return queueView(q)
    })

    /** Vider la file : la piste en cours continue, seule, rien ne la suit. */
    app.delete<{ Querystring: { deviceId?: string } }>('/queue', async (req, reply) => {
      const q = liveQueue(req.query.deviceId ?? '')
      if (!q) return sendError(reply, 404, 'NOT_FOUND', 'no music queue on this player')
      q.items = [q.items[q.index]!]
      q.index = 0
      rememberQueue(req.query.deviceId ?? '', q)
      return queueView(q)
    })

    /**
     * Où en est une piste lue dans un NAVIGATEUR (`/local`) : aucune enceinte n'en publie l'état, c'est
     * lui qui le dit, de temps en temps et à la fin — pour la reprise d'un mix, comme sur une enceinte.
     */
    app.post<{ Body: unknown }>('/progress', async (req, reply) => {
      const body = z.object({
        source: z.string().trim().min(1),
        id: z.string().trim().min(1),
        positionS: z.number().min(0),
        durationS: z.number().positive().optional(),
        ended: z.boolean().optional(),
      }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'source, id and positionS are required')
      const { source, id, positionS, durationS, ended } = body.data
      sourceOf(source)?.onProgress?.(id, positionS, durationS, ended === true)
      return { ok: true as const }
    })

    /** Ce que nos lecteurs jouent de nous en ce moment : titre, durée et transfert côté UI. */
    app.get('/sessions', async () => ({ sessions: proxy.list().filter(sessionActive).map(sessionView) }))

    /**
     * La dernière écoute des lecteurs qui ne jouent rien de nous en ce moment : de quoi montrer le
     * titre interrompu (redémarrage du serveur, arrêt) en pause à sa position.
     */
    app.get('/last', async () => {
      await lastLoaded
      const live = new Set(proxy.list().filter(sessionActive).map((s) => s.deviceId))
      return {
        last: Object.entries(last).filter(([deviceId]) => !live.has(deviceId)).map(([deviceId, e]) => ({
          deviceId,
          track: e.items[e.index]!,
          positionS: Math.floor(e.positionS),
          durationS: e.durationS,
          queue: { length: e.items.length, index: e.index, repeat: e.repeat },
          at: e.at,
        })),
      }
    })

    /** Relancer la dernière écoute d'un lecteur, sa file comprise, à sa position (ou à `positionS`). */
    app.post<{ Body: unknown }>('/resume', async (req, reply) => {
      const body = z.object({ deviceId: z.string().trim().min(1), positionS: z.number().min(0).optional() }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'deviceId is required')
      const { deviceId } = body.data
      await lastLoaded
      const entry = last[deviceId]
      if (!entry) return sendError(reply, 404, 'NOT_FOUND', 'nothing to resume on this player')
      const target = playableOrError(reply, resolvePlay().get, deviceId)
      if ('error' in target) return target.error
      const startS = Math.floor(body.data.positionS ?? entry.positionS)
      const tracks = entry.items.map((t, i) => (i === entry.index && startS > 0 ? { ...t, startS } : t))
      const started = await playQueue(reply, publishBase(req), deviceId, tracks, entry.index)
      if ('error' in started) return started.error
      started.queue.repeat = entry.repeat
      rememberQueue(deviceId, started.queue)
      return { ok: true as const, streamUrl: started.streamUrl, sid: started.session.sid, queue: queueView(started.queue) }
    })

    // Transfert : la piste que joue `from` repart sur `to` (même « fichier »), la cible se place à la
    // position où `from` en était (relevée dans l'état publié du lecteur), puis `from` s'arrête. Pas de
    // nouvelle résolution : l'URL de la source de la session est encore bonne.
    //
    // Un navigateur (`local:…`) peut être l'un ou l'autre bout. Source : il n'a pas d'état publié, il
    // donne sa position et sa file (`positionS`, `queue`), et s'arrête lui-même. Cible : rien à lancer,
    // la réponse lui rend le chemin du fichier, la position et la file qu'il reprend à son compte.
    app.post<{ Body: unknown }>('/transfer', async (req, reply) => {
      const body = z.object({
        fromDeviceId: z.string().trim().min(1),
        toDeviceId: z.string().trim().min(1),
        positionS: z.number().min(0).optional(),
        queue: z.object({
          tracks: z.array(trackSchema).min(1).max(QUEUE_MAX),
          index: z.number().int().min(0),
          repeat: z.enum(REPEAT_MODES),
        }).optional(),
      }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'fromDeviceId and toDeviceId are required')
      const { fromDeviceId, toDeviceId } = body.data
      if (fromDeviceId === toDeviceId) return sendError(reply, 400, 'INVALID_BODY', 'source and target are the same device')
      const fromLocal = isLocal(fromDeviceId)
      const toLocal = isLocal(toDeviceId)
      if (fromLocal && toLocal) return sendError(reply, 400, 'INVALID_BODY', 'a transfer needs at least one player')
      if (fromLocal && body.data.positionS === undefined) return sendError(reply, 400, 'INVALID_BODY', 'positionS is required from a browser')
      if (body.data.queue && body.data.queue.index >= body.data.queue.tracks.length) return sendError(reply, 400, 'INVALID_BODY', 'queue index is past the last track')

      const { get, execute } = resolvePlay()
      const source = proxy.forDevice(fromDeviceId)
      if (!source || (!fromLocal && !sessionActive(source))) return sendError(reply, 404, 'NOT_FOUND', 'source device is not playing one of our streams')
      if (!toLocal) {
        const target = playableOrError(reply, get, toDeviceId)
        if ('error' in target) return target.error
      }
      const positionS = fromLocal ? body.data.positionS! : trackPosition(get, source)

      // la file suit la piste : elle ne réagit à rien le temps du transfert (la source va s'arrêter
      // en milieu de morceau, ce n'est pas une fin de piste)
      const queue = fromLocal ? undefined : queues.get(fromDeviceId)
      if (queue) queue.busy = true
      try {
        if (toLocal) {
          const session = proxy.open(source.track, toDeviceId, source.sourceUrl, source.meta, rawOf(source))
          await execute(fromDeviceId, { type: 'media_player.stop' })
            .catch((err) => log.warn({ err, deviceId: fromDeviceId }, 'music transfer: source stop failed'))
          proxy.closeDevice(fromDeviceId)
          const moved = queue && queue.sid === source.sid ? queueView(queue) : null
          if (queue && queues.get(fromDeviceId) === queue) queues.delete(fromDeviceId)
          // le navigateur tient désormais l'écoute : l'enceinte n'a plus rien à reprendre
          forget(fromDeviceId)
          log.info({ track: trackKey(source.track), from: fromDeviceId, to: toDeviceId, positionS, queued: moved?.items.length ?? 0 }, 'music playback transferred to a browser')
          return { ok: true as const, streamUrl: streamPath(session.sid, rawOf(session)), sid: session.sid, positionS, session: sessionView(session), queue: moved }
        }

        const base = publishBase(req)
        const { session, streamUrl } = await launch(base, source.track, toDeviceId, source.sourceUrl, source.meta, rawOf(source))
        if (positionS > 1 && session.lengthBytes !== null) {
          await seekWhenReady(toDeviceId, positionS + TRANSFER_LEAD_S)
            .catch((err) => log.warn({ err, deviceId: toDeviceId, positionS }, 'music transfer: seek on target failed, playing from start'))
        }
        // la source ne s'arrête qu'une fois la cible lancée : un échec laisse la musique où elle était
        // (un navigateur s'arrête lui-même, à la réponse)
        if (!fromLocal) {
          await execute(fromDeviceId, { type: 'media_player.stop' })
            .catch((err) => log.warn({ err, deviceId: fromDeviceId }, 'music transfer: source stop failed'))
        }
        proxy.closeDevice(fromDeviceId)
        if (queue && queues.get(fromDeviceId) === queue) {
          queues.delete(fromDeviceId)
          Object.assign(queue, { sid: session.sid, heard: null, base })
          queues.set(toDeviceId, queue)
        } else if (body.data.queue) {
          // la file du navigateur passe au serveur : c'est lui qui enchaînera sur l'enceinte
          const { tracks, index, repeat } = body.data.queue
          queues.set(toDeviceId, { items: tracks, index, repeat, base, sid: session.sid, heard: null, busy: false })
          watchPlayers()
          prefetchUpcoming(queues.get(toDeviceId)!)
        }
        const moved = queues.get(toDeviceId)
        forget(fromDeviceId)
        remember(toDeviceId, moved ?? { items: [trackOfSession(source)], index: 0, repeat: 'off' }, positionS, source.meta.durationS)
        log.info({ track: trackKey(source.track), from: fromDeviceId, to: toDeviceId, positionS, queued: moved?.items.length ?? 0 }, 'music playback transferred')
        return { ok: true as const, streamUrl, sid: session.sid, positionS, ...(moved ? { queue: queueView(moved) } : {}) }
      } catch (err) {
        if (err instanceof PluginError) throw err
        throw new PluginError('UPSTREAM_ERROR', (err as Error).message, { cause: err })
      } finally {
        if (queue) queue.busy = false
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
      const session = proxy.get(req.params.sid)
      if (!session) return sendError(reply, 404, 'NOT_FOUND', 'stream session expired or unknown')
      log.debug({ sid: session.sid, deviceId: session.deviceId, ua: req.headers['user-agent'] ?? null }, 'music stream HEAD')
      reply.hijack()
      reply.raw.writeHead(200, fileHeaders(session))
      reply.raw.end()
    })

    /**
     * Relais SANS réencodage : la source annonce une taille exacte et accepte les plages — le
     * « fichier » que le MP3 fabrique, elle le fournit déjà. On repasse les octets, en reportant la
     * plage demandée par l'enceinte. L'extension de l'URL (`.m4a`) fait annoncer `audio/mp4` au Sonos.
     */
    const rawSession = (file: string) => {
      const sid = file.split('.')[0] ?? ''
      const s = proxy.get(sid)
      return s?.raw ? s : undefined
    }

    app.head<{ Params: { file: string } }>('/raw/:file', async (req, reply) => {
      const session = rawSession(req.params.file)
      if (!session) return sendError(reply, 404, 'NOT_FOUND', 'raw session expired or unknown')
      log.debug({ sid: session.sid, deviceId: session.deviceId, ua: req.headers['user-agent'] ?? null }, 'music raw HEAD')
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
        log.warn({ err, sid: session.sid }, 'music raw GET: upstream failed')
        return sendError(reply, 502, 'UPSTREAM_ERROR', 'source stream unreachable')
      }
      if (!upstream.ok || !upstream.body) {
        log.warn({ sid: session.sid, status: upstream.status }, 'music raw GET: upstream refused')
        return sendError(reply, 502, 'UPSTREAM_ERROR', `source stream answered ${upstream.status}`)
      }
      const len = upstream.headers.get('content-length')
      const contentRange = upstream.headers.get('content-range')
      // `debug` : un Sonos lit le fichier par plages de 6 Ko, soit une requête par fraction de seconde —
      // en `info`, ces lignes noyaient le journal. Le lancement d'une piste, lui, reste en `info`.
      log.debug({
        sid: session.sid, deviceId: session.deviceId, range: range ?? null, status: upstream.status,
        len, contentRange, ua: req.headers['user-agent'] ?? null,
      }, 'music raw GET')
      reply.hijack()
      reply.raw.writeHead(upstream.status === 206 ? 206 : 200, {
        'content-type': session.mime,
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
        ...(len ? { 'content-length': len } : {}),
        ...(contentRange ? { 'content-range': contentRange } : {}),
      })
      // Le lecteur coupe quand il veut (pause, changement de piste, fin de sonde) : on arrête alors
      // de tirer sur la source. PIÈGE : l'annulation fait émettre une AbortError au flux ; sans
      // écouteur d'erreur, Node la remonte en exception non gérée et le SERVEUR tombe.
      const body = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
      const stop = () => { if (!reply.raw.writableEnded) reply.raw.end() }
      body.on('error', (err) => {
        log.debug({ err, sid: session.sid }, 'music raw GET: source stream cut')
        stop()
      })
      reply.raw.on('close', () => { abort.abort(); body.destroy() })
      body.pipe(reply.raw)
    })

    app.get<{ Params: { sid: string } }>('/stream/:sid', async (req, reply) => {
      const session = proxy.get(req.params.sid)
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
      // `debug`, comme le relais : une ligne par plage demandée par l'enceinte
      log.debug({
        sid: session.sid, deviceId: session.deviceId, range: req.headers.range ?? null, startS: Number(startS.toFixed(3)),
        ua: req.headers['user-agent'] ?? null,
      }, 'music stream GET')

      const proc = proxy.spawnFfmpeg(session.sourceUrl, startS)
      reply.hijack()
      const res = reply.raw
      res.writeHead(range ? 206 : 200, headers)
      const finish = () => { if (!res.writableEnded) res.end() }
      if (end !== null) {
        const lock = new LengthLock(end - start + 1, skipBytes, await proxy.silentFrame())
        proc.stdout.pipe(lock).pipe(res)
        lock.on('error', finish)
      } else {
        proc.stdout.pipe(res)
      }
      proc.on('error', finish)
      proc.on('close', () => { if (end === null) finish() })
      res.on('close', () => { try { proc.kill('SIGKILL') } catch { /* gone */ } })
    })
  }

  return {
    registerRoutes,
    stop() {
      unwatch?.()
      unwatch = null
      queues.clear()
      prefetched.clear()
      // la position la plus récente, pas celle d'il y a 15 s
      if (lastTimer) {
        clearTimeout(lastTimer)
        lastTimer = undefined
        void lastLoaded.then(() => lastStore.save(last)).catch((err) => log.warn({ err }, 'music: last played state not saved'))
      }
      proxy.clear()
    },
  }
}
