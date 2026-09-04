import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { HueClient } from './client'
import { createHuePlugin, hueConfigSchema } from './index'
import { DEVICES, GROUPED_LIGHTS, LIGHTS, PAIR_101, PAIR_OK, ROOMS, SSE_FRAME, ZIGBEE } from './__fixtures__/bridge'

const flush = () => new Promise((r) => setTimeout(r, 0))
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, body: null, json: async () => data, text: async () => JSON.stringify(data) })

/** Faux bridge : sert les fixtures, journalise les PUT, laisse le flux SSE ouvert après une trame. */
function fakeBridge(opts: { pairResponse?: unknown; lights?: unknown[] } = {}) {
  const puts: { url: string; body: unknown }[] = []
  let sseController: ReadableStreamDefaultController<Uint8Array> | null = null
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const path = url.replace(/^https:\/\/[^/]+/, '')
    if (init?.method === 'PUT') { puts.push({ url: path, body: JSON.parse(String(init.body)) }); return json({ data: [], errors: [] }) }
    if (path === '/api' && init?.method === 'POST') return json(opts.pairResponse ?? PAIR_101)
    if (path === '/eventstream/clip/v2') {
      const body = new ReadableStream<Uint8Array>({ start(c) { sseController = c; c.enqueue(new TextEncoder().encode(SSE_FRAME)) } })
      return { ok: true, status: 200, body, json: async () => ({}), text: async () => '' }
    }
    const resource = path.replace('/clip/v2/resource/', '')
    const table: Record<string, unknown[]> = { light: opts.lights ?? LIGHTS, device: DEVICES, room: ROOMS, grouped_light: GROUPED_LIGHTS, zigbee_connectivity: ZIGBEE }
    if (resource in table) return json({ errors: [], data: table[resource] })
    return json({ errors: [{ description: 'not found' }], data: [] }, 404)
  })
  return { fetchImpl, puts, closeSse: () => sseController?.close() }
}

function fakeContext(config: Record<string, unknown>, clock: ManualClock) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'hue', config, logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(),
  }
  return { ctx, ctrl }
}

describe('hue plugin', () => {
  it('discovers lights, emits full states + availability, applies SSE events', async () => {
    const bridge = fakeBridge()
    const clock = new ManualClock(0)
    const plugin = createHuePlugin({ fetchImpl: bridge.fetchImpl })
    const { ctx, ctrl } = fakeContext(hueConfigSchema.parse({ HUE_BRIDGE_HOST: '10.0.0.2', HUE_APP_KEY: 'key', HUE_EXPOSE_ROOMS: 'true' }), clock)
    await plugin.init(ctx)
    const descriptors = await plugin.discover()
    expect(descriptors.map((d) => d.id).sort()).toEqual(['hue:g-living', 'hue:l-color', 'hue:l-plain', 'hue:l-white'])
    await plugin.start()
    expect(ctx.emitState).toHaveBeenCalledWith('l-color', { on: true, brightness: 64, colorTempMirek: 366, color: { x: 0.4573, y: 0.41 } })
    expect(ctx.setAvailable).toHaveBeenCalledWith('l-white', false)
    await flush(); await flush()
    // trame SSE : deux fragments pour l-color, reconnectivité de d-white
    expect(ctx.emitState).toHaveBeenCalledWith('l-color', { brightness: 20 })
    expect(ctx.emitState).toHaveBeenCalledWith('l-color', { color: { x: 0.2, y: 0.3 } })
    expect(ctx.setAvailable).toHaveBeenCalledWith('l-white', true)
    expect(plugin.health!().status).toBe('ok')
    // commande → PUT avec le bon en-tête et corps
    await plugin.execute('l-color', { type: 'light.set', brightness: 50, colorTempMirek: 250 })
    expect(bridge.puts).toEqual([{ url: '/clip/v2/resource/light/l-color', body: { on: { on: true }, dimming: { brightness: 50 }, color_temperature: { mirek: 250 } } }])
    const putCall = bridge.fetchImpl.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect((putCall[1]!.headers as Record<string, string>)['hue-application-key']).toBe('key')
    await plugin.execute('g-living', { type: 'light.set', on: false })
    expect(bridge.puts[1]!.url).toBe('/clip/v2/resource/grouped_light/g-living')
    await expect(plugin.execute('l-color', { type: 'cover.open' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('nope', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    ctrl.abort()
    await plugin.stop()
  })

  it('without key: needs_pairing, 409 until the button is pressed, then adopts the key', async () => {
    const bridge = fakeBridge({ pairResponse: PAIR_101 })
    const clock = new ManualClock(0)
    const plugin = createHuePlugin({ fetchImpl: bridge.fetchImpl })
    const { ctx } = fakeContext(hueConfigSchema.parse({ HUE_BRIDGE_HOST: '10.0.0.2' }), clock)
    await plugin.init(ctx)
    expect(await plugin.discover()).toEqual([])
    await plugin.start()
    expect(plugin.health!().status).toBe('needs_pairing')
    await expect(plugin.execute('l-color', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'NEEDS_PAIRING' })

    const app = Fastify()
    app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/hue' })
    await app.ready()
    const r1 = await app.inject({ method: 'POST', url: '/api/plugins/hue/pair' })
    expect(r1.statusCode).toBe(409)
    expect(r1.json().error.code).toBe('LINK_BUTTON_NOT_PRESSED')

    bridge.fetchImpl.mockImplementationOnce(async () => json(PAIR_OK))
    const r2 = await app.inject({ method: 'POST', url: '/api/plugins/hue/pair' })
    expect(r2.statusCode).toBe(200)
    expect(r2.json().appKey).toBe('abcdefgh-app-key')
    expect(ctx.emitDevices).toHaveBeenCalled()
    expect(plugin.health!().status).toBe('ok')
    await plugin.stop()
    await app.close()
  })

  it('client supersedes pending PUTs on the same resource under rate limiting', async () => {
    const clock = new ManualClock(0)
    const bridge = fakeBridge()
    const client = new HueClient({ host: 'b', appKey: 'k', clock, fetchImpl: bridge.fetchImpl, insecureTls: false })
    const p1 = client.putLimited('grouped_light', 'g', { on: { on: true } })
    const p2 = client.putLimited('grouped_light', 'g', { dimming: { brightness: 10 } })
    const p3 = client.putLimited('grouped_light', 'g', { dimming: { brightness: 30 } })
    await flush()
    expect(bridge.puts.map((p) => p.body)).toEqual([{ on: { on: true } }])
    clock.advance(1000); await flush(); await flush()
    expect(bridge.puts.map((p) => p.body)).toEqual([{ on: { on: true } }, { dimming: { brightness: 30 } }])
    await Promise.all([p1, p2, p3])
  })
})
