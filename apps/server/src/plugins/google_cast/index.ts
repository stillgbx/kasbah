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

// Google Cast plugin: Google / Nest speakers and clocks, Chromecasts, TVs and soundbars with
// "Chromecast built-in". Everything is LOCAL: mDNS discovery, one persistent TLS connection per
// device, no account or secret. The receiver pushes its changes (volume, app, playback); there is no
// polling, apart from re-reading the position during playback.
//
// What the protocol cannot do: start a title from a subscription service (YouTube Music, Spotify) —
// it has no notion of account. It can control what is already playing, and play a URL (default
// media receiver): that will be the next step.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

export const googleCastConfigSchema = z.object({
  /** IPv4 of the network interface carrying mDNS multicast (machine with several network cards: VPN, VM). */
  CAST_MDNS_INTERFACE: optionalKey,
  /** Time given to devices to answer the first mDNS query before returning the list. */
  CAST_DISCOVERY_WAIT_MS: z.coerce.number().int().min(500).max(15_000).default(3000),
  /** Rate of the following mDNS queries (devices switched back on, lost announcements). */
  CAST_MDNS_REFRESH_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
  /**
   * Where to remember devices already seen (see `known.ts`): a Cast device that is off no longer
   * announces itself, it stays listed thanks to this file. Empty string = remember nothing (the device
   * disappears when it is switched off).
   */
  CAST_KNOWN_FILE: z.string().trim().default(stateFile('google-cast-devices.json')),
  /**
   * Enrich Crunchyroll playback (series, season, episode, thumbnail) through the service's internal
   * API, anonymously, without an account — UNOFFICIAL (see `enrich/crunchyroll.ts`). `false` to do
   * without.
   */
  CAST_CRUNCHYROLL_ENRICH: bool.default(true),
  /**
   * Look up the cover of a track the device names without illustrating it (an Android TV app sends
   * no image), in the public iTunes then Deezer catalogs, without a key or account — the title +
   * artist match is checked before accepting an image (`enrich/cover.ts`). `false` to do without:
   * the app logo remains.
   */
  CAST_COVER_LOOKUP: bool.default(true),
  /**
   * Ask a Sony TV (model `BRAVIA…`) where its sound goes, through its local REST API, without a key
   * (`bravia.ts`): a TV on HDMI ARC plays through a soundbar that the Cast protocol sees as idle.
   * Published in `audioOutput`; the UI puts the sound wave there using house.json's `meta.audioOutput`
   * link. `false` to do without.
   */
  CAST_BRAVIA_PROBE: bool.default(true),
})
export type GoogleCastConfig = z.infer<typeof googleCastConfigSchema>

/** A receiver that no longer answers is retried at 5 s, 10 s… up to two minutes. */
const RECONNECT_INITIAL_MS = 5000
const RECONNECT_MAX_MS = 120_000
/** Rate of the "where does your sound go?" question to a connected Sony TV (two local HTTP requests). */
const BRAVIA_POLL_MS = 10_000

/** Covers: how many recently seen URLs we agree to serve, cache lifetime of an image, of a failure. */
const ART_KNOWN_MAX = 64
const ART_CACHE_MAX = 32
const ART_TTL_MS = 6 * 3_600_000
const ART_FAIL_TTL_MS = 60_000
const ART_FETCH_TIMEOUT_MS = 8000
/** Google sometimes answers 429: we retry with an increasing delay before giving up. */
const ART_ATTEMPTS = 3
const ART_RETRY_MS = 800

/** The bare minimum of `fetch` to download an image (the global `fetch` will do). */
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
  /** `fixed` removes the volume / mute capabilities from the descriptor. */
  controlType: string | undefined
  backoff: Backoff
  reconnectTimer: unknown
  /** Sound output of a Sony TV (last reading from `bravia.ts`); `undefined` until it has answered. */
  audio: AudioOutput | undefined
  audioTimer: unknown
  /** Metadata of the last `play_url` as long as the contentId matches. */
  stickyPlay?: PlayUrlMeta & { uri: string }
}

export interface GoogleCastPluginDeps {
  /** Injection for tests: cover downloads. */
  fetchImpl?: ArtFetch
  /** Injection for tests: calls to the Crunchyroll API. */
  enrichFetch?: EnrichFetch
  /** Injection for tests: calls to the cover catalogs (iTunes, Deezer). */
  coverFetch?: CoverFetch
  /** Injection for tests: public Cast app registry (logos). */
  registryFetch?: RegistryFetch
  /** Injection for tests: local REST API of a Sony TV (sound output). */
  braviaFetch?: BraviaFetch
  /** Injection for tests: fake discovery. */
  discovery?: CastDiscovery
  /** Injection for tests: memory of devices already seen (otherwise a JSON file). */
  known?: KnownDevices
  /** Injection for tests: fake socket. */
  connect?: SocketFactory
  requestTimeoutMs?: number
  heartbeatMs?: number
}

export function createGoogleCastPlugin(deps: GoogleCastPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: GoogleCastConfig | null = null
  let discovery: CastDiscovery | null = null
  /** Memory of devices already seen (null if `CAST_KNOWN_FILE` is empty: nothing is remembered). */
  let known: KnownDevices | null = null
  /** Crunchyroll enrichment (absent if disabled). */
  let crunchyroll: CrunchyrollEnricher | null = null
  /** Cover lookup by title + artist (absent if disabled). */
  let covers: CoverFinder | null = null
  /** App logos, fallback cover. */
  let appIcons: AppIconResolver | null = null
  let refreshTimer: unknown = null
  let stopping = false
  /** Cover URLs seen in media states (the only ones the /art route agrees to serve), most recent last. */
  const knownArt: string[] = []
  const artCache = new Map<string, ArtEntry>()
  const fetchArt: ArtFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init))
  const braviaFetch: BraviaFetch = deps.braviaFetch ?? ((url, init) => fetch(url, init))
  /** False until "start": a state emitted during "discover" would arrive BEFORE the devices are registered and be lost. */
  let started = false
  const entries = new Map<string, Entry>()

  const log = () => ctx!.logger
  const descriptors = (): DeviceDescriptor[] =>
    [...entries.values()].map((e) => toDescriptor(e.service, { controlType: e.controlType }))

  /** Writes the memory of seen devices (see `known.ts`); without a configured memory, does nothing. */
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
   * A device announced over mDNS: remembered, connected; if it arrives after `discover`, the list is
   * republished. The announcement may concern an ALREADY known device (periodic re-announcement,
   * device switched back on, device found in the memory at startup):
   *  - identical announcement and open connection: nothing to do;
   *  - address or name changed (DHCP lease, rename in Google Home): we keep the new announcement,
   *    republish the descriptors and reopen the connection, the old one pointing into the void;
   *  - no connection: the announcement proves it is there, we retry RIGHT AWAY rather than waiting
   *    for the current delay to run out (which can go up to two minutes).
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
      if (!late) return                                         // during `discover`: the connection comes right after
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

  /** Immediate new attempt: the current delay is worthless since the device has just spoken. */
  function reconnectNow(entry: Entry): void {
    ctx!.clock.clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
    entry.backoff.reset()
    void connect(entry)
  }

  /** Opens a device's connection; on failure, schedules a new attempt. */
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
    } catch {
      // `open` failed: `onClose` has not necessarily run (connection never established)
      entry.connection = null
      connection.close('open failed')
      // logs disabled because there are too many
      // log().warn({ externalId: id, host: entry.service.host, err }, 'cast connection failed')
      scheduleReconnect(entry)
    }
  }

  /**
   * Connected Sony TV: ask it where its sound goes, right away then at a slow rate, as long as the
   * Cast connection holds (it drops with the TV). Published only when it changes; a TV that does not
   * answer keeps its last reading — nothing is invented.
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
      if (wasFixed !== isFixed && started) ctx!.emitDevices(descriptors())      // the capabilities have changed
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
   * Full playback patch, from the most precise to the most general: what the device says, enriched
   * (Crunchyroll), then the track cover looked up by its name, then the app logo. Each stage only
   * speaks up if the image is still missing.
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

  /** The track named by a patch, if it has enough to be looked up (title AND artist). */
  function trackOf(patch: StatePatch<'media_player'>): Track | undefined {
    const n = patch.nowPlaying
    return n?.title && n.artist ? { title: n.title, artist: n.artist } : undefined
  }

  /**
   * Album cover of a track the device does not illustrate (observed: the YouTube app on an Android
   * TV gives title and artist, never an image). Looked up by its name in the public catalogs
   * (`enrich/cover.ts`), with a checked match. Cached: applied right away; otherwise we publish what
   * we have and republish on the answer — if the SAME track is still playing.
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
   * Playback patch, enriched if the app is poor and we know how to do better (Crunchyroll). A result
   * already cached applies right away; otherwise we publish what we have and republish when the
   * answer arrives — if the same content is still playing (the user may have switched in between).
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
   * Fallback cover: the app logo when the track has no image (native Netflix, Crunchyroll before
   * enrichment). The icon the receiver gives itself first; otherwise the public Cast app registry —
   * right away if cached, otherwise published afterwards if the same app is still on screen.
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

  /** Downloads a cover, with a few spaced-out attempts when the image server complains (429, 5xx). */
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

  /** Current state of a connected device, published in one block (at "start", after the silence of "discover"). */
  function emitCurrent(entry: Entry): void {
    const c = entry.connection
    if (!c?.isOpen || !c.lastReceiverStatus) { ctx!.setAvailable(entry.service.txt.id, false); return }
    ctx!.emitState(entry.service.txt.id, { ...toReceiverPatch(c.lastReceiverStatus), ...mediaPatch(entry, c.media, c.app), ...(entry.audio ? { audioOutput: entry.audio } : {}) })
  }

  function onClose(entry: Entry, reason: string): void {
    const id = entry.service.txt.id
    if (!entry.connection) return                                   // open failure already handled
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
   * Forgets a device: connection closed, entry removed from the list AND the memory. A device still
   * on the network will come back at its next announcement — that is fine: we only forget what has
   * disappeared (device sold, passing guest), and the UI only offers it for unavailable devices.
   */
  function forget(externalId: string): boolean {
    const entry = entries.get(externalId)
    if (!entry) return false
    ctx!.clock.clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
    stopAudioProbe(entry)
    const c = entry.connection
    entry.connection = null                                     // `onClose` must not schedule another attempt
    c?.close('device forgotten')
    entries.delete(externalId)
    remember()
    if (started) ctx!.emitDevices(descriptors())
    log().info({ externalId, name: entry.service.txt.fn }, 'cast device forgotten')
    return true
  }

  /** Command to a connected device; resolves when the receiver has answered (its state follows through its messages). */
  async function run(externalId: string, command: Command): Promise<void> {
    const entry = entries.get(externalId)
    if (!entry) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Cast device ${externalId}`)
    const c = entry.connection
    if (!c || !c.isOpen) throw new PluginError('DEVICE_UNAVAILABLE', `${entry.service.txt.fn} is not connected`)
    switch (command.type) {
      case 'media_player.play': return c.mediaCommand('PLAY')
      case 'media_player.pause': return c.mediaCommand('PAUSE')
      case 'media_player.stop': return c.stopApp()                        // closes the app, not just the playback
      case 'media_player.next': return c.queueJump(1)
      case 'media_player.previous': return c.previous()                 // start of the track past 3 s, otherwise the previous one
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
      // Devices already seen: they enter the list BEFORE discovery, so a device that is off (which no
      // longer announces itself) stays there, unavailable. An mDNS announcement will update its address.
      known = deps.known ?? (config.CAST_KNOWN_FILE ? createKnownDevicesFile(config.CAST_KNOWN_FILE, context.logger) : null)
      const remembered = (await known?.load()) ?? []
      for (const service of remembered) addEntry(service)
      if (remembered.length) context.logger.info({ devices: remembered.length }, 'cast devices remembered from a previous run')
    },

    /**
     * Listens to mDNS for the configured time, then connects each device found to learn its volume
     * type before returning the descriptors. An unreachable device is listed anyway (unavailable): it
     * is on the network, it will come back.
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
      // the devices are registered: publish each one's state (connected, or unavailable), then let
      // the connections push what follows and repeat the mDNS query at a slow rate
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
      // A track's cover, downloaded by the server and cached (see `artProxyUrl`). Only URLs seen in a
      // media state are served: it is not an open relay.
      app.get<{ Querystring: { url?: string } }>('/art', async (req, reply) => {
        const url = req.query.url
        if (!url || !knownArt.includes(url)) return sendError(reply, 404, 'NOT_FOUND', 'unknown artwork')
        const art = await artFor(url)
        if (art.status !== 200) return sendError(reply, 502, 'UPSTREAM_ERROR', `artwork fetch failed (${art.status || 'network'})`)
        return reply.header('content-type', art.type).header('cache-control', 'public, max-age=86400').send(art.body)
      })

      // Forget a remembered device (see `forget`): it is the counterpart of the memory, without which a
      // device seen once would stay listed forever.
      app.delete<{ Params: { externalId: string } }>('/devices/:externalId', async (req, reply) => {
        if (!forget(req.params.externalId)) return sendError(reply, 404, 'NOT_FOUND', `unknown Cast device ${req.params.externalId}`)
        return { forgotten: req.params.externalId }
      })

      // Last raw state received from each device: used to capture real fixtures (see __fixtures__).
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
