import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import type { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { readdir, readFile, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'
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

// Google Nest plugin (cameras, doorbells, displays with a camera, thermostats) through the Smart
// Device Management cloud API. There is NO local API: nothing to discover on the LAN, everything
// goes through the Google account.
//
// Setup, in two steps like Hue and TaHoma:
//  1. on the Google side (once, by the user, outside Kasbah): Device Access project + OAuth client
//     → NEST_PROJECT_ID, NEST_CLIENT_ID, NEST_CLIENT_SECRET in .env;
//  2. on the Kasbah side: without NEST_REFRESH_TOKEN the plugin is in `needs_pairing` and offers to
//     link the account (GET /auth/url → Google consent → GET /auth/callback). The token obtained is
//     adopted IN MEMORY and returned to the user so they can paste it into .env: the server never
//     writes .env.
//
// Cameras have neither commands (the API cannot turn them off) nor state beyond their presence;
// their events will come later (Pub/Sub). The thermostat, however, has a state and two commands;
// since the API pushes nothing without Pub/Sub, the device list is read again at a slow rate
// (NEST_POLL_MS, one minute by default: Google caps calls at a few per minute), which also follows
// devices being added and removed.
//
// Video: the whole device set is RTSP (1st-generation cameras), which no browser plays. Google opens
// an RTSP session on demand (`GenerateRtspStream`, five minutes, extendable), one ffmpeg relay per
// watched camera remuxes it into fragmented MP4 (`core/video/rtsp-relay.ts`), and the WebSocket
// route `/cameras/<id>/stream` distributes it to the screens. Nobody watching anymore → the Google
// session is stopped: nothing justifies leaving it running.

/**
 * Optional key whose EMPTY value counts as "absent": `.env.example` lists the keys to fill in, and a
 * `NEST_REFRESH_TOKEN=` line left empty while waiting for the linking must not disable the plugin
 * (that is what happened with `min(1)`: invalid config → `disabled`, without saying anything useful).
 */
const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const nestConfigSchema = z.object({
  /** Id (UUID) of the Device Access project — not the Google Cloud project. */
  NEST_PROJECT_ID: optionalKey,
  NEST_CLIENT_ID: optionalKey,
  NEST_CLIENT_SECRET: optionalKey,
  NEST_REFRESH_TOKEN: optionalKey,
  /** Must be declared as is in the Google OAuth client ("Authorized redirect URIs"). */
  NEST_REDIRECT_URI: z.string().url().default('http://localhost:8787/api/plugins/nest/auth/callback'),
  /** Rate for re-reading the device list (thermostat state, additions / removals). */
  NEST_POLL_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
  /** ffmpeg binary of the video relay (in the PATH, or full path). Shared key, not prefixed with NEST_. */
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  /**
   * RTSP sessions open at the same time, at most (live streams watched + thumbnails of the Cameras
   * view). THAT is what costs — a Google session, an ffmpeg, 1 to 2 Mbit/s per camera — not the
   * image rate. Below the number of cameras, the thumbnails rotate.
   */
  NEST_LIVE_BUDGET: z.coerce.number().int().min(1).max(32).default(10),
  /** Thumbnail rate of the Cameras view (one JPEG image per camera whose session is open). */
  NEST_SNAPSHOT_MS: z.coerce.number().int().min(2000).max(120_000).default(10_000),
  /** "Pull" Pub/Sub subscription to pull the events from (doorbell…). Absent → no events. */
  NEST_PUBSUB_SUBSCRIPTION: optionalKey,
  /** Pull rate of the Pub/Sub subscription. A ring arrives at the latest on the next pull. */
  NEST_PUBSUB_POLL_MS: z.coerce.number().int().min(1000).max(60_000).default(5000),
})
export type NestConfig = z.infer<typeof nestConfigSchema>

/** Google expires an RTSP session after five minutes: we extend before that. */
const STREAM_EXTEND_MS = 4 * 60_000
/** Maximum messages pulled per Pub/Sub call. */
const PUBSUB_MAX_MESSAGES = 20
/** A relay without subscribers waits this long before stopping the session (view change, reconnection). */
const STREAM_IDLE_MS = 8000
/**
 * A started stream without a fragment for this long is stalled (five groups of pictures of the
 * doorbell): the session is closed, and the rotation tries again — a camera gone from the network
 * then shows as inactive within seconds instead of freezing until Google's five-minute deadline.
 */
const STREAM_STALL_MS = 20_000
/** Beyond this send backlog, a screen is no longer keeping up: we skip fragments rather than pile them up. */
const WS_MAX_BUFFERED = 8 << 20
/** Video stream ping: two beats without a pong and the screen is considered gone. */
const WS_HEARTBEAT_MS = 30_000

/** The Cameras view checks in every 5 s; with no news from anyone during this delay, the thumbnails stop. */
const GRID_WATCH_TTL_MS = 15_000
const GRID_TICK_MS = 8000
/** Rotation (budget < number of cameras): how long a camera stays before giving up its slot. */
const GRID_DWELL_MS = 20_000
/** Width of the JPEG thumbnails. */
const SNAPSHOT_WIDTH = 480
/**
 * Thumbnails live in memory; the disk only gets the last image of each camera — when its session
 * closes, every five minutes while it runs, and when the plugin stops — so that a restart shows it
 * again. One image every 10 s per camera rewritten on disk was what this avoids.
 */
const SNAPSHOT_SAVE_MS = 5 * 60_000
/**
 * A camera whose stream fails (off, on standby: Google gives the URL, its server answers 404) is not
 * retried right away — otherwise the rotation would ask for it again every 5 s and exhaust the
 * Google quota. Wait doubled on each failure, capped.
 */
const GRID_RETRY_MIN_MS = 3 * 60_000
const GRID_RETRY_MAX_MS = 15 * 60_000
/**
 * Google limits commands to about ten per minute and per user (observed: nine openings at once then
 * retries earned a "Rate limited" on ALL commands, the list included). So ONE opening per 8 s tick —
 * ten cameras in 80 s, then nothing but the extensions — and a global pause as soon as Google
 * complains.
 */
const GRID_OPEN_PER_TICK = 1
const GRID_RATE_LIMIT_PAUSE_MS = 90_000

/** `gotImage`: the session has given a thumbnail — until then, the Cameras view says it is updating. */
interface StreamSession { relay: RtspRelay; url: string; extensionToken: string; extendTimer: unknown; gotImage: boolean }
/** The Cameras view's hold on a session: a silent subscriber keeping it open for the time of a thumbnail. */
interface GridHold { since: number; hold: RelaySubscriber }
/** Camera whose stream failed: from when to retry, and how many failures in a row. */
interface GridFailure { retryAt: number; failures: number; reason: string }
/** A camera's last thumbnail, and the date of the one last saved to disk (`undefined`: never). */
interface Snapshot { jpeg: Buffer; at: number; savedAt?: number }

export interface NestPluginDeps {
  /** Injection for tests (simulated fetch). */
  fetchImpl?: FetchLike
  /** Injection for tests: request timeout. */
  requestTimeoutMs?: number
  /** Injection for tests: the anti-CSRF `state` of the OAuth linking. */
  randomState?: () => string
  /** Injection for tests: replaces launching ffmpeg. */
  spawnImpl?: typeof spawn
}

export function createNestPlugin(deps: NestPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: NestConfig | null = null
  let client: NestClient | null = null
  /** Devices kept (cameras and thermostats), by externalId, in their last received form. */
  let entries = new Map<string, SdmDevice>()
  let descriptors: DeviceDescriptor[] = []
  /** Last setpoint published outside off and eco, per thermostat: Google hides it when off. */
  const lastSetpoint = new Map<string, number>()
  /** API devices that are neither camera nor thermostat: ignored but counted. */
  let ignored = 0
  /** Last raw response of the list, to capture a real fixture. */
  let lastRaw: unknown = undefined
  let lastError: string | null = null
  let poller: { stop(): void } | null = null
  let eventsPoller: { stop(): void } | null = null
  /** Open video sessions, by externalId: an ffmpeg relay and the token that extends the Google session. */
  const streams = new Map<string, StreamSession>()
  /** Openings in progress, so that a simultaneous second request joins the first. */
  const opening = new Map<string, Promise<RtspRelay>>()
  /** Cameras view: until when someone is watching it, and the sessions it holds for its thumbnails. */
  let gridWantedUntil = 0
  const gridHeld = new Map<string, GridHold>()
  /** Last time a camera gave up its slot: breaks rotation ties when no thumbnail has a date. */
  const gridReleasedAt = new Map<string, number>()
  const gridFailed = new Map<string, GridFailure>()
  /** Google answered "Rate limited": no thumbnail opening before this date. */
  let gridCooldownUntil = 0
  /** Cameras whose thumbnail the user stopped from the view (stop button): out of rotation until resumed. */
  const gridPaused = new Set<string>()
  let gridTimer: unknown = null
  /** Last thumbnail of each camera, by externalId: in memory, saved to disk now and then. */
  const snapshots = new Map<string, Snapshot>()
  let snapshotSaveTimer: unknown = null
  /** Folder where the last thumbnail of each camera outlives the server (file date = image date). */
  const snapshotDir = join(tmpdir(), 'kasbah-nest-snapshots')
  const snapshotPath = (externalId: string) => join(snapshotDir, `${externalId}.jpg`)
  /** `state`s issued by /auth/url and expected on return: a linking is only accepted if we started it. */
  const pendingStates = new Set<string>()
  const randomState = deps.randomState ?? (() => randomBytes(16).toString('hex'))

  const log = () => ctx!.logger
  const ready = (): NestClient => {
    if (!client) throw new PluginError('NEEDS_PAIRING', 'Google Device Access is not configured (NEST_PROJECT_ID, NEST_CLIENT_ID, NEST_CLIENT_SECRET)')
    if (!client.linked) throw new PluginError('NEEDS_PAIRING', 'no Google account linked: open /api/plugins/nest/auth/url')
    return client
  }

  /** Reads the device list again and rebuilds the descriptors. True if the inventory changed. */
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

  /** Publishes the state of ONE device: presence for a camera, full state for a thermostat. */
  function emitOne(externalId: string, device: SdmDevice): void {
    if (isThermostat(device)) {
      const patch = toClimatePatch(device, lastSetpoint.get(externalId))
      if (patch?.targetTempC !== undefined && patch.mode !== 'off' && patch.mode !== 'eco') lastSetpoint.set(externalId, patch.targetTempC)
      if (patch) ctx!.emitState(externalId, patch)
      ctx!.setAvailable(externalId, thermostatAvailable(device))
    } else {
      ctx!.emitState(externalId, {})                    // even empty, the patch marks the device available
    }
  }

  function emitAll(): void {
    for (const [externalId, device] of entries) emitOne(externalId, device)
  }

  /** One re-read pass: inventory (republished if it changes) then states. */
  async function tick(): Promise<void> {
    try {
      if (await refresh()) ctx!.emitDevices(descriptors)
      emitAll()
    } catch (err) {
      lastError = (err as Error).message
      throw err                                         // the poller logs and applies its backoff
    }
  }

  function startPolling(): void {
    if (poller || !config) return
    poller = createPoller({
      name: 'nest-devices', intervalMs: config.NEST_POLL_MS, fn: tick,
      clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
    })
  }

  /** Pub/Sub loop: pulls the events, pushes the doorbell to the clients, acknowledges. Optional. */
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
      // Doorbell first: we only push 'chime'. Motion/person/sound are decoded but not exposed yet
      // (they would spam a client that does nothing with them) — a single `if` to open up later.
      for (const kind of parsed.kinds) {
        if (kind !== 'chime') continue
        log().info({ externalId: parsed.externalId, event: kind }, 'nest event')
        ctx!.emitEvent(parsed.externalId, kind)
      }
    }
    // acknowledge EVERYTHING pulled (even the ignored events), otherwise Google redelivers them in a loop
    await ready().acknowledge(sub, msgs.map((m) => m.ackId), ctx!.signal)
  }

  /**
   * Opens (or joins) the video session of an RTSP camera. Two screens arriving at the same time (or
   * one screen connecting twice, seen for real) must share the SAME opening: without `opening`, each
   * asked Google for its own session and the second overwrote the first in `streams`, whose ffmpeg
   * and extension timer then ran forever.
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
      idleGraceMs: STREAM_IDLE_MS, stallMs: STREAM_STALL_MS, onIdle: () => void closeStream(externalId, 'no viewer left'),
      onEnded: (reason) => void closeStream(externalId, `relay ended: ${reason}`),
      snapshot: {
        intervalMs: config!.NEST_SNAPSHOT_MS, width: SNAPSHOT_WIDTH,
        onImage: (jpeg) => {
          snapshots.set(externalId, { jpeg, at: ctx!.clock.now(), savedAt: snapshots.get(externalId)?.savedAt })
          gridFailed.delete(externalId)                 // an image proves it streams, whoever opened the session (a live view too)
          const session = streams.get(externalId)
          if (session?.relay === relay) session.gotImage = true
        },
      },
      ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
    })
    const session: StreamSession = { relay, url: started.streamUrls.rtspUrl, extensionToken: started.streamExtensionToken, extendTimer: null, gotImage: false }
    // Extending is not enough: Google cuts the RTSP connection at the INITIAL deadline (observed:
    // frozen thumbnails then ffmpeg at end of stream right at `expiresAt`, extension or not). The new
    // `streamToken` is used to reopen the connection, and the relay switches to it without a gap.
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

  /** Closes the video session: relay stopped, Google session released. */
  async function closeStream(externalId: string, reason: string): Promise<void> {
    const session = streams.get(externalId)
    if (!session) return
    streams.delete(externalId)
    ctx!.clock.clearInterval(session.extendTimer)
    const started = session.relay.ready
    session.relay.stop(reason)
    log().info({ externalId, reason }, 'rtsp stream closed')
    await saveSnapshot(externalId)                      // the image that stays on screen from now on
    // A session whose stream never started (camera off: Google gives the URL, its server answers
    // 404) has nothing to release — and each command counts in Google's per-minute quota, which seven
    // cameras that are off, restarted together, are enough to exhaust. It expires on its own in five minutes.
    if (!started) return
    try { await client?.stopRtspStream(externalId, session.extensionToken, ctx!.signal) }
    catch (err) { log().debug({ err }, 'StopRtspStream failed (the session expires by itself)') }
  }

  // ---- Cameras view thumbnails --------------------------------------------------------------
  // The view checks in every 5 s (`GET /cameras/snapshots?watch=1`). As long as it does, the plugin
  // keeps sessions open for the RTSP cameras, within the budget, and each relay writes its JPEG
  // thumbnail. Watched live streams count in the budget; if it does not cover all the cameras, the
  // thumbnails rotate: the camera held the longest gives its slot to the one with the oldest
  // thumbnail.

  function rtspCameraIds(): string[] {
    return [...entries].filter(([, d]) => isCamera(d) && streamProtocols(d).includes('rtsp')).map(([id]) => id)
  }

  /** Date of a camera's thumbnail, or `undefined` without a thumbnail. */
  const snapshotAt = (externalId: string): number | undefined => snapshots.get(externalId)?.at

  /** Writes a camera's last thumbnail to disk if it changed since the last save; never throws. */
  async function saveSnapshot(externalId: string): Promise<void> {
    const s = snapshots.get(externalId)
    if (!s || s.savedAt === s.at) return
    s.savedAt = s.at                                    // before writing: a second call meanwhile has nothing to do
    try {
      await writeFileAtomic(snapshotPath(externalId), s.jpeg)
      await utimes(snapshotPath(externalId), new Date(s.at), new Date(s.at))
    } catch (err) { log().warn({ err, externalId }, 'thumbnail not saved to disk') }
  }

  const saveSnapshots = () => Promise.all([...snapshots.keys()].map(saveSnapshot))

  /** Thumbnails left by the previous run, back in memory with the date of their image. */
  async function loadSnapshots(): Promise<void> {
    let names: string[]
    try { names = await readdir(snapshotDir) } catch { return }
    await Promise.all(names.filter((n) => n.endsWith('.jpg')).map(async (name) => {
      const externalId = name.slice(0, -'.jpg'.length)
      try {
        const [jpeg, info] = await Promise.all([readFile(join(snapshotDir, name)), stat(join(snapshotDir, name))])
        const at = Math.round(info.mtimeMs)
        if (!snapshots.has(externalId)) snapshots.set(externalId, { jpeg, at, savedAt: at })
      } catch { /* gone meanwhile */ }
    }))
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
      // end BEFORE the first image: the camera is not streaming (off, on standby), we do not insist
      else if (msg.kind === 'ended' && !gotInit) { gridHeld.delete(externalId); gridFailure(externalId, msg.reason) }
    }
    gridHeld.set(externalId, { since: ctx!.clock.now(), hold })
    openStream(externalId)
      .then((relay) => { if (gridHeld.get(externalId)?.hold === hold) relay.subscribe(hold) })
      .catch((err) => {
        gridHeld.delete(externalId)
        // a quota refusal is not the camera's fault: pause for everyone, no failure count
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
    streams.get(externalId)?.relay.unsubscribe(h.hold)   // without another subscriber, the relay closes after the grace period
  }

  async function gridTick(): Promise<void> {
    const now = ctx!.clock.now()
    if (now > gridWantedUntil) {
      for (const id of [...gridHeld.keys()]) releaseGrid(id)
      if (gridTimer !== null) { ctx!.clock.clearInterval(gridTimer); gridTimer = null }
      return
    }
    // a hold whose relay is dead has nothing left to hold
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
    // Order, with one opening per tick (Google quota):
    //  0. cameras that have a thumbnail but have not yet been given back by the rotation: those of a
    //     previous run (server restart) or whose session died — we KNOW they are streaming. Without
    //     this rank, after a restart the six cameras that were off (no thumbnail, hence "oldest")
    //     went first, and the three active ones showed an image several minutes old while we waited
    //     for them. NEWEST image first within this rank: since the last images are kept on disk,
    //     every camera has one, and a camera off for days (an image days old) went before the one
    //     that streamed a minute ago — seen for real, the only active camera came last, 70 s in;
    //  1. never tried;
    //  2. given back by the rotation (oldest image first);
    //  3. failed, whose delay has just expired — six cameras that are off to retry would otherwise
    //     make the only working one wait more than a minute (seen: "82 s ago" on an active camera).
    const dated = candidates.map((id) => {
      const at = snapshotAt(id), released = gridReleasedAt.get(id)
      const tier = gridFailed.has(id) ? 3 : released !== undefined ? 2 : at !== undefined ? 0 : 1
      return [id, tier, Math.max(at ?? 0, released ?? 0)] as const
    })
    dated.sort((a, b) => a[1] - b[1] || (a[1] === 0 ? b[2] - a[2] : a[2] - b[2]))
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
      config = c.config as NestConfig                    // already validated/transformed by the host
      if (!config.NEST_PROJECT_ID || !config.NEST_CLIENT_ID || !config.NEST_CLIENT_SECRET) return
      mkdirSync(snapshotDir, { recursive: true })
      await loadSnapshots()
      snapshotSaveTimer = c.clock.setInterval(() => void saveSnapshots(), SNAPSHOT_SAVE_MS)
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
      // A failure here (Google quota exhausted, network) must not doom the plugin until the next
      // restart: we start anyway, `health` says why the list is empty, and the polling retries — the
      // inventory is published as soon as it goes through.
      try { await refresh() }
      catch (err) { lastError = (err as Error).message; log().warn({ err }, 'Nest device list unavailable at start') }
      return descriptors
    },

    async start() {
      if (!client?.linked) return
      emitAll()                                          // `discover` has just filled the entries
      startPolling()                                     // the first tick reads the list again right away: that is the price of a simple poller
      startEvents()                                      // Pub/Sub events (doorbell) if a subscription is configured
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
      // Google has acknowledged; we read the device again to publish what it KEPT (rounding,
      // effective mode) rather than what we asked for — a once-a-minute poll would leave the UI behind.
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
      if (snapshotSaveTimer !== null) { ctx?.clock.clearInterval(snapshotSaveTimer); snapshotSaveTimer = null }
      await saveSnapshots()
      client = null
    },

    registerRoutes(app: FastifyInstance) {
      // Link to open in a browser to link the Google account to the Device Access project.
      app.get('/auth/url', async (_req, reply) => {
        if (!client) return sendError(reply, 409, 'NEEDS_PAIRING', 'set NEST_PROJECT_ID, NEST_CLIENT_ID and NEST_CLIENT_SECRET first')
        const state = randomState()
        pendingStates.add(state)
        return { url: client.authorizationUrl(state), redirectUri: config!.NEST_REDIRECT_URI }
      })

      // Return from Google after consent: the code is exchanged for the refresh token.
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
          startPolling()                                 // the plugin had started without an account: polling starts now
          return reply.type('text/html; charset=utf-8').send(linkedPage(refreshToken, descriptors.length, ignored))
        } catch (err) {
          lastError = (err as Error).message
          const d = describeError(err)
          return sendError(reply, d.status, d.code, d.message)
        }
      })

      // A camera's video stream: a JSON header line (codecs), then the MP4 header and the fragments
      // as binary. Each fragment starts with a keyframe: a screen arriving midway decodes from the
      // first one, and a screen that is too slow can skip some.
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
        // a screen that disappears without closing (Wi-Fi cut) would leave the Google session and
        // ffmpeg running: ping every 30 s, and we cut if the pong does not come back
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

      // Cameras view thumbnails: the date of each, and `watch=1` to signal that someone is watching
      // (it is what keeps the sessions open; without a signal for 15 s, they close).
      app.get<{ Querystring: { watch?: string } }>('/cameras/snapshots', async (req) => {
        if (req.query.watch === '1' && client?.linked) watchGrid()
        const list: Record<string, { at?: number; live: boolean; inactive?: boolean; paused?: boolean; refreshing?: boolean }> = {}
        for (const id of rtspCameraIds()) {
          const at = snapshotAt(id), failed = gridFailed.get(id), paused = gridPaused.has(id)
          // a session is being opened, or is open without having given an image yet: the view says it is updating
          const session = streams.get(id)
          const refreshing = opening.has(id) || (session !== undefined && !session.gotImage && !session.relay.hasEnded)
          if (at === undefined && !failed && !paused && !refreshing) continue
          list[id] = {
            ...(at !== undefined ? { at } : {}), live: streams.has(id), ...(failed ? { inactive: true } : {}), ...(paused ? { paused: true } : {}),
            ...(refreshing ? { refreshing: true } : {}),
          }
        }
        return { snapshots: list, budget: config?.NEST_LIVE_BUDGET ?? 0, sessions: streams.size }
      })

      // A tile's stop button: the thumbnail of THIS camera stops (its session is released, the image
      // stays frozen) until resumed. Shared between screens — a screen that stops a camera stops it
      // for the house, as it would turn off a light. The live stream is not affected.
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
        const s = snapshots.get(req.params.id)
        if (!s) return sendError(reply, 404, 'NOT_FOUND', 'no snapshot yet')
        return reply.type('image/jpeg').header('cache-control', 'no-store').header('x-kasbah-snapshot-at', String(s.at)).send(s.jpeg)
      })

      // Last raw list received from Google: used to capture a real fixture (see __fixtures__).
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

/** End-of-linking page: the token to paste into .env, nothing else (the server does not write .env). */
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
