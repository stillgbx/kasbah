import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { isRasterImage, isWebUrl, sendArt } from '../../http/art'
import { sendError } from '../../http/errors'
import type { FetchLike } from '../../core/sse'
import { createSsdpDiscovery, type SonosDiscovery } from './discovery'
import { createKnownPlayersFile, type KnownPlayers } from './known'
import { formatSonosTime, parseDeviceDescription, parseMute, parsePosition, parseTransport, parseVolume, parseZoneMembers, parseZpInfo, streamLoad, overlayStreamMeta, artProxyUrl, toDescriptor, toPlayback, toStatePatch, type StreamMeta } from './mapping'
import { AV_PATH, AV_URN, RC_PATH, RC_URN, ZG_PATH, ZG_URN, httpGet, soapAction } from './soap'
import type { PositionInfo, SonosPlayer, TransportInfo, ZoneMember } from './types'
import { PLUGIN_ID } from './types'

// Sonos plugin — LOCAL, UPnP/SOAP port 1400. SSDP discovery, no account, no quota.
// Captured on 2026-09-19: Port (Bureau) + Play:3 (Cuisine) answer GetVolume / GetMute /
// GetTransportInfo / GetPositionInfo / GetZoneGroupState with HTTP 200. `/status/info` is empty;
// the identity is in `/status/zp`. wss://:1443 refuses without an API key (HTTP 400): out of phase 1.
//
// PHASE 1: `media_player` contract (state, remote control) + `play_url` (SetAVTransportURI of an
// HTTP stream). No Spotify launch / Sonos queue.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const sonosConfigSchema = z.object({
  /** IPv4 of the LAN adapter (multi-homed machine: VPN, APIPA). Without it SSDP stays silent. */
  SONOS_SSDP_INTERFACE: optionalKey,
  SONOS_SSDP_REFRESH_MS: z.coerce.number().int().min(10_000).max(600_000).default(60_000),
  SONOS_POLL_MS: z.coerce.number().int().min(500).max(30_000).default(2_000),
  SONOS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(5_000),
  SONOS_KNOWN_FILE: z.string().trim().default(stateFile('sonos-devices.json')),
})
export type SonosConfig = z.infer<typeof sonosConfigSchema>

const RESTART_AFTER_S = 3
const ART_KNOWN_MAX = 64
const ART_CACHE_MAX = 32
const ART_TTL_MS = 6 * 3_600_000
const ART_FAIL_TTL_MS = 60_000
const ART_FETCH_TIMEOUT_MS = 8000

export type ArtFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}>

interface Entry {
  player: SonosPlayer
  reachable: boolean
  coordinatorUuid: string
  coordinatorHost: string
  volume?: number
  muted?: boolean
  transport?: TransportInfo
  position?: PositionInfo
  /** Metadata of the last `play_url` while the URI is still playing (Sonos often forgets the DIDL). */
  stickyPlay?: StreamMeta & { uri: string }
}

export interface SonosPluginDeps {
  discovery?: SonosDiscovery
  known?: KnownPlayers
  fetchImpl?: FetchLike
  artFetch?: ArtFetch
  requestTimeoutMs?: number
}

function globalFetch(): FetchLike {
  return (input, init) => fetch(input, init)
}

export function createSonosPlugin(deps: SonosPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: SonosConfig | null = null
  let discovery: SonosDiscovery | null = null
  let known: KnownPlayers | null = null
  let fetchImpl: FetchLike = globalFetch()
  let started = false
  let stopping = false
  let refreshTimer: unknown
  let poller: { stop(): void } | null = null
  const entries = new Map<string, Entry>()
  const knownArt: string[] = []
  const artCache = new Map<string, { status: number; type: string; body: Buffer; at: number }>()

  const timeoutMs = () => deps.requestTimeoutMs ?? config?.SONOS_REQUEST_TIMEOUT_MS ?? 5_000
  const log = () => ctx!.logger
  const signal = () => ctx!.signal

  function remember(): void {
    void known?.save([...entries.values()].map((e) => e.player))
  }

  function descriptors(): DeviceDescriptor[] {
    return [...entries.values()].map((e) => toDescriptor(e.player))
  }

  function publishList(): void {
    if (started) ctx!.emitDevices(descriptors())
  }

  function addPlayer(player: SonosPlayer): Entry {
    const prev = entries.get(player.uuid)
    const entry: Entry = prev ?? {
      player,
      reachable: false,
      coordinatorUuid: player.uuid,
      coordinatorHost: player.host,
    }
    entry.player = player
    entries.set(player.uuid, entry)
    return entry
  }

  async function identify(host: string, uuidHint?: string): Promise<SonosPlayer | undefined> {
    try {
      const zp = parseZpInfo(await httpGet({ host, path: '/status/zp', fetchImpl, signal: signal(), timeoutMs: timeoutMs() }))
      if (!zp) return undefined
      if (uuidHint && zp.uuid !== uuidHint) log().warn({ host, uuidHint, got: zp.uuid }, 'Sonos /status/zp uuid differs from SSDP')
      let model: string | undefined
      let modelNumber: string | undefined
      try {
        const desc = parseDeviceDescription(await httpGet({ host, path: '/xml/device_description.xml', fetchImpl, signal: signal(), timeoutMs: timeoutMs() }))
        model = desc.model
        modelNumber = desc.modelNumber
      } catch { /* the description is not required to publish */ }
      return { uuid: zp.uuid, host, name: zp.name, softwareVersion: zp.softwareVersion, model, modelNumber }
    } catch (err) {
      log().debug({ host, err }, 'Sonos identify failed')
      return undefined
    }
  }

  async function onDiscovered(uuid: string, host: string): Promise<void> {
    if (stopping) return
    const existing = entries.get(uuid)
    if (existing && existing.player.host === host && existing.player.name) {
      existing.player.host = host
      return
    }
    const identified = await identify(host, uuid)
    const player: SonosPlayer = identified ?? { uuid, host, name: existing?.player.name ?? uuid }
    addPlayer(player)
    remember()
    publishList()
  }

  function soap(host: string, path: string, urn: string, action: string, args?: Record<string, string>) {
    return soapAction({ host, path, urn, action, args, fetchImpl, signal: signal(), timeoutMs: timeoutMs() })
  }

  function applyTopology(members: ZoneMember[]): void {
    const byUuid = new Map(members.map((m) => [m.uuid, m]))
    for (const entry of entries.values()) {
      const m = byUuid.get(entry.player.uuid)
      if (!m) continue
      entry.coordinatorUuid = m.coordinatorUuid
      const coord = byUuid.get(m.coordinatorUuid)
      entry.coordinatorHost = coord?.host ?? entry.player.host
      if (m.name && m.name !== entry.player.name) {
        entry.player = { ...entry.player, name: m.name, host: m.host }
      } else if (m.host !== entry.player.host) {
        entry.player = { ...entry.player, host: m.host }
      }
    }
  }

  async function pollOne(entry: Entry): Promise<void> {
    const host = entry.player.host
    const transportHost = entry.coordinatorHost
    const [volXml, muteXml, trXml, posXml] = await Promise.all([
      soap(host, RC_PATH, RC_URN, 'GetVolume', { InstanceID: '0', Channel: 'Master' }),
      soap(host, RC_PATH, RC_URN, 'GetMute', { InstanceID: '0', Channel: 'Master' }),
      soap(transportHost, AV_PATH, AV_URN, 'GetTransportInfo', { InstanceID: '0' }),
      soap(transportHost, AV_PATH, AV_URN, 'GetPositionInfo', { InstanceID: '0' }),
    ])
    entry.volume = parseVolume(volXml)
    entry.muted = parseMute(muteXml)
    entry.transport = parseTransport(trXml)
    entry.position = parsePosition(posXml)
    entry.reachable = true
    let patch = toStatePatch(entry.volume, entry.muted, entry.transport, entry.position, host)
    if (entry.stickyPlay) {
      // Another URI took its place: the stream is gone, and the sticky title with it. Being idle is
      // not enough to forget: the Sonos spends a second stopped right after receiving the URI, and
      // the sticky title disappeared before the first sound. When idle the overlay does not apply
      // (nothing is playing); it comes back if the same URI starts again.
      if (entry.position?.trackUri && entry.position.trackUri !== entry.stickyPlay.uri) {
        entry.stickyPlay = undefined
      } else {
        patch = overlayStreamMeta(patch, entry.stickyPlay, entry.position?.trackUri, artProxyUrl)
      }
    }
    const artUrl = patch.nowPlaying?.artUrl
    if (artUrl) rememberArt(artUrl)
    ctx!.emitState(entry.player.uuid, patch)
  }

  async function pollAll(): Promise<void> {
    if (stopping || entries.size === 0) return
    const first = [...entries.values()][0]
    if (first) {
      try {
        const xml = await soap(first.player.host, ZG_PATH, ZG_URN, 'GetZoneGroupState', {})
        applyTopology(parseZoneMembers(xml))
      } catch { /* a topology failure does not deprive us of the volume */ }
    }
    await Promise.all([...entries.values()].map(async (entry) => {
      try {
        await pollOne(entry)
      } catch (err) {
        entry.reachable = false
        ctx!.setAvailable(entry.player.uuid, false)
        log().debug({ uuid: entry.player.uuid, err }, 'Sonos poll failed')
      }
    }))
  }

  function rememberArt(proxyUrl: string): void {
    const raw = new URL(proxyUrl, 'http://local').searchParams.get('url')
    if (!isWebUrl(raw)) return
    if (!knownArt.includes(raw)) {
      knownArt.push(raw)
      if (knownArt.length > ART_KNOWN_MAX) knownArt.shift()
    }
  }

  async function artFor(url: string): Promise<{ status: number; type: string; body: Buffer }> {
    const cached = artCache.get(url)
    const now = ctx!.clock.now()
    if (cached && now - cached.at < (cached.status === 200 ? ART_TTL_MS : ART_FAIL_TTL_MS)) return cached
    const fetchArt = deps.artFetch ?? ((u, init) => fetch(u, init))
    try {
      const res = await fetchArt(url, { signal: AbortSignal.timeout(ART_FETCH_TIMEOUT_MS) })
      const type = res.headers.get('content-type') ?? 'image/jpeg'
      const body = Buffer.from(await res.arrayBuffer())
      const entry = { status: !res.ok ? res.status : isRasterImage(type) ? 200 : 415, type, body, at: now }
      artCache.set(url, entry)
      while (artCache.size > ART_CACHE_MAX) artCache.delete(artCache.keys().next().value!)
      return entry
    } catch {
      const entry = { status: 0, type: 'application/octet-stream', body: Buffer.alloc(0), at: now }
      artCache.set(url, entry)
      return entry
    }
  }

  function transportHost(entry: Entry): string {
    return entry.coordinatorHost || entry.player.host
  }

  async function run(externalId: string, command: Command): Promise<void> {
    const entry = entries.get(externalId)
    if (!entry) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Sonos device ${externalId}`)
    if (!entry.reachable && started) throw new PluginError('DEVICE_UNAVAILABLE', `${entry.player.name} is not reachable`)
    const av = (action: string, args: Record<string, string> = { InstanceID: '0' }) =>
      soap(transportHost(entry), AV_PATH, AV_URN, action, args)
    switch (command.type) {
      case 'media_player.play':
        await av('Play', { InstanceID: '0', Speed: '1' })
        return
      case 'media_player.pause':
        try {
          await av('Pause')
        } catch (err) {
          // an HTTP stream refuses Pause (transition not available): stopping it amounts to the same, the URI stays
          if (!entry.stickyPlay) throw err
          await av('Stop')
        }
        return
      case 'media_player.stop':
        await av('Stop')
        // deliberate stop: no need any more to pass the stream off as "paused"
        entry.stickyPlay = undefined
        return
      case 'media_player.next':
        if (entry.position && toPlayback(entry.transport?.state ?? '') !== 'idle' && parseDidlLive(entry)) {
          throw new PluginError('UNSUPPORTED_COMMAND', 'there is no next track on a live stream')
        }
        await av('Next')
        return
      case 'media_player.previous': {
        if (parseDidlLive(entry)) throw new PluginError('UNSUPPORTED_COMMAND', 'there is no previous track on a live stream')
        const pos = entry.position?.positionS ?? 0
        if (pos > RESTART_AFTER_S) {
          await av('Seek', { InstanceID: '0', Unit: 'REL_TIME', Target: formatSonosTime(0) })
          return
        }
        await av('Previous')
        return
      }
      case 'media_player.seek':
        if (parseDidlLive(entry)) throw new PluginError('UNSUPPORTED_COMMAND', 'there is nothing to seek through')
        await av('Seek', { InstanceID: '0', Unit: 'REL_TIME', Target: formatSonosTime(command.positionS) })
        return
      case 'media_player.play_url': {
        const meta: StreamMeta = {
          ...(command.title ? { title: command.title } : {}),
          ...(command.artist ? { artist: command.artist } : {}),
          ...(command.artUrl ? { artUrl: command.artUrl } : {}),
          ...(command.explicit ? { explicit: true } : {}),
          ...(command.live ? { live: true } : {}),
        }
        const load = streamLoad(command.url, meta)
        await av('SetAVTransportURI', { InstanceID: '0', CurrentURI: load.uri, CurrentURIMetaData: load.didl })
        await av('Play', { InstanceID: '0', Speed: '1' })
        // Sonos often forgets an HTTP stream's DIDL: we keep title / artwork until the next URI.
        if (meta.title || meta.artist || meta.artUrl) {
          entry.stickyPlay = { uri: command.url, ...meta }
          const art = meta.artUrl ? artProxyUrl(meta.artUrl) : undefined
          if (art) rememberArt(art)
          ctx!.emitState(entry.player.uuid, {
            playback: 'playing',
            nowPlaying: {
              title: meta.title ?? '',
              ...(meta.artist ? { artist: meta.artist } : {}),
              ...(art ? { artUrl: art } : {}),
              ...(meta.explicit ? { explicit: true } : {}),
              ...(meta.live ? { live: true } : {}),
              source: command.url,
            },
          })
        } else {
          entry.stickyPlay = undefined
        }
        return
      }
      case 'media_player.set_volume':
        await soap(entry.player.host, RC_PATH, RC_URN, 'SetVolume', {
          InstanceID: '0', Channel: 'Master', DesiredVolume: String(Math.max(0, Math.min(100, Math.round(command.volume)))),
        })
        return
      case 'media_player.set_mute':
        await soap(entry.player.host, RC_PATH, RC_URN, 'SetMute', {
          InstanceID: '0', Channel: 'Master', DesiredMute: command.muted ? '1' : '0',
        })
        return
      default:
        throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on a Sonos device`)
    }
  }

  function parseDidlLive(entry: Entry): boolean {
    return entry.position ? toStatePatch(undefined, undefined, entry.transport ?? { state: '', status: '' }, entry.position, entry.player.host).nowPlaying?.live === true : false
  }

  function forget(externalId: string): boolean {
    if (!entries.has(externalId)) return false
    entries.delete(externalId)
    remember()
    publishList()
    log().info({ externalId }, 'Sonos device forgotten')
    return true
  }

  return {
    id: PLUGIN_ID,
    configSchema: sonosConfigSchema,

    async init(context) {
      ctx = context
      config = context.config as SonosConfig
      started = false
      stopping = false
      entries.clear()
      knownArt.length = 0
      artCache.clear()
      fetchImpl = deps.fetchImpl ?? globalFetch()
      discovery = deps.discovery ?? createSsdpDiscovery({ ...(config.SONOS_SSDP_INTERFACE ? { iface: config.SONOS_SSDP_INTERFACE } : {}), logger: context.logger })
      known = deps.known ?? (config.SONOS_KNOWN_FILE ? createKnownPlayersFile(config.SONOS_KNOWN_FILE, context.logger) : null)
      const remembered = (await known?.load()) ?? []
      for (const player of remembered) addPlayer(player)
      if (remembered.length) context.logger.info({ devices: remembered.length }, 'Sonos devices remembered from a previous run')
    },

    async discover() {
      return descriptors()
    },

    async start() {
      started = true
      stopping = false
      publishList()
      discovery?.start((found) => { void onDiscovered(found.uuid, found.host) })
      poller = createPoller({
        name: 'sonos',
        intervalMs: config!.SONOS_POLL_MS,
        fn: pollAll,
        clock: ctx!.clock,
        signal: ctx!.signal,
        logger: ctx!.logger,
      })
      refreshTimer = ctx!.clock.setInterval(() => discovery?.refresh(), config!.SONOS_SSDP_REFRESH_MS)
    },

    async execute(externalId, command) {
      await run(externalId, command)
    },

    async stop() {
      stopping = true
      started = false
      poller?.stop()
      poller = null
      if (refreshTimer) ctx?.clock.clearInterval(refreshTimer)
      refreshTimer = null
      discovery?.stop()
    },

    registerRoutes(app: FastifyInstance) {
      app.get<{ Querystring: { url?: string } }>('/art', async (req, reply) => {
        const url = req.query.url
        if (!url || !knownArt.includes(url)) return sendError(reply, 404, 'NOT_FOUND', 'unknown artwork')
        const art = await artFor(url)
        if (art.status !== 200) return sendError(reply, 502, 'UPSTREAM_ERROR', `artwork fetch failed (${art.status || 'network'})`)
        return sendArt(reply, art)
      })
      app.delete<{ Params: { externalId: string } }>('/devices/:externalId', async (req, reply) => {
        if (!forget(req.params.externalId)) return sendError(reply, 404, 'NOT_FOUND', `unknown Sonos device ${req.params.externalId}`)
        return { forgotten: req.params.externalId }
      })
      app.get('/raw', async () => ({
        devices: [...entries.values()].map((e) => ({
          player: e.player,
          reachable: e.reachable,
          coordinatorUuid: e.coordinatorUuid,
          volume: e.volume,
          muted: e.muted,
          transport: e.transport,
          position: e.position,
        })),
      }))
    },

    health(): PluginHealth {
      if (entries.size === 0) {
        return { status: 'degraded', detail: 'no Sonos player found yet (SSDP ZonePlayer — set SONOS_SSDP_INTERFACE on a multi-homed machine)' }
      }
      const reachable = [...entries.values()].filter((e) => e.reachable).length
      const playing = [...entries.values()].filter((e) => toPlayback(e.transport?.state ?? '') === 'playing').length
      return {
        status: reachable === 0 ? 'degraded' : 'ok',
        detail: `${entries.size} device(s), ${reachable} reachable${playing ? `, ${playing} playing` : ''}`,
      }
    },
  }
}
