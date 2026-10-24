import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import {
  DESC_PLAY3, DESC_PORT, HLS_ART, HOST_PLAY3, HOST_PORT, SOAP_MUTE_0, SOAP_OK, SOAP_PLAYING, SOAP_POSITION_IDLE,
  SOAP_POSITION_PLAYING, SOAP_STOPPED, SOAP_VOLUME_21, SOAP_VOLUME_8, SOAP_ZONES, UUID_PLAY3, UUID_PORT,
  ZP_PLAY3, ZP_PORT,
} from './__fixtures__/network'
import type { SonosDiscovery } from './discovery'
import { createSonosPlugin, sonosConfigSchema } from './index'
import type { SonosPlayer } from './types'

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

const PLAYER_PORT: SonosPlayer = { uuid: UUID_PORT, host: HOST_PORT, name: 'Bureau', model: 'Sonos Port' }
const PLAYER_PLAY3: SonosPlayer = { uuid: UUID_PLAY3, host: HOST_PLAY3, name: 'Cuisine', model: 'Sonos Play:3' }

function header(init: RequestInit | undefined, name: string): string {
  const h = init?.headers
  if (!h) return ''
  if (h instanceof Headers) return h.get(name) ?? ''
  const rec = h as Record<string, string>
  return rec[name] ?? rec[name.toLowerCase()] ?? ''
}

function actionOf(init: RequestInit | undefined): string {
  return header(init, 'SOAPAction')
}

function textRes(body: string, status = 200) {
  return { ok: status < 400, status, body: null, json: async () => ({}), text: async () => body }
}

function fakeNetwork(opts: { playing?: boolean } = {}) {
  const calls: { url: string; action: string }[] = []
  const playing = { value: opts.playing ?? false }
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const u = String(url)
    const action = actionOf(init)
    calls.push({ url: u, action })
    if (u.endsWith('/status/zp')) return textRes(u.includes(HOST_PORT) ? ZP_PORT : ZP_PLAY3)
    if (u.endsWith('/xml/device_description.xml')) return textRes(u.includes(HOST_PORT) ? DESC_PORT : DESC_PLAY3)
    if (action.includes('GetVolume')) return textRes(u.includes(HOST_PORT) ? SOAP_VOLUME_21 : SOAP_VOLUME_8)
    if (action.includes('GetMute')) return textRes(SOAP_MUTE_0)
    if (action.includes('GetTransportInfo')) return textRes(playing.value ? SOAP_PLAYING : SOAP_STOPPED)
    if (action.includes('GetPositionInfo')) return textRes(playing.value ? SOAP_POSITION_PLAYING : SOAP_POSITION_IDLE)
    if (action.includes('GetZoneGroupState')) return textRes(SOAP_ZONES)
    if (action.includes('#Play') || action.includes('#Pause') || action.includes('#Stop') || action.includes('#Next') || action.includes('#Previous') || action.includes('#Seek') || action.includes('#SetVolume') || action.includes('#SetMute') || action.includes('#SetAVTransportURI')) {
      if (action.includes('#Play')) playing.value = true
      if (action.includes('#Pause') || action.includes('#Stop')) playing.value = false
      return textRes(SOAP_OK)
    }
    return textRes('', 404)
  })
  return { fetchImpl, calls, playing }
}

function fakeDiscovery(initial: { uuid: string; host: string }[] = []) {
  let onUp: ((p: { uuid: string; host: string }) => void) | null = null
  const d: SonosDiscovery & { announce(p: { uuid: string; host: string }): void } = {
    start: vi.fn((cb) => { onUp = cb; for (const p of initial) cb(p) }),
    refresh: vi.fn(), stop: vi.fn(),
    announce(p) { onUp?.(p) },
  }
  return d
}

function fakeKnown(initial: SonosPlayer[] = []) {
  let devices = initial
  return {
    async load() { return devices },
    async save(players: SonosPlayer[]) { devices = players },
    get current() { return devices },
  }
}

function fakeContext(clock: ManualClock) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'sonos',
    config: sonosConfigSchema.parse({ SONOS_KNOWN_FILE: '', SONOS_POLL_MS: '2000', SONOS_SSDP_REFRESH_MS: '60000' }),
    logger: pino({ level: 'silent' }),
    clock,
    signal: ctrl.signal,
    emitState: vi.fn(),
    setAvailable: vi.fn(),
    emitDevices: vi.fn(),
    emitScenes: vi.fn(),
    emitSceneState: vi.fn(),
    emitEvent: vi.fn(),
    parts: {},
    site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  return { ctx, ctrl }
}

async function started(net: ReturnType<typeof fakeNetwork>, discovery: ReturnType<typeof fakeDiscovery>, known?: ReturnType<typeof fakeKnown>) {
  const clock = new ManualClock(0)
  const { ctx, ctrl } = fakeContext(clock)
  const plugin = createSonosPlugin({ discovery, fetchImpl: net.fetchImpl, known: known ?? fakeKnown() })
  await plugin.init(ctx)
  const descriptors = await plugin.discover()
  await plugin.start()
  await flush(12)
  return { plugin, ctx, ctrl, clock, descriptors }
}

const patches = (ctx: PluginContext, externalId: string) =>
  (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === externalId).map((c) => c[1] as Record<string, unknown>)

describe('sonos plugin', () => {
  it('discover() does no network and replays known devices', async () => {
    const net = fakeNetwork()
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const plugin = createSonosPlugin({ discovery: fakeDiscovery(), fetchImpl: net.fetchImpl, known: fakeKnown([PLAYER_PORT]) })
    await plugin.init(ctx)
    const descriptors = await plugin.discover()
    expect(net.fetchImpl).not.toHaveBeenCalled()
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]!.name).toBe('Bureau')
    expect(descriptors[0]!.externalId).toBe(UUID_PORT)
    await plugin.stop()
  })

  it('polls captured SOAP and publishes idle state', async () => {
    const net = fakeNetwork()
    const { plugin, ctx } = await started(net, fakeDiscovery(), fakeKnown([PLAYER_PORT, PLAYER_PLAY3]))
    expect(patches(ctx, UUID_PORT)[0]).toEqual({ volume: 21, muted: false, playback: 'idle', nowPlaying: null })
    expect(patches(ctx, UUID_PLAY3)[0]).toEqual({ volume: 8, muted: false, playback: 'idle', nowPlaying: null })
    expect(plugin.health!()).toEqual({ status: 'ok', detail: '2 device(s), 2 reachable' })
    await plugin.stop()
  })

  it('identifies a player announced over SSDP', async () => {
    const net = fakeNetwork()
    const discovery = fakeDiscovery()
    const { plugin, ctx } = await started(net, discovery, fakeKnown())
    expect(ctx.emitDevices).toHaveBeenCalledWith([])
    discovery.announce({ uuid: UUID_PORT, host: HOST_PORT })
    await flush(12)
    const lists = (ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as { name: string }[])
    expect(lists.at(-1)?.map((d) => d.name)).toEqual(['Bureau'])
    await plugin.stop()
  })

  it('acks play / pause / volume and seeks to 0 past three seconds on previous', async () => {
    const net = fakeNetwork({ playing: true })
    const { plugin } = await started(net, fakeDiscovery(), fakeKnown([PLAYER_PORT]))
    await plugin.execute(UUID_PORT, { type: 'media_player.set_volume', volume: 12 })
    await plugin.execute(UUID_PORT, { type: 'media_player.previous' })
    const actions = net.calls.map((c) => c.action).filter(Boolean)
    expect(actions.some((a) => a.includes('SetVolume'))).toBe(true)
    expect(actions.some((a) => a.includes('#Seek'))).toBe(true)
    expect(actions.some((a) => a.includes('#Previous'))).toBe(false)
    await plugin.execute(UUID_PORT, { type: 'media_player.pause' })
    await plugin.stop()
  })

  it('refuses a command for an unknown player', async () => {
    const net = fakeNetwork()
    const { plugin } = await started(net, fakeDiscovery(), fakeKnown([PLAYER_PORT]))
    await expect(plugin.execute('RINCON_NOPE01400', { type: 'media_player.play' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await plugin.stop()
  })

  it('forgets a remembered player on DELETE', async () => {
    const net = fakeNetwork()
    const known = fakeKnown([PLAYER_PORT])
    const { plugin } = await started(net, fakeDiscovery(), known)
    const app = Fastify({ logger: false })
    await app.register(async (a) => { plugin.registerRoutes!(a) }, { prefix: '/api/plugins/sonos' })
    const r = await app.inject({ method: 'DELETE', url: `/api/plugins/sonos/devices/${UUID_PORT}` })
    expect(r.statusCode).toBe(200)
    expect(known.current).toEqual([])
    await plugin.stop()
    await app.close()
  })

  it('exposes last raw state', async () => {
    const net = fakeNetwork()
    const { plugin } = await started(net, fakeDiscovery(), fakeKnown([PLAYER_PORT]))
    const app = Fastify({ logger: false })
    await app.register(async (a) => { plugin.registerRoutes!(a) }, { prefix: '/api/plugins/sonos' })
    const r = await app.inject({ method: 'GET', url: '/api/plugins/sonos/raw' })
    expect(r.statusCode).toBe(200)
    expect(r.json().devices[0].player.uuid).toBe(UUID_PORT)
    expect(r.json().devices[0].volume).toBe(21)
    await plugin.stop()
    await app.close()
  })

  it('serves captured artwork through /art after decoding XML entities in getaa', async () => {
    const net = fakeNetwork({ playing: true })
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer
    const speakerUrl = `http://${HOST_PLAY3}:1400${HLS_ART}`
    const artFetch = vi.fn(async (url: string) => {
      expect(url).toBe(speakerUrl)
      expect(url).not.toContain('&amp;')
      return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => jpeg }
    })
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const plugin = createSonosPlugin({ discovery: fakeDiscovery(), fetchImpl: net.fetchImpl, known: fakeKnown([PLAYER_PLAY3]), artFetch })
    await plugin.init(ctx)
    await plugin.start()
    await flush(12)
    const artUrl = (patches(ctx, UUID_PLAY3)[0] as { nowPlaying: { artUrl: string } }).nowPlaying.artUrl
    expect(artUrl).toBe(`/api/plugins/sonos/art?url=${encodeURIComponent(speakerUrl)}`)
    const app = Fastify({ logger: false })
    await app.register(async (a) => { plugin.registerRoutes!(a) }, { prefix: '/api/plugins/sonos' })
    const r = await app.inject({ method: 'GET', url: artUrl })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('image/jpeg')
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
    expect(artFetch).toHaveBeenCalledOnce()
    await plugin.stop()
    await app.close()
  })

  it('never relays through /art anything but a raster image (a page or an SVG would run under Kasbah’s origin)', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/javascript']) {
      const net = fakeNetwork({ playing: true })
      const artFetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => type }, arrayBuffer: async () => new TextEncoder().encode('<script>x</script>').buffer }))
      const { ctx } = fakeContext(new ManualClock(0))
      const plugin = createSonosPlugin({ discovery: fakeDiscovery(), fetchImpl: net.fetchImpl, known: fakeKnown([PLAYER_PLAY3]), artFetch })
      await plugin.init(ctx)
      await plugin.start()
      await flush(12)
      const artUrl = (patches(ctx, UUID_PLAY3)[0] as { nowPlaying: { artUrl: string } }).nowPlaying.artUrl
      const app = Fastify({ logger: false })
      await app.register(async (a) => { plugin.registerRoutes!(a) }, { prefix: '/api/plugins/sonos' })
      const r = await app.inject({ method: 'GET', url: artUrl })
      expect(r.statusCode, type).toBe(502)
      expect(r.body, type).not.toContain('<script>')
      await plugin.stop()
      await app.close()
    }
  })

  it('rebuilds its list from known on init after stop (closure must not keep stale entries)', async () => {
    const net = fakeNetwork()
    const known = fakeKnown([PLAYER_PORT])
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const plugin = createSonosPlugin({ discovery: fakeDiscovery(), fetchImpl: net.fetchImpl, known })
    await plugin.init(ctx)
    expect((await plugin.discover()).map((d) => d.externalId)).toEqual([UUID_PORT])
    await plugin.stop()
    const second = fakeContext(new ManualClock(0))
    await plugin.init(second.ctx)
    expect((await plugin.discover()).map((d) => d.externalId)).toEqual([UUID_PORT])
    await plugin.stop()
  })

  it('sets AVTransport URI then Plays for play_url', async () => {
    const net = fakeNetwork()
    const { plugin } = await started(net, fakeDiscovery(), fakeKnown([PLAYER_PLAY3]))
    const url = 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3'
    await plugin.execute(UUID_PLAY3, { type: 'media_player.play_url', url })
    const actions = net.calls.map((c) => c.action).filter(Boolean)
    const set = actions.findIndex((a) => a.includes('#SetAVTransportURI'))
    const play = actions.findIndex((a) => a.includes('#Play'))
    expect(set).toBeGreaterThanOrEqual(0)
    expect(play).toBeGreaterThan(set)
    expect(net.playing.value).toBe(true)
    await plugin.stop()
  })

  it('emits sticky title and art after play_url with meta', async () => {
    const net = fakeNetwork()
    const { plugin, ctx } = await started(net, fakeDiscovery(), fakeKnown([PLAYER_PLAY3]))
    const url = 'http://192.168.1.10:8787/api/plugins/ytmusic/stream/abc'
    await plugin.execute(UUID_PLAY3, {
      type: 'media_player.play_url',
      url,
      title: 'Horizon',
      artist: 'Mira Solano',
      artUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
    })
    const last = patches(ctx, UUID_PLAY3).at(-1)
    expect(last).toMatchObject({
      playback: 'playing',
      nowPlaying: {
        title: 'Horizon',
        artist: 'Mira Solano',
        artUrl: expect.stringContaining(encodeURIComponent('https://i.ytimg.com/vi/x/hqdefault.jpg')),
      },
    })
    await plugin.stop()
  })
})

// The /art relay fetches with the real fetch here (no `artFetch`): what the server may reach.
describe('sonos /art reach', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  const imageServer = async (port = 0) => {
    let hits = 0
    const server = createServer((_req, res) => { hits++; res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(JPEG) })
    server.listen(port, '127.0.0.1')
    await once(server, 'listening')
    return { port: (server.address() as AddressInfo).port, hits: () => hits, close: () => new Promise((ok) => server.close(ok)) }
  }
  const coverOf = async (plugin: ReturnType<typeof createSonosPlugin>, ctx: PluginContext, artUrl: string) => {
    await plugin.execute(UUID_PLAY3, { type: 'media_player.play_url', url: 'https://example.org/live.mp3', title: 'T', artUrl })
    const app = Fastify({ logger: false })
    await app.register(async (a) => { plugin.registerRoutes!(a) }, { prefix: '/api/plugins/sonos' })
    const proxied = (patches(ctx, UUID_PLAY3).at(-1) as { nowPlaying: { artUrl: string } }).nowPlaying.artUrl
    const res = await app.inject({ method: 'GET', url: proxied })
    await app.close()
    return res
  }

  it('never fetches a local address that is not one of our speakers', async () => {
    const local = await imageServer()
    const { plugin, ctx } = await started(fakeNetwork(), fakeDiscovery(), fakeKnown([PLAYER_PLAY3]))
    const res = await coverOf(plugin, ctx, `http://127.0.0.1:${local.port}/router.jpg`)
    expect(res.statusCode).toBe(502)
    expect(local.hits()).toBe(0)
    await plugin.stop()
    await local.close()
  })

  it('still fetches the cover a known speaker serves on its port 1400', async (t) => {
    const speaker = await imageServer(1400).catch(() => null)
    if (!speaker) return t.skip()                        // port 1400 taken on this machine
    // the speaker lives on this machine: its group description must say so too, or it moves back
    const net = fakeNetwork()
    const base = net.fetchImpl.getMockImplementation()!
    net.fetchImpl.mockImplementation(async (url, init) => (actionOf(init).includes('GetZoneGroupState')
      ? textRes(SOAP_ZONES.replaceAll(HOST_PLAY3, '127.0.0.1'))
      : base(url, init)))
    const { plugin, ctx } = await started(net, fakeDiscovery(), fakeKnown([{ ...PLAYER_PLAY3, host: '127.0.0.1' }]))
    const res = await coverOf(plugin, ctx, 'http://127.0.0.1:1400/getaa?s=1&u=x')
    expect(res.statusCode).toBe(200)
    expect(speaker.hits()).toBe(1)
    await plugin.stop()
    await speaker.close()
  })
})
