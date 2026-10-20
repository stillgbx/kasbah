import { ManualClock } from '@kasbah/mock-sim'
import { Duplex, PassThrough } from 'node:stream'
import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import {
  CAST_REGISTRY_NETFLIX, CAST_REGISTRY_PRIME_VIDEO, CAST_REGISTRY_YOUTUBE, CRUNCHYROLL_OBJECT_EPISODE, DEEZER_SEARCH_BOUNDARY, ITUNES_SEARCH_BOUNDARY, CRUNCHYROLL_OBJECT_SERIES, CRUNCHYROLL_TOKEN, MEDIA_STATUS_CRUNCHYROLL, MEDIA_STATUS_PLAYING, MEDIA_STATUS_PRIME_VIDEO, MEDIA_STATUS_RADIO, MEDIA_STATUS_YOUTUBE_TV, RECEIVER_STATUS_CHROMECAST_FIXED,
  RECEIVER_STATUS_CRUNCHYROLL, RECEIVER_STATUS_NEST_HUB_IDLE, RECEIVER_STATUS_NETFLIX, RECEIVER_STATUS_PLAYING, RECEIVER_STATUS_PRIME_VIDEO, RECEIVER_STATUS_RADIO, RECEIVER_STATUS_YOUTUBE_TV, SERVICE_BRAVIA, SERVICE_CHROMECAST,
  SERVICE_NEST_HUB, SERVICE_NEST_MINI, TXT_BRAVIA, TXT_CHROMECAST, TXT_NEST_HUB, TXT_NEST_MINI,
} from './__fixtures__/network'
import { BRAVIA_INPUTS_ARC_SOUNDBAR, BRAVIA_SOUND_AUDIO_SYSTEM, BRAVIA_SOUND_SPEAKER } from './__fixtures__/bravia'
import type { BraviaFetch } from './bravia'
import type { SocketFactory } from './channel'
import type { CastDiscovery } from './discovery'
import type { RegistryFetch } from './enrich/appIcon'
import type { CoverFetch } from './enrich/cover'
import type { EnrichFetch } from './enrich/crunchyroll'
import { createGoogleCastPlugin, googleCastConfigSchema, type ArtFetch } from './index'
import { FrameDecoder, NS_HEARTBEAT, NS_MEDIA, NS_RECEIVER, encodeFrame, jsonMessage } from './protocol'
import type { CastService } from './types'

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

interface Sent { namespace: string; destination: string; body: Record<string, unknown> }

/**
 * Fake Cast receiver at the end of an in-memory socket: answers GET_STATUS, SET_VOLUME, PING and
 * media commands with the `requestId` received, like the real one. `receiver` and `media` are its
 * current states, modifiable by the test; `push` sends an unsolicited state.
 */
function fakeReceiver(receiver: Record<string, unknown>, media?: Record<string, unknown>) {
  const sent: Sent[] = []
  const toReceiver = new PassThrough(), fromReceiver = new PassThrough()
  const decoder = new FrameDecoder()
  const state = { receiver: structuredClone(receiver), media: media ? structuredClone(media) : undefined, sent, closed: false }
  const reply = (to: string, namespace: string, body: Record<string, unknown>) => { if (!state.closed) fromReceiver.write(encodeFrame(jsonMessage(to === 'sender-0' ? 'receiver-0' : to, 'sender-0', namespace, body))) }
  const mediaStatus = (requestId: number | undefined) => ({ type: 'MEDIA_STATUS', requestId, status: state.media ? [state.media] : [] })
  /** Like the real receiver: a transport command is acknowledged by a state WITHOUT the `media` block (unchanged). */
  const mediaDelta = (requestId: number | undefined) => {
    const { media: _omitted, ...rest } = state.media as Record<string, unknown>
    return { type: 'MEDIA_STATUS', requestId, status: [rest] }
  }
  toReceiver.on('data', (chunk: Buffer) => {
    for (const m of decoder.push(chunk)) {
      const body = JSON.parse(m.payload) as Record<string, unknown>
      sent.push({ namespace: m.namespace, destination: m.destinationId, body })
      const requestId = body.requestId as number | undefined
      if (m.namespace === NS_HEARTBEAT && body.type === 'PING') reply(m.destinationId, NS_HEARTBEAT, { type: 'PONG' })
      if (m.namespace === NS_RECEIVER) {
        if (body.type === 'SET_VOLUME') {
          const v = body.volume as { level?: number; muted?: boolean }
          state.receiver.volume = { ...(state.receiver.volume as object), ...v }
        }
        // STOP of a session: the app closes, the receiver answers with a state without an app
        if (body.type === 'STOP') { state.receiver = { ...state.receiver, applications: [] }; state.media = undefined }
        if (body.type === 'LAUNCH') {
          const appId = String(body.appId)
          state.receiver = {
            ...state.receiver,
            applications: [{
              appId, appType: 'WEB', displayName: 'Default Media Receiver', iconUrl: '', isIdleScreen: false,
              namespaces: [{ name: 'urn:x-cast:com.google.cast.media' }],
              sessionId: 'session-dmr', statusText: '', transportId: 'transport-dmr', universalAppId: appId,
            }],
          }
          state.media = undefined
        }
        reply(m.destinationId, NS_RECEIVER, { type: 'RECEIVER_STATUS', requestId, status: state.receiver })
      }
      if (m.namespace === NS_MEDIA) {
        if (body.type === 'LOAD') {
          const loaded = body.media as { contentId: string; contentType?: string; streamType?: string; metadata?: { title?: string } }
          state.media = {
            mediaSessionId: 1, playerState: 'PLAYING', currentTime: 0,
            media: {
              contentId: loaded.contentId,
              contentType: loaded.contentType ?? 'audio/mpeg',
              streamType: loaded.streamType ?? 'BUFFERED',
              metadata: { metadataType: 0, title: loaded.metadata?.title ?? loaded.contentId },
            },
          }
          reply(m.destinationId, NS_MEDIA, mediaStatus(requestId))
          continue
        }
        if (!state.media) {
          if (body.type === 'GET_STATUS') { reply(m.destinationId, NS_MEDIA, { type: 'MEDIA_STATUS', requestId, status: [] }); continue }
          reply(m.destinationId, NS_MEDIA, { type: 'INVALID_REQUEST', requestId, reason: 'INVALID_MEDIA_SESSION_ID' })
          continue
        }
        if (body.type === 'PAUSE') state.media.playerState = 'PAUSED'
        if (body.type === 'PLAY') state.media.playerState = 'PLAYING'
        if (body.type === 'SEEK') state.media.currentTime = body.currentTime
        reply(m.destinationId, NS_MEDIA, ['PAUSE', 'PLAY', 'SEEK'].includes(body.type as string) ? mediaDelta(requestId) : mediaStatus(requestId))
      }
    }
  })
  const socket = Duplex.from({ writable: toReceiver, readable: fromReceiver })
  return {
    state, sent, socket,
    push(receiver: Record<string, unknown>) { state.receiver = structuredClone(receiver); reply('sender-0', NS_RECEIVER, { type: 'RECEIVER_STATUS', status: state.receiver }) },
    pushMedia(media: Record<string, unknown> | undefined, transportId: string) { state.media = media ? structuredClone(media) : undefined; if (!state.closed) fromReceiver.write(encodeFrame(jsonMessage(transportId, 'sender-0', NS_MEDIA, mediaStatus(undefined)))) },
    /** The device drops (restart, Wi-Fi lost). */
    drop() { state.closed = true; fromReceiver.end() },
    of(type: string): Sent[] { return sent.filter((s) => s.body.type === type) },
  }
}

function fakeDiscovery(initial: CastService[]) {
  let onUp: ((s: CastService) => void) | null = null
  const d: CastDiscovery & { announce(s: CastService): void } = {
    start: vi.fn((cb) => { onUp = cb; for (const s of initial) cb(s) }),
    refresh: vi.fn(), stop: vi.fn(),
    announce(s) { onUp?.(s) },
  }
  return d
}

function fakeContext(clock: ManualClock, config: Record<string, string> = {}) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    // Empty `CAST_KNOWN_FILE`: no test may read or write the dev machine's real memory.
    // `CAST_COVER_LOOKUP` false: no test may go out on the network — the test that exercises it
    // turns it on by injecting fake catalogs.
    pluginId: 'google_cast', config: googleCastConfigSchema.parse({ CAST_DISCOVERY_WAIT_MS: '1000', CAST_KNOWN_FILE: '', CAST_COVER_LOOKUP: 'false', ...config }), logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  return { ctx, ctrl }
}

/** Wires one fake receiver per host; a missing host is unreachable. */
function network(receivers: Record<string, ReturnType<typeof fakeReceiver>>) {
  const connect: SocketFactory = vi.fn(async (host) => {
    const r = receivers[host]
    if (!r) throw new Error(`connect ECONNREFUSED ${host}`)
    return r.socket
  })
  return connect
}

/** Cast app registry: silent by default (no test may go out on the network), Netflix or Prime Video known on request. */
const noRegistry: RegistryFetch = async () => ({ ok: false, status: 404, text: async () => '' })
const netflixRegistry: RegistryFetch = async (url) => (url.endsWith('CA5E8412') ? { ok: true, status: 200, text: async () => CAST_REGISTRY_NETFLIX } : noRegistry(url))
const primeVideoRegistry: RegistryFetch = async (url) => (url.endsWith('17608BC8') ? { ok: true, status: 200, text: async () => CAST_REGISTRY_PRIME_VIDEO } : noRegistry(url))
/** Like the real registry: the Android TV variant of YouTube (2C6A6E3D) returns NO visual. */
const youtubeRegistry: RegistryFetch = async (url) => (url.endsWith('233637DE') ? { ok: true, status: 200, text: async () => CAST_REGISTRY_YOUTUBE } : noRegistry(url))

/** Memory of seen devices, in RAM: what `known.ts` does with a file. */
function fakeKnown(initial: CastService[] = []) {
  let devices = initial
  return {
    async load() { return devices },
    async save(services: CastService[]) { devices = services },
    get current() { return devices },
  }
}

/** A Sony TV's API: silent by default (no test may go out on the network). */
const noBravia: BraviaFetch = async () => { throw new Error('ECONNREFUSED') }

async function started(discovery: CastDiscovery, connect: SocketFactory, fetchImpl?: ArtFetch, enrichFetch?: EnrichFetch, registryFetch: RegistryFetch = noRegistry, known?: ReturnType<typeof fakeKnown>, coverFetch?: CoverFetch, braviaFetch: BraviaFetch = noBravia) {
  const clock = new ManualClock(0)
  // injecting fake catalogs means wanting to exercise the cover lookup: it gets switched on with them
  const { ctx, ctrl } = fakeContext(clock, coverFetch ? { CAST_COVER_LOOKUP: 'true' } : {})
  const plugin = createGoogleCastPlugin({ discovery, connect, registryFetch, braviaFetch, ...(fetchImpl ? { fetchImpl } : {}), ...(enrichFetch ? { enrichFetch } : {}), ...(known ? { known } : {}), ...(coverFetch ? { coverFetch } : {}) })
  await plugin.init(ctx)
  const p = plugin.discover()
  await flush()
  clock.advance(1000)                                            // end of the mDNS listening window
  await flush(8)
  const descriptors = await p
  await plugin.start()
  return { plugin, ctx, ctrl, clock, descriptors }
}

const patches = (ctx: PluginContext, externalId: string) =>
  (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === externalId).map((c) => c[1] as Record<string, unknown>)

describe('google_cast plugin', () => {
  it('discovers the devices, connects to each and publishes their capabilities and state', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE), tv = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    const { plugin, ctx, descriptors } = await started(fakeDiscovery([SERVICE_NEST_HUB, SERVICE_CHROMECAST]), network({ [SERVICE_NEST_HUB.host]: hub, [SERVICE_CHROMECAST.host]: tv }))

    expect(descriptors.map((d) => d.name)).toEqual(['Réveil parents', "Chambre 3"])
    expect(descriptors[0]!.capabilities).toContain('volume')
    expect(descriptors[1]!.capabilities).not.toContain('volume')          // `fixed` volume known from the first state
    // the receiver got CONNECT then GET_STATUS
    expect(hub.sent.map((s) => s.body.type)).toEqual(['CONNECT', 'GET_STATUS'])
    // nothing is published during discover (the devices are not registered yet): a single full patch at start
    expect(patches(ctx, TXT_NEST_HUB.id)).toEqual([{ volume: 20, muted: false, playback: 'idle', nowPlaying: null }])
    expect(ctx.setAvailable).not.toHaveBeenCalled()
    expect(plugin.health!()).toEqual({ status: 'ok', detail: '2 device(s), 2 connected' })
    await plugin.stop()
  })

  it('lists an unreachable device anyway, unavailable, and retries later', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    const receivers: Record<string, ReturnType<typeof fakeReceiver>> = { [SERVICE_NEST_HUB.host]: hub }
    const { plugin, ctx, clock, descriptors } = await started(fakeDiscovery([SERVICE_NEST_HUB, SERVICE_NEST_MINI]), network(receivers))
    expect(descriptors).toHaveLength(2)
    expect(ctx.setAvailable).toHaveBeenCalledWith(TXT_NEST_MINI.id, false)
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '2 device(s), 1 connected' })

    // the speaker comes back: the new attempt (5 s backoff ± jitter) finds it
    receivers[SERVICE_NEST_MINI.host] = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    clock.advance(7000)
    await flush(8)
    expect(patches(ctx, TXT_NEST_MINI.id)).toEqual([{ volume: 20, muted: false }, { playback: 'idle', nowPlaying: null }])
    await plugin.stop()
  })

  it('follows the running app: now playing, then pause acknowledged by the receiver', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    const transportId = RECEIVER_STATUS_PLAYING.applications[0]!.transportId
    // connection to the app's channel, then media state requested
    expect(speaker.sent.filter((s) => s.destination === transportId).map((s) => s.body.type)).toEqual(['CONNECT', 'GET_STATUS'])
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ playback: 'playing', nowPlaying: { title: 'Terracotta', artist: 'Mira Solano', source: 'Spotify' } })

    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.pause' })
    expect(speaker.of('PAUSE')[0]).toMatchObject({ destination: transportId, body: { mediaSessionId: 1 } })
    await flush()
    // the PAUSE ack does not carry `media`: the known track is kept
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ playback: 'paused', nowPlaying: { title: 'Terracotta', artist: 'Mira Solano' } })

    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.next' })
    expect(speaker.of('QUEUE_UPDATE')[0]!.body).toMatchObject({ jump: 1, mediaSessionId: 1 })

    // seeking within the track: SEEK, and the state that comes back carries the new position
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.seek', positionS: 90 })
    expect(speaker.of('SEEK')[0]!.body).toMatchObject({ mediaSessionId: 1, currentTime: 90 })
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ nowPlaying: { title: 'Terracotta', positionS: 90 } })
    // a new session without `media` (another track not yet described) does not keep the old one
    speaker.pushMedia({ mediaSessionId: 2, playerState: 'BUFFERING' }, transportId)
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toEqual({ playback: 'playing', nowPlaying: null })
    expect(plugin.health!()).toMatchObject({ detail: expect.stringContaining('1 connected') })
    await plugin.stop()
  })

  it('"previous" restarts the track past three seconds, and goes back a track before that', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)          // currentTime 42.5
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    const transportId = RECEIVER_STATUS_PLAYING.applications[0]!.transportId
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.previous' })
    expect(speaker.of('SEEK')[0]).toMatchObject({ destination: transportId, body: { mediaSessionId: 1, currentTime: 0 } })
    expect(speaker.of('QUEUE_UPDATE')).toHaveLength(0)
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ nowPlaying: { title: 'Terracotta', positionS: 0 } })

    // two seconds later (estimated position ~2 s), "previous" means the track before
    clock.advance(2000)
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.previous' })
    expect(speaker.of('QUEUE_UPDATE')[0]!.body).toMatchObject({ jump: -1, mediaSessionId: 1 })
    expect(speaker.of('SEEK')).toHaveLength(1)

    // four seconds after the last state, the estimated position exceeds the threshold: back to the start
    clock.advance(4000)
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.previous' })
    expect(speaker.of('SEEK')).toHaveLength(2)
    await plugin.stop()
  })

  it('refuses to skip or seek a LIVE stream, and sends nothing (real franceinfo capture)', async () => {
    // Observed for real: "previous" on the franceinfo live stream sent a SEEK to 0 (position > 3 s,
    // as on a track). The stream stopped and the app would not restart. A live stream has no start
    // to go back to, no neighboring track, whatever `supportedMediaCommands` announces.
    const speaker = fakeReceiver(RECEIVER_STATUS_RADIO, MEDIA_STATUS_RADIO)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ playback: 'playing', nowPlaying: { title: 'franceinfo', live: true } })

    for (const type of ['media_player.previous', 'media_player.next'] as const) {
      await expect(plugin.execute(TXT_NEST_MINI.id, { type })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND', message: expect.stringContaining('live stream') })
    }
    await expect(plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.seek', positionS: 0 })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    expect(speaker.of('SEEK')).toHaveLength(0)
    expect(speaker.of('QUEUE_UPDATE')).toHaveLength(0)

    // pause, resume and volume, however, work on a live stream: they are not grayed out
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.pause' })
    expect(speaker.of('PAUSE')).toHaveLength(1)
    await plugin.stop()
  })

  it('clears the track when the app stops, and refuses play when nothing plays', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    speaker.push(RECEIVER_STATUS_NEST_HUB_IDLE)                           // Spotify closed, idle screen
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toEqual({ playback: 'idle', nowPlaying: null })
    await expect(plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.play' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND', message: expect.stringContaining('nothing is playing') })
    await plugin.stop()
  })

  it('launches the default media receiver and LOADs an HTTP URL', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    const url = 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3'
    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.play_url', url })
    expect(speaker.of('LAUNCH')[0]!.body).toMatchObject({ appId: 'CC1AD845' })
    const load = speaker.of('LOAD')[0]
    expect(load).toBeDefined()
    expect(load!.destination).toBe('transport-dmr')
    expect(load!.body).toMatchObject({
      type: 'LOAD',
      autoplay: true,
      media: { contentId: url, contentType: 'audio/mpeg', streamType: 'BUFFERED' },
    })
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ playback: 'playing', nowPlaying: { title: 'icecast.radiofrance.fr' } })
    await plugin.stop()
  })

  it('shows a native app without a media channel as on screen, and never talks to it (real Netflix capture)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, undefined, netflixRegistry)
    tv.push(RECEIVER_STATUS_NETFLIX)                                      // Netflix open on the Chromecast
    await flush(8)
    const onScreen = patches(ctx, TXT_CHROMECAST.id).filter((p) => p.playback === 'on')
    // first the bare state, without waiting for the registry; then the app logo (native id → CA5E8412), relayed by /art, as the fallback cover
    const icon = 'https://lh3.googleusercontent.com/anonymised-netflix-icon'
    expect(onScreen[0]).toEqual({ playback: 'on', nowPlaying: { title: '', source: 'Netflix' } })
    expect(onScreen.at(-1)).toEqual({ playback: 'on', nowPlaying: { title: '', source: 'Netflix', artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(icon)}` } })
    // no transportId: neither CONNECT to the app nor media GET_STATUS, only the receiver's ones on opening
    expect(tv.sent.filter((s) => s.destination !== 'receiver-0')).toEqual([])
    await expect(plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.pause' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    // "turn off" = close the app: STOP of its session on the receiver channel, acknowledged by a state without an app
    await plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.stop' })
    expect(tv.of('STOP')).toEqual([{ namespace: NS_RECEIVER, destination: 'receiver-0', body: { type: 'STOP', sessionId: '0a9d3eeb-0000-4000-8000-000000000005', requestId: expect.any(Number) } }])
    await flush()
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toEqual({ playback: 'idle', nowPlaying: null })
    await expect(plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.stop' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND', message: expect.stringContaining('nothing is on screen') })
    await plugin.stop()
  })

  it('sets the volume as a 0–1 level and refuses it on a fixed-volume device', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE), tv = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_HUB, SERVICE_CHROMECAST]), network({ [SERVICE_NEST_HUB.host]: hub, [SERVICE_CHROMECAST.host]: tv }))
    await plugin.execute(TXT_NEST_HUB.id, { type: 'media_player.set_volume', volume: 45 })
    expect(hub.of('SET_VOLUME')[0]!.body).toMatchObject({ volume: { level: 0.45 } })
    await flush()
    expect(patches(ctx, TXT_NEST_HUB.id).at(-1)).toEqual({ volume: 45, muted: false })
    await plugin.execute(TXT_NEST_HUB.id, { type: 'media_player.set_mute', muted: true })
    expect(hub.of('SET_VOLUME')[1]!.body).toMatchObject({ volume: { muted: true } })
    await expect(plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.set_volume', volume: 10 })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('nope', { type: 'media_player.play' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await plugin.stop()
  })

  it('marks a device unavailable when it drops, then reconnects with backoff', async () => {
    const receivers: Record<string, ReturnType<typeof fakeReceiver>> = { [SERVICE_NEST_HUB.host]: fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE) }
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_NEST_HUB]), network(receivers))
    receivers[SERVICE_NEST_HUB.host]!.drop()
    await flush()
    expect(ctx.setAvailable).toHaveBeenCalledWith(TXT_NEST_HUB.id, false)
    await expect(plugin.execute(TXT_NEST_HUB.id, { type: 'media_player.set_volume', volume: 10 })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    expect(plugin.health!()).toMatchObject({ status: 'degraded', detail: '1 device(s), 0 connected' })

    receivers[SERVICE_NEST_HUB.host] = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    clock.advance(7000)
    await flush(8)
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
    await plugin.stop()
  })

  it('answers the receiver pings and gives up on a silent socket', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_NEST_HUB]), network({ [SERVICE_NEST_HUB.host]: hub }))
    clock.advance(5000)
    await flush()
    expect(hub.of('PING')).toHaveLength(1)                                 // our heartbeat, and the PONG came back
    hub.state.closed = true                                                // the device stops answering, without closing
    clock.advance(20_000)
    await flush()
    expect(ctx.setAvailable).toHaveBeenCalledWith(TXT_NEST_HUB.id, false)
    await plugin.stop()
  })

  it('publishes a device announced after discovery', async () => {
    const hub = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE), mini = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    const discovery = fakeDiscovery([SERVICE_NEST_HUB])
    const { plugin, ctx, clock } = await started(discovery, network({ [SERVICE_NEST_HUB.host]: hub, [SERVICE_NEST_MINI.host]: mini }))
    expect(ctx.emitDevices).not.toHaveBeenCalled()
    discovery.announce(SERVICE_NEST_MINI)
    await flush(8)
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)
    expect((ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toHaveLength(2)
    expect(patches(ctx, TXT_NEST_MINI.id)[0]).toEqual({ volume: 20, muted: false })
    clock.advance(60_000)
    expect(discovery.refresh).toHaveBeenCalled()
    await plugin.stop()
    expect(discovery.stop).toHaveBeenCalled()
  })

  it('serves the artwork it has seen through /art, cached, and refuses any other URL', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)
    const calls: string[] = []
    const fetchImpl: ArtFetch = vi.fn(async (url) => {
      calls.push(url)
      // Google complains once, then serves the image
      if (calls.length === 1) return { ok: false, status: 429, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }
      return { ok: true, status: 200, headers: { get: (n: string) => (n === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer }
    })
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }), fetchImpl)
    const original = MEDIA_STATUS_PLAYING.media.metadata.images[0]!.url
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ nowPlaying: { artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(original)}` } })

    const app = Fastify()
    await app.register(async (a) => { plugin.registerRoutes!(a) }, { prefix: '/api/plugins/google_cast' })
    await app.ready()
    // the new attempt waits 800 ms of clock time: we advance it while the request is in flight
    const pending = app.inject({ method: 'GET', url: `/api/plugins/google_cast/art?url=${encodeURIComponent(original)}` })
    await flush(); clock.advance(1000)
    const res = await pending
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.rawPayload.length).toBe(3)
    expect(calls).toHaveLength(2)                                           // 429 then 200
    // cached: no new download
    expect((await app.inject({ method: 'GET', url: `/api/plugins/google_cast/art?url=${encodeURIComponent(original)}` })).statusCode).toBe(200)
    expect(calls).toHaveLength(2)
    // a URL never seen in a media state is not relayed
    expect((await app.inject({ method: 'GET', url: '/api/plugins/google_cast/art?url=https%3A%2F%2Fexample.com%2Fx.jpg' })).statusCode).toBe(404)
    await app.close()
    await plugin.stop()
  })

  it('enriches a Crunchyroll episode: series, S·E and thumbnail arrive in a second patch, then straight from cache', async () => {
    // seen for real on 2026-09-10: the device may omit the title itself, the API provides it
    const tv = fakeReceiver(RECEIVER_STATUS_CRUNCHYROLL, { ...MEDIA_STATUS_CRUNCHYROLL, media: { ...MEDIA_STATUS_CRUNCHYROLL.media, metadata: { metadataType: 0, artist: ' ' } } })
    const enrichFetch: EnrichFetch = vi.fn(async (url) => ({ ok: true, status: 200, json: async () => (url.endsWith('/auth/v1/token') ? CRUNCHYROLL_TOKEN : url.includes('/cms/series/') ? CRUNCHYROLL_OBJECT_SERIES : CRUNCHYROLL_OBJECT_EPISODE) }))
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, enrichFetch)
    const all = patches(ctx, TXT_CHROMECAST.id)
    // first what the device said (title only), without waiting for Crunchyroll
    expect(all.at(-1)).toMatchObject({ nowPlaying: { title: '', source: 'Crunchyroll' } })
    expect((all.at(-1) as { nowPlaying: { artist?: string } }).nowPlaying.artist).toBeUndefined()
    await flush(8)
    // then the same playback, completed
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      playback: 'playing',
      nowPlaying: { title: 'Un épisode de démonstration', artist: 'Les Chroniques de démo', album: 'S1 · E10', source: 'Crunchyroll', artUrl: expect.stringContaining('poster_tall') },
    })
    expect(enrichFetch).toHaveBeenCalledTimes(3)                           // token + episode + series
    // the enriched poster is served by /art (known URL), like the metadata covers
    const poster = CRUNCHYROLL_OBJECT_SERIES.data[0]!.images.poster_tall[0]![3]!.source
    expect((patches(ctx, TXT_CHROMECAST.id).at(-1) as { nowPlaying: { artUrl: string } }).nowPlaying.artUrl).toBe(`/api/plugins/google_cast/art?url=${encodeURIComponent(poster)}`)
    // a new state of the same content (pause) goes out enriched at once, from the cache
    await plugin.execute(TXT_CHROMECAST.id, { type: 'media_player.pause' })
    await flush()
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({ playback: 'paused', nowPlaying: { artist: 'Les Chroniques de démo', album: 'S1 · E10' } })
    expect(enrichFetch).toHaveBeenCalledTimes(3)
    await plugin.stop()
  })

  it('leaves other apps alone and works without enrichment when disabled', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)
    const enrichFetch: EnrichFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const { plugin } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }), undefined, enrichFetch)
    await flush(4)
    expect(enrichFetch).not.toHaveBeenCalled()                               // Spotify: nothing to enrich
    await plugin.stop()
    expect(googleCastConfigSchema.parse({ CAST_CRUNCHYROLL_ENRICH: 'false' }).CAST_CRUNCHYROLL_ENRICH).toBe(false)
  })

  it('remembers a device that stopped announcing itself: listed and unavailable, connected as soon as it speaks again', async () => {
    // the TV was seen during a previous run; it is off, so absent from mDNS and from the network
    const known = fakeKnown([SERVICE_CHROMECAST])
    const receivers: Record<string, ReturnType<typeof fakeReceiver>> = { [SERVICE_NEST_MINI.host]: fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE) }
    const discovery = fakeDiscovery([SERVICE_NEST_MINI])
    const { plugin, ctx, descriptors } = await started(discovery, network(receivers), undefined, undefined, undefined, known)

    // it keeps its name, its kind and its capabilities: the house.json entry pointing at it stays readable
    expect(descriptors.map((d) => d.name)).toEqual(['Chambre 3', 'Cuisine'])
    expect(descriptors[0]!.meta.mediaPlayer).toEqual({ deviceClass: 'tv' })
    expect(descriptors[0]!.meta.forgettable).toBe(true)
    expect(ctx.setAvailable).toHaveBeenCalledWith(TXT_CHROMECAST.id, false)
    expect(plugin.health!()).toMatchObject({ detail: '2 device(s), 1 connected' })
    // the new speaker has entered the memory, the TV stays in it
    expect(known.current.map((s) => s.txt.id)).toEqual([TXT_CHROMECAST.id, TXT_NEST_MINI.id])

    // we switch the TV back on: its announcement is enough, without waiting for the reconnect delay to end
    receivers[SERVICE_CHROMECAST.host] = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    discovery.announce(SERVICE_CHROMECAST)
    await flush(8)
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({ playback: 'idle' })
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '2 device(s), 2 connected' })
    await plugin.stop()
  })

  it('follows a device that changed address or name, and forgets one on demand', async () => {
    const known = fakeKnown()
    const first = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    const receivers: Record<string, ReturnType<typeof fakeReceiver>> = { [SERVICE_NEST_MINI.host]: first }
    const discovery = fakeDiscovery([SERVICE_NEST_MINI])
    const { plugin, ctx, clock } = await started(discovery, network(receivers), undefined, undefined, undefined, known)

    // new DHCP lease and rename in Google Home: the old connection leads nowhere anymore
    const moved: CastService = { ...SERVICE_NEST_MINI, host: '192.168.1.207', txt: { ...TXT_NEST_MINI, fn: 'Cuisine bas' } }
    receivers[moved.host] = fakeReceiver(RECEIVER_STATUS_NEST_HUB_IDLE)
    discovery.announce(moved)
    await flush()
    expect((ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toMatchObject([{ name: 'Cuisine bas' }])
    expect(known.current[0]!.host).toBe(moved.host)
    clock.advance(7000)                                                   // new attempt, on the new address
    await flush(8)
    expect(plugin.health!()).toMatchObject({ detail: '1 device(s), 1 connected' })

    // forget: the device leaves the list AND the memory (route counterpart of `known.ts`)
    const app = Fastify()
    await app.register(async (a) => { plugin.registerRoutes!(a) }, { prefix: '/api/plugins/google_cast' })
    await app.ready()
    const res = await app.inject({ method: 'DELETE', url: `/api/plugins/google_cast/devices/${TXT_NEST_MINI.id}` })
    expect(res.statusCode).toBe(200)
    expect((ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toEqual([])
    expect(known.current).toEqual([])
    // a device already forgotten is no longer known
    expect((await app.inject({ method: 'DELETE', url: `/api/plugins/google_cast/devices/${TXT_NEST_MINI.id}` })).statusCode).toBe(404)
    await app.close()
    await plugin.stop()
  })

  it('gives a Prime Video playback its position and the app logo, without inventing a title (real capture)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_PRIME_VIDEO, MEDIA_STATUS_PRIME_VIDEO)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, undefined, primeVideoRegistry)
    const all = patches(ctx, TXT_CHROMECAST.id)
    // `duration: -0.001` means "unknown": no duration published, the position stays
    expect(all.at(-1)).toMatchObject({ playback: 'playing', nowPlaying: { title: '', positionS: 141.89, source: 'Prime Video' } })
    expect((all.at(-1) as { nowPlaying: Record<string, unknown> }).nowPlaying).not.toHaveProperty('durationS')
    await flush(8)
    // then the app logo as the fallback cover (native app → 17608BC8 in the registry), relayed by /art
    const icon = 'https://lh3.googleusercontent.com/anonymised-prime-video-icon'
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      nowPlaying: { title: '', source: 'Prime Video', artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(icon)}` },
    })
    await plugin.stop()
  })

  it('takes the app logo from the CANONICAL app id when a TV runs its own variant (real YouTube capture)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_YOUTUBE_TV, MEDIA_STATUS_YOUTUBE_TV)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, undefined, youtubeRegistry)
    // title and artist come from the app, but it publishes no image
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      playback: 'playing',
      nowPlaying: { title: 'SLOW RIVERS - Live Performance (Piano Set)', artist: 'SLOW RIVERS', durationS: 1544.541, positionS: 602.781, source: 'YouTube' },
    })
    await flush(8)
    // the logo comes through `universalAppId` (233637DE): querying `appId` (2C6A6E3D) returned nothing
    const icon = 'https://lh3.googleusercontent.com/anonymised-youtube-icon'
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      nowPlaying: { artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(icon)}` },
    })
    await plugin.stop()
  })

  it('prefers the cover of the track being played over the app logo (real YouTube + catalogue captures)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_YOUTUBE_TV, {
      ...MEDIA_STATUS_YOUTUBE_TV,
      media: { ...MEDIA_STATUS_YOUTUBE_TV.media, metadata: { metadataType: 0, title: 'Horizon', artist: 'Northwind et Lumen' } },
    })
    const catalogs: CoverFetch = vi.fn(async (url) => ({
      ok: true, status: 200,
      json: async () => (url.includes('itunes.apple.com') ? ITUNES_SEARCH_BOUNDARY : DEEZER_SEARCH_BOUNDARY),
    }))
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_CHROMECAST]), network({ [SERVICE_CHROMECAST.host]: tv }), undefined, undefined, youtubeRegistry, undefined, catalogs)
    // first what the device says, without an image: we do not make it wait for the catalog
    expect(patches(ctx, TXT_CHROMECAST.id)[0]).toMatchObject({ nowPlaying: { title: 'Horizon', artist: 'Northwind et Lumen' } })
    await flush(8)
    // then the album cover, relayed by /art — and not the YouTube logo
    const cover = 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/anonymised/199502092474_cover.jpg/600x600bb.jpg'
    expect(patches(ctx, TXT_CHROMECAST.id).at(-1)).toMatchObject({
      nowPlaying: { title: 'Horizon', artUrl: `/api/plugins/google_cast/art?url=${encodeURIComponent(cover)}` },
    })
    expect(catalogs).toHaveBeenCalledTimes(1)                            // iTunes was enough, Deezer was not called
    await plugin.stop()
  })

  it('asks a Sony TV where its sound goes and publishes it, but never asks anything else (real captures)', async () => {
    const tv = fakeReceiver(RECEIVER_STATUS_YOUTUBE_TV, MEDIA_STATUS_YOUTUBE_TV), chromecast = fakeReceiver(RECEIVER_STATUS_CHROMECAST_FIXED)
    const replies: Record<string, unknown> = { getSoundSettings: BRAVIA_SOUND_AUDIO_SYSTEM, getCurrentExternalInputsStatus: BRAVIA_INPUTS_ARC_SOUNDBAR }
    const bravia: BraviaFetch = vi.fn(async (url, init) => {
      const { method } = JSON.parse(init.body) as { method: string }
      return { ok: true, status: 200, json: async () => replies[method] }
    })
    const { plugin, ctx, clock } = await started(fakeDiscovery([SERVICE_BRAVIA, SERVICE_CHROMECAST]), network({ [SERVICE_BRAVIA.host]: tv, [SERVICE_CHROMECAST.host]: chromecast }), undefined, undefined, noRegistry, undefined, undefined, bravia)
    // reading taken during `discover`, published in one block at `start` with the rest of the state
    expect(patches(ctx, TXT_BRAVIA.id)[0]).toMatchObject({ playback: 'playing', audioOutput: { terminal: 'external', name: 'Flexus 300' } })
    // only the Sony TV is queried, and only at its address
    for (const call of (bravia as ReturnType<typeof vi.fn>).mock.calls) expect(call[0]).toMatch(`http://${SERVICE_BRAVIA.host}/sony/`)
    expect(patches(ctx, TXT_CHROMECAST.id).some((p) => 'audioOutput' in p)).toBe(false)

    // same answer ten seconds later: nothing republished (the position re-reading, however, continues)
    const audioPatches = () => patches(ctx, TXT_BRAVIA.id).filter((p) => 'audioOutput' in p)
    expect(audioPatches()).toHaveLength(1)
    clock.advance(10_000)
    await flush(6)
    expect(audioPatches()).toHaveLength(1)
    // the TV switches back to its speakers: one patch, without a device name (nothing left to name)
    replies.getSoundSettings = BRAVIA_SOUND_SPEAKER
    clock.advance(10_000)
    await flush(6)
    expect(audioPatches()).toHaveLength(2)
    expect(audioPatches().at(-1)).toEqual({ audioOutput: { terminal: 'internal' } })
    // the TV no longer answers (off): the last reading stays, nothing invented
    replies.getSoundSettings = { error: [403, 'Forbidden'] }
    clock.advance(10_000)
    await flush(6)
    expect(audioPatches()).toHaveLength(2)
    await plugin.stop()
  })

  it('reports no device found as degraded', async () => {
    const { plugin } = await started(fakeDiscovery([]), network({}))
    expect(plugin.health!()).toMatchObject({ status: 'degraded', detail: expect.stringContaining('CAST_MDNS_INTERFACE') })
    await plugin.stop()
  })
})
