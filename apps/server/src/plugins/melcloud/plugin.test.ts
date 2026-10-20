import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { DEVICE_GET, ENERGY_REPORT_SEPTEMBER, LIST_DEVICES } from './__fixtures__/melcloud'
import type { SessionStore, StoredSession } from './auth'
import { createMelcloudPlugin, melcloudConfigSchema } from './index'

// What the plugin must hold up against MELCloud, and that only a private API imposes:
//
//  - MELCLOUD ANSWERS HTTP 200 EVEN WHEN IT REFUSES. A wrong password arrives as a 200 with an
//    `ErrorId` in the body — the same trap as Gigya at Renault, and the reason for half of the
//    cases below.
//  - The PASSWORD must leave nothing behind: neither in the session cache, nor anywhere else.
//  - A REFUSED session key (401) is not refreshed: there is no refresh token. It must be thrown
//    away, so that the Settings card asks for the password again instead of letting the plugin
//    hammer a dead key.
//  - The plugin publishes ONE ZONE, not one machine: the reference installation has three Zubadan
//    in cascade behind a single controller, which MELCloud shows as one device with two zones.
//
// The fake vendor replays the CAPTURE (`__fixtures__/melcloud.ts`), not a reconstructed response:
// a test that validates an assumption disguised as proof proves nothing (COMAP lesson).
// No real account or machine is touched.

const NOW = Date.UTC(2026, 8, 17, 10)
const BASE = 'https://app.melcloud.com/Mitsubishi.Wifi.Client'
const CONTEXT_KEY = 'context-key-abc'
const PASSWORD = 'un-mot-de-passe-qui-ne-doit-pas-fuir'
const EMAIL = 'moi@exemple.fr'
/** The machine's id in the anonymized capture, and the two zones it publishes. */
const UNIT = '111111'
const Z1 = `${UNIT}-z1`
const Z2 = `${UNIT}-z2`

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

/** The poller fires its first read without awaiting it: the loop has to be let run. */
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)) }

/** Fake MELCloud, driven by a mutable state. Everything comes out as 200, refusals included. */
function fakeMelcloud(over: { loginError?: number; rejectKey?: boolean; deviceFails?: string; listFails?: boolean } = {}) {
  const calls: { method: string; path: string }[] = []
  const world = { list: LIST_DEVICES as unknown }
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const path = url.slice(BASE.length).split('?')[0]!
    const query = new URL(url).searchParams
    calls.push({ method, path })

    if (path === '/Login/ClientLogin') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { Password?: string }
      // the refusal arrives as HTTP 200: `ErrorId` decides, never the status
      if (over.loginError !== undefined) return response({ ErrorId: over.loginError, LoginData: null })
      if (body.Password !== PASSWORD) return response({ ErrorId: 1, LoginData: null })
      return response({ ErrorId: null, LoginData: { ContextKey: CONTEXT_KEY, Name: 'Compte de démonstration' } })
    }

    if (over.rejectKey || headers['X-MitsContextKey'] !== CONTEXT_KEY) return response({ ErrorId: 5 }, 401)

    if (path === '/User/ListDevices') {
      if (over.listFails) return response({ error: 'boom' }, 500)
      return response(world.list)
    }
    if (path === '/Device/Get') {
      if (over.deviceFails === query.get('id')) return response({ error: 'boom' }, 500)
      return response(DEVICE_GET)
    }
    if (path === '/EnergyCost/Report') return response(ENERGY_REPORT_SEPTEMBER)
    return response({ ErrorId: 404 }, 404)
  })
  return { calls, fetchImpl, world }
}

function memoryStore(initial: StoredSession | null = null): SessionStore & { value: StoredSession | null } {
  const store = {
    value: initial,
    async load() { return store.value },
    async save(s: StoredSession) { store.value = s },
    async clear() { store.value = null },
  }
  return store
}

async function setup(over: { session?: StoredSession | null; loginError?: number; rejectKey?: boolean; deviceFails?: string; listFails?: boolean } = {}) {
  const melcloud = fakeMelcloud({
    ...(over.loginError !== undefined ? { loginError: over.loginError } : {}),
    ...(over.rejectKey !== undefined ? { rejectKey: over.rejectKey } : {}),
    ...(over.deviceFails !== undefined ? { deviceFails: over.deviceFails } : {}),
    ...(over.listFails !== undefined ? { listFails: over.listFails } : {}),
  })
  const sessionStore = memoryStore(over.session ?? null)
  const clock = new ManualClock(NOW)
  const plugin = createMelcloudPlugin({ fetchImpl: melcloud.fetchImpl, sessionStore })
  const ctx: PluginContext = {
    pluginId: 'melcloud',
    config: melcloudConfigSchema.parse({}),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/melcloud' })
  await app.ready()
  return { plugin, app, melcloud, sessionStore, ctx, clock }
}

const login = (app: Awaited<ReturnType<typeof setup>>['app'], password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/plugins/melcloud/login', payload: { email: EMAIL, password } })

const linked: StoredSession = { contextKey: CONTEXT_KEY, name: 'Compte de démonstration' }

describe('MELCloud — account linking', () => {
  it('links the account and keeps only the session key, never the password', async () => {
    const { app, sessionStore } = await setup()
    const r = await login(app)
    expect(r.statusCode).toBe(200)
    expect(sessionStore.value).toEqual(linked)
    expect(JSON.stringify(sessionStore.value)).not.toContain(PASSWORD)
    expect(r.json().devices).toEqual([{ deviceId: UNIT, name: 'Chauffage', family: 'atw', buildingName: 'Maison' }])
  })

  it('refuses a wrong password, which MELCloud nonetheless returns as HTTP 200', async () => {
    const { app, sessionStore } = await setup()
    const r = await login(app, 'pas-le-bon')
    expect(r.statusCode).toBe(401)
    expect(sessionStore.value).toBeNull()
  })

  it('tells a credentials refusal from a vendor failure', async () => {
    const { app } = await setup({ loginError: 42 })
    expect((await login(app)).statusCode).toBe(502)
  })

  it('unlinking erases the session key and removes the zones from the house', async () => {
    const { app, sessionStore, ctx } = await setup()
    await login(app)
    const r = await app.inject({ method: 'POST', url: '/api/plugins/melcloud/logout' })
    expect(r.statusCode).toBe(200)
    expect(sessionStore.value).toBeNull()
    expect(r.json().linked).toBe(false)
    expect(ctx.emitDevices).toHaveBeenLastCalledWith([])
  })

  it('throws away a session key MELCloud refuses, rather than hammering it', async () => {
    const { plugin, sessionStore } = await setup({ session: linked, rejectKey: true })
    await plugin.start()
    await flush()
    // the key is dead and nothing can renew it: the account goes back to "to link"
    expect(sessionStore.value).toBeNull()
    expect(plugin.health!().status).toBe('needs_pairing')
  })
})

describe('MELCloud — what the plugin publishes', () => {
  it('publishes TWO zones for ONE machine (three Zubadan in cascade)', async () => {
    const { plugin, ctx } = await setup({ session: linked })
    await plugin.start()
    await flush()
    const published = (ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    expect(published.map((d: { id: string }) => d.id)).toEqual([`melcloud:${Z1}`, `melcloud:${Z2}`])
    expect(plugin.health!().detail).toContain('2 zone(s) on 1 unit(s)')
  })

  it('publishes each zone’s state with its real values', async () => {
    const { plugin, ctx } = await setup({ session: linked })
    await plugin.start()
    await flush()
    expect(ctx.emitState).toHaveBeenCalledWith(Z1, expect.objectContaining({ currentTempC: 23, targetTempC: 19.5, action: 'idle' }))
    // the zone without a room sensor publishes its flow water, never the -39 sentinel
    expect(ctx.emitState).toHaveBeenCalledWith(Z2, expect.objectContaining({ currentTempC: 20, targetTempC: 45 }))
  })

  /** The registry must not churn: repeating the same descriptors every two minutes would be pointless. */
  it('republishes the devices only when they change', async () => {
    const { plugin, ctx, clock, melcloud } = await setup({ session: linked })
    await plugin.start()
    await flush()
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)

    clock.advance(120_000)
    await flush()
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)   // same machine, same zones

    // zone 2 switches back to room temperature: `meta.climate.control` changes, the UI must know
    const flipped = JSON.parse(JSON.stringify(melcloud.world.list)) as { Structure: { Devices: { Device: Record<string, unknown> }[] } }[]
    Object.assign(flipped[0]!.Structure.Devices[0]!.Device, { Zone2InRoomMode: true, RoomTemperatureZone2: 21 })
    melcloud.world.list = flipped
    clock.advance(120_000)
    await flush()
    expect(ctx.emitDevices).toHaveBeenCalledTimes(2)
  })

  it('knows no device before its first read, and repeats them afterwards', async () => {
    const { plugin } = await setup({ session: linked })
    expect(await plugin.discover()).toEqual([])   // no network call in discover
    await plugin.start()
    await flush()
    expect(await plugin.discover()).toHaveLength(2)
  })

  it('forgets what it published when the host restarts it without re-instantiating it', async () => {
    const { plugin, ctx } = await setup({ session: linked })
    await plugin.start()
    await flush()
    await plugin.stop()
    await plugin.init(ctx)
    expect(await plugin.discover()).toEqual([])
    expect(plugin.health!().detail).toContain('0 zone(s)')
  })

  it('refuses every command: the plugin is read-only', async () => {
    const { plugin } = await setup({ session: linked })
    await expect(plugin.execute(Z1, { type: 'climate.set_mode', mode: 'heat' })).rejects.toThrow(/read-only/i)
  })

  it('can still start when MELCloud does not answer', async () => {
    const { plugin } = await setup({ session: linked, listFails: true })
    await expect(plugin.start()).resolves.toBeUndefined()
    await flush()
    expect(plugin.health!().deviceCount).toBe(0)
  })
})

describe('MELCloud — the machine state served to the Heating view', () => {
  it('returns the poll’s last read, without calling the vendor again', async () => {
    const { plugin, app, melcloud } = await setup({ session: linked })
    await plugin.start()
    await flush()
    const before = melcloud.calls.length
    const r = await app.inject({ method: 'GET', url: '/api/plugins/melcloud/system' })
    expect(r.statusCode).toBe(200)
    expect(melcloud.calls.length).toBe(before)   // no extra call
    expect(r.json().units[0]).toMatchObject({ name: 'Chauffage', power: true, outdoorTempC: 22, energyMeter: false })
    expect(r.json().units[0].error).toMatchObject({ hasError: false, code: 8000 })
  })

  it('refuses as long as no account is linked', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/melcloud/system' })).statusCode).toBe(409)
  })
})

describe('MELCloud — raw readout', () => {
  it('returns the list, the detail and the energy report of each machine', async () => {
    const { app } = await setup({ session: linked })
    const body = (await app.inject({ method: 'GET', url: '/api/plugins/melcloud/raw' })).json()
    expect(body.devices).toHaveLength(1)
    expect(body.details[0]).toMatchObject({ deviceId: UNIT, ok: true })
    expect(body.reports[0]).toMatchObject({ deviceId: UNIT, ok: true })
  })

  it('accepts a report window, the only way to settle the absence of a meter', async () => {
    const { app } = await setup({ session: linked })
    const body = (await app.inject({ method: 'GET', url: '/api/plugins/melcloud/raw?from=2026-01-15&to=2026-02-15' })).json()
    expect(body.reports[0]).toMatchObject({ from: '2026-01-15T00:00:00', to: '2026-02-15T00:00:00' })
  })

  it('returns a machine’s failure instead of losing the capture', async () => {
    const { app } = await setup({ session: linked, deviceFails: UNIT })
    const body = (await app.inject({ method: 'GET', url: '/api/plugins/melcloud/raw' })).json()
    expect(body.details[0]).toMatchObject({ deviceId: UNIT, ok: false })
    expect(body.reports[0]).toMatchObject({ ok: true })   // the energy report, for its part, answered
  })

  it('refuses the capture as long as no account is linked', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/melcloud/raw' })).statusCode).toBe(409)
  })
})
