import { X509Certificate } from 'node:crypto'
import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { selfSignedCertificate, startTlsServer, type TestCertificate } from '../../core/test-tls'
import { ENSEMBLE_INVENTORY, ENSEMBLE_POWER, INVERTERS, LIVEDATA, PRODUCTION } from './__fixtures__/gateway'
import { EVSE_PREFERENCE, EVSE_STATUS, EVSE_SUMMARY } from './__fixtures__/evse'
import { createEnphasePlugin, enphaseConfigSchema, peakChunks } from './index'
import { PANEL_STALE_MS } from './mapping'
import type { TokenStore } from './token'
import type { CloudStore, CloudSession } from './cloud'
import type { DaysStore, EnergyDays } from './days'
import type { InverterDays, InverterDaysStore } from './inverterDays'

// IQ Gateway pairing. The point watched here: the Enphase account credentials PASS THROUGH the route
// and vanish — they are neither cached, nor sent back to the UI, nor required in the configuration.
// No real gateway or account is touched.

const NOW = Date.UTC(2026, 8, 11)
const DAY = 86_400_000
const SERIAL = '123456789012'
const HOST = 'envoy.test'

const INFO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<envoy_info><time>1789123472</time><device><sn>${SERIAL}</sn><pn>800-00654-r09</pn>
<software>D8.3.5289</software><imeter>true</imeter></device><web-tokens>true</web-tokens></envoy_info>`

/** What the real gateway returns on each route (anonymized capture). */
const FIXTURES: Record<string, unknown> = {
  '/production.json?details=1': PRODUCTION,
  '/api/v1/production/inverters': INVERTERS,
  '/ivp/livedata/status': LIVEDATA,
  '/ivp/ensemble/inventory': ENSEMBLE_INVENTORY,
  '/ivp/ensemble/power': ENSEMBLE_POWER,
  // shape of the real gateway (D8.3), invented serials and values
  '/ivp/pdm/device_data': {
    '1001': { devName: 'pcu', sn: '100000000001', channels: [{ wattHours: { today: 1200, yesterday: 0, week: 0 }, lifetime: { joulesProduced: 3_600_000_000 } }] },
    '1002': { devName: 'pcu', sn: '100000000002', channels: [{ wattHours: { today: 1100, yesterday: 0, week: 0 }, lifetime: { joulesProduced: 7_200_000_000 } }] },
    deviceCount: 2,
  },
}

function jwt(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`
}
const token = (days: number, over: Record<string, unknown> = {}) => jwt({
  aud: SERIAL, enphaseUser: 'owner', username: 'toit@exemple.fr',
  exp: Math.floor((NOW + days * DAY) / 1000), ...over,
})

/** Enphase's daily history, invented: three whole days before today (NOW is the 11th). */
const LIFETIME = { start_date: '2026-09-08', production: [1000, 2000, 3000, 4000], consumption: [500, null, 700, 800] }

const response = (text: string, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => JSON.parse(text) as unknown,
  text: async () => text,
})

/** Fake gateway: `/info` without a token, the rest with Bearer; 401 if the token does not match. */
function fakeGateway(opts: { infoDown?: boolean; accept?: string; failing?: string[] } = {}) {
  const calls: { path: string; auth: string | undefined }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const path = url.replace(`https://${HOST}`, '')
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization
    calls.push({ path, auth })
    if (path === '/info') {
      if (opts.infoDown) throw new Error('ECONNREFUSED')
      return response(INFO_XML)
    }
    if (opts.accept && auth !== `Bearer ${opts.accept}`) return response('<html>401</html>', 401)
    if (opts.failing?.includes(path)) return response('<html>not found</html>', 404)
    const fixture = FIXTURES[path]
    return response(JSON.stringify(fixture ?? { path }))
  })
  return { fetchImpl, calls }
}

/** Fake Enphase cloud: session then exchange, as the vendor's technical note describes them. */
function fakeCloud(minted = token(365), opts: { seriesFails?: boolean } = {}) {
  const calls: { url: string; body: string; method: string }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, body: String(init?.body ?? ''), method: init?.method ?? 'GET' })
    if (url.includes('/start_charging')) return response('{"meta":{},"data":{"chargingLevel":24},"error":{}}')
    if (url.includes('/stop_charging')) return response('{"meta":{},"data":{},"error":{}}')
    if (url.includes('/login/login.json')) return response('{"session_id":"sess-1"}')
    if (url.includes('/tokens')) return response(minted)
    if (url.includes('search_sites')) return response(JSON.stringify({ sites: [{ id: 1000001, title: 'Maison' }] }))
    if (url.includes('/users/self/token')) return response('{"token":"access-1"}')
    if (url.includes('/pv/systems/1000001/lifetime_energy')) return response(JSON.stringify(LIFETIME))
    if (url.includes('/pv/systems/1000001/array_layout_x')) return response(JSON.stringify({ arrays: [{ modules: [
      { inverter: { inverter_id: 900000001, serial_num: '100000000001' } }, { inverter: { inverter_id: 900000002, serial_num: '100000000002' } },
    ] }] }))
    if (url.includes('/inverter_data_x/energy.json')) {
      const day = Number(/start_date=\d{4}-\d{2}-(\d{2})/.exec(url)![1])
      // commissioning day: the inverters had not reported yet, Enphase has nothing
      if (day === 8) return response(JSON.stringify({ production: {} }))
      return response(JSON.stringify({ production: { 900000001: day * 100, 900000002: day * 100 + 1 } }))
    }
    if (url.includes('/inverter_data_x/time_series.json')) {
      if (opts.seriesFails) throw new TypeError('fetch failed')
      // each day of the range: a quarter-hour peak of day × 10 W, nothing on commissioning day
      const [, from, to] = /start_date=([\d-]+)&end_date=([\d-]+)/.exec(url)!
      const out: Record<string, unknown> = { haiku: '' }
      for (let d = Number(from!.slice(8)); d <= Number(to!.slice(8)); d++) {
        out[`${from!.slice(0, 8)}${String(d).padStart(2, '0')}`] = d === 8 ? {} : {
          900000001: { POWR: [[0, 0, 900], [900, d * 10, 900]] }, 900000002: { POWR: [[0, 0, 900], [900, d * 10 + 1, 900]] },
        }
      }
      return response(JSON.stringify(out))
    }
    if (url.includes('/ev_chargers/status') && url.includes('/api/v2/')) return response(JSON.stringify({ data: {} }))
    if (url.includes('/ev_chargers/status')) return response(JSON.stringify(EVSE_STATUS))
    if (url.includes('/ev_chargers/summary')) return response(JSON.stringify(EVSE_SUMMARY))
    if (url.includes('/charging-mode/') && init?.method === 'PUT') return response('{"meta":{},"data":{"data":null,"error":{}},"error":{}}')
    if (url.includes('/charging-mode/')) return response(JSON.stringify(EVSE_PREFERENCE))
    return response(minted)
  })
  return { fetchImpl, calls }
}

function memoryStore(): TokenStore & { value: string | null } {
  const store = {
    value: null as string | null,
    load: async () => store.value,
    save: async (t: string) => { store.value = t },
  }
  return store
}

function memoryDays(): DaysStore & { saved: unknown } {
  const store = {
    saved: null as unknown,
    load: async (days: EnergyDays) => { if (store.saved) days.restore(store.saved) },
    save: async (days: EnergyDays) => { store.saved = JSON.parse(JSON.stringify(days)); days.dirty = false },
  }
  return store
}

function memoryInverters(): InverterDaysStore & { saved: unknown } {
  const store = {
    saved: null as unknown,
    load: async (days: InverterDays) => { if (store.saved) days.restore(store.saved) },
    save: async (days: InverterDays) => { store.saved = JSON.parse(JSON.stringify(days)); days.dirty = false },
  }
  return store
}

function memoryCloud(): CloudStore & { value: CloudSession | null } {
  const store = {
    value: null as CloudSession | null,
    load: async () => store.value,
    save: async (s: CloudSession) => { store.value = s },
  }
  return store
}

async function started(over: {
  env?: Record<string, string>
  gateway?: ReturnType<typeof fakeGateway>
  cloud?: ReturnType<typeof fakeCloud>
  store?: ReturnType<typeof memoryStore>
  cloudStore?: ReturnType<typeof memoryCloud>
  daysStore?: ReturnType<typeof memoryDays>
  inverterDaysStore?: ReturnType<typeof memoryInverters>
  parts?: Record<string, boolean>
} = {}) {
  const gateway = over.gateway ?? fakeGateway()
  const cloud = over.cloud ?? fakeCloud()
  const store = over.store ?? memoryStore()
  const cloudStore = over.cloudStore ?? memoryCloud()
  const daysStore = over.daysStore ?? memoryDays()
  const inverterDaysStore = over.inverterDaysStore ?? memoryInverters()
  const plugin = createEnphasePlugin({
    gatewayFetch: gateway.fetchImpl, cloudFetch: cloud.fetchImpl, store, cloudStore, daysStore, inverterDaysStore,
  })
  const clock = new ManualClock(NOW)
  const ctx: PluginContext = {
    pluginId: 'enphase',
    config: enphaseConfigSchema.parse({ ENPHASE_HOST: HOST, ...over.env }),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: over.parts ?? {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/enphase' })
  await app.ready()
  return { plugin, app, gateway, cloud, store, cloudStore, daysStore, inverterDaysStore, ctx, clock }
}

/** Lets in-flight promises resolve (the pollers run on the injected clock). */
const settle = () => new Promise((r) => setTimeout(r, 0))

const post = (app: Awaited<ReturnType<typeof started>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/plugins/enphase/token', payload: payload as object })
const get = (app: Awaited<ReturnType<typeof started>>['app'], url: string) =>
  app.inject({ method: 'GET', url: `/api/plugins/enphase${url}` })

describe('unpaired gateway', () => {
  it('starts anyway, declares itself needs_pairing, and has already read the serial number from /info', async () => {
    const { plugin, app, gateway } = await started()
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
    // /info carries NO token: it is what allows recognizing the gateway before pairing
    expect(gateway.calls).toEqual([{ path: '/info', auth: undefined }])
    expect(await get(app, '/token').then((r) => r.json())).toMatchObject({ paired: false, serial: SERIAL, software: 'D8.3.5289', stage: 'none', cloudLinked: false })
  })

  it('says WHERE the token will be kept: it is what answers "do I have something to copy?"', async () => {
    const withCache = await started()
    expect((await get(withCache.app, '/token').then((r) => r.json())).tokenFile).toMatch(/enphase-token\.json$/)
    // cache disabled: the UI must then warn that the pairing will not survive a restart
    const without = await started({ env: { ENPHASE_TOKEN_FILE: '' } })
    expect((await get(without.app, '/token').then((r) => r.json())).tokenFile).toBeNull()
  })

  it('the keys listed in Settings contain no account credential', async () => {
    const { plugin } = await started()
    expect(plugin.health!().keys).toEqual(['ENPHASE_HOST', 'ENPHASE_TOKEN', 'ENPHASE_TOKEN_FILE', 'ENPHASE_CLOUD_FILE', 'ENPHASE_DAYS_FILE', 'ENPHASE_INVERTER_DAYS_FILE'])
    expect(Object.keys(enphaseConfigSchema.shape)).not.toContain('ENPHASE_PASSWORD')
    expect(plugin.parts).toEqual([{ id: 'ev_charger', labelKey: 'kinds.ev_charger', enabledByDefault: true }])
  })

  it('refuses the raw reading as long as no token is in place', async () => {
    const { app } = await started()
    expect((await get(app, '/raw')).statusCode).toBe(409)
    expect((await get(app, '/ev/raw')).statusCode).toBe(409)
  })
})

describe('pairing with a pasted token', () => {
  it('adopts a valid token, caches it, and switches to ok', async () => {
    const pasted = token(300)
    const { plugin, app, store, cloud } = await started({ gateway: fakeGateway({ accept: pasted }) })
    const r = await post(app, { token: `  ${pasted}\n` })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ paired: true, serial: SERIAL, stage: 'ok', daysLeft: 300, role: 'owner', source: 'minted' })
    expect(store.value).toBe(pasted)                       // the cache keeps the token, not the credentials
    expect(cloud.calls).toHaveLength(0)                    // a pasted token does not touch the cloud
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
  })

  it('the response NEVER returns the token itself, only its expiry', async () => {
    const pasted = token(300)
    const { app } = await started()
    const body = await post(app, { token: pasted }).then((r) => r.body)
    expect(body).not.toContain(pasted)
    expect(JSON.parse(body)).toHaveProperty('expiresAt', NOW + 300 * DAY)
  })

  it('refuses an unreadable or expired token, or one issued for ANOTHER gateway, saying which', async () => {
    const { app } = await started()
    for (const [bad, expected] of [
      ['tronque', /not a readable/],
      [token(-1), /expired on/],
      [token(100, { aud: '999999999999' }), /issued for gateway 999999999999/],
    ] as const) {
      const r = await post(app, { token: bad })
      expect(r.statusCode).toBe(400)
      expect(r.json()).toMatchObject({ error: { code: 'NEEDS_PAIRING', message: expect.stringMatching(expected) as unknown as string } })
    }
  })

  it('a body that is neither a token nor credentials → 400 saying what to send', async () => {
    const { app } = await started()
    const r = await post(app, { user: 'seul' })
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ error: { message: expect.stringContaining('{ token }') as unknown as string } })
  })
})

describe('pairing with credentials', () => {
  it('mints a token with the cloud for THIS gateway, without keeping the password', async () => {
    const minted = token(365)
    const { app, cloud, store, cloudStore } = await started({ gateway: fakeGateway({ accept: minted }), cloud: fakeCloud(minted) })
    const r = await post(app, { user: 'toit@exemple.fr', password: 'motdepasse' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ paired: true, stage: 'ok', daysLeft: 365, cloudLinked: true })

    const login = cloud.calls.find((c) => c.url.includes('/login/login.json'))
    const mintedCall = cloud.calls.find((c) => c.url.includes('/tokens'))
    expect(new URLSearchParams(login!.body).get('user[password]')).toBe('motdepasse')
    expect(JSON.parse(mintedCall!.body)).toMatchObject({ serial_num: SERIAL })
    expect(store.value).toBe(minted)
    expect(cloudStore.value).toMatchObject({ sessionId: 'sess-1' })
    expect(r.body).not.toContain('motdepasse')
    expect(JSON.stringify(cloudStore.value)).not.toContain('motdepasse')
  })

  it('without a reachable gateway, still links the cloud: the charger does not need the serial number', async () => {
    const { app, cloud, cloudStore } = await started({ gateway: fakeGateway({ infoDown: true }) })
    const r = await post(app, { user: 'u', password: 'p' })
    expect(r.statusCode).toBe(502)
    expect(cloud.calls.some((c) => c.url.includes('/login/login.json'))).toBe(true)
    expect(cloudStore.value).toMatchObject({ sessionId: 'sess-1' })
    expect(cloud.calls.some((c) => c.url.includes('/tokens'))).toBe(false)
  })

  it('does not mint while the current token is still good, but links the cloud (the charger)', async () => {
    const { app, cloud, cloudStore } = await started({ env: { ENPHASE_TOKEN: token(200) } })
    const r = await post(app, { user: 'u', password: 'p' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ paired: true, cloudLinked: true, daysLeft: 200 })
    expect(cloud.calls.some((c) => c.url.includes('/login/login.json'))).toBe(true)
    expect(cloud.calls.some((c) => c.url.includes('/tokens'))).toBe(false)
    expect(cloudStore.value).toMatchObject({ sessionId: 'sess-1' })
  })

  it('`force` overrides this safeguard, for whoever really wants to replace their token', async () => {
    const minted = token(365)
    const { app, cloud, store } = await started({ env: { ENPHASE_TOKEN: token(200) }, cloud: fakeCloud(minted) })
    const r = await post(app, { user: 'u', password: 'p', force: true })
    expect(r.statusCode).toBe(200)
    expect(cloud.calls.some((c) => c.url.includes('/tokens'))).toBe(true)
    expect(store.value).toBe(minted)
  })

  it('a token expiring soon does NOT trigger the safeguard: renewing it is precisely the goal', async () => {
    const { app, cloud } = await started({ env: { ENPHASE_TOKEN: token(5) } })
    expect((await post(app, { user: 'u', password: 'p' })).statusCode).toBe(200)
    expect(cloud.calls.some((c) => c.url.includes('/tokens'))).toBe(true)
  })

  it('credentials refused by the cloud → 400, and nothing is cached', async () => {
    const cloud = { calls: [] as { url: string; body: string }[], fetchImpl: vi.fn<FetchLike>(async () => response('{"message":"bad"}', 401)) }
    const { app, store, cloudStore } = await started({ cloud: cloud as unknown as ReturnType<typeof fakeCloud> })
    const r = await post(app, { user: 'u', password: 'faux' })
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ error: { code: 'NEEDS_PAIRING' } })
    expect(store.value).toBeNull()
    expect(cloudStore.value).toBeNull()
  })
})

describe('token already known at startup', () => {
  it("takes the configuration's one, and says so in its state", async () => {
    const configured = token(200)
    const { app } = await started({ env: { ENPHASE_TOKEN: configured }, gateway: fakeGateway({ accept: configured }) })
    expect(await get(app, '/token').then((r) => r.json())).toMatchObject({ paired: true, source: 'config', daysLeft: 200 })
  })

  it("picks up the cache's one at the next start: nothing more to type for a year", async () => {
    const cached = token(180)
    const store = memoryStore()
    store.value = cached
    const { plugin } = await started({ store, gateway: fakeGateway({ accept: cached }) })
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
  })

  it('goes degraded under 30 days: the Settings badge warns BEFORE the failure', async () => {
    const { plugin, app } = await started({ env: { ENPHASE_TOKEN: token(12) } })
    expect(plugin.health!()).toMatchObject({ status: 'degraded', detail: expect.stringContaining('12 day(s)') as unknown as string })
    expect(await get(app, '/token').then((r) => r.json())).toMatchObject({ stage: 'expiring', daysLeft: 12, renewUnderDays: 30 })
  })

  it('an expired token in the configuration leaves the plugin in needs_pairing, not in error', async () => {
    const { plugin } = await started({ env: { ENPHASE_TOKEN: token(-3) } })
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
  })
})

describe('raw reading (to write the mapping fixtures)', () => {
  it('queries every local route with the token, and carries the failure of one without falling over', async () => {
    const pasted = token(300)
    const gateway = fakeGateway({ accept: pasted, failing: ['/ivp/ensemble/power'] })
    const { app } = await started({ gateway })
    await post(app, { token: pasted })
    const raw = await get(app, '/raw').then((r) => r.json() as Record<string, unknown>)
    expect(raw.info).toMatchObject({ serial: SERIAL })
    expect(raw['/api/v1/production/inverters']).toHaveLength(20)
    expect(raw['/ivp/ensemble/power']).toMatchObject({ error: expect.stringContaining('404') as unknown as string })
    // every authenticated route carries the Bearer
    const authed = gateway.calls.filter((c) => c.path !== '/info')
    expect(authed.every((c) => c.auth === `Bearer ${pasted}`)).toBe(true)
  })

  it('the EVSE reading refuses as long as the Enlighten account is not linked — a pasted token is not enough', async () => {
    const pasted = token(300)
    const { app } = await started()
    await post(app, { token: pasted })
    expect((await get(app, '/ev/raw')).statusCode).toBe(409)
  })

  it('the EVSE reading probes the cloud after a pairing with credentials', async () => {
    const minted = token(365)
    const cloud = fakeCloud(minted)
    const { app } = await started({ gateway: fakeGateway({ accept: minted }), cloud })
    await post(app, { user: 'u', password: 'p' })
    const res = await get(app, '/ev/raw')
    const raw = res.json() as Record<string, unknown>
    // the account's bearer token never leaves the server: only whether one is obtainable
    expect(raw).not.toHaveProperty('/users/self/token')
    expect(raw.hasAccessToken).toBe(true)
    expect(res.body).not.toContain('access-1')
    expect(cloud.calls.some((c) => c.url.includes('/ev_chargers/status') || c.url.includes('search_sites'))).toBe(true)
  })
})

describe('daily history', () => {
  const lifetimeCalls = (cloud: ReturnType<typeof fakeCloud>) => cloud.calls.filter((c) => c.url.includes('/lifetime_energy'))
  const paired = async () => {
    const t = token(300)
    return started({ env: { ENPHASE_TOKEN: t }, gateway: fakeGateway({ accept: t }) })
  }

  it("an account pairing fetches Enphase's history once, today excluded, a null left out", async () => {
    const { plugin, app, cloud, daysStore } = await started()
    expect((await post(app, { user: 'u', password: 'p' })).statusCode).toBe(200)
    await settle(); await settle()
    expect(lifetimeCalls(cloud)).toHaveLength(1)
    const history = await plugin.energyDays!('site')
    expect(history.days.map((d) => [d.source, d.productionWh, d.consumptionWh])).toEqual([
      ['vendor', 1000, 500], ['vendor', 2000, undefined], ['vendor', 3000, 700],
    ])
    expect(history.syncedAt).toBe(NOW)
    expect(daysStore.saved).not.toBeNull()
    expect((await get(app, '/token')).json()).toMatchObject({ history: { days: 3, syncedAt: NOW, syncing: false, error: null } })
  })

  it('at startup, a linked account and an empty history synchronize; a history already synced does not', async () => {
    const cloudStore = memoryCloud()
    cloudStore.value = { sessionId: 'sess-1', cookie: 'c', siteId: '1000001' }
    const first = await started({ cloudStore, parts: { ev_charger: false } })
    await first.plugin.start(); await settle(); await settle()
    expect(lifetimeCalls(first.cloud)).toHaveLength(1)
    await first.plugin.stop()

    const again = await started({ cloudStore, daysStore: first.daysStore, parts: { ev_charger: false } })
    await again.plugin.start(); await settle(); await settle()
    expect(lifetimeCalls(again.cloud)).toHaveLength(0)
    expect((await again.plugin.energyDays!('site')).days).toHaveLength(3)
    await again.plugin.stop()
  })

  it('the button synchronizes again; without the account it says why', async () => {
    const { app } = await started()
    const refused = await app.inject({ method: 'POST', url: '/api/plugins/enphase/history/sync' })
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ error: { code: 'NEEDS_PAIRING' } })
    expect((await get(app, '/token')).json()).toMatchObject({ history: { error: expect.stringContaining('Enphase account') } })

    await post(app, { user: 'u', password: 'p' })
    await settle(); await settle()
    const ok = await app.inject({ method: 'POST', url: '/api/plugins/enphase/history/sync' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toMatchObject({ history: { days: 3, error: null } })
  })

  it("the polls feed today's day: the inverters' production, and the consumption balanced around it", async () => {
    const { plugin, ctx } = await paired()
    await plugin.discover()
    await plugin.start()
    await settle()
    const today = (await plugin.energyDays!('site')).days.at(-1)
    // the two inverters' day counters (1200 + 1100 Wh), never the gateway's own `whToday`
    expect(today).toMatchObject({ source: 'local', productionWh: 2300 })
    expect(today!.consumptionWh).toBeGreaterThan(0)
    const site = (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter(([id]) => id === 'site').map(([, p]) => p as Record<string, unknown>)
    expect(site.find((p) => p.todayProductionWh !== undefined)).toMatchObject({ todayProductionWh: 2300, todayConsumptionWh: today!.consumptionWh })
    await plugin.stop()
  })

  it("then fetches each inverter's days, one call per day, through the id ↔ serial map", async () => {
    const { plugin, app, cloud, clock, inverterDaysStore } = await started()
    await post(app, { user: 'u', password: 'p' })
    for (let i = 0; i < 8; i++) { clock.advance(2000); await settle(); await settle() }
    const calls = cloud.calls.filter((c) => c.url.includes('/inverter_data_x/energy.json'))
    // the 8th, 9th and 10th: from commissioning to yesterday (today is the 11th)
    expect(calls.map((c) => /start_date=([\d-]+)/.exec(c.url)![1])).toEqual(['2026-09-08', '2026-09-09', '2026-09-10'])
    const inv = (await plugin.energyDays!('site')).inverters!
    expect(inv.devices.map((d) => d.wh.slice(0, 3))).toEqual([[null, 900, 1000], [null, 901, 1001]])
    // then the peaks, the three days in ONE call to the quarter-hour series
    const series = cloud.calls.filter((c) => c.url.includes('/inverter_data_x/time_series.json') && c.url.includes('start_date=2026-09-08'))
    expect(series).toHaveLength(1)
    expect(series[0]!.url).toContain('end_date=2026-09-10')
    expect(inv.devices.map((d) => d.peakW!.slice(0, 3))).toEqual([[null, 90, 100], [null, 91, 101]])
    expect(inv.syncedAt).not.toBeNull()
    expect(inverterDaysStore.saved).not.toBeNull()
    expect((await get(app, '/token')).json()).toMatchObject({ history: { inverters: { done: null, error: null } } })
  })

  it("the gateway's polls give each inverter today's production and its lifetime counter", async () => {
    const { plugin } = await paired()
    await plugin.discover()
    await plugin.start()
    await settle()
    const inv = (await plugin.energyDays!('site')).inverters!
    expect(inv.devices).toEqual([
      { externalId: '100000000001', lifetimeWh: 1_000_000, wh: [1200] },
      { externalId: '100000000002', lifetimeWh: 2_000_000, wh: [1100] },
    ])
    await plugin.stop()
  })

  it('tells the state of every past day, and a smart resync asks Enphase only for the incomplete ones', async () => {
    const { app, cloud, clock } = await started()
    await post(app, { user: 'u', password: 'p' })
    for (let i = 0; i < 8; i++) { clock.advance(2000); await settle(); await settle() }
    // the 8th: nothing at Enphase for the inverters, known; the 9th has no consumption but production: complete
    expect((await get(app, '/token')).json()).toMatchObject({ history: { coverage: { days: 'ecc' } } })
    const before = cloud.calls.filter((c) => c.url.includes('/inverter_data_x/energy.json')).length
    const smart = await app.inject({ method: 'POST', url: '/api/plugins/enphase/history/sync', payload: {} })
    expect(smart.statusCode).toBe(200)
    for (let i = 0; i < 8; i++) { clock.advance(2000); await settle(); await settle() }
    expect(cloud.calls.filter((c) => c.url.includes('/inverter_data_x/energy.json')).length).toBe(before)
    // "Take everything again": every day is asked again
    await app.inject({ method: 'POST', url: '/api/plugins/enphase/history/sync', payload: { force: true } })
    for (let i = 0; i < 8; i++) { clock.advance(2000); await settle(); await settle() }
    expect(cloud.calls.filter((c) => c.url.includes('/inverter_data_x/energy.json')).length).toBe(before + 3)
  })

  it('a peak request that fails costs its days only: shown incomplete, the Wh still synchronized', async () => {
    const { app, plugin, clock } = await started({ cloud: fakeCloud(token(365), { seriesFails: true }) })
    await post(app, { user: 'u', password: 'p' })
    for (let i = 0; i < 8; i++) { clock.advance(2000); await settle(); await settle() }
    const inv = (await plugin.energyDays!('site')).inverters!
    expect(inv.devices.map((d) => d.wh.slice(0, 3))).toEqual([[null, 900, 1000], [null, 901, 1001]])
    expect(inv.syncedAt).not.toBeNull()
    // the 8th has nothing at Enphase (its Wh say so); the 9th and 10th lack their peaks: incomplete, so "Resync" has work
    expect((await get(app, '/token')).json()).toMatchObject({
      history: { coverage: { days: 'epp' }, inverters: { done: null, error: expect.stringContaining('1/1 peak requests failed') } },
    })
  })

  it('serves no history for another device', async () => {
    const { plugin } = await paired()
    await expect(plugin.energyDays!('482000000001')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })
})

describe('devices', () => {
  /** Plugin paired on the fake gateway, which serves the responses captured from the real one. */
  const paired = async () => {
    const t = token(300)
    return started({ env: { ENPHASE_TOKEN: t }, gateway: fakeGateway({ accept: t }) })
  }

  it('publishes the site, a sensor per inverter and a device per battery', async () => {
    const { plugin } = await paired()
    const devices = await plugin.discover()
    expect(devices).toHaveLength(23)
    expect(devices[0]).toMatchObject({ id: 'enphase:site', kind: 'energy' })
    expect(devices.filter((d) => d.kind === 'sensor')).toHaveLength(20)
  })

  it('publishes nothing as long as the gateway is not paired', async () => {
    const { plugin } = await started()
    expect(await plugin.discover()).toEqual([])
  })

  it('polls the meters and pushes the site state', async () => {
    const { plugin, ctx } = await paired()
    await plugin.discover()
    await plugin.start()
    await settle()
    const site = (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.find(([id]) => id === 'site')
    expect(site?.[1]).toMatchObject({ kind: 'energy', productionW: 6472, consumptionW: 725, gridW: -5763, batteryW: -16 })
    await plugin.stop()
  })

  it('pushes the power of each inverter, and the batteries', async () => {
    const { plugin, ctx } = await paired()
    await plugin.discover()
    await plugin.start()
    await settle()
    const calls = (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls
    const panels = calls.filter(([, patch]) => (patch as { kind: string }).kind === 'sensor')
    expect(panels).toHaveLength(20)
    expect(panels[0]![1]).toMatchObject({ kind: 'sensor', value: INVERTERS[0]!.lastReportWatts })
    // two batteries, one at rest and the other discharging 16 W (contract sign: negative)
    const batteries = calls.filter(([id]) => ENSEMBLE_INVENTORY[0]!.devices.some((d) => d.serial_num === id))
    expect(batteries).toHaveLength(2)
    expect(batteries.map(([, p]) => (p as { batteryW: number }).batteryW).sort()).toEqual([-16, 0])
    await plugin.stop()
  })

  it('an inverter silent for too long is declared unavailable, not reset to zero', async () => {
    const { plugin, ctx, clock } = await paired()
    await plugin.discover()
    await plugin.start()
    await settle()
    ;(ctx.setAvailable as ReturnType<typeof vi.fn>).mockClear()
    ;(ctx.emitState as ReturnType<typeof vi.fn>).mockClear()
    // the capture dates from a sunny afternoon: we advance past the last report + the half-hour
    // grace period, which simulates nightfall
    const last = Math.max(...INVERTERS.map((i) => i.lastReportDate)) * 1000
    clock.advance(last + PANEL_STALE_MS + 60_000 - clock.now())
    await settle()
    const off = (ctx.setAvailable as ReturnType<typeof vi.fn>).mock.calls.filter(([, ok]) => ok === false)
    expect(off).toHaveLength(20)
    // no value was republished for a solar panel: we do not replace a measurement with a zero
    const panels = (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter(([, patch]) => (patch as { kind: string }).kind === 'sensor')
    expect(panels).toHaveLength(0)
    await plugin.stop()
  })

  it('refuses every command: the gateway is read-only here', async () => {
    const { plugin } = await started()
    await expect(plugin.execute('x', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
  })

  it('a pasted token does not open the charger', async () => {
    const { plugin } = await paired()
    expect((await plugin.discover()).filter((d) => d.kind === 'ev_charger')).toHaveLength(0)
  })

  it('publishes the charger after an account pairing, startable and stoppable', async () => {
    const minted = token(365)
    const { plugin, app, ctx } = await started({ gateway: fakeGateway({ accept: minted }), cloud: fakeCloud(minted) })
    expect((await post(app, { user: 'u', password: 'p' })).statusCode).toBe(200)
    const devices = await plugin.discover()
    const charger = devices.find((d) => d.kind === 'ev_charger')
    expect(charger).toMatchObject({
      id: 'enphase:482000000001', kind: 'ev_charger', name: 'Borne Enphase',
      capabilities: ['charge_control', 'charge_mode'], meta: { manufacturer: 'Enphase', model: 'IQ-EVSE-EU-3032' },
    })
    await plugin.start()
    await settle()
    const state = (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.find(([id]) => id === '482000000001')
    expect(state?.[1]).toMatchObject({ kind: 'ev_charger', status: 'connected', powerW: 0, sessionWh: 12363, maxCurrentA: 24, chargeMode: 'green' })
    await plugin.stop()
  })

  it("starting sends the app's DEFAULT current (24 A), stopping a PUT; the state follows through a read", async () => {
    const minted = token(365)
    const { plugin, app, cloud, clock } = await started({ gateway: fakeGateway({ accept: minted }), cloud: fakeCloud(minted) })
    await post(app, { user: 'u', password: 'p' })
    await plugin.discover()
    await plugin.start()
    await settle()
    await plugin.execute('482000000001', { type: 'ev_charger.start' })
    const start = cloud.calls.find((c) => c.url.includes('/start_charging'))!
    expect(start).toMatchObject({ method: 'POST', body: '{"chargingLevel":24,"connectorId":1}' })
    expect(start.url).toContain('/service/evse_controller/1000001/ev_chargers/482000000001/start_charging')
    await plugin.execute('482000000001', { type: 'ev_charger.stop' })
    expect(cloud.calls.find((c) => c.url.includes('/stop_charging'))).toMatchObject({ method: 'PUT', body: '' })
    const reads = cloud.calls.filter((c) => c.url.includes('/ev_chargers/status')).length
    clock.advance(45_000)
    for (let i = 0; i < 10; i++) await settle()
    expect(cloud.calls.filter((c) => c.url.includes('/ev_chargers/status')).length).toBeGreaterThan(reads)
    await plugin.stop()
  })

  it('a refusal under HTTP 200 (non-empty `error`) surfaces; an unknown charger is unavailable', async () => {
    const minted = token(365)
    const cloud = fakeCloud(minted)
    const base = cloud.fetchImpl.getMockImplementation()!
    cloud.fetchImpl.mockImplementation(async (url, init) => url.includes('/start_charging')
      ? response('{"data":null,"error":{"displayMessage":"not plugged","code":"400"}}')
      : base(url, init))
    const { plugin, app } = await started({ gateway: fakeGateway({ accept: minted }), cloud })
    await post(app, { user: 'u', password: 'p' })
    await plugin.discover()
    await plugin.start()
    await settle()
    await expect(plugin.execute('482000000001', { type: 'ev_charger.start' })).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    await expect(plugin.execute('nope', { type: 'ev_charger.stop' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await plugin.stop()
  })

  /**
   * Seen on the real charger on 2026-10-02: a forced charge finished, the charger unplugged, it still
   * held its cancellation (`mode: 0`, preference `GREEN_CHARGING`) and the app could no longer switch
   * green back on ("already enabled"). Switching to manual then back to green lifted it.
   */
  function overriddenCloud(minted: string, opts: { pluggedIn?: boolean; preference?: string; failRestore?: number } = {}) {
    const cloud = fakeCloud(minted)
    const base = cloud.fetchImpl.getMockImplementation()!
    const charger = { ...EVSE_STATUS.data.chargers[0]!, mode: 0, charging: false, pluggedIn: opts.pluggedIn ?? false }
    const status = { ...EVSE_STATUS, data: { ...EVSE_STATUS.data, chargers: [charger] } }
    const modes = EVSE_PREFERENCE.data.modes
    const preference = opts.preference ?? 'GREEN_CHARGING'
    const pref = { ...EVSE_PREFERENCE, data: { ...EVSE_PREFERENCE.data, modes: {
      greenCharging: { ...modes.greenCharging, enabled: preference === 'GREEN_CHARGING' },
      scheduledCharging: { ...modes.scheduledCharging, enabled: preference === 'SCHEDULED_CHARGING' },
      manualCharging: { ...modes.manualCharging, enabled: preference === 'MANUAL_CHARGING' },
    } } }
    let restoreFailures = opts.failRestore ?? 0
    cloud.fetchImpl.mockImplementation(async (url, init) => {
      if (url.includes('/charging-mode/')) cloud.calls.push({ url, body: String(init?.body ?? ''), method: init?.method ?? 'GET' })
      if (url.includes('/charging-mode/') && init?.method === 'PUT') {
        if (!String(init.body).includes('MANUAL') && restoreFailures-- > 0) return response('{"data":null,"error":{"code":"500"}}', 500)
        return response('{"meta":{},"data":{"data":null,"error":{}},"error":{}}')
      }
      if (url.includes('/charging-mode/')) return response(JSON.stringify(pref))
      if (url.includes('/ev_chargers/status') && !url.includes('/api/v2/')) return response(JSON.stringify(status))
      return base(url, init)
    })
    return cloud
  }
  const modeWrites = (cloud: ReturnType<typeof fakeCloud>) =>
    cloud.calls.filter((c) => c.url.includes('/charging-mode/') && c.method === 'PUT').map((c) => c.body)

  async function pollWithOverride(cloud: ReturnType<typeof fakeCloud>, minted: string) {
    const s = await started({ gateway: fakeGateway({ accept: minted }), cloud })
    await post(s.app, { user: 'u', password: 'p' })
    await s.plugin.discover()
    await s.plugin.start()
    for (let i = 0; i < 10; i++) await settle()
    return s
  }
  const drain = async (clock: ManualClock, ms: number) => {
    clock.advance(ms)
    for (let i = 0; i < 10; i++) await settle()
  }

  it('unplugged under manual cancellation, the charger goes back to its preference (green): manual THEN green', async () => {
    const minted = token(365)
    const cloud = overriddenCloud(minted)
    const { plugin: p, clock } = await pollWithOverride(cloud, minted)
    await drain(clock, 5_000)
    expect(modeWrites(cloud)).toEqual(['{"mode":"MANUAL_CHARGING"}', '{"mode":"GREEN_CHARGING"}'])
    expect(cloud.calls.find((c) => c.url.includes('/charging-mode/'))!.url)
      .toContain('/service/evse_scheduler/api/v1/iqevc/charging-mode/1000001/482000000001/preference')
    // the cloud takes a while to reflect the mode: we do not retry on every read
    await drain(clock, 60_000)
    expect(modeWrites(cloud)).toHaveLength(2)
    await p.stop()
  })

  it("touches nothing while a car is plugged in, nor when manual is the user's choice", async () => {
    const minted = token(365)
    for (const opts of [{ pluggedIn: true }, { preference: 'MANUAL_CHARGING' }, { preference: 'SCHEDULED_CHARGING' }]) {
      const cloud = overriddenCloud(minted, opts)
      const { plugin: p, clock } = await pollWithOverride(cloud, minted)
      await drain(clock, 5_000)
      expect(modeWrites(cloud), JSON.stringify(opts)).toEqual([])
      await p.stop()
    }
  })

  it('after a forcing by Kasbah, it is the PREVIOUS mode that comes back, not necessarily green', async () => {
    const minted = token(365)
    const cloud = overriddenCloud(minted, { preference: 'SCHEDULED_CHARGING' })
    const { plugin: p, clock } = await pollWithOverride(cloud, minted)
    expect(modeWrites(cloud)).toEqual([])
    await p.execute('482000000001', { type: 'ev_charger.start' })
    await drain(clock, 45_000)
    await drain(clock, 5_000)
    expect(modeWrites(cloud)).toEqual(['{"mode":"MANUAL_CHARGING"}', '{"mode":"SCHEDULED_CHARGING"}'])
    await p.stop()
  })

  it('a refused return to the previous mode is retried at the next read, without going through manual again', async () => {
    const minted = token(365)
    const cloud = overriddenCloud(minted, { failRestore: 1 })
    const { plugin: p, clock } = await pollWithOverride(cloud, minted)
    await drain(clock, 5_000)
    expect(modeWrites(cloud)).toEqual(['{"mode":"MANUAL_CHARGING"}', '{"mode":"GREEN_CHARGING"}'])
    await drain(clock, 60_000)
    expect(modeWrites(cloud)).toEqual(['{"mode":"MANUAL_CHARGING"}', '{"mode":"GREEN_CHARGING"}', '{"mode":"GREEN_CHARGING"}'])
    await p.stop()
  })

  it('"resume its mode" at the charge limit, car still plugged in: manual, then the previous mode 5 s later', async () => {
    const minted = token(365)
    const cloud = overriddenCloud(minted, { pluggedIn: true, preference: 'SCHEDULED_CHARGING' })
    const { plugin: p, clock } = await pollWithOverride(cloud, minted)
    expect(modeWrites(cloud)).toEqual([])
    await p.execute('482000000001', { type: 'ev_charger.resume_mode' })
    expect(modeWrites(cloud)).toEqual(['{"mode":"MANUAL_CHARGING"}'])
    await drain(clock, 5_000)
    expect(modeWrites(cloud)).toEqual(['{"mode":"MANUAL_CHARGING"}', '{"mode":"SCHEDULED_CHARGING"}'])
    await p.stop()
  })

  it('"resume its mode" does nothing when the charger has already gone back to it, nor when manual is the user\'s choice', async () => {
    const minted = token(365)
    const back = await pollWithOverride(fakeCloud(minted), minted) // fixture: `mode` 1, green charging
    await back.plugin.execute('482000000001', { type: 'ev_charger.resume_mode' })
    expect(modeWrites(back.cloud)).toEqual([])
    await back.plugin.stop()
    const cloud = overriddenCloud(minted, { pluggedIn: true, preference: 'MANUAL_CHARGING' })
    const manual = await pollWithOverride(cloud, minted)
    await manual.plugin.execute('482000000001', { type: 'ev_charger.resume_mode' })
    await drain(manual.clock, 5_000)
    expect(modeWrites(cloud)).toEqual([])
    await manual.plugin.stop()
  })

  const lastPatch = (ctx: { emitState: unknown }) =>
    (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter(([id]) => id === '482000000001').at(-1)?.[1]

  it('choosing manual from green: a single PUT, the published mode follows without waiting for the read', async () => {
    const minted = token(365)
    const { plugin: p, cloud, ctx } = await pollWithOverride(fakeCloud(minted), minted)
    await p.execute('482000000001', { type: 'ev_charger.set_mode', mode: 'manual' })
    expect(modeWrites(cloud)).toEqual(['{"mode":"MANUAL_CHARGING"}'])
    expect(lastPatch(ctx)).toMatchObject({ chargeMode: 'manual', manualOverride: false })
    await p.stop()
  })

  it('choosing the current mode rewrites nothing (the cloud refuses it); under cancellation, it is "resume"', async () => {
    const minted = token(365)
    const same = await pollWithOverride(fakeCloud(minted), minted) // fixture: green charging, `mode` 1
    await same.plugin.execute('482000000001', { type: 'ev_charger.set_mode', mode: 'green' })
    expect(modeWrites(same.cloud)).toEqual([])
    await same.plugin.stop()
    const cloud = overriddenCloud(minted, { pluggedIn: true })
    const { plugin: p, clock } = await pollWithOverride(cloud, minted)
    await p.execute('482000000001', { type: 'ev_charger.set_mode', mode: 'green' })
    await drain(clock, 5_000)
    expect(modeWrites(cloud)).toEqual(['{"mode":"MANUAL_CHARGING"}', '{"mode":"GREEN_CHARGING"}'])
    await p.stop()
  })

  it('going back to green from manual: a single PUT, without going through manual again', async () => {
    const minted = token(365)
    const cloud = overriddenCloud(minted, { pluggedIn: true, preference: 'MANUAL_CHARGING' })
    const { plugin: p, clock } = await pollWithOverride(cloud, minted)
    await p.execute('482000000001', { type: 'ev_charger.set_mode', mode: 'green' })
    await drain(clock, 5_000)
    expect(modeWrites(cloud)).toEqual(['{"mode":"GREEN_CHARGING"}'])
    await p.stop()
  })

  it('in manual mode, `mode` 0 is not a cancellation to lift: nothing to "resume"', async () => {
    const minted = token(365)
    const cloud = overriddenCloud(minted, { pluggedIn: true, preference: 'MANUAL_CHARGING' })
    const { plugin: p, ctx } = await pollWithOverride(cloud, minted)
    expect(lastPatch(ctx)).toMatchObject({ chargeMode: 'manual', manualOverride: false })
    await p.stop()
    const green = await pollWithOverride(overriddenCloud(minted, { pluggedIn: true }), minted)
    expect(lastPatch(green.ctx)).toMatchObject({ chargeMode: 'green', manualOverride: true })
    await green.plugin.stop()
  })

  it('the mode is read at most every ten minutes, not on every charger read', async () => {
    const minted = token(365)
    const { plugin: p, cloud, clock } = await pollWithOverride(fakeCloud(minted), minted)
    const reads = () => cloud.calls.filter((c) => c.url.includes('/charging-mode/') && c.method === 'GET').length
    const first = reads()
    expect(first).toBe(1)
    await drain(clock, 60_000)
    expect(reads()).toBe(first)
    await drain(clock, 10 * 60_000)
    expect(reads()).toBe(first + 1)
    await p.stop()
  })

  it('the unchecked sub-item removes the charger without touching the solar side', async () => {
    const minted = token(365)
    const { plugin, app } = await started({
      gateway: fakeGateway({ accept: minted }), cloud: fakeCloud(minted), parts: { ev_charger: false },
    })
    await post(app, { user: 'u', password: 'p' })
    const devices = await plugin.discover()
    expect(devices.filter((d) => d.kind === 'ev_charger')).toHaveLength(0)
    expect(devices.filter((d) => d.kind === 'sensor')).toHaveLength(20)
  })
})

describe('gateway certificate pin', () => {
  const fingerprint = (c: TestCertificate) => new X509Certificate(c.cert).fingerprint256
  /** Just enough of a gateway over real TLS: `/info`, then an empty JSON on any other route. */
  const respondLikeAGateway = (chunk: string): string | undefined => {
    const path = /^GET (\S+)/.exec(chunk)?.[1]
    if (!path) return undefined
    const body = path === '/info' ? INFO_XML : '{}'
    return `HTTP/1.1 200 OK\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  }

  it('never sends the token to a gateway with another certificate, says so, and pairing again accepts it', async () => {
    const cert = selfSignedCertificate()
    const server = await startTlsServer(cert, respondLikeAGateway)
    let saved: string | undefined = fingerprint(selfSignedCertificate())   // pinned on another gateway
    const plugin = createEnphasePlugin({
      store: memoryStore(), cloudStore: memoryCloud(), pinFile: { load: async () => saved, save: async (fp) => { saved = fp } },
    })
    const ctx: PluginContext = {
      pluginId: 'enphase',
      config: enphaseConfigSchema.parse({ ENPHASE_HOST: `127.0.0.1:${server.port}`, ENPHASE_TOKEN: token(365) }),
      logger: pino({ level: 'silent' }), clock: new ManualClock(NOW), signal: new AbortController().signal,
      emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
      parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
    }
    await plugin.init(ctx)
    await expect(plugin.discover()).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    expect(server.received()).toBe('')                       // neither /info nor, above all, the Bearer
    expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('Le certificat de la passerelle IQ Gateway a changé') })

    const app = Fastify()
    app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/enphase' })
    await app.ready()
    const r = await post(app, { token: token(365) })
    expect(r.statusCode).toBe(200)
    expect(saved).toBe(fingerprint(cert))
    expect(server.received()).toContain('GET /info')
    expect(plugin.health!().status).toBe('ok')
    await plugin.stop()
    await app.close()
    await server.close()
  })
})

describe('peakChunks', () => {
  it('groups consecutive days three at most, and breaks on a gap', () => {
    const keys = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-09']
    expect(peakChunks(keys)).toEqual([['2026-08-30', '2026-09-01'], ['2026-09-02', '2026-09-03'], ['2026-09-09', '2026-09-09']])
    expect(peakChunks([])).toEqual([])
  })
})
