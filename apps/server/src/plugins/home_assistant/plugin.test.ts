import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManualClock } from '@kasbah/mock-sim'
import Fastify from 'fastify'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceDescriptor } from '@kasbah/shared'
import type { PluginContext } from '../../core/plugin'
import states from './__fixtures__/states.json'
import type { WsLike } from './client'
import { createHomeAssistantPlugin, homeAssistantConfigSchema, type HaEntitiesResponse } from './index'

const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

const REGISTRY = {
  'config/entity_registry/list': [
    { entity_id: 'light.lampe_1', area_id: 'salon', platform: 'hue' },
    { entity_id: 'cover.volet_1', area_id: 'salon', platform: 'overkiz' },
    { entity_id: 'cover.volet_1_low_speed', area_id: 'salon', platform: 'overkiz' },
    { entity_id: 'media_player.enceinte_1', area_id: 'salon', platform: 'cast' },
  ],
  'config/device_registry/list': [],
  'config/area_registry/list': [{ area_id: 'salon', name: 'Salon' }],
}

const IN_REGISTRY = Object.fromEntries(REGISTRY['config/entity_registry/list'].map((e) => [e.entity_id, true]))

/** Fake Home Assistant: answers the WebSocket API with the fixture, records what it is sent. */
function fakeHa() {
  const ha = { sent: [] as Record<string, unknown>[], socket: null as WsLike | null }
  const push = (msg: unknown) => ha.socket!.onmessage!({ data: JSON.stringify(msg) })
  const wsFactory = (): WsLike => {
    const ws: WsLike = {
      readyState: 1, onopen: null, onmessage: null, onclose: null, onerror: null,
      close: () => { ws.onclose?.({}) },
      send: (raw) => {
        const msg = JSON.parse(raw) as Record<string, unknown>
        ha.sent.push(msg)
        setImmediate(() => {
          if (msg.type === 'auth') return push({ type: 'auth_ok' })
          const result = msg.type === 'get_states' ? states : (REGISTRY as Record<string, unknown>)[msg.type as string] ?? null
          push({ type: 'result', id: msg.id, success: true, result })
        })
      },
    }
    ha.socket = ws
    setImmediate(() => push({ type: 'auth_required' }))
    return ws
  }
  const event = (entityId: string, state: unknown) =>
    push({ type: 'event', event: { event_type: 'state_changed', data: { entity_id: entityId, new_state: state } } })
  return { ha, wsFactory, event }
}

let dir = ''
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

async function setup(enabled: string[] = []) {
  dir = await mkdtemp(join(tmpdir(), 'kasbah-ha-'))
  const file = join(dir, 'home-assistant.json')
  const { ha, wsFactory, event } = fakeHa()
  const plugin = createHomeAssistantPlugin({ wsFactory })
  const plugins = [...enabled]
  const ctx: PluginContext = {
    pluginId: 'home_assistant',
    config: homeAssistantConfigSchema.parse({ HA_URL: 'http://192.168.1.10:8123', HA_TOKEN: 'test-token', HA_STATE_FILE: file }),
    logger: pino({ level: 'silent' }), clock: new ManualClock(0), signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47, lon: 5, alt: 0 }, enabledPlugins: () => plugins,
  }
  const app = Fastify()
  await app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/home_assistant' })
  await plugin.init(ctx)
  await plugin.discover()
  await plugin.start()
  await flush(30)
  const shownIds = () => {
    const calls = vi.mocked(ctx.emitDevices).mock.calls
    // the other fixture entities have no registry entry (YAML entities): shown too, left out here
    return (calls.at(-1)?.[0] ?? []).map((d: DeviceDescriptor) => d.externalId).filter((id) => id in IN_REGISTRY).sort()
  }
  return { plugin, ctx, app, ha, event, file, plugins, shownIds }
}

describe('Home Assistant plugin', () => {
  it('subscribes before reading the states, then shows every entity', async () => {
    const { ha, shownIds } = await setup()
    const types = ha.sent.map((m) => m.type)
    expect(types.indexOf('subscribe_events')).toBeLessThan(types.indexOf('get_states'))
    expect(shownIds()).toEqual(['cover.volet_1', 'light.lampe_1', 'media_player.enceinte_1'])
  })

  it('leaves out what a native plugin that is on provides, and follows it being turned off', async () => {
    const { plugin, plugins, shownIds } = await setup(['hue'])
    expect(shownIds()).toEqual(['cover.volet_1', 'media_player.enceinte_1'])
    plugins.length = 0
    plugin.onPluginsChanged!()
    expect(shownIds()).toEqual(['cover.volet_1', 'light.lampe_1', 'media_player.enceinte_1'])
  })

  it('lists the entities with their integration, applies and keeps a choice', async () => {
    const { app, file, shownIds } = await setup(['hue'])
    const list = (await app.inject({ method: 'GET', url: '/api/plugins/home_assistant/entities' })).json() as HaEntitiesResponse
    expect(list.connected).toBe(true)
    expect(list.entities.find((e) => e.entityId === 'light.lampe_1')).toMatchObject({ integration: 'hue', room: 'Salon', shown: false, chosen: false, duplicateOf: 'hue' })

    const r = await app.inject({ method: 'PATCH', url: '/api/plugins/home_assistant/entities', payload: { choices: { 'light.lampe_1': true, 'cover.volet_1': false } } })
    expect(r.statusCode).toBe(200)
    expect(shownIds()).toEqual(['light.lampe_1', 'media_player.enceinte_1'])
    expect(JSON.parse(await readFile(file, 'utf8')).choices).toEqual({ 'light.lampe_1': true, 'cover.volet_1': false })

    // `null`: back to the default
    await app.inject({ method: 'PATCH', url: '/api/plugins/home_assistant/entities', payload: { choices: { 'cover.volet_1': null } } })
    expect(shownIds()).toEqual(['cover.volet_1', 'light.lampe_1', 'media_player.enceinte_1'])
    expect((await app.inject({ method: 'PATCH', url: '/api/plugins/home_assistant/entities', payload: { choices: 'all' } })).statusCode).toBe(400)
  })

  it('a hidden entity is not driven and its states are not pushed', async () => {
    const { plugin, app, ctx, event } = await setup()
    await app.inject({ method: 'PATCH', url: '/api/plugins/home_assistant/entities', payload: { choices: { 'light.lampe_1': false } } })
    vi.mocked(ctx.emitState).mockClear()
    event('light.lampe_1', { entity_id: 'light.lampe_1', state: 'off', attributes: {} })
    expect(ctx.emitState).not.toHaveBeenCalled()
    await expect(plugin.execute('light.lampe_1', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
  })

  it('quiet mode drives the slow twin and survives a restart', async () => {
    const { plugin, ctx, ha, file } = await setup()
    await plugin.execute('cover.volet_1', { type: 'cover.set_quiet', on: true })
    expect(JSON.parse(await readFile(file, 'utf8')).quiet).toEqual(['cover.volet_1'])
    await plugin.execute('cover.volet_1', { type: 'cover.close' })
    expect(ha.sent.at(-1)).toMatchObject({ type: 'call_service', service: 'close_cover', target: { entity_id: 'cover.volet_1_low_speed' } })

    await plugin.stop()
    await plugin.init(ctx)
    await plugin.start()
    await flush(30)
    expect(vi.mocked(ctx.emitState).mock.calls.filter(([id]) => id === 'cover.volet_1').at(-1)?.[1]).toMatchObject({ quiet: true })
  })

  it('serves the current cover of a player through the server, with the HA token', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }))
    dir = await mkdtemp(join(tmpdir(), 'kasbah-ha-'))
    const { wsFactory } = fakeHa()
    const plugin = createHomeAssistantPlugin({ wsFactory, fetchImpl })
    const ctx = {
      pluginId: 'home_assistant',
      config: homeAssistantConfigSchema.parse({ HA_URL: 'http://192.168.1.10:8123/', HA_TOKEN: 'test-token', HA_STATE_FILE: join(dir, 'ha.json') }),
      logger: pino({ level: 'silent' }), clock: new ManualClock(0), signal: new AbortController().signal,
      emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
      parts: {}, site: { lat: 47, lon: 5, alt: 0 },
    } satisfies PluginContext
    const app = Fastify()
    await app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/home_assistant' })
    await plugin.init(ctx)
    await plugin.start()
    await flush(30)

    const r = await app.inject({ method: 'GET', url: '/api/plugins/home_assistant/art/media_player.enceinte_1?v=f00d' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('image/jpeg')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://192.168.1.10:8123/api/media_player_proxy/media_player.enceinte_1?token=abc123&cache=f00d',
      expect.objectContaining({ headers: { authorization: 'Bearer test-token' } }),
    )
    // not an open relay: an unknown or picture-less entity gets nothing
    expect((await app.inject({ method: 'GET', url: '/api/plugins/home_assistant/art/media_player.tv_1' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/plugins/home_assistant/art/light.lampe_1' })).statusCode).toBe(404)
  })
})
