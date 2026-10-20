import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import {
  BATTERY_CHARGING, BATTERY_UNPLUGGED, BATTERY_WAITING, COCKPIT_V1, CONTRACTS, COCKPIT_V2_EASTER_EGG, EV_SETTINGS,
  FORBIDDEN, HVAC_STATUS, LOCATION, NOT_FOUND, SETTINGS_COMMAND, SETTINGS_PENDING, SOC_LEVELS,
} from './__fixtures__/kamereon'
import { JWT_TTL_S, type SessionStore, type StoredSession } from './auth'
import { createRenaultPlugin, renaultConfigSchema } from './index'
import { CLIMATE_FEATURES } from './mapping'

// What the plugin must guarantee against Renault, which only a private API imposes:
//
//  - GIGYA ANSWERS HTTP 200 EVEN WHEN IT REFUSES. A wrong password, an expired session, a pending
//    two-factor authentication: everything arrives as 200 with an `errorCode`. It's THE pitfall
//    of this API, and half the tests below only serve to keep it shut.
//  - The PASSWORD must leave nothing behind: not in the session cache, nor anywhere else.
//  - The RATE is tight (60 calls per hour): the plugin must refuse by itself, without calling.
//  - An endpoint REFUSED for this vehicle (403 `err.func.wired.forbidden`, the R5's case for locking
//    and tire pressure) is not an outage and must not spoil a capture.
//
// No real account or vehicle is touched.

const NOW = Date.UTC(2026, 8, 14, 10)
const GIGYA = 'https://accounts.eu1.gigya.com'
const KAMEREON = 'https://api-wired-prod-1-euw1.wrd-aws.com'
const VIN = 'VF1RJE00000000001'
const PERSON = 'person-0001'
const ACCOUNT = 'account-0001'
const LOGIN_TOKEN = 'login-token-abc'
const PASSWORD = 'un-mot-de-passe-qui-ne-doit-pas-fuir'

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const VEHICLES = {
  accountId: ACCOUNT,
  vehicleLinks: [{
    vin: VIN,
    status: 'ACTIVE',
    vehicleDetails: {
      vin: VIN,
      registrationNumber: 'GA-123-BX',
      brand: { label: 'RENAULT' },
      model: { code: 'R5E1VE', label: 'R5 E-Tech' },
      energy: { code: 'ELEC', label: 'Electrique' },
    },
  }],
}

/** Fake Renault: Gigya (authentication) and Kamereon (data), driven by a mutable state. */
function fakeRenault(over: { gigyaError?: number } = {}) {
  const world = {
    /** The JWT Kamereon accepts; any other → 401. Changes on every `accounts.getJWT`. */
    jwt: 'jwt-1',
    minted: 0,
    /** Kamereon answers 401 once before accepting (JWT revoked before its expiry). */
    revokeOnce: false,
    /** `hvac-status` answers 403 while true: a reading this vehicle doesn't serve. */
    hvacForbidden: false,
    /** What `battery-status` returns: plugged in and waiting by default. */
    battery: BATTERY_WAITING as unknown,
    /** A settings command is already pending: every write is refused with 409. */
    settingsPending: false,
  }
  const calls: { method: string; path: string; body?: string }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = init?.body === undefined ? undefined : String(init.body)

    if (url.startsWith(GIGYA)) {
      const method_ = url.slice(GIGYA.length + 1)
      calls.push({ method, path: `gigya:${method_}` })
      const params = new URLSearchParams(body)
      // EVERYTHING goes out as HTTP 200, refusals included: it's `errorCode` that decides
      if (over.gigyaError) return response({ errorCode: over.gigyaError, errorMessage: 'refused' })
      if (method_ === 'accounts.login') {
        if (params.get('password') !== PASSWORD) return response({ errorCode: 403042, errorMessage: 'Invalid LoginID' })
        return response({ errorCode: 0, sessionInfo: { cookieValue: LOGIN_TOKEN } })
      }
      if (params.get('login_token') !== LOGIN_TOKEN) return response({ errorCode: 403005, errorMessage: 'Unauthorized user' })
      if (method_ === 'accounts.getAccountInfo') return response({ errorCode: 0, data: { personId: PERSON } })
      if (method_ === 'accounts.getJWT') {
        world.jwt = `jwt-${++world.minted + 1}`
        return response({ errorCode: 0, id_token: world.jwt })
      }
      return response({ errorCode: 400002, errorMessage: 'unknown method' })
    }

    const path = url.slice(KAMEREON.length).split('?')[0]!
    calls.push({ method, path, ...(body === undefined ? {} : { body }) })
    if (headers.apikey !== 'YjkKtHmGfaceeuExUDKGxrLZGGvtVS0J') return response({ errors: [{ errorCode: 'err.tech.500' }] }, 500)
    if (world.revokeOnce) { world.revokeOnce = false; return response({ errors: [{ errorCode: 'err.func.wired.unauthorized' }] }, 401) }
    if (headers['x-gigya-id_token'] !== world.jwt) return response({ errors: [{ errorCode: 'err.func.wired.unauthorized' }] }, 401)
    if (path === `/commerce/v1/persons/${PERSON}`) {
      return response({ accounts: [{ accountId: ACCOUNT, accountType: 'MYRENAULT', accountStatus: 'ACTIVE' }] })
    }
    if (path === `/commerce/v1/accounts/${ACCOUNT}/vehicles`) return response(VEHICLES)
    // what the R5 answered at capture, refusals included
    if (path.endsWith('/contracts')) return response(CONTRACTS)
    if (path.endsWith('/battery-status')) return response(world.battery)
    if (path.endsWith('/cockpit')) return response(path.includes('/v2/') ? COCKPIT_V2_EASTER_EGG : COCKPIT_V1)
    if (path.endsWith('/location')) return response(LOCATION)
    if (path.endsWith('/hvac-status')) return world.hvacForbidden ? response(FORBIDDEN, 403) : response(HVAC_STATUS)
    if (path.endsWith('/ev/soc-levels')) return response(method === 'POST' ? { ok: true } : SOC_LEVELS)
    if (path.endsWith('/ev/settings')) {
      if (method !== 'POST') return response(EV_SETTINGS)
      // an accepted write returns a COMMAND; a command already pending refuses it with 409
      return world.settingsPending ? response(SETTINGS_PENDING, 409) : response(SETTINGS_COMMAND)
    }
    // the two flavors of refusal: 403 "forbidden" and 404 "unknown"
    if (path.endsWith('/lock-status') || path.endsWith('/pressure')) return response(NOT_FOUND, 404)
    return response({ data: { attributes: {} } })
  })
  return { world, calls, fetchImpl }
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

async function setup(over: { env?: Record<string, string>; session?: StoredSession | null; gigyaError?: number; parts?: Record<string, boolean> } = {}) {
  const renault = fakeRenault(over.gigyaError !== undefined ? { gigyaError: over.gigyaError } : {})
  const sessionStore = memoryStore(over.session ?? null)
  const clock = new ManualClock(NOW)
  const plugin = createRenaultPlugin({ fetchImpl: renault.fetchImpl, sessionStore })
  const ctx: PluginContext = {
    pluginId: 'renault',
    config: renaultConfigSchema.parse({ ...over.env }),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    // the host applies the `parts` defaults; here we give them, the wake-up being checked by default
    parts: over.parts ?? { charge_wake: true }, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/renault' })
  await app.ready()
  return { plugin, app, renault, sessionStore, ctx, clock }
}

const login = (app: Awaited<ReturnType<typeof setup>>['app'], password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/plugins/renault/login', payload: { email: 'moi@exemple.fr', password } })

describe('Renault — account linking', () => {
  it('links the account and keeps only the token, never the password', async () => {
    const { app, sessionStore } = await setup()
    const r = await login(app)
    expect(r.statusCode).toBe(200)
    expect(sessionStore.value).toEqual({ loginToken: LOGIN_TOKEN, personId: PERSON })
    // the password must end up NOWHERE in what survives the request
    expect(JSON.stringify(sessionStore.value)).not.toContain(PASSWORD)
    expect(r.json().vehicles).toEqual([{ vin: VIN, name: 'GA-123-BX' }])
  })

  it('refuses a wrong password, which Gigya nonetheless returns as HTTP 200', async () => {
    const { app, sessionStore } = await setup()
    const r = await login(app, 'pas-le-bon')
    expect(r.statusCode).toBe(401)
    expect(sessionStore.value).toBeNull()
  })

  it('says explicitly that two-factor authentication blocks linking', async () => {
    const { app } = await setup({ gigyaError: 403101 })
    const r = await login(app)
    expect(r.statusCode).toBe(401)
    expect(r.json().error).toMatch(/two-factor/i)
  })

  it('unlinking erases the session', async () => {
    const { app, sessionStore } = await setup()
    await login(app)
    const r = await app.inject({ method: 'POST', url: '/api/plugins/renault/logout' })
    expect(r.statusCode).toBe(200)
    expect(sessionStore.value).toBeNull()
    expect(r.json().linked).toBe(false)
  })
})

describe('Renault — inventory', () => {
  it('picks up the session from the cache and publishes one device per VIN', async () => {
    const { plugin } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    const devices = await plugin.discover()
    expect(devices).toEqual([{
      id: `renault:${VIN}`, pluginId: 'renault', externalId: VIN, kind: 'vehicle',
      name: 'GA-123-BX', capabilities: ['soc', 'range', 'location', 'charge_limit', 'charging', 'climate_precondition'],
      meta: { manufacturer: 'Renault', vehicle: { climate: CLIMATE_FEATURES, stopViaCharger: true } },
    }])
  })

  it('does not declare locking (404): the UI will offer nothing the plugin would refuse', async () => {
    const { plugin } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    const [device] = await plugin.discover()
    expect(device!.capabilities).not.toContain('lock')
  })

  it('without a linked account, no device and a health that says so', async () => {
    const { plugin } = await setup()
    expect(await plugin.discover()).toEqual([])
    expect(plugin.health!().status).toBe('needs_pairing')
  })
})

describe('Renault — tokens', () => {
  it('reuses the JWT while it is fresh, and requests a new one once expired', async () => {
    const { plugin, renault, clock } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    await plugin.discover()
    expect(renault.world.minted).toBe(1)
    await plugin.discover()
    expect(renault.world.minted).toBe(1)          // same JWT: nothing requested again
    clock.advance(JWT_TTL_S * 1000)
    await plugin.discover()
    expect(renault.world.minted).toBe(2)
  })

  it('replays the request once after a 401 from Kamereon', async () => {
    const { plugin, renault } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    renault.world.revokeOnce = true
    const devices = await plugin.discover()
    expect(devices).toHaveLength(1)               // the 401 was caught, not surfaced
    expect(renault.world.minted).toBe(2)
  })
})

describe('Renault — rate', () => {
  it('refuses by itself beyond the hourly budget, without calling Renault', async () => {
    const { plugin, renault } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON }, env: { RENAULT_RATE_PER_HOUR: '2' } })
    await plugin.discover()                        // 2 calls: accounts then vehicles
    const before = renault.calls.filter((c) => c.path.startsWith('/commerce')).length
    expect(await plugin.discover()).toEqual([])    // budget spent: the list fails cleanly
    expect(renault.calls.filter((c) => c.path.startsWith('/commerce'))).toHaveLength(before)
    expect(plugin.health!().status).toBe('degraded')
  })
})

describe('Renault — contracts on demand', () => {
  it('suggests the km-capped maintenance of the requested vehicle', async () => {
    const { app, renault } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    const r = await app.inject({ method: 'GET', url: `/api/plugins/renault/contracts/${VIN}?lang=fr` })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ contracts: [{ description: 'EASYPACK 49MOIS EXEMPLE', start: '2025-03-01', end: '2029-03-31', maxKm: 40000 }] })
    expect(renault.calls.some((c) => c.path.endsWith(`/vehicles/${VIN}/contracts`))).toBe(true)
  })

  it('refuses a VIN that is not the account one, without calling the contracts', async () => {
    const { app, renault } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON } })
    expect((await app.inject({ method: 'GET', url: '/api/plugins/renault/contracts/VF1AUTRE000000000' })).statusCode).toBe(404)
    expect(renault.calls.some((c) => c.path.endsWith('/contracts'))).toBe(false)
  })

  it('refuses as long as the account is not linked', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: `/api/plugins/renault/contracts/${VIN}` })).statusCode).toBe(409)
  })
})

describe('Renault — raw reading', () => {
  it('returns what the vehicle gives AND what it refuses, without failing the capture', async () => {
    const { app } = await setup({ session: { loginToken: LOGIN_TOKEN, personId: PERSON }, env: { RENAULT_RATE_PER_HOUR: '200' } })
    const r = await app.inject({ method: 'GET', url: '/api/plugins/renault/raw' })
    expect(r.statusCode).toBe(200)
    const readings = r.json().readings as { endpoint: string; ok: boolean; unavailable?: boolean }[]
    expect(readings.find((x) => x.endpoint === 'battery-status')).toMatchObject({ ok: true })
    // the refused locking is RETURNED as such: it's information, not an outage
    expect(readings.find((x) => x.endpoint === 'lock-status')).toMatchObject({ ok: false, unavailable: true })
    expect(readings.find((x) => x.endpoint === 'pressure')).toMatchObject({ ok: false, unavailable: true })
  })

  it('refuses the capture as long as the account is not linked', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/renault/raw' })).statusCode).toBe(409)
  })
})

describe('Renault — polling', () => {
  /** Rate of these tests, independent of the plugin default. */
  const POLL_MS = 5 * 60_000
  /** The poller chains promises: a few event loop turns are enough to drain them. */
  // We yield to the event loop, not just to microtasks: a polling round chains several requests
  // (readings, then possibly the wake-up), and merely draining microtasks left the rest hanging.
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) }
  const patches = (ctx: PluginContext) => (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])
  const dataCalls = (renault: ReturnType<typeof fakeRenault>, endpoint: string) =>
    renault.calls.filter((c) => c.path.endsWith(endpoint)).length

  async function running(over: { hvacForbidden?: boolean } = {}) {
    const s = await setup({
      session: { loginToken: LOGIN_TOKEN, personId: PERSON },
      env: { RENAULT_RATE_PER_HOUR: '600', RENAULT_POLL_MS: String(POLL_MS) },
    })
    if (over.hvacForbidden) s.renault.world.hvacForbidden = true
    await s.plugin.discover()
    await s.plugin.start()
    await flush()
    return s
  }

  it('publishes the vehicle state from the first round', async () => {
    const { ctx, plugin } = await running()
    expect(patches(ctx).at(-1)).toMatchObject({
      soc: 58, rangeKm: 218, pluggedIn: true, charging: false, odometerKm: 12500, insideTempC: 37, chargeLimit: 80,
    })
    await plugin.stop()
  })

  it('NEVER requests again a reading the vehicle refuses', async () => {
    const { plugin, renault, clock } = await running({ hvacForbidden: true })
    expect(dataCalls(renault, '/hvac-status')).toBe(1)
    clock.advance(POLL_MS + 60_000)
    await flush()
    expect(dataCalls(renault, '/battery-status')).toBeGreaterThan(1)   // the round did take place
    expect(dataCalls(renault, '/hvac-status')).toBe(1)                 // but that one is struck off
    await plugin.stop()
  })

  it('a refused reading does not stop the others from publishing', async () => {
    const { ctx, plugin } = await running({ hvacForbidden: true })
    const last = patches(ctx).at(-1)!
    expect(last).toMatchObject({ soc: 58, odometerKm: 12500 })
    expect(last).not.toHaveProperty('insideTempC')
    await plugin.stop()
  })

  it('vehicle.refresh re-reads right away', async () => {
    const { plugin, renault, ctx } = await running()
    const before = dataCalls(renault, '/battery-status')
    await plugin.execute(VIN, { type: 'vehicle.refresh' })
    expect(dataCalls(renault, '/battery-status')).toBe(before + 1)
    expect(patches(ctx).at(-1)).toMatchObject({ soc: 58 })
    await plugin.stop()
  })

  it('vehicle.set_charge_limit RE-READS the levels, then changes ONLY the target', async () => {
    const { plugin, renault, ctx } = await running()
    await plugin.execute(VIN, { type: 'vehicle.set_charge_limit', percent: 70 })
    const write = renault.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/ev/soc-levels')).at(-1)!
    // the floor is the user's setting IN the car: it is replayed as is
    expect(JSON.parse(write.body!)).toMatchObject({ socTarget: 70, socMin: SOC_LEVELS.socMin })
    // the target is published right away: Kamereon reads back the OLD value for a few seconds
    expect(patches(ctx).at(-1)).toMatchObject({ chargeLimit: 70 })
    await plugin.stop()
  })

  it('starting the charge: reads the settings, rewrites them with programs disabled, then re-reads a minute later', async () => {
    const { plugin, renault, clock } = await running()
    const posts = () => renault.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/ev/settings'))
    const before = posts().length
    await plugin.execute(VIN, { type: 'vehicle.start_charge' })
    expect(posts()).toHaveLength(before + 1)
    const body = JSON.parse(posts().at(-1)!.body!) as { programs: { programActivationStatus: boolean }[]; chargeTimeStart: string }
    expect(body.programs.every((p) => p.programActivationStatus === false)).toBe(true)
    expect(body.chargeTimeStart).toBe(EV_SETTINGS.chargeTimeStart)
    const reads = dataCalls(renault, '/battery-status')
    clock.advance(60_000)
    await flush()
    expect(dataCalls(renault, '/battery-status')).toBe(reads + 1)
    await plugin.stop()
  })

  it('a settings command already pending (409): RATE_LIMITED, "try again", not an outage', async () => {
    const { plugin, renault } = await running()
    renault.world.settingsPending = true
    await expect(plugin.execute(VIN, { type: 'vehicle.start_charge' })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await plugin.stop()
  })

  it('stopping: the R5 cannot, the plugin says so (the server stops the charger before it comes to that)', async () => {
    const { plugin } = await running()
    await expect(plugin.execute(VIN, { type: 'vehicle.stop_charge' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await plugin.stop()
  })

  it('preconditioning: the hvac-start action at the setpoint, then a re-read a minute later', async () => {
    const { plugin, renault, clock } = await running()
    await plugin.execute(VIN, { type: 'vehicle.climate_start', targetTempC: 20 })
    const action = renault.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/actions/hvac-start')).at(-1)!
    expect(JSON.parse(action.body!)).toEqual({ data: { type: 'HvacStart', attributes: { action: 'start', targetTemperature: 20 } } })
    const before = dataCalls(renault, '/hvac-status')
    clock.advance(60_000)
    await flush()
    expect(dataCalls(renault, '/hvac-status')).toBe(before + 1)       // the effect is OBSERVED
    await plugin.execute(VIN, { type: 'vehicle.climate_stop' })
    expect(JSON.parse(renault.calls.at(-1)!.body!)).toEqual({ data: { type: 'HvacStart', attributes: { action: 'cancel' } } })
    await plugin.stop()
  })

  it('below the threshold the car announces (socThreshold), refused WITHOUT spending an action', async () => {
    const { plugin, renault } = await running()
    renault.world.battery = { data: { ...BATTERY_WAITING.data, attributes: { ...BATTERY_WAITING.data.attributes, batteryLevel: 12 } } }
    await plugin.execute(VIN, { type: 'vehicle.refresh' })
    await expect(plugin.execute(VIN, { type: 'vehicle.climate_start' })).rejects.toMatchObject({ code: 'LOW_BATTERY' })
    expect(renault.calls.some((c) => c.path.endsWith('/actions/hvac-start'))).toBe(false)
    await plugin.stop()
  })

  it('setting seats and steering wheel REWRITES the settings read, and publishes `seatHeat` whole', async () => {
    const { plugin, renault, ctx } = await running()
    await plugin.execute(VIN, { type: 'vehicle.climate_set', seatHeat: { fl: 1 }, steeringWheelHeat: true })
    const write = renault.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/ev/settings')).at(-1)!
    expect(JSON.parse(write.body!)).toMatchObject({ preconditioningHeatedLeftSeat: true, preconditioningHeatedStrgWheel: true, programs: EV_SETTINGS.programs })
    expect(patches(ctx).at(-1)).toEqual({ seatHeat: { fl: 1, fr: 0 }, steeringWheelHeat: true })
    await plugin.stop()
  })

  it('refuses any other command rather than pretending', async () => {
    const { plugin } = await running()
    await expect(plugin.execute(VIN, { type: 'vehicle.lock' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await plugin.stop()
  })

  it('stopping the plugin stops the polling', async () => {
    const { plugin, renault, clock } = await running()
    await plugin.stop()
    const before = dataCalls(renault, '/battery-status')
    clock.advance(6 * POLL_MS)
    await flush()
    expect(dataCalls(renault, '/battery-status')).toBe(before)
  })
})

describe('Renault — charge wake-up', () => {
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) }
  const wakes = (renault: ReturnType<typeof fakeRenault>) =>
    renault.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/ev/settings'))

  /** A window that CONTAINS the test clock's local time, and one that surely excludes it. */
  const hour = new Date(NOW).getHours()
  const pad = (h: number) => String((h + 24) % 24).padStart(2, '0')
  const DEDANS = { RENAULT_WAKE_FROM: `${pad(hour)}:00`, RENAULT_WAKE_TO: `${pad(hour + 1)}:00` }
  const DEHORS = { RENAULT_WAKE_FROM: `${pad(hour + 2)}:00`, RENAULT_WAKE_TO: `${pad(hour + 3)}:00` }

  async function running(over: { env?: Record<string, string>; parts?: Record<string, boolean>; battery?: unknown; pending?: boolean } = {}) {
    const s = await setup({
      session: { loginToken: LOGIN_TOKEN, personId: PERSON },
      env: { RENAULT_RATE_PER_HOUR: '600', RENAULT_POLL_MS: String(5 * 60_000), ...DEDANS, ...over.env },
      ...(over.parts ? { parts: over.parts } : {}),
    })
    if (over.battery !== undefined) s.renault.world.battery = over.battery
    if (over.pending) s.renault.world.settingsPending = true
    await s.plugin.discover()
    await s.plugin.start()
    await flush()
    return s
  }

  it('wakes a PLUGGED-IN car that is not charging, by replaying its own settings', async () => {
    const { plugin, renault } = await running()
    const sent = wakes(renault)
    expect(sent).toHaveLength(1)
    const body = JSON.parse(sent[0]!.body!) as Record<string, unknown>
    // its settings, intact — only the timestamp is new
    expect(body.chargeTimeStart).toBe(EV_SETTINGS.chargeTimeStart)
    expect(body.chargeDuration).toBe(EV_SETTINGS.chargeDuration)
    expect(body.programs).toEqual(EV_SETTINGS.programs)
    expect(body.lastSettingsUpdateTimestamp).not.toBe(EV_SETTINGS.lastSettingsUpdateTimestamp)
    await plugin.stop()
  })

  it('does NOT wake a car that is already charging, nor an unplugged car', async () => {
    const a = await running({ battery: BATTERY_CHARGING })
    expect(wakes(a.renault)).toHaveLength(0)
    await a.plugin.stop()
    const b = await running({ battery: BATTERY_UNPLUGGED })
    expect(wakes(b.renault)).toHaveLength(0)
    await b.plugin.stop()
  })

  /**
   * The ORDINARY case of a plugged-in car that isn't charging: it's full. It's the R5's state every
   * night after its charge — shaking it wouldn't change anything, and this wake-up WRITES to the
   * car.
   */
  it('does not wake a car already at its charge limit', async () => {
    const atTarget = { data: { id: VIN, attributes: { ...BATTERY_WAITING.data.attributes, batteryLevel: 80 } } }
    const { plugin, renault } = await running({ battery: atTarget })   // socTarget = 80 (SOC_LEVELS)
    expect(wakes(renault)).toHaveLength(0)
    await plugin.stop()
  })

  it('does not wake outside the time window', async () => {
    const { plugin, renault } = await running({ env: DEHORS })
    expect(wakes(renault)).toHaveLength(0)
    await plugin.stop()
  })

  it('does not wake when the sub-item is unchecked', async () => {
    const { plugin, renault } = await running({ parts: { charge_wake: false } })
    expect(wakes(renault)).toHaveLength(0)
    await plugin.stop()
  })

  it('does not shake the car in a loop: one wake-up, then the delay', async () => {
    const { plugin, renault, clock } = await running({ env: { RENAULT_WAKE_EVERY_MS: String(30 * 60_000) } })
    expect(wakes(renault)).toHaveLength(1)
    clock.advance(6 * 60_000)            // one more polling round, still plugged in and stopped
    await flush()
    expect(wakes(renault)).toHaveLength(1)
    await plugin.stop()
  })

  it('a failing wake-up does not lose the reading', async () => {
    // Kamereon refuses the write: the state must have been published nonetheless
    const { plugin, ctx, renault } = await running({ pending: true })
    expect(wakes(renault)).toHaveLength(1)
    const patches = (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])
    expect(patches.at(-1)).toMatchObject({ soc: 58, pluggedIn: true, charging: false })
    await plugin.stop()
  })

  /**
   * The flaw that the day of 2026-09-19 brought to light: five hours of refused wake-ups, visible
   * NOWHERE outside the server console, while a day of solar surplus was being lost.
   */
  it('keeps the command returned by Renault, and shows it in the status', async () => {
    const { plugin, app } = await running()
    const status = (await app.inject({ method: 'GET', url: '/api/plugins/renault/status' })).json()
    expect(status.lastWake).toMatchObject({ result: 'sent', detail: 'HVAC_CHARGE_SYNCH CREATED ba6a5b31-0000-0000-0000-9f2c1d4e8a70' })
    await plugin.stop()
  })

  it('reads a 409 as "not now", not as an outage', async () => {
    const { plugin, app } = await running({ pending: true })
    const status = (await app.inject({ method: 'GET', url: '/api/plugins/renault/status' })).json()
    expect(status.lastWake.result).toBe('deferred')
    // the polling round itself went fine: a wake-up refusal is not a plugin failure
    expect(status.lastError).toBeNull()
    await plugin.stop()
  })
})
