import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ManualClock } from '@kasbah/mock-sim'
import { DEVICE_KINDS, serverMessageSchema, type ServerMessage } from '@kasbah/shared'
import pino from 'pino'
import WebSocket from 'ws'
import { buildApp, type KasbahApp } from '../src/app'
import { loadEnv } from '../src/config/env'

const HOUSE = resolve(import.meta.dirname, '../../../house/demo-house.json')
const MONDAY = Date.UTC(2026, 8, 7, 12)

async function makeApp(scenario: string, extraEnv: Record<string, string> = {}, houseFile = HOUSE) {
  const clock = new ManualClock(MONDAY)
  // which plugins run comes from the HOUSE: demo-house.json has no `plugins` section,
  // so the schema default applies (mock alone, all its kinds)
  const env = loadEnv({ KASBAH_HOUSE_FILE: houseFile, KASBAH_LOG_LEVEL: 'silent' })
  const kasbah = await buildApp({
    env, logger: pino({ level: 'silent' }), clock, serveStatic: false,
    envSource: { MOCK_SCENARIO: scenario, MOCK_SEED: '3', MOCK_START_TIME: new Date(MONDAY).toISOString(), ...extraEnv },
  })
  await kasbah.app.ready()
  await kasbah.startPlugins()
  return { kasbah, clock }
}

// The simulation must be able to COMPLEMENT a real device set instead of duplicating it: as soon as
// a real plugin covers a kind, its simulated equivalents no longer need to clutter the lists as
// "off-plan". The choice is made in the UI (the plugin's sub-items) and written into house.json.
describe('mock plugin sub-items', () => {
  async function withTempHouse(fn: (kasbah: KasbahApp, file: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-plugins-'))
    const file = join(dir, 'house.json')
    await copyFile(HOUSE, file)
    const { kasbah } = await makeApp('default', {}, file)
    try { await fn(kasbah, file) } finally { await kasbah.close(); await rm(dir, { recursive: true, force: true }) }
  }

  const kindsOf = async (kasbah: KasbahApp) => {
    const { devices } = (await kasbah.app.inject({ method: 'GET', url: '/api/devices' })).json()
    return new Set<string>(devices.map((e: { descriptor: { kind: string } }) => e.descriptor.kind))
  }

  it('unchecking a kind removes it live, keeps the others, and writes it into the house', async () => {
    await withTempHouse(async (kasbah, file) => {
      expect(await kindsOf(kasbah)).toContain('light')
      const r = await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/mock', payload: { parts: { light: false, cover: false } } })
      expect(r.statusCode).toBe(200)
      const mock = r.json().plugins.find((p: { id: string }) => p.id === 'mock')
      expect(mock.parts.find((p: { id: string }) => p.id === 'light')).toEqual({ id: 'light', labelKey: 'kinds.light', enabled: false })
      expect(mock.parts.find((p: { id: string }) => p.id === 'vehicle').enabled).toBe(true)

      const kinds = await kindsOf(kasbah)                  // plugin restart, without restarting the server
      expect(kinds.has('light')).toBe(false)
      expect(kinds.has('cover')).toBe(false)
      expect(kinds.has('vehicle')).toBe(true)              // not handled by a real plugin: kept
      expect(kinds.has('energy')).toBe(true)

      const health = (await kasbah.app.inject({ method: 'GET', url: '/api/health' })).json()
      expect(health.plugins.mock.status).toBe('ok')
      expect(health.plugins.mock.detail).toContain('sans light/cover')

      const written = JSON.parse(await readFile(file, 'utf8'))
      expect(written.plugins.mock).toMatchObject({ enabled: true, parts: { light: false, cover: false } })
    })
  })

  it('without a setting, a silent house simulates everything', async () => {
    const { kasbah } = await makeApp('default')
    try {
      const kinds = await kindsOf(kasbah)
      expect(kinds.has('light')).toBe(true)
      expect(kinds.has('cover')).toBe(true)
    } finally { await kasbah.close() }
  })
})

// Enabling / disabling a vendor from Settings: the choice lives in house.json and takes effect
// right away, without restarting the server.
describe('plugin activation (GET /api/plugins, PATCH /api/plugins/:id)', () => {
  it('lists ALL declared plugins, turns them on and off live, refuses an unknown id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-plugins-'))
    const file = join(dir, 'house.json')
    await copyFile(HOUSE, file)
    const { kasbah } = await makeApp('default', {}, file)
    try {
      const list = (await kasbah.app.inject({ method: 'GET', url: '/api/plugins' })).json().plugins
      const byId = Object.fromEntries(list.map((p: { id: string }) => [p.id, p]))
      expect(Object.keys(byId).length).toBeGreaterThan(5)          // all available ones, not only the active ones
      expect(byId.mock).toMatchObject({ enabled: true, implemented: true })
      expect(byId.sonos).toMatchObject({ enabled: false, implemented: true })     // no longer a skeleton: can be enabled, off by default
      expect(byId.mock.parts).toHaveLength(DEVICE_KINDS.length)  // one per simulated kind (all of them, cameras included)

      // turning the simulation off: its devices leave the registry
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/mock', payload: { enabled: false } })).statusCode).toBe(200)
      expect((await kasbah.app.inject({ method: 'GET', url: '/api/devices' })).json().devices).toHaveLength(0)
      const off = (await kasbah.app.inject({ method: 'GET', url: '/api/health' })).json()
      expect(off.plugins.mock.status).toBe('disabled')
      expect((await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'cover.close' } })).statusCode).toBe(404)

      // and turning it back on brings them back
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/mock', payload: { enabled: true } })).statusCode).toBe(200)
      expect((await kasbah.app.inject({ method: 'GET', url: '/api/devices' })).json().devices.length).toBeGreaterThan(15)

      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/nope', payload: { enabled: true } })).statusCode).toBe(404)
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/plugins/mock', payload: { enabled: 'oui' } })).json().error.code).toBe('INVALID_BODY')
    } finally {
      await kasbah.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('REST API', () => {
  let kasbah: KasbahApp
  beforeAll(async () => { ({ kasbah } = await makeApp('default')) })
  afterAll(async () => { await kasbah.close() })

  it('health lists plugins with status', async () => {
    const r = await kasbah.app.inject({ method: 'GET', url: '/api/health' })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.plugins.mock.status).toBe('ok')
    expect(body.plugins.mock.deviceCount).toBeGreaterThan(15)
    expect(body.plugins.sonos.status).toBe('disabled')
  })
  it('serves the validated house', async () => {
    const r = await kasbah.app.inject({ method: 'GET', url: '/api/house' })
    expect(r.statusCode).toBe(200)
    expect(r.json().name).toBe('Maison démo')
    expect(r.json().rooms[0].kind).toBe('corridor')   // zod defaults applied
  })
  it('lists devices with available states', async () => {
    const r = await kasbah.app.inject({ method: 'GET', url: '/api/devices' })
    const { devices } = r.json()
    const cover = devices.find((d: { descriptor: { id: string } }) => d.descriptor.id === 'mock:cover-living')
    expect(cover.state).toMatchObject({ kind: 'cover', available: true, position: 100, motion: 'stopped' })
  })
  it('executes a command and reflects the new state', async () => {
    const r = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'cover.close' } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true })
    const after = await kasbah.app.inject({ method: 'GET', url: '/api/devices/mock:cover-living' })
    expect(after.json().state.motion).toBe('closing')
  })
  it('maps errors to status codes', async () => {
    expect((await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:nope/command', payload: { type: 'cover.close' } })).statusCode).toBe(404)
    const bad = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'nope' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe('INVALID_BODY')
    const mismatch = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'light.set', on: true } })
    expect(mismatch.statusCode).toBe(400)
    expect(mismatch.json().error.code).toBe('KIND_MISMATCH')
    const unsupported = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:cover-living/command', payload: { type: 'cover.set_tilt', tilt: 10 } })
    expect(unsupported.statusCode).toBe(400)
    expect(unsupported.json().error.code).toBe('UNSUPPORTED_COMMAND')
  })
})

describe('plugin scenes (GET /api/scenes, POST /api/scenes/:id/recall)', () => {
  it('lists the registered scenes and refuses impossible recalls', async () => {
    const { kasbah } = await makeApp('default')
    try {
      // the mock plugin has no scenes: some are injected to exercise the routes
      kasbah.scenes.register('mock', [
        { id: 'mock:s1', pluginId: 'mock', externalId: 's1', name: 'Soirée', group: { name: 'Salon', kind: 'room' }, dynamic: false, autoDynamic: false, swatches: ['#ff8800'] },
      ])
      const list = await kasbah.app.inject({ method: 'GET', url: '/api/scenes' })
      expect(list.statusCode).toBe(200)
      expect(list.json().scenes).toEqual([
        { scene: { id: 'mock:s1', pluginId: 'mock', externalId: 's1', name: 'Soirée', group: { name: 'Salon', kind: 'room' }, dynamic: false, autoDynamic: false, swatches: ['#ff8800'] },
          state: { active: 'inactive', updatedAt: MONDAY } },
      ])

      expect((await kasbah.app.inject({ method: 'POST', url: '/api/scenes/mock:nope/recall', payload: {} })).statusCode).toBe(404)
      const notDynamic = await kasbah.app.inject({ method: 'POST', url: '/api/scenes/mock:s1/recall', payload: { mode: 'dynamic' } })
      expect(notDynamic.statusCode).toBe(400)
      expect(notDynamic.json().error.code).toBe('UNSUPPORTED_COMMAND')
      // the mock plugin only recalls the light scenes of ITS device set: an injected scene it does
      // not know is refused like an absent device; it does not implement updateScene
      const noRecall = await kasbah.app.inject({ method: 'POST', url: '/api/scenes/mock:s1/recall', payload: {} })
      expect(noRecall.statusCode).toBe(503)
      expect(noRecall.json().error.code).toBe('DEVICE_UNAVAILABLE')

      // PATCH: the "Starts animated" setting makes no sense without an animated palette
      const notAnimated = await kasbah.app.inject({ method: 'PATCH', url: '/api/scenes/mock:s1', payload: { autoDynamic: true } })
      expect(notAnimated.statusCode).toBe(400)
      expect(notAnimated.json().error.code).toBe('UNSUPPORTED_COMMAND')
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/scenes/mock:nope', payload: { autoDynamic: false } })).statusCode).toBe(404)
      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/scenes/mock:s1', payload: {} })).json().error.code).toBe('INVALID_BODY')

      // POST /api/scenes: unknown source, invalid body, plugin unable to create
      expect((await kasbah.app.inject({ method: 'POST', url: '/api/scenes', payload: { fromSceneId: 'mock:nope', groupName: 'Salon' } })).statusCode).toBe(404)
      expect((await kasbah.app.inject({ method: 'POST', url: '/api/scenes', payload: { fromSceneId: 'mock:s1' } })).json().error.code).toBe('INVALID_BODY')
      const cannotCreate = await kasbah.app.inject({ method: 'POST', url: '/api/scenes', payload: { fromSceneId: 'mock:s1', groupName: 'Cuisine' } })
      expect(cannotCreate.statusCode).toBe(501)

      // DELETE /api/scenes/:id: unknown scene, then plugin unable to delete
      expect((await kasbah.app.inject({ method: 'DELETE', url: '/api/scenes/mock:nope' })).statusCode).toBe(404)
      const cannotDelete = await kasbah.app.inject({ method: 'DELETE', url: '/api/scenes/mock:s1' })
      expect(cannotDelete.statusCode).toBe(501)
      expect(cannotDelete.json().error.code).toBe('NOT_IMPLEMENTED')
      const readOnly = await kasbah.app.inject({ method: 'PATCH', url: '/api/scenes/mock:s1', payload: { autoDynamic: false } })
      expect(readOnly.statusCode).toBe(501)
    } finally {
      await kasbah.close()
    }
  })
})

describe('chaos scenario error mapping', () => {
  it('surfaces upstream failures as 502', async () => {
    const { kasbah } = await makeApp('chaos')
    const codes = new Set<number>()
    for (let i = 0; i < 40 && !codes.has(502); i++) {
      const r = await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:light-kitchen/command', payload: { type: 'light.set', on: i % 2 === 0 } })
      codes.add(r.statusCode)
    }
    expect(codes.has(502)).toBe(true)
    await kasbah.close()
  })
})

describe('WebSocket hub', () => {
  it('sends a snapshot, then coalesced full states after a command', async () => {
    const { kasbah, clock } = await makeApp('default')
    const address = await kasbah.app.listen({ port: 0, host: '127.0.0.1' })
    const ws = new WebSocket(`${address.replace('http', 'ws')}/ws`)
    // message queue set up BEFORE `open`: the snapshot may arrive in the same tick as the opening
    const queue: ServerMessage[] = []
    const waiters: ((m: ServerMessage) => void)[] = []
    ws.on('message', (d) => {
      const m = serverMessageSchema.parse(JSON.parse(d.toString()))
      const w = waiters.shift()
      if (w) w(m); else queue.push(m)
    })
    const next = () => new Promise<ServerMessage>((resolve) => { const m = queue.shift(); if (m) resolve(m); else waiters.push(resolve) })
    await new Promise((r) => ws.once('open', r))
    const snapshot = await next()
    expect(snapshot.type).toBe('snapshot')
    if (snapshot.type === 'snapshot') expect(snapshot.devices.length).toBeGreaterThan(15)

    const waitState = next()
    await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:light-living/command', payload: { type: 'light.set', on: true, brightness: 30 } })
    await kasbah.app.inject({ method: 'POST', url: '/api/devices/mock:light-living/command', payload: { type: 'light.set', brightness: 60 } })
    clock.advance(50)                                   // coalescing window
    const state = await waitState
    expect(state.type).toBe('state')
    if (state.type === 'state') {
      expect(state.deviceId).toBe('mock:light-living')
      expect(state.state).toMatchObject({ kind: 'light', on: true, brightness: 60 })   // a single message, last state
    }
    ws.close()
    await kasbah.close()
  })
})

describe('WebSocket hub: web build served', () => {
  // The screen compares the build it carries with the server's: re-read on each connection, a build
  // redone without restarting is seen by the screen that reconnects.
  it('carries the build identifier in the snapshot, re-read on each connection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-web-'))
    await writeFile(join(dir, 'index.html'), '<!doctype html>')
    await writeFile(join(dir, 'build-id.txt'), 'build-1')
    const env = loadEnv({ KASBAH_HOUSE_FILE: HOUSE, KASBAH_LOG_LEVEL: 'silent', KASBAH_STATIC_DIR: dir })
    const kasbah = await buildApp({ env, logger: pino({ level: 'silent' }), clock: new ManualClock(MONDAY), envSource: { MOCK_SEED: '3' } })
    const address = await kasbah.app.listen({ port: 0, host: '127.0.0.1' })
    const firstSnapshot = () => new Promise<ServerMessage>((resolve) => {
      const ws = new WebSocket(`${address.replace('http', 'ws')}/ws`)
      ws.once('message', (d) => { ws.close(); resolve(serverMessageSchema.parse(JSON.parse(d.toString()))) })
    })
    expect(await firstSnapshot()).toMatchObject({ type: 'snapshot', appBuild: 'build-1' })
    await writeFile(join(dir, 'build-id.txt'), 'build-2')
    expect(await firstSnapshot()).toMatchObject({ type: 'snapshot', appBuild: 'build-2' })
    await kasbah.close()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('device placement (PUT /api/house/devices/:id)', () => {
  it('rewrites the house file atomically, keeps a .bak and broadcasts the new house', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-house-'))
    const file = join(dir, 'maison.json')
    await copyFile(HOUSE, file)
    const env = loadEnv({ KASBAH_PLUGINS: 'mock', KASBAH_HOUSE_FILE: file, KASBAH_LOG_LEVEL: 'silent' })
    const kasbah = await buildApp({ env, logger: pino({ level: 'silent' }), serveStatic: false })
    await kasbah.app.ready()
    try {
      const r = await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/light.salon', payload: { position: [5, 3, 0.75], mount: 'free' } })
      expect(r.statusCode).toBe(200)
      const moved = r.json().house.devices.find((d: { id: string }) => d.id === 'light.salon')
      expect(moved).toMatchObject({ position: [5, 3, 0.75], mount: 'free', name: 'Plafonnier salon' })

      const served = (await kasbah.app.inject({ method: 'GET', url: '/api/house' })).json()
      expect(served.devices.find((d: { id: string }) => d.id === 'light.salon').position).toEqual([5, 3, 0.75])

      const onDisk = JSON.parse(await readFile(file, 'utf8'))
      expect(onDisk.devices.find((d: { id: string }) => d.id === 'light.salon').position).toEqual([5, 3, 0.75])
      expect(onDisk.rooms[1].kind).toBeUndefined()            // the file does not receive the zod defaults (salon: implicit 'room' kind)
      expect(JSON.parse(await readFile(`${file}.bak`, 'utf8')).devices.find((d: { id: string }) => d.id === 'light.salon').position).toEqual([6.6, 2.5, 2.5])

      // creating an entry for an auto-placed device
      const created = await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/auto.hue-abc', payload: { position: [1, 1, 2.4], roomId: 'salon', deviceId: 'hue:abc' } })
      expect(created.statusCode).toBe(200)
      expect(JSON.parse(await readFile(file, 'utf8')).devices.at(-1)).toEqual({ id: 'auto.hue-abc', deviceId: 'hue:abc', position: [1, 1, 2.4], roomId: 'salon' })

      // refusals: invalid body, unknown room, unknown device without deviceId, room on another level
      expect((await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/light.salon', payload: { position: [1, 2] } })).json().error.code).toBe('INVALID_BODY')
      expect((await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/light.salon', payload: { position: [1, 2, 3], roomId: 'veranda' } })).json().error.code).toBe('INVALID_PLACEMENT')
      expect((await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/nope', payload: { position: [1, 2, 3] } })).statusCode).toBe(400)
      // changing room carries the levelId along; a shutter anchored to an opening of another room is refused by the cross-validation
      const cross = await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/light.salon', payload: { position: [2.4, 2.4, 2.4], roomId: 'chambre1' } })
      expect(cross.statusCode).toBe(200)
      expect(cross.json().house.devices.find((d: { id: string }) => d.id === 'light.salon').levelId).toBe('etage')
      const invalid = await kasbah.app.inject({ method: 'PUT', url: '/api/house/devices/cover.baie', payload: { position: [6.6, 6.5, 1.3], roomId: 'cuisine' } })
      expect(invalid.statusCode).toBe(400)
      expect(invalid.json().error.code).toBe('INVALID_HOUSE')
      expect(JSON.parse(await readFile(file, 'utf8')).devices.find((d: { id: string }) => d.id === 'cover.baie').roomId).toBe('salon')   // nothing was written
    } finally {
      await kasbah.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// Forecasts are read ON DEMAND, like the history: the plugin returns its last reading, the host
// adds the deviceId, and a device that is not a weather one has none.
describe('GET /api/devices/:id/forecast', () => {
  it('serves the simulated forecast for the weather device and refuses other kinds', async () => {
    const { kasbah } = await makeApp('default')
    try {
      const ok = await kasbah.app.inject({ method: 'GET', url: '/api/devices/mock:weather/forecast' })
      expect(ok.statusCode).toBe(200)
      const body = ok.json()
      expect(body.deviceId).toBe('mock:weather')
      expect(body.hourly).toHaveLength(24)
      expect(body.daily).toHaveLength(7)
      expect((await kasbah.app.inject({ method: 'GET', url: '/api/devices/mock:light-living/forecast' })).json().error.code).toBe('KIND_MISMATCH')
      expect((await kasbah.app.inject({ method: 'GET', url: '/api/devices/mock:nope/forecast' })).statusCode).toBe(404)
    } finally { await kasbah.close() }
  })
})

// The Matter card writes the house; the bridge itself is not started here (a real Matter node opens
// UDP ports and mDNS): only the setting, the list of what can be published, and the refusals.
describe('Matter bridge setting (GET/PATCH /api/matter)', () => {
  it('lists what the bridge can translate, writes the chosen devices into the house, refuses a bad body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-matter-'))
    const file = join(dir, 'house.json')
    await copyFile(HOUSE, file)
    const { kasbah } = await makeApp('default', {}, file)
    try {
      const before = (await kasbah.app.inject({ method: 'GET', url: '/api/matter' })).json()
      expect(before).toMatchObject({ enabled: false, running: false, commissioned: false, skipped: [] })
      const types = new Set(before.candidates.map((c: { type: string }) => c.type))
      expect(types).toEqual(new Set(['dimmable_light', 'on_off_light', 'window_covering', 'door_lock', 'fan']))
      expect(before.candidates.some((c: { listed: boolean }) => c.listed)).toBe(false)

      const r = await kasbah.app.inject({ method: 'PATCH', url: '/api/matter', payload: { devices: ['mock:cover-gate'] } })
      expect(r.statusCode).toBe(200)
      expect(r.json().candidates.filter((c: { listed: boolean }) => c.listed).map((c: { id: string }) => c.id)).toEqual(['mock:cover-gate'])
      expect(JSON.parse(await readFile(file, 'utf8')).matter).toEqual({ enabled: false, devices: ['mock:cover-gate'] })

      expect((await kasbah.app.inject({ method: 'PATCH', url: '/api/matter', payload: { enabled: 'yes' } })).statusCode).toBe(400)
      // unpairing with the bridge off changes nothing; an index that is not a number is refused
      const off = await kasbah.app.inject({ method: 'DELETE', url: '/api/matter/fabrics/1' })
      expect(off.statusCode).toBe(200)
      expect(off.json().fabrics).toEqual([])
      expect((await kasbah.app.inject({ method: 'DELETE', url: '/api/matter/fabrics/abc' })).statusCode).toBe(400)
    } finally { await kasbah.close(); await rm(dir, { recursive: true, force: true }) }
  })
})
