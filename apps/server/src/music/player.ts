import { Readable } from 'node:stream'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { Command } from '@kasbah/shared'
import { stateFile } from '../core/paths'
import { PluginError } from '../core/plugin'
import { getPlaybackBridge } from '../core/playbackBridge'
import { sendError } from '../http/errors'
import { isPublicRequest } from '../mcp/auth'
import { LengthLock, OUT_BITRATE_KBPS, OUT_CHANNELS, OUT_SAMPLE_RATE_HZ, parseRange, seekFor, StreamProxy, type ProxySession, type ResolvedStream, type SessionMeta, type SpawnFn, type TrackRef } from './proxy'
import { afterEnd, insert, jumpTo, removeAt, REPEAT_MODES, upcoming, type PlayQueue, type QueueTrack, type RepeatMode } from './queue'
import { createLastPlayedFile, type LastPlayedByDevice, type LastPlayedStore } from './lastPlayed'
import { getMusicSource, musicUserOf as userOf, type MusicSource, type MusicUser } from './sources'

// Player SHARED by the music sources, mounted under /api/music. What was the core of the YouTube Music
// plugin (2026-09-22) moved out of it on 2026-09-23 to serve Mixcloud too: a source only provides its
// catalog and a track's stream (`sources.ts`); everything else lives here.
//
// - Playback on a speaker: `play_url` of a server URL (LAN proxy, `proxy.ts`), served as a "file" of
//   known size — relay of the source's bytes, or fixed-frame MP3 fallback.
// - Queue per player: the speaker only ever knows one file; the queue watches its state to chain
//   on at the end of each track.
// - Transfer (office → living room) and LOCAL listening (the browser plays the file itself).
// - For whom: the request's account (`userOf`); a queue keeps that of whoever started it, its next
//   tracks are resolved and recorded under that account, whatever screen drives it afterwards.

export const musicConfigSchema = z.object({
  /** ffmpeg binary for the MP3 fallback (key shared with Nest / cameras). */
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  /**
   * Base URL published for Cast/Sonos (e.g. `http://192.168.1.10:8787`). Empty = derived from the
   * request (the browser's Host) — suited to the LAN. `YTM_PUBLISH_BASE` (old name) is still read.
   */
  MUSIC_PUBLISH_BASE: z.string().trim().default(''),
  YTM_PUBLISH_BASE: z.string().trim().default(''),
  /** The last listening of each player, resumed after a restart (`lastPlayed.ts`). */
  MUSIC_STATE_FILE: z.string().trim().default(stateFile('music.json')),
})
export type MusicConfig = z.infer<typeof musicConfigSchema>

/** A track as the UI sends it (`/play`, the queue): its source, its id, and what the catalog says about it. */
const trackSchema = z.object({
  source: z.string().trim().min(1),
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(512).optional(),
  artist: z.string().trim().min(1).max(512).optional(),
  artUrl: z.string().trim().min(1).max(2048).transform((u) => (u.startsWith('//') ? `https:${u}` : u))
    .pipe(z.string().url().refine((u) => /^https?:\/\//i.test(u), 'http or https only'))
    .optional(),
  /** Catalog duration, if the source gives none: it sets the size of the "file". */
  durationS: z.number().positive().optional(),
  /** What the catalog says about the song: the speaker itself will never know. */
  explicit: z.boolean().optional(),
  /** Start from there (s): resuming a long mix. */
  startS: z.number().min(0).optional(),
})
/** A playlist several hours long fits easily; beyond that, it is a caller error. */
const QUEUE_MAX = 1000

export interface MusicPlayerDeps {
  config?: Partial<MusicConfig>
  logger: Logger
  now?: () => number
  spawnImpl?: SpawnFn
  fetchImpl?: typeof fetch
  /** The registered sources (tests); otherwise the `sources.ts` registry. */
  source?: (id: string) => MusicSource | undefined
  /** Command to another plugin's player (tests); otherwise the `app.ts` bridge. */
  execute?: (deviceId: string, command: Command) => Promise<void>
  getDevice?: (deviceId: string) => { descriptor: { kind: string; capabilities: string[] }; state?: unknown } | undefined
  /** The states published by players (tests); otherwise the `app.ts` bridge. */
  onState?: (cb: (deviceId: string, state: unknown) => void) => () => void
  /** Where to keep the last listening (tests); otherwise `MUSIC_STATE_FILE`. */
  lastStore?: LastPlayedStore
  /** Public names (NAS proxy): a speaker cannot read the public address, which requires a session. */
  publicHosts?: string[]
}

export interface MusicPlayer {
  registerRoutes(app: FastifyInstance): void
  stop(): void
}

/** Common path of the player's routes. */
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
    if (isPublicRequest(req, deps.publicHosts ?? [])) {
      throw new PluginError('UPSTREAM_ERROR', 'MUSIC_PUBLISH_BASE required when the UI is opened through the public address (Cast/Sonos need the LAN IP)')
    }
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
    return `${proto}://${host}`
  }

  /** A track's source, registered and active; otherwise a clear error (plugin turned off meanwhile). */
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

  /** The player can receive `play_url`; otherwise the HTTP error to return. */
  function playableOrError(reply: FastifyReply, get: (id: string) => { descriptor: { kind: string; capabilities: string[] } } | undefined, deviceId: string) {
    const entry = get(deviceId)
    if (!entry) return { error: sendError(reply, 404, 'NOT_FOUND', `unknown device "${deviceId}"`) }
    if (entry.descriptor.kind !== 'media_player' || !entry.descriptor.capabilities.includes('play_url')) {
      return { error: sendError(reply, 400, 'UNSUPPORTED_COMMAND', 'device does not support play_url') }
    }
    return { entry }
  }

  /**
   * CURRENT position of the source in the song. The published reading dates from the last poll
   * (Sonos: up to 2 s): while it plays, the time elapsed since `updatedAt` is added — never more than
   * the real lag, since another state change would have refreshed it meanwhile.
   */
  function trackPosition(get: (id: string) => { state?: unknown } | undefined, session: ProxySession): number {
    const st = get(session.deviceId)?.state as { kind?: string; playback?: string; updatedAt?: number; nowPlaying?: { positionS?: number } } | undefined
    if (st?.kind !== 'media_player') return 0
    const pos = st.nowPlaying?.positionS ?? 0
    const sinceS = st.playback === 'playing' && typeof st.updatedAt === 'number' ? Math.max(0, (now() - st.updatedAt) / 1000) : 0
    return Math.max(0, pos + sinceS)
  }

  /** Opens a session for this player (the previous one of the same player is closed) and sends it `play_url`. */
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
    // The extension is not decorative: `streamLoad` (Sonos) derives from it the type announced in the DIDL.
    const streamUrl = `${base}${streamPath(session.sid, raw)}`
    await play(deviceId, streamUrl, meta)
    return { session, streamUrl }
  }

  /**
   * LOCAL playback: the tablet's (or phone's) browser plays the "file" itself. Its session carries a
   * player id `local:<browser id>` that is no device: no `play_url`, no published state, no queue on
   * the server side — the browser holds all of that.
   */
  const LOCAL_PREFIX = 'local:'
  const isLocal = (deviceId: string) => deviceId.startsWith(LOCAL_PREFIX)

  /** A transfer's target takes about a second to start: it is placed that much further on. */
  const TRANSFER_LEAD_S = 1

  /**
   * Seeking in the song right after `play_url`: the speaker has not necessarily finished loading, the
   * first command may be refused — we retry a little. The "file" having a size, the seek is its own
   * (byte range), accurate to the frame.
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
   * A session is "alive" only if the speaker plays (or has paused) OUR track: otherwise it outlives
   * what the speaker plays next (a radio started from Google Home), and the UI would have shown our
   * title, our duration, and transferred the wrong song. The speaker says so through its title: ours,
   * or nothing readable (stream identifier, URL: it knows no better). The first five seconds are
   * granted by default, the time for the speaker's state to follow the command.
   */
  function sessionActive(s: ProxySession): boolean {
    // a browser (`/local`) holds its playback itself: it is not a speaker's
    if (isLocal(s.deviceId)) return false
    if (now() - s.createdAt < 5_000) return true
    const { get } = resolvePlay()
    const st = get(s.deviceId)?.state as { kind?: string; playback?: string; nowPlaying?: { title?: string } } | undefined
    if (st?.kind !== 'media_player') return false
    if (st.playback !== 'playing' && st.playback !== 'paused') return false
    const t = st.nowPlaying?.title?.trim() ?? ''
    // a relay is named `<sid>.m4a`: the Sonos sometimes publishes this FILE NAME as the title
    if (!t || /^[0-9a-f]{24}(\.[a-z0-9]{2,4})?$/i.test(t) || /^https?:\/\//i.test(t)) return true
    return !!s.meta.title && t.toLowerCase() === s.meta.title.trim().toLowerCase()
  }

  // ---- starting a track ----------------------------------------------------------------------------

  /** Prepare the source then resolve; any error comes out as a `PluginError`. */
  async function resolveTrack(track: TrackRef, user: MusicUser): Promise<ResolvedStream> {
    const source = requireSource(track.source)
    try {
      await source.prepare?.(user)
      return await source.resolve(track.id, user)
    } catch (err) {
      if (err instanceof PluginError) throw err
      throw new PluginError('UPSTREAM_ERROR', (err as Error).message, { cause: err })
    }
  }

  /**
   * The next track of a queue, resolved WHILE the current one plays: resolution takes a few seconds,
   * which we don't want to hear between two songs. A googlevideo URL is good for ~6 h; we keep it
   * only an hour, a track not yet played after an hour will be resolved again.
   * Per account: a stream resolved with one account's credentials is not used for another.
   */
  const prefetched = new Map<string, { at: number; p: Promise<ResolvedStream> }>()
  const PREFETCH_TTL_MS = 3_600_000

  const prefetchKey = (track: TrackRef, user: MusicUser) => `${user ?? ''}|${trackKey(track)}`

  function prefetchUpcoming(q: RunningQueue): void {
    const next = upcoming(q)
    if (next) prefetchTrack(next, q.user)
  }

  function prefetchTrack(track: TrackRef, user: MusicUser): void {
    const key = prefetchKey(track, user)
    const hit = prefetched.get(key)
    if (hit && now() - hit.at < PREFETCH_TTL_MS) return
    const entry = { at: now(), p: resolveTrack(track, user) }
    // a failure is not kept: the start will retry for real, and say why
    entry.p.catch((err) => {
      if (prefetched.get(key) === entry) prefetched.delete(key)
      log.debug({ err, track: key }, 'music queue: prefetch failed')
    })
    prefetched.set(key, entry)
  }

  function takePrefetched(track: TrackRef, user: MusicUser): Promise<ResolvedStream> | undefined {
    const key = prefetchKey(track, user)
    const hit = prefetched.get(key)
    prefetched.delete(key)
    return hit && now() - hit.at < PREFETCH_TTL_MS ? hit.p : undefined
  }

  /** A relay's session is restarted as is (transfer, replayed track); otherwise the MP3 fallback. */
  function rawOf(s: ProxySession): { mime: string; sizeBytes: number; ext: string } | undefined {
    const ext = s.meta.source?.ext?.toLowerCase() ?? ''
    return s.raw && s.lengthBytes !== null && RAW_MIME[ext] ? { mime: s.mime, sizeBytes: s.lengthBytes, ext } : undefined
  }

  /** What the session keeps from a resolved track, and whether it can be relayed as is. */
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
    // RELAY BY DEFAULT: the source is already a file of exact size, splittable into ranges —
    // re-encoding it only loses quality. Two conditions: a container the speakers can play, and an
    // announced size (that is what makes it a "file"). Otherwise, fall back to the fixed-frame MP3,
    // which builds that size from the duration.
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

  /** Path of a session's "file", relative to the host (the relay carries the container's extension). */
  const streamPath = (sid: string, raw?: { ext: string }) => (raw
    ? `${MUSIC_PREFIX}/raw/${sid}.${raw.ext}`
    : `${MUSIC_PREFIX}/stream/${sid}`)

  /**
   * Resolve (or pick up the prepared resolution) then send `play_url`. `stillWanted` is re-read after
   * the resolution, which lasts several seconds: another command may have gone through meanwhile, and
   * this track must then no longer start (null).
   */
  async function startTrack(base: string, deviceId: string, track: QueueTrack, user: MusicUser, opts: { raw?: boolean; stillWanted: () => boolean }) {
    const source = requireSource(track.source)
    await source.prepare?.(user)
    // One of our streams is already playing there: pause it RIGHT AWAY, before the seconds of
    // resolution — the screen shows an hourglass, the speaker goes quiet, the new track replaces the
    // old one. Not `stop`: on a Cast it would close the app, which would have to be relaunched.
    // The pause is AWAITED before `play_url`: a track resolved ahead starts at once, and a pause
    // arriving after it left the new track paused at 0 s (seen on the "Bureau" Sonos).
    const { get, execute } = resolvePlay()
    const playing = (get(deviceId)?.state as { playback?: string } | undefined)?.playback === 'playing'
    const paused = proxy.forDevice(deviceId) && playing
      ? execute(deviceId, { type: 'media_player.pause' }).catch((err) => log.debug({ err }, 'music: pause before replace failed'))
      : Promise.resolve()

    const resolved = await (takePrefetched(track, user) ?? resolveTrack(track, user))
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

  // ---- queue ---------------------------------------------------------------------------------------

  /** A running queue: what it holds, and enough to see the current track finish. */
  interface RunningQueue extends PlayQueue {
    /** URL published to the speakers (derived from the request that created the queue). */
    base: string
    /** `false`: MP3 fallback forced for the whole queue. */
    raw?: boolean
    /** Proxy session of the current track; another session on this player = the queue is over. */
    sid: string | null
    /** Last playback position read, and when: enough to estimate where the track was when it stopped. */
    heard: { positionS: number; at: number } | null
    /** A track is starting (resolution, `play_url`, transfer): the player's states say nothing about the queue. */
    busy: boolean
    /** Who started it: their accounts resolve the tracks, their resume remembers the position. */
    user: MusicUser
  }
  const queues = new Map<string, RunningQueue>()
  /** Closer to the end than this, a player that stops has finished the track (Sonos read every 2 s). */
  const END_SLACK_S = 5
  /** Right after `play_url`, the Sonos spends a second stopped, and a reading in flight may still be about the previous track. */
  const SETTLE_MS = 3_000
  /** Previous beyond this playback time: back to the start of the track, as the Sonos plugin does. */
  const RESTART_AFTER_S = 3

  const queueView = (q: RunningQueue) => ({ items: q.items, index: q.index, repeat: q.repeat })

  // ---- last listening ------------------------------------------------------------------------------
  // Queues and sessions do not survive a restart: we keep on disk, per player, the queue, the current
  // track and the position reached. The bar shows its title paused, `/resume` restarts it from there.
  // Forgotten when the queue finishes on its own: there is nothing left to resume.
  const lastStore = deps.lastStore ?? createLastPlayedFile(cfg.MUSIC_STATE_FILE, log)
  let last: LastPlayedByDevice = {}
  const lastLoaded = lastStore.load()
    .then((v) => { last = { ...v, ...last } })
    .catch((err) => log.warn({ err }, 'music: last played state unreadable'))
  /** A position arrives with every speaker reading: to disk at most every 15 s. */
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
      // resuming a mix applies to its first start: `startS` is not kept
      items: q.items.map(({ startS: _startS, ...t }) => t),
      index: q.index, repeat: q.repeat, positionS: Math.max(0, positionS), durationS: durationS ?? null, at: now(),
    }
    saveLast(true)
  }
  /** A session without a queue (listening arrived from a browser without its own): the track as it plays. */
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
  /** The queue changed (addition, removal, repeat) without the track changing: the position stays. */
  function rememberQueue(deviceId: string, q: PlayQueue): void {
    const prev = last[deviceId]
    if (prev) remember(deviceId, q, prev.positionS, prev.durationS ?? undefined)
  }

  /** A player's queue, as long as its current track is indeed the one the speaker plays. */
  function liveQueue(deviceId: string): RunningQueue | undefined {
    const q = queues.get(deviceId)
    if (!q) return undefined
    const s = proxy.forDevice(deviceId)
    if (q.busy || (s && s.sid === q.sid && sessionActive(s))) return q
    return undefined
  }

  let unwatch: (() => void) | null = null
  /** Subscribe to the players' states at the first queue (not at startup: the bridge is not wired yet). */
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
   * End of track: no player announces it, the state simply goes to `idle` (Sonos STOPPED at the end
   * of the file, Cast IDLE). It is recognized by the position: starting from where it was last heard
   * playing, it must have reached the duration. An `idle` mid-song (intended stop, pause of a stream
   * that the Sonos turns into Stop) leaves the queue waiting, without moving on.
   */
  function onPlayerState(deviceId: string, state: unknown): void {
    const q = queues.get(deviceId)
    if (!q || q.busy) return
    const s = q.sid ? proxy.get(q.sid) : undefined
    if (!s || proxy.forDevice(deviceId)?.sid !== s.sid) {
      // our stream was replaced (another `play`) or closed (TTL): the queue goes with it
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
      // A state republished for something else (volume) keeps the OLD position: only re-date it if it
      // moved, otherwise the estimate at the stop would start from too early.
      const pos = st.nowPlaying?.positionS
      if (typeof pos === 'number' && pos !== q.heard?.positionS) {
        // resume after a pause, or a jump within the song: an action, written right away
        const expected = q.heard ? q.heard.positionS + (now() - q.heard.at) / 1000 : null
        const acted = expected === null || Math.abs(pos - expected) > END_SLACK_S
        q.heard = { positionS: pos, at: now() }
        sourceOf(s.track.source)?.onProgress?.(s.track.id, pos, s.meta.durationS, false, q.user)
        const mine = last[deviceId]
        if (mine) {
          mine.positionS = pos
          mine.at = now()
          saveLast(acted)
        }
      } else if (!q.heard) q.heard = { positionS: 0, at: now() }
      return
    }
    // paused: the position where we stopped, written right away
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
    sourceOf(s.track.source)?.onProgress?.(s.track.id, dur, dur, true, q.user)
    void advance(deviceId, q)
  }

  /** Chain on after the end of a track. A track that does not start is skipped, three times in a row at most. */
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
   * Play track `index` of the queue. The same track replayed (repeat) restarts from the stream already
   * resolved: the source URL is still good, no new resolution.
   */
  async function playAt(deviceId: string, q: RunningQueue, index: number, repeat: RepeatMode) {
    const track = q.items[index]!
    const stillWanted = () => queues.get(deviceId) === q
    q.busy = true
    try {
      const current = q.sid ? proxy.get(q.sid) : undefined
      const started = current && index === q.index && sameTrack(current.track, track)
        ? await launch(q.base, current.track, deviceId, current.sourceUrl, current.meta, rawOf(current))
        : await startTrack(q.base, deviceId, track, q.user, { ...(q.raw === false ? { raw: false } : {}), stillWanted })
      if (!started || !stillWanted()) return null
      Object.assign(q, { index, repeat, sid: started.session.sid, heard: null })
      remember(deviceId, q, track.startS ?? 0, started.session.meta.durationS)
      if (track.startS && track.startS > 1 && started.session.lengthBytes !== null) {
        await seekWhenReady(deviceId, track.startS)
          .catch((err) => log.warn({ err, deviceId, startS: track.startS }, 'music: resume seek failed, playing from start'))
      }
      // the resume applies only once: replayed (repeat, previous), the track starts from the beginning
      if (track.startS !== undefined) q.items[index] = { ...track, startS: undefined }
      prefetchUpcoming(q)
      return started
    } finally {
      q.busy = false
    }
  }

  /** New queue on this player (the old one is replaced), which plays `tracks[startIndex]`. */
  async function playQueue(reply: FastifyReply, base: string, deviceId: string, tracks: QueueTrack[], startIndex: number, user: MusicUser, raw?: boolean) {
    for (const t of tracks) requireSource(t.source)
    const q: RunningQueue = {
      items: tracks, index: startIndex, repeat: 'off', base,
      ...(raw === false ? { raw: false } : {}),
      sid: null, heard: null, busy: false, user,
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

  /** Content type of a source stream relayed as is (the container decides, not the codec). */
  const RAW_MIME: Record<string, string> = { m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', opus: 'audio/ogg' }

  const sessionView = (s: ProxySession) => ({
    deviceId: s.deviceId, source: s.track.source, id: s.track.id, sid: s.sid,
    durationS: s.meta.durationS ?? null, title: s.meta.title ?? null, artist: s.meta.artist ?? null, artUrl: s.meta.artUrl ?? null,
    // What the speaker receives from US, and what we receive from the source: enough to judge by eye
    // what the chain is worth, without opening the log.
    quality: {
      mime: s.mime,
      // relay: what the proxy serves IS what the source gave, there is no output of our own anymore
      bitrateKbps: s.raw ? s.meta.source?.abrKbps ?? null : OUT_BITRATE_KBPS,
      sampleRateHz: s.raw ? null : OUT_SAMPLE_RATE_HZ,
      channels: s.raw ? null : OUT_CHANNELS,
      lengthBytes: s.lengthBytes,
      source: s.meta.source ?? null,
    },
    // enough to gray out previous / next and show the repeat without opening the queue
    queue: (() => {
      const q = queues.get(s.deviceId)
      return q && q.sid === s.sid ? { length: q.items.length, index: q.index, repeat: q.repeat } : null
    })(),
  })

  function registerRoutes(app: FastifyInstance) {
    // A single track is a one-track queue: the repeat applies to it too, and the same mechanism
    // starts it.
    app.post<{ Body: unknown }>('/play', async (req, reply) => {
      const body = trackSchema.extend({
        deviceId: z.string().trim().min(1),
        /**
         * By default the source stream is RELAYED as is; `false` forces MP3 re-encoding (escape hatch
         * if a player chokes on the original container).
         */
        raw: z.boolean().optional(),
      }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'source, id and deviceId are required')
      const { deviceId, raw, ...track } = body.data
      const target = playableOrError(reply, resolvePlay().get, deviceId)
      if ('error' in target) return target.error
      const started = await playQueue(reply, publishBase(req), deviceId, [track], 0, userOf(req), raw)
      if ('error' in started) return started.error
      return { ok: true as const, streamUrl: started.streamUrl, sid: started.session.sid }
    })

    // LOCAL playback: the browser plays the "file" itself (same relay as the speakers), and holds its
    // queue. The returned path is relative: it is the browser talking to the server, not a speaker on
    // the network. `next`: the track that will follow, resolved ahead during listening.
    app.post<{ Body: unknown }>('/local', async (req, reply) => {
      const body = trackSchema.extend({
        clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
        next: z.object({ source: z.string().trim().min(1), id: z.string().trim().min(1) }).optional(),
      }).safeParse(req.body)
      if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'source, id and clientId are required')
      const { clientId, next, ...track } = body.data
      requireSource(track.source)
      const user = userOf(req)
      const resolved = await (takePrefetched(track, user) ?? resolveTrack(track, user))
      const { meta, raw } = describeResolved(track, resolved)
      const session = proxy.open(track, `${LOCAL_PREFIX}${clientId}`, resolved.url, meta, raw)
      if (next && sourceOf(next.source)) prefetchTrack(next, user)
      log.info({ source: track.source, id: track.id, clientId, mode: raw ? `relay ${raw.ext}` : 'mp3' }, 'music local playback opened')
      return { ok: true as const, streamUrl: streamPath(session.sid, raw), session: sessionView(session), ...(track.startS ? { startS: track.startS } : {}) }
    })

    // ---- queue --------------------------------------------------------------------------------
    // It lives here, per player: the speaker only ever knows one "file". Previous and next go through
    // these routes, not through `media_player.next` — the speaker would have nothing to skip.

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
      const started = await playQueue(reply, publishBase(req), deviceId, tracks, startIndex, userOf(req), raw)
      if ('error' in started) return started.error
      return { ok: true as const, streamUrl: started.streamUrl, sid: started.session.sid, queue: queueView(started.queue) }
    })

    app.get<{ Querystring: { deviceId?: string } }>('/queue', async (req, reply) => {
      const q = liveQueue(req.query.deviceId ?? '')
      if (!q) return sendError(reply, 404, 'NOT_FOUND', 'no music queue on this player')
      return queueView(q)
    })

    /** Add without interrupting: right after the current track, or at the end. Nothing playing? It starts right away. */
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
        const started = await playQueue(reply, publishBase(req), deviceId, tracks, 0, userOf(req))
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

    /** Previous: to the start of the track after a few seconds of playback (like a living-room player), otherwise the track before. */
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

    /** Play a track picked in the queue. */
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

    /** Clear the queue: the current track carries on, alone, nothing follows it. */
    app.delete<{ Querystring: { deviceId?: string } }>('/queue', async (req, reply) => {
      const q = liveQueue(req.query.deviceId ?? '')
      if (!q) return sendError(reply, 404, 'NOT_FOUND', 'no music queue on this player')
      q.items = [q.items[q.index]!]
      q.index = 0
      rememberQueue(req.query.deviceId ?? '', q)
      return queueView(q)
    })

    /**
     * Where a track played in a BROWSER (`/local`) stands: no speaker publishes its state, the browser
     * says it, now and then and at the end — for resuming a mix, as on a speaker.
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
      sourceOf(source)?.onProgress?.(id, positionS, durationS, ended === true, userOf(req))
      return { ok: true as const }
    })

    /** What our players are playing from us right now: title, duration and transfer on the UI side. */
    app.get('/sessions', async () => ({ sessions: proxy.list().filter(sessionActive).map(sessionView) }))

    /**
     * The last listening of the players that play nothing from us right now: enough to show the
     * interrupted track (server restart, stop) paused at its position.
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

    /** Restart a player's last listening, its queue included, at its position (or at `positionS`). */
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
      // restarting is starting: with the accounts of whoever restarts, not of whoever was listening before
      const started = await playQueue(reply, publishBase(req), deviceId, tracks, entry.index, userOf(req))
      if ('error' in started) return started.error
      started.queue.repeat = entry.repeat
      rememberQueue(deviceId, started.queue)
      return { ok: true as const, streamUrl: started.streamUrl, sid: started.session.sid, queue: queueView(started.queue) }
    })

    // Transfer: the track `from` plays restarts on `to` (same "file"), the target seeks to the position
    // `from` was at (read from the player's published state), then `from` stops. No new resolution:
    // the URL of the session's source is still good.
    //
    // A browser (`local:…`) can be either end. Source: it has no published state, it gives its
    // position and its queue (`positionS`, `queue`), and stops itself. Target: nothing to start, the
    // response gives it the file path, the position and the queue it takes over.
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

      // the queue follows the track: it reacts to nothing during the transfer (the source is about to
      // stop mid-song, it is not the end of a track)
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
          // the browser now holds the listening: the speaker has nothing left to resume
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
        // the source only stops once the target is started: a failure leaves the music where it was
        // (a browser stops itself, on the response)
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
          // the browser's queue moves to the server: it is the one that will chain on the speaker
          const { tracks, index, repeat } = body.data.queue
          queues.set(toDeviceId, { items: tracks, index, repeat, base, sid: session.sid, heard: null, busy: false, user: userOf(req) })
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
     * Headers of the "file": announced size and accepted ranges when the duration is known; otherwise
     * a live stream without a size (live). `connection: close`: one connection per ffmpeg service.
     */
    const fileHeaders = (session: ProxySession): Record<string, string> => ({
      'content-type': session.mime,
      'cache-control': 'no-store',
      connection: 'close',
      ...(session.lengthBytes !== null
        ? { 'accept-ranges': 'bytes', 'content-length': String(session.lengthBytes) }
        : { 'accept-ranges': 'none' }),
    })

    // Players probe the file with HEAD (size, ranges): answer without starting ffmpeg — otherwise
    // Fastify derives HEAD from GET and would run the whole handler, stream included.
    app.head<{ Params: { sid: string } }>('/stream/:sid', async (req, reply) => {
      const session = proxy.get(req.params.sid)
      if (!session) return sendError(reply, 404, 'NOT_FOUND', 'stream session expired or unknown')
      log.debug({ sid: session.sid, deviceId: session.deviceId, ua: req.headers['user-agent'] ?? null }, 'music stream HEAD')
      reply.hijack()
      reply.raw.writeHead(200, fileHeaders(session))
      reply.raw.end()
    })

    /**
     * Relay WITHOUT re-encoding: the source announces an exact size and accepts ranges — the "file"
     * the MP3 builds, it already provides. The bytes are passed through, forwarding the range requested
     * by the speaker. The URL extension (`.m4a`) makes the Sonos announce `audio/mp4`.
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
      // `debug`: a Sonos reads the file in 6 KB ranges, i.e. one request per fraction of a second — at
      // `info`, these lines drowned the log. Starting a track, on the other hand, stays at `info`.
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
      // The player cuts whenever it wants (pause, track change, end of probe): we then stop pulling on
      // the source. TRAP: aborting makes the stream emit an AbortError; without an error listener,
      // Node raises it as an unhandled exception and the SERVER goes down.
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

      // Byte range → instant at which to start ffmpeg (to the frame), bytes of the first frame to skip,
      // and number of bytes promised. Without a known duration: everything, from the start, no size.
      const range = session.lengthBytes !== null ? parseRange(req.headers.range, session.lengthBytes) : null
      const start = range?.start ?? 0
      const end = range?.end ?? (session.lengthBytes !== null ? session.lengthBytes - 1 : null)
      const { startS, skipBytes } = seekFor(start)
      const headers = fileHeaders(session)
      if (range && session.lengthBytes !== null) {
        headers['content-range'] = `bytes ${range.start}-${range.end}/${session.lengthBytes}`
        headers['content-length'] = String(range.end - range.start + 1)
      }
      // `debug`, like the relay: one line per range requested by the speaker
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
      // the most recent position, not the one from 15 s ago
      if (lastTimer) {
        clearTimeout(lastTimer)
        lastTimer = undefined
        void lastLoaded.then(() => lastStore.save(last)).catch((err) => log.warn({ err }, 'music: last played state not saved'))
      }
      proxy.clear()
    },
  }
}
