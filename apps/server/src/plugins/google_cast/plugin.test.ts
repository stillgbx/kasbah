import { ManualClock } from '@kasbah/mock-sim'
import { Duplex, PassThrough } from 'node:stream'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import {
  MEDIA_STATUS_PLAYING, RECEIVER_STATUS_CHROMECAST_FIXED, RECEIVER_STATUS_NEST_HUB_IDLE, RECEIVER_STATUS_PLAYING, SERVICE_CHROMECAST,
  SERVICE_NEST_HUB, SERVICE_NEST_MINI, TXT_CHROMECAST, TXT_NEST_HUB, TXT_NEST_MINI,
} from './__fixtures__/network'
import type { SocketFactory } from './channel'
import type { CastDiscovery } from './discovery'
import { createGoogleCastPlugin, googleCastConfigSchema } from './index'
import { FrameDecoder, NS_HEARTBEAT, NS_MEDIA, NS_RECEIVER, encodeFrame, jsonMessage } from './protocol'
import type { CastService } from './types'

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

interface Sent { namespace: string; destination: string; body: Record<string, unknown> }

/**
 * Faux récepteur Cast au bout d'une socket en mémoire : répond aux GET_STATUS, SET_VOLUME, PING et
 * aux commandes média avec le `requestId` reçu, comme le vrai. `receiver` et `media` sont ses états
 * courants, modifiables par le test ; `push` envoie un état non sollicité.
 */
function fakeReceiver(receiver: Record<string, unknown>, media?: Record<string, unknown>) {
  const sent: Sent[] = []
  const toReceiver = new PassThrough(), fromReceiver = new PassThrough()
  const decoder = new FrameDecoder()
  const state = { receiver: structuredClone(receiver), media: media ? structuredClone(media) : undefined, sent, closed: false }
  const reply = (to: string, namespace: string, body: Record<string, unknown>) => { if (!state.closed) fromReceiver.write(encodeFrame(jsonMessage(to === 'sender-0' ? 'receiver-0' : to, 'sender-0', namespace, body))) }
  const mediaStatus = (requestId: number | undefined) => ({ type: 'MEDIA_STATUS', requestId, status: state.media ? [state.media] : [] })
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
        reply(m.destinationId, NS_RECEIVER, { type: 'RECEIVER_STATUS', requestId, status: state.receiver })
      }
      if (m.namespace === NS_MEDIA) {
        if (!state.media) { reply(m.destinationId, NS_MEDIA, { type: 'INVALID_REQUEST', requestId, reason: 'INVALID_MEDIA_SESSION_ID' }); continue }
        if (body.type === 'PAUSE') state.media.playerState = 'PAUSED'
        if (body.type === 'PLAY') state.media.playerState = 'PLAYING'
        reply(m.destinationId, NS_MEDIA, mediaStatus(requestId))
      }
    }
  })
  const socket = Duplex.from({ writable: toReceiver, readable: fromReceiver })
  return {
    state, sent, socket,
    push(receiver: Record<string, unknown>) { state.receiver = structuredClone(receiver); reply('sender-0', NS_RECEIVER, { type: 'RECEIVER_STATUS', status: state.receiver }) },
    pushMedia(media: Record<string, unknown> | undefined, transportId: string) { state.media = media ? structuredClone(media) : undefined; if (!state.closed) fromReceiver.write(encodeFrame(jsonMessage(transportId, 'sender-0', NS_MEDIA, mediaStatus(undefined)))) },
    /** L'appareil coupe (redémarrage, Wi-Fi perdu). */
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

function fakeContext(clock: ManualClock) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'google_cast', config: googleCastConfigSchema.parse({ CAST_DISCOVERY_WAIT_MS: '1000' }), logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
  }
  return { ctx, ctrl }
}

/** Câble un faux récepteur par hôte ; un hôte absent est injoignable. */
function network(receivers: Record<string, ReturnType<typeof fakeReceiver>>) {
  const connect: SocketFactory = vi.fn(async (host) => {
    const r = receivers[host]
    if (!r) throw new Error(`connect ECONNREFUSED ${host}`)
    return r.socket
  })
  return connect
}

async function started(discovery: CastDiscovery, connect: SocketFactory) {
  const clock = new ManualClock(0)
  const { ctx, ctrl } = fakeContext(clock)
  const plugin = createGoogleCastPlugin({ discovery, connect })
  await plugin.init(ctx)
  const p = plugin.discover()
  await flush()
  clock.advance(1000)                                            // fin de la fenêtre d'écoute mDNS
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
    expect(descriptors[1]!.capabilities).not.toContain('volume')          // volume `fixed` connu dès le premier état
    // le récepteur a reçu CONNECT puis GET_STATUS
    expect(hub.sent.map((s) => s.body.type)).toEqual(['CONNECT', 'GET_STATUS'])
    // rien n'est publié pendant discover (les appareils ne sont pas encore enregistrés) : un seul patch complet au start
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

    // l'enceinte revient : la nouvelle tentative (backoff 5 s ± gigue) la trouve
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
    // connexion au canal de l'appli, puis état média demandé
    expect(speaker.sent.filter((s) => s.destination === transportId).map((s) => s.body.type)).toEqual(['CONNECT', 'GET_STATUS'])
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ playback: 'playing', nowPlaying: { title: 'Terracotta', artist: 'Mira Solano', source: 'Spotify' } })

    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.pause' })
    expect(speaker.of('PAUSE')[0]).toMatchObject({ destination: transportId, body: { mediaSessionId: 1 } })
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toMatchObject({ playback: 'paused' })

    await plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.next' })
    expect(speaker.of('QUEUE_UPDATE')[0]!.body).toMatchObject({ jump: 1, mediaSessionId: 1 })
    expect(plugin.health!()).toMatchObject({ detail: expect.stringContaining('1 connected') })
    await plugin.stop()
  })

  it('clears the track when the app stops, and refuses play when nothing plays', async () => {
    const speaker = fakeReceiver(RECEIVER_STATUS_PLAYING, MEDIA_STATUS_PLAYING)
    const { plugin, ctx } = await started(fakeDiscovery([SERVICE_NEST_MINI]), network({ [SERVICE_NEST_MINI.host]: speaker }))
    speaker.push(RECEIVER_STATUS_NEST_HUB_IDLE)                           // Spotify fermé, écran de veille
    await flush()
    expect(patches(ctx, TXT_NEST_MINI.id).at(-1)).toEqual({ playback: 'idle', nowPlaying: null })
    await expect(plugin.execute(TXT_NEST_MINI.id, { type: 'media_player.play' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND', message: expect.stringContaining('nothing is playing') })
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
    expect(hub.of('PING')).toHaveLength(1)                                 // notre battement de cœur, et le PONG est revenu
    hub.state.closed = true                                                // l'appareil ne répond plus, sans fermer
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

  it('reports no device found as degraded', async () => {
    const { plugin } = await started(fakeDiscovery([]), network({}))
    expect(plugin.health!()).toMatchObject({ status: 'degraded', detail: expect.stringContaining('CAST_MDNS_INTERFACE') })
    await plugin.stop()
  })
})
