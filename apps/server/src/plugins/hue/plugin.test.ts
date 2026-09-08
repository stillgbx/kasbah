import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import type { PluginScene } from '@kasbah/shared'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { HueClient } from './client'
import { createHuePlugin, hueConfigSchema } from './index'
import { DEVICES, GROUPED_LIGHTS, LIGHTS, PAIR_101, PAIR_OK, ROOMS, SCENES, SSE_FRAME, ZIGBEE, ZONES } from './__fixtures__/bridge'
import { hueSceneSchema } from './types'

const scenes = () => SCENES.map((s) => hueSceneSchema.parse(s))

const flush = () => new Promise((r) => setTimeout(r, 0))
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, body: null, json: async () => data, text: async () => JSON.stringify(data) })

/** Faux bridge : sert les fixtures, journalise les PUT, laisse le flux SSE ouvert après une trame. */
function fakeBridge(opts: { pairResponse?: unknown; lights?: unknown[] } = {}) {
  const puts: { url: string; body: unknown }[] = []
  const posts: { url: string; body: unknown }[] = []
  const deletes: string[] = []
  let sseController: ReadableStreamDefaultController<Uint8Array> | null = null
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const path = url.replace(/^https:\/\/[^/]+/, '')
    if (init?.method === 'PUT') { puts.push({ url: path, body: JSON.parse(String(init.body)) }); return json({ data: [], errors: [] }) }
    if (path === '/api' && init?.method === 'POST') return json(opts.pairResponse ?? PAIR_101)
    if (path.startsWith('/clip/v2/resource/') && init?.method === 'DELETE') {
      deletes.push(path)
      return json({ data: [{ rid: path.split('/').pop(), rtype: 'scene' }], errors: [] })
    }
    if (path.startsWith('/clip/v2/resource/') && init?.method === 'POST') {
      posts.push({ url: path, body: JSON.parse(String(init.body)) })
      return json({ data: [{ rid: 's-created', rtype: 'scene' }], errors: [] })
    }
    if (path === '/eventstream/clip/v2') {
      const body = new ReadableStream<Uint8Array>({ start(c) { sseController = c; c.enqueue(new TextEncoder().encode(SSE_FRAME)) } })
      return { ok: true, status: 200, body, json: async () => ({}), text: async () => '' }
    }
    const resource = path.replace('/clip/v2/resource/', '')
    const table: Record<string, unknown[]> = {
      light: opts.lights ?? LIGHTS, device: DEVICES, room: ROOMS, grouped_light: GROUPED_LIGHTS,
      zigbee_connectivity: ZIGBEE, scene: SCENES, zone: ZONES,
    }
    if (resource in table) return json({ errors: [], data: table[resource] })
    return json({ errors: [{ description: 'not found' }], data: [] }, 404)
  })
  return { fetchImpl, puts, posts, deletes, closeSse: () => sseController?.close() }
}

function fakeContext(config: Record<string, unknown>, clock: ManualClock) {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'hue', config, logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(),
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

  it('publishes scenes with their group and activation, recalls them, follows SSE status', async () => {
    const bridge = fakeBridge()
    const clock = new ManualClock(0)
    const plugin = createHuePlugin({ fetchImpl: bridge.fetchImpl })
    const { ctx, ctrl } = fakeContext(hueConfigSchema.parse({ HUE_BRIDGE_HOST: '10.0.0.2', HUE_APP_KEY: 'key' }), clock)
    await plugin.init(ctx)
    await plugin.start()

    const published = (ctx.emitScenes as unknown as { mock: { calls: [PluginScene[]][] } }).mock.calls.at(-1)![0]
    expect(published.map((s) => s.id)).toEqual(['hue:s-relax', 'hue:s-tropical'])
    expect(published[0]).toMatchObject({ name: 'Détente', dynamic: false, group: { name: 'Salon', kind: 'room' } })
    expect(published[1]).toMatchObject({ name: 'Crépuscule tropical', dynamic: true, group: { name: 'Soirée', kind: 'zone' } })
    expect(ctx.emitSceneState).toHaveBeenCalledWith('s-relax', 'inactive')
    expect(ctx.emitSceneState).toHaveBeenCalledWith('s-tropical', 'dynamic')

    // le pont annonce l'activation dans le flux d'événements
    await flush(); await flush()
    expect(ctx.emitSceneState).toHaveBeenCalledWith('s-relax', 'static')
    // …et le changement de réglage, d'où qu'il vienne : les scènes sont republiées
    const republished = (ctx.emitScenes as unknown as { mock: { calls: [PluginScene[]][] } }).mock.calls.at(-1)![0]
    expect(republished.find((sc) => sc.externalId === 's-tropical')!.autoDynamic).toBe(false)

    await plugin.recallScene!('s-tropical', { mode: 'dynamic' })
    expect(bridge.puts).toEqual([{ url: '/clip/v2/resource/scene/s-tropical', body: { recall: { action: 'dynamic_palette' } } }])
    clock.advance(1000)
    await plugin.recallScene!('s-relax', { mode: 'static', brightness: 50 })
    expect(bridge.puts[1]).toEqual({ url: '/clip/v2/resource/scene/s-relax', body: { recall: { action: 'static', dimming: { brightness: 50 } } } })
    // éteindre : un seul PUT sur le grouped_light de la pièce
    clock.advance(1000)
    await plugin.recallScene!('s-relax', { mode: 'off' })
    expect(bridge.puts[2]).toEqual({ url: '/clip/v2/resource/grouped_light/g-living', body: { on: { on: false } } })
    // la zone de la fixture n'a pas de grouped_light : repli lampe par lampe
    clock.advance(1000)
    await plugin.recallScene!('s-tropical', { mode: 'off' })
    expect(bridge.puts[3]).toEqual({ url: '/clip/v2/resource/light/l-color', body: { on: { on: false } } })
    await expect(plugin.recallScene!('nope', { mode: 'static' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })

    // réglage « démarrer animée » : écrit sur le pont, file distincte du rappel (aucune supplantation)
    clock.advance(1000)
    const recall = plugin.recallScene!('s-tropical', { mode: 'dynamic' })
    const setting = plugin.updateScene!('s-tropical', { autoDynamic: false })
    clock.advance(1000); await flush(); await flush()
    clock.advance(1000); await flush(); await flush()
    await Promise.all([recall, setting])
    const scenePuts = bridge.puts.filter((p) => p.url === '/clip/v2/resource/scene/s-tropical').map((p) => p.body)
    expect(scenePuts).toContainEqual({ recall: { action: 'dynamic_palette' } })
    expect(scenePuts).toContainEqual({ auto_dynamic: false })
    await expect(plugin.updateScene!('nope', { autoDynamic: true })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })

    // recopier une ambiance vers une pièce qui ne l'a pas : POST avec la palette de la source
    await plugin.createScene!('s-tropical', 'Salon')
    expect(bridge.posts).toHaveLength(1)
    const created = bridge.posts[0]!.body as { metadata: { name: string }; group: { rid: string }; actions: unknown[]; palette: unknown }
    expect(bridge.posts[0]!.url).toBe('/clip/v2/resource/scene')
    expect(created.metadata.name).toBe('Crépuscule tropical')
    expect(created.group).toEqual({ rid: 'r-living', rtype: 'room' })
    expect(created.actions).toEqual([
      { target: { rid: 'l-color', rtype: 'light' }, action: { on: { on: true }, dimming: { brightness: 44 }, color: { xy: { x: 0.4731, y: 0.3723 } } } },
      // la deuxième lampe de la pièce ne fait pas la couleur : elle retombe sur l'intensité seule
      { target: { rid: 'l-white', rtype: 'light' }, action: { on: { on: true }, dimming: { brightness: 44 } } },
    ])
    // palette recopiée sans les deux listes d'effets vides (le pont les refuse ensemble)
    expect(created.palette).toEqual({ color: scenes()[1]!.palette!.color, dimming: [], color_temperature: [] })
    // refus : ambiance déjà présente dans la pièce, pièce inconnue, source inconnue
    await expect(plugin.createScene!('s-relax', 'Salon')).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.createScene!('s-tropical', 'Cuisine')).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await expect(plugin.createScene!('nope', 'Salon')).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })

    // suppression chez le fabricant
    await plugin.deleteScene!('s-relax')
    expect(bridge.deletes).toEqual(['/clip/v2/resource/scene/s-relax'])
    await expect(plugin.deleteScene!('nope')).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
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
