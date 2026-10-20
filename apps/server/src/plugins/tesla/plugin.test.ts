import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import { deviceReleaseNotesSchema } from '@kasbah/shared'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import {
  ASLEEP_408, PARTNER_TOKEN, RELEASE_NOTES_INSTALLED, RELEASE_NOTES_STAGED, TOKEN_REFRESHED, TOKEN_RESPONSE, VEHICLES_ASLEEP,
  VEHICLES_ONLINE, VEHICLE_DATA_CHARGING, VEHICLE_DATA_DRIVING, VEHICLE_DATA_PARKED,
} from './__fixtures__/fleet'
import { REGION_BASE_URLS, TOKEN_URL, generateKeyPair, publicKeyOf, publicKeyPointHex, samePublicKey, type KeyStore, type StoredTokens, type TokenStore } from './auth'
import { createTeslaPlugin, teslaConfigSchema } from './index'
import { emptyState, type TeslaState, type TeslaStateStore } from './state'

// What the plugin must guarantee against the vendor: NEVER read a sleeping vehicle, let it fall
// asleep once seen at rest, not exceed the day's read budget, and survive the refresh token's
// rotation (single-use at Tesla). No real account or vehicle is touched.

const NOW = Date.UTC(2026, 8, 13, 10)
const MIN = 60_000
const VIN = '5YJSA7E20HF000001'
const BASE = REGION_BASE_URLS.eu
const ENV = { TESLA_CLIENT_ID: 'app-id', TESLA_CLIENT_SECRET: 'app-secret', TESLA_DOMAIN: 'nas.exemple.fr', TESLA_POLL_MS: String(10 * MIN), TESLA_REST_MS: String(15 * MIN) }

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

/** Fake Tesla: auth server and API, driven by a mutable state. */
function fakeTesla(over: { registeredKey?: string; servedKey?: string; publicKeyForbidden?: boolean } = {}) {
  const world = {
    list: VEHICLES_ASLEEP as unknown,
    data: VEHICLE_DATA_PARKED as unknown,
    /** `vehicle_data` answers 408 while true. */
    asleep: false,
    /** The access token the API accepts; any other → 401. */
    accepts: TOKEN_RESPONSE.access_token,
    /** What Tesla has ALREADY registered for the domain; `servedKey` is what it would read when registering. */
    registeredKey: over.registeredKey,
    servedKey: over.servedKey,
    /** The account API answers 412 while true (application not registered for this account). */
    unregistered: false,
    /** What a command acknowledges. Tesla REFUSES with HTTP 200: `result: false` and a reason. */
    commandResult: { result: true } as { result: boolean; reason?: string },
    /** `release_notes`, without parameter and `?staged=true`; `null` = 500. */
    notes: RELEASE_NOTES_INSTALLED as unknown,
    stagedNotes: RELEASE_NOTES_STAGED as unknown,
    /** Responses to `language=fr` (seen on the real car); `null` = Tesla ignores the language (English). */
    notesFr: null as unknown,
    stagedNotesFr: null as unknown,
  }
  const calls: { method: string; path: string; body?: string; auth?: string; lang?: string }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = init?.body === undefined ? undefined : String(init.body)
    if (url === TOKEN_URL) {
      const params = new URLSearchParams(body)
      calls.push({ method, path: `token:${params.get('grant_type')}`, body })
      if (params.get('grant_type') === 'client_credentials') return response(PARTNER_TOKEN)
      if (params.get('grant_type') === 'authorization_code') return response(TOKEN_RESPONSE)
      // rotation: only the current refresh token is accepted, and it returns another one
      if (params.get('refresh_token') === TOKEN_RESPONSE.refresh_token) { world.accepts = TOKEN_REFRESHED.access_token; return response(TOKEN_REFRESHED) }
      return response({ error: 'invalid_grant' }, 400)
    }
    const path = url.replace(BASE, '')
    const lang = /[?&]language=([a-z]+)/.exec(path)?.[1]
    calls.push({ method, path, body, auth: headers.authorization, ...(lang ? { lang } : {}) })
    if (path.startsWith('/api/1/partner_accounts')) {
      if (headers.authorization !== `Bearer ${PARTNER_TOKEN.access_token}`) return response({ error: 'unauthorized' }, 401)
      if (method === 'POST') {
        // observed on the real account: an already registered domain can't be registered again
        if (world.registeredKey) return response({ error: 'Validation failed: Public key hash has already been taken' }, 422)
        world.registeredKey = world.servedKey
        return response({ response: { domain: 'nas.exemple.fr' } })
      }
      // observed on the real account: the check may be refused even though the API answers
      if (over.publicKeyForbidden) return response({ error: 'This account does not have access to nas.exemple.fr' }, 403)
      // Tesla returns the hexadecimal POINT, not the PEM (observed on the real account)
      return response({ response: { public_key: world.registeredKey ? publicKeyPointHex(world.registeredKey) : null } })
    }
    if (headers.authorization !== `Bearer ${world.accepts}`) return response({ error: 'unauthorized' }, 401)
    if (path === '/api/1/vehicles') {
      // observed: application not registered in the region → 412, not an empty list
      if (world.unregistered) return response({ error: `Account 592035a8 must be registered in the current region ${BASE}` }, 412)
      return response(world.list)
    }
    if (path.includes('/vehicle_data')) return world.asleep ? response(ASLEEP_408, 408) : response(world.data)
    if (path.includes('/release_notes')) {
      const staged = path.includes('staged=true')
      const fr = lang === 'fr' ? (staged ? world.stagedNotesFr : world.notesFr) : null
      const body = fr ?? (staged ? world.stagedNotes : world.notes)
      return body === null ? response({ error: 'internal error' }, 500) : response(body)
    }
    if (path.endsWith('/wake_up')) return response({ response: { ...(VEHICLES_ONLINE.response[0] as object), state: 'online' } })
    // a command on a sleeping vehicle answers 408, like a read
    if (path.includes('/command/')) return world.asleep ? response(ASLEEP_408, 408) : response({ response: world.commandResult })
    return response({ error: 'not found' }, 404)
  })
  return { fetchImpl, calls, world }
}

function memoryTokens(initial: StoredTokens | null = null): TokenStore & { value: StoredTokens | null } {
  const s = { value: initial, load: async () => s.value, save: async (t: StoredTokens) => { s.value = t } }
  return s
}
function memoryState(initial: TeslaState | null = null): TeslaStateStore & { value: TeslaState | null } {
  const s = { value: initial, load: async () => s.value, save: async (v: TeslaState) => { s.value = JSON.parse(JSON.stringify(v)) as TeslaState } }
  return s
}
function memoryKey(pem: string | null = null): KeyStore & { value: string | null } {
  const s = { value: pem, load: async () => s.value, save: async (p: string) => { s.value = p } }
  return s
}
const linkedTokens = (): StoredTokens => ({ refreshToken: TOKEN_RESPONSE.refresh_token, accessToken: TOKEN_RESPONSE.access_token, accessExpiresAt: NOW + 8 * 3600_000 })

async function started(over: { env?: Record<string, string>; tesla?: ReturnType<typeof fakeTesla>; tokens?: StoredTokens | null; key?: string | null; state?: ReturnType<typeof memoryState> } = {}) {
  const tesla = over.tesla ?? fakeTesla()
  const tokenStore = memoryTokens(over.tokens ?? null)
  const keyStore = memoryKey(over.key ?? null)
  const stateStore = over.state ?? memoryState()
  const plugin = createTeslaPlugin({ fetchImpl: tesla.fetchImpl, tokenStore, keyStore, stateStore })
  const clock = new ManualClock(NOW)
  const ctx: PluginContext = {
    pluginId: 'tesla',
    config: teslaConfigSchema.parse({ ...ENV, ...over.env }),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/tesla' })
  await app.ready()
  return { plugin, app, tesla, tokenStore, keyStore, stateStore, ctx, clock }
}

/** Lets in-flight promises resolve (polling runs on the injected clock). */
const settle = () => new Promise((r) => setTimeout(r, 0))
/**
 * Advances `n` polling rounds. One round per advance: the poller only re-arms its timer after
 * finishing its work (asynchronous), so a single big advance would trigger only one round.
 */
async function ticks(clock: ManualClock, n: number, ms = 10 * MIN) {
  for (let i = 0; i < n; i++) { clock.advance(ms); await settle() }
}
const dataCalls = (t: ReturnType<typeof fakeTesla>) => t.calls.filter((c) => c.path.includes('/vehicle_data')).length
const listCalls = (t: ReturnType<typeof fakeTesla>) => t.calls.filter((c) => c.path === '/api/1/vehicles').length
/** Release notes calls (free at Tesla, but we want to know when they go out). */
const notesCalls = (t: ReturnType<typeof fakeTesla>) => t.calls.filter((c) => c.path.includes('/release_notes')).length
const patches = (ctx: PluginContext) => (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as Record<string, unknown>)

describe('setup', () => {
  it('without application credentials: needs_pairing, but the key pair already exists and the public key is served', async () => {
    const { plugin, app, keyStore } = await started({ env: { TESLA_CLIENT_ID: '', TESLA_CLIENT_SECRET: '' } })
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
    expect(keyStore.value).toMatch(/BEGIN PRIVATE KEY/)
    const status = await app.inject({ method: 'GET', url: '/api/plugins/tesla/status' }).then((r) => r.json())
    expect(status).toMatchObject({ configured: false, linked: false, publicKeyUrl: 'https://nas.exemple.fr/.well-known/appspecific/com.tesla.3p.public-key.pem' })
    expect(status.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/)
    expect(status.publicKeyPem).toBe(publicKeyOf(keyStore.value!))
    const pem = await app.inject({ method: 'GET', url: '/api/plugins/tesla/public-key' })
    expect(pem.headers['content-type']).toContain('application/x-pem-file')
    expect(pem.body).toBe(status.publicKeyPem)
  })

  it('a private key already cached is reused: the public key put on the domain stays the right one', async () => {
    const pair = generateKeyPair()
    const { keyStore, app } = await started({ key: pair.privatePem })
    expect(keyStore.value).toBe(pair.privatePem)
    expect((await app.inject({ method: 'GET', url: '/api/plugins/tesla/status' }).then((r) => r.json())).publicKeyPem).toBe(pair.publicPem)
  })

  it('domain registration goes through a partner token, then checks what Tesla read of the key', async () => {
    const pair = generateKeyPair()
    const tesla = fakeTesla({ servedKey: pair.publicPem })
    const { app, tesla: t } = await started({ tesla, key: pair.privatePem })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ registered: true, lastError: null })
    const check = '/api/1/partner_accounts/public_key?domain=nas.exemple.fr'
    // checked BEFORE (nothing registered), registered, checked AFTER
    expect(t.calls.map((c) => c.path)).toEqual(['token:client_credentials', check, '/api/1/partner_accounts', check])
    expect(JSON.parse(t.calls[2]!.body!)).toEqual({ domain: 'nas.exemple.fr' })
  })

  it('an already registered domain is not registered again; and if Tesla refuses anyway (422), it is not an error', async () => {
    const pair = generateKeyPair()
    const done = await started({ tesla: fakeTesla({ registeredKey: pair.publicPem }), key: pair.privatePem })
    expect((await done.app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })).json()).toMatchObject({ registered: true })
    expect(done.tesla.calls.map((c) => c.path)).toEqual(['token:client_credentials', '/api/1/partner_accounts/public_key?domain=nas.exemple.fr'])
    // Tesla knows ANOTHER key: we attempt registration, it answers 422, we check again and say so
    const other = await started({ tesla: fakeTesla({ registeredKey: generateKeyPair().publicPem, servedKey: pair.publicPem }), key: pair.privatePem })
    const r = await other.app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ registered: false })
    expect(other.tesla.calls.filter((c) => c.method === 'POST' && c.path === '/api/1/partner_accounts')).toHaveLength(1)
  })

  it('key taken by ANOTHER application: the following 412 says "not registered", and rotation gives a new key', async () => {
    const pair = generateKeyPair()
    const tesla = fakeTesla({ registeredKey: pair.publicPem, publicKeyForbidden: true })
    tesla.world.unregistered = true
    const { app, keyStore } = await started({ tesla, key: pair.privatePem, tokens: linkedTokens() })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/register' }).then((x) => x.json())
    expect(r.registered).toBe(false)
    expect(r.lastError).toMatch(/registered by another application/)
    const rotated = await app.inject({ method: 'POST', url: '/api/plugins/tesla/public-key/rotate' }).then((x) => x.json())
    expect(rotated.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/)
    expect(rotated.publicKeyPem).not.toBe(pair.publicPem)
    expect(rotated.registered).toBeUndefined()
    expect(publicKeyOf(keyStore.value!)).toBe(rotated.publicKeyPem)     // the new private key is kept
  })

  it('check refused (403) but key already known to Tesla (422): we take its word, registered', async () => {
    const pair = generateKeyPair()
    const { app, plugin } = await started({ tesla: fakeTesla({ registeredKey: pair.publicPem, publicKeyForbidden: true }), key: pair.privatePem, tokens: linkedTokens() })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ registered: true, lastError: null })
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
  })

  it('a key read by Tesla that is not ours: registered but not recognized, the plugin says so', async () => {
    const other = generateKeyPair()
    const { app, plugin } = await started({ tesla: fakeTesla({ registeredKey: other.publicPem }), tokens: linkedTokens() })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/register' })
    expect(r.json()).toMatchObject({ registered: false })
    expect(r.json().lastError).toMatch(/did not read our public key/)
    expect(plugin.health!()).toMatchObject({ status: 'degraded' })
  })
})

describe('key format at Tesla', () => {
  it('the hexadecimal EC point (04 ‖ X ‖ Y) and the PEM designate the same key', () => {
    const pair = generateKeyPair()
    const hex = publicKeyPointHex(pair.publicPem)
    expect(hex).toMatch(/^04[0-9a-f]{128}$/)
    expect(samePublicKey(hex, pair.publicPem)).toBe(true)
    expect(samePublicKey(hex.toUpperCase(), pair.publicPem)).toBe(true)
    expect(samePublicKey(pair.publicPem, pair.publicPem)).toBe(true)
    expect(samePublicKey(publicKeyPointHex(generateKeyPair().publicPem), pair.publicPem)).toBe(false)
  })
})

describe('account linking', () => {
  it('without an account: needs_pairing, no API call, /auth/url carries the client and the redirect', async () => {
    const { plugin, app, tesla } = await started()
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
    expect(await plugin.discover()).toEqual([])
    await plugin.start()
    await settle()
    expect(tesla.calls).toEqual([])
    const { url, redirectUri } = await app.inject({ method: 'GET', url: '/api/plugins/tesla/auth/url' }).then((r) => r.json())
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://auth.tesla.com/oauth2/v3/authorize')
    expect(u.searchParams.get('client_id')).toBe('app-id')
    expect(u.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(u.searchParams.get('scope')).toContain('offline_access')
    expect(u.searchParams.get('scope')).toContain('vehicle_location')
  })

  it('the return is only accepted with the `state` we issued; the code becomes tokens that are KEPT, and polling starts', async () => {
    const { plugin, app, tesla, tokenStore, ctx } = await started()
    expect((await app.inject({ method: 'GET', url: '/api/plugins/tesla/auth/callback?code=abc&state=forged' })).statusCode).toBe(400)
    const { url } = await app.inject({ method: 'GET', url: '/api/plugins/tesla/auth/url' }).then((r) => r.json())
    const state = new URL(url).searchParams.get('state')!
    const r = await app.inject({ method: 'GET', url: `/api/plugins/tesla/auth/callback?code=abc&state=${state}` })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('text/html')
    expect(r.body).toContain('Kasbah S')
    // the exchange carries the code, the redirect and the region's `audience`
    const exchange = new URLSearchParams(tesla.calls[0]!.body)
    expect(exchange.get('grant_type')).toBe('authorization_code')
    expect(exchange.get('code')).toBe('abc')
    expect(exchange.get('audience')).toBe(BASE)
    expect(tokenStore.value).toMatchObject({ refreshToken: TOKEN_RESPONSE.refresh_token, accessToken: TOKEN_RESPONSE.access_token })
    expect(ctx.emitDevices).toHaveBeenCalledWith([expect.objectContaining({ id: `tesla:${VIN}` })])
    await settle()
    expect(plugin.health!()).toMatchObject({ status: 'ok', deviceCount: 1 })
    // polling has started: the list was re-read by the poller, and the vehicle is asleep → no vehicle_data
    expect(listCalls(tesla)).toBeGreaterThanOrEqual(2)
    expect(dataCalls(tesla)).toBe(0)
  })

  it('the refresh token is single-use: refreshing replaces it in the cache, and a 401 triggers a refresh then replays', async () => {
    const tesla = fakeTesla()
    tesla.world.accepts = TOKEN_REFRESHED.access_token          // the cached access token is no longer accepted
    const { plugin, tesla: t, tokenStore } = await started({ tesla, tokens: linkedTokens() })
    const devices = await plugin.discover()
    expect(devices).toHaveLength(1)
    expect(t.calls.map((c) => c.path)).toEqual(['/api/1/vehicles', 'token:refresh_token', '/api/1/vehicles'])
    expect(tokenStore.value?.refreshToken).toBe(TOKEN_REFRESHED.refresh_token)
    expect(tokenStore.value?.accessToken).toBe(TOKEN_REFRESHED.access_token)
  })

  it('an access token close to expiry is refreshed in advance, without waiting for the 401', async () => {
    const { plugin, tesla } = await started({ tokens: { ...linkedTokens(), accessExpiresAt: NOW + MIN } })
    await plugin.discover()
    expect(tesla.calls.map((c) => c.path)).toEqual(['token:refresh_token', '/api/1/vehicles'])
  })

  it('a refused refresh token (burned, account revoked) brings back needs_pairing instead of a network incident', async () => {
    const { plugin, tesla } = await started({ tokens: { ...linkedTokens(), refreshToken: 'burnt', accessExpiresAt: NOW } })
    await plugin.discover()
    expect(tesla.calls.map((c) => c.path)).toEqual(['token:refresh_token'])
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing' })
  })
})

describe('polling that respects sleep', () => {
  it('sleeping vehicle: the list only, NEVER vehicle_data, and the state says `asleep`', async () => {
    const { plugin, tesla, ctx, clock } = await started({ tokens: linkedTokens() })
    await plugin.discover()
    await plugin.start()
    await settle()
    await ticks(clock, 3)
    expect(listCalls(tesla)).toBe(1 + 4)                          // discover + 4 rounds (t0, +10, +20, +30)
    expect(dataCalls(tesla)).toBe(0)
    expect(patches(ctx)).toContainEqual({ sleepState: 'asleep' })
    expect(ctx.setAvailable).not.toHaveBeenCalled()               // sleeping is not being unavailable
  })

  it('awake and at rest: ONE read, then we let it fall asleep for TESLA_REST_MS', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, ctx, clock } = await started({ tesla, tokens: linkedTokens() })
    await plugin.start()
    await settle()
    expect(dataCalls(tesla)).toBe(1)
    expect(patches(ctx).at(-1)).toMatchObject({ soc: 54, gear: 'P', speedKmh: 0, sleepState: 'online', tirePressureBar: { fl: 3.18 } })
    // +10 min: still awake according to the list, but at rest for 10 min < 15 → no re-read
    clock.advance(10 * MIN)
    await settle()
    expect(listCalls(tesla)).toBe(2)
    expect(dataCalls(tesla)).toBe(1)
    // +20 min: the rest period is over, we re-read
    clock.advance(10 * MIN)
    await settle()
    expect(dataCalls(tesla)).toBe(2)
  })

  it('driving or charging: re-read every round, it is not the time to sleep', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.data = VEHICLE_DATA_DRIVING
    const { plugin, clock, ctx } = await started({ tesla, tokens: linkedTokens() })
    await plugin.start()
    await settle()
    clock.advance(10 * MIN)
    await settle()
    expect(dataCalls(tesla)).toBe(2)
    expect(patches(ctx).at(-1)).toMatchObject({ gear: 'D', pluggedIn: false, locked: false })
    tesla.world.data = VEHICLE_DATA_CHARGING
    clock.advance(10 * MIN)
    await settle()
    expect(dataCalls(tesla)).toBe(3)
    expect(patches(ctx).at(-1)).toMatchObject({ charging: true, chargePowerW: 7000 })
  })

  it('asleep between the list and the read (408): the state goes to `asleep`, without error or backoff', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.asleep = true
    const { plugin, ctx, clock } = await started({ tesla, tokens: linkedTokens() })
    await plugin.start()
    await settle()
    expect(dataCalls(tesla)).toBe(1)
    expect(patches(ctx).at(-1)).toEqual({ sleepState: 'asleep' })
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
    // the next round arrives on schedule (no error backoff) and retries since the list says it's awake
    clock.advance(10 * MIN)
    await settle()
    expect(dataCalls(tesla)).toBe(2)
  })

  it('the day budget bounds the full reads, never the list; it starts again the next day', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.data = VEHICLE_DATA_DRIVING
    const { plugin, clock, app } = await started({ tesla, tokens: linkedTokens(), env: { TESLA_DAILY_DATA_BUDGET: '2' } })
    await plugin.start()
    await settle()
    await ticks(clock, 4)
    expect(listCalls(tesla)).toBe(5)
    expect(dataCalls(tesla)).toBe(2)
    expect((await app.inject({ method: 'GET', url: '/api/plugins/tesla/status' }).then((r) => r.json())).budget).toEqual({ used: 2, limit: 2 })
    expect(plugin.health!().detail).toContain('2/2')
    // the UI gauge shows the vendor's MONTHLY CREDIT, not this daily budget: an estimate in
    // dollars. LISTS don't count toward it — the vendor doesn't bill them (observed on its console)
    const q = plugin.health!().quota!
    expect(q).toMatchObject({ limit: 10, labelKey: 'vehicle.quotaCredit', unit: 'usd' })
    expect(listCalls(tesla)).toBeGreaterThan(dataCalls(tesla))
    expect(q.used).toBeCloseTo(dataCalls(tesla) * (1 / 500), 5)
    // the cycle starts on the 1st of the month (the vendor's console says so), not on the linking day
    expect(q.since).toBe(Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth(), 1))
    // the next day: a single round is enough to see the budget start again
    await ticks(clock, 1, 24 * 60 * MIN)
    expect(dataCalls(tesla)).toBe(3)
  })

  it('a vehicle appearing in or disappearing from the list republishes the descriptors', async () => {
    const tesla = fakeTesla()
    const { plugin, ctx, clock } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.start()
    await settle()
    expect(ctx.emitDevices).not.toHaveBeenCalled()
    tesla.world.list = { response: [], count: 0 }
    clock.advance(10 * MIN)
    await settle()
    expect(ctx.emitDevices).toHaveBeenCalledWith([])
    expect(plugin.health!()).toMatchObject({ deviceCount: 0 })
  })
})

describe('what survives a restart', () => {
  it('the last state of each vehicle is kept, and RE-EMITTED at the next startup without reading anything', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const state = memoryState()
    const first = await started({ tesla, tokens: linkedTokens(), state })
    await first.plugin.start()
    await settle()
    expect(state.value?.vehicles[VIN]).toMatchObject({ soc: 54, readAt: NOW })

    // second startup: the car has fallen asleep again, no read is possible
    const asleep = fakeTesla()
    const second = await started({ tesla: asleep, tokens: linkedTokens(), state })
    await second.plugin.discover()
    await second.plugin.start()
    await settle()
    expect(dataCalls(asleep)).toBe(0)
    // the card gets the previous day's values back instead of starting empty
    expect(patches(second.ctx)).toContainEqual(expect.objectContaining({ soc: 54, readAt: NOW }))
  })

  it('the paint survives a restart: asleep, the car keeps its color without a re-read', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const state = memoryState()
    const first = await started({ tesla, tokens: linkedTokens(), state })
    await first.plugin.start()
    await settle()
    // paint_color_override of the PARKED fixture → #285ac8, matte finish
    expect(state.value?.paints[VIN]).toMatchObject({ color: '#285ac8', finish: 'matte' })
    expect(first.ctx.emitDevices).toHaveBeenCalledWith([
      expect.objectContaining({ id: `tesla:${VIN}`, meta: expect.objectContaining({ vehicle: expect.objectContaining({ color: '#285ac8', finish: 'matte' }) }) }),
    ])

    const asleep = fakeTesla()
    const second = await started({ tesla: asleep, tokens: linkedTokens(), state })
    const devices = await second.plugin.discover()
    expect(dataCalls(asleep)).toBe(0)
    expect(devices[0]?.meta.vehicle).toMatchObject({ color: '#285ac8', finish: 'matte' })
  })

  it('the month usage carries on after a restart, and starts again the following month', async () => {
    const state = memoryState()
    const one = fakeTesla()
    one.world.list = VEHICLES_ONLINE
    const first = await started({ tesla: one, tokens: linkedTokens(), state })
    await first.plugin.start()
    await settle()
    // one full read; the release notes (installed, pending), read once, are free
    const billed = 1 / 500
    expect(notesCalls(one)).toBe(2)
    expect(first.plugin.health!().quota!.used).toBeCloseTo(billed, 5)
    // the next round falls before the rest period ends: it only LISTS, and listing costs nothing
    await ticks(first.clock, 1)
    expect(listCalls(one)).toBeGreaterThan(1)
    expect(first.plugin.health!().quota!.used).toBeCloseTo(billed, 5)

    // restart: the counter resumes where it was (polling not started, so as to count only the
    // calls requested here)
    const two = fakeTesla()
    two.world.list = VEHICLES_ONLINE
    const second = await started({ tesla: two, tokens: linkedTokens(), state })
    await second.plugin.discover()
    await second.plugin.execute(VIN, { type: 'vehicle.refresh' })
    // the notes, kept in the state file for these versions, are not re-read
    expect(notesCalls(two)).toBe(0)
    expect(second.plugin.health!().quota!.used).toBeCloseTo(billed + 1 / 500, 5)

    // the following month, the counter starts again from zero (calendar cycle, like the vendor's billing)
    second.clock.advance(31 * 24 * 60 * MIN)
    await second.plugin.execute(VIN, { type: 'vehicle.refresh' })
    expect(second.plugin.health!().quota!.used).toBeCloseTo(1 / 500, 5)
  })

  it('the counter realigns on the vendor console, which alone bills', async () => {
    const state = memoryState()
    const { app, plugin } = await started({ tesla: fakeTesla(), tokens: linkedTokens(), state })
    const r = await app.inject({ method: 'POST', url: '/api/plugins/tesla/usage', payload: { data: 6, wakes: 2, commands: 0 } })
    expect(r.statusCode).toBe(200)
    // 6 reads at 0.2 c + 2 wake-ups at 2 c
    expect(r.json().estimatedUsd).toBeCloseTo(6 / 500 + 2 / 50, 5)
    expect(plugin.health!().quota!.used).toBeCloseTo(0.052, 5)
    expect(state.value?.cycle).toMatchObject({ data: 6, wakes: 2, commands: 0 })
    expect((await app.inject({ method: 'POST', url: '/api/plugins/tesla/usage', payload: { data: -1 } })).statusCode).toBe(400)
  })
})

describe('commands', () => {
  it('refresh re-reads now, and polling RESTARTS from that read (not from the initial schedule)', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.data = VEHICLE_DATA_DRIVING          // on the road: no rest, every round re-reads
    const { plugin, clock, ctx } = await started({ tesla, tokens: linkedTokens() })
    await plugin.start()
    await settle()
    expect(dataCalls(tesla)).toBe(1)
    expect(patches(ctx).at(-1)).toMatchObject({ readAt: NOW })
    // t+3 min: manual read
    clock.advance(3 * MIN); await settle()
    await plugin.execute(VIN, { type: 'vehicle.refresh' })
    expect(dataCalls(tesla)).toBe(2)
    expect(patches(ctx).at(-1)).toMatchObject({ readAt: NOW + 3 * MIN })
    // t+10: the initial schedule's round does NOT fall; t+13: ten minutes after the manual read, it does
    clock.advance(7 * MIN); await settle()
    expect(dataCalls(tesla)).toBe(2)
    clock.advance(3 * MIN); await settle()
    expect(dataCalls(tesla)).toBe(3)
  })

  it('refreshing a sleeping vehicle does not wake it: only the sleep state is re-read', async () => {
    const tesla = fakeTesla()
    const { plugin, ctx } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.refresh' })
    expect(dataCalls(tesla)).toBe(0)
    expect(tesla.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
    expect(patches(ctx).at(-1)).toEqual({ sleepState: 'asleep' })
  })

  it('refreshing when the day budget is spent is refused rather than spent', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin } = await started({ tesla, tokens: linkedTokens(), env: { TESLA_DAILY_DATA_BUDGET: '1' } })
    await plugin.start()
    await settle()
    await expect(plugin.execute(VIN, { type: 'vehicle.refresh' })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(dataCalls(tesla)).toBe(1)
  })

  it('setting the charge limit: one command, the target published without a billed re-read', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, ctx, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.set_charge_limit', percent: 70 })
    expect(t.calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/1/vehicles/${VIN}/command/set_charge_limit`, body: '{"percent":70}' })
    expect(dataCalls(t)).toBe(0)                     // the target comes from US: no read behind it
    expect(patches(ctx).at(-1)).toMatchObject({ chargeLimit: 70 })
    // a command costs ten times less than a read, but it COUNTS
    expect(plugin.health!().quota!.used).toBeCloseTo(1 / 1000, 5)
  })

  it('a Tesla REFUSAL arrives as HTTP 200: the target is then not published', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.commandResult = { result: false, reason: 'charge_limit_not_supported' }
    const { plugin, ctx } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.set_charge_limit', percent: 70 }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: expect.stringContaining('charge_limit_not_supported') })
    expect(patches(ctx).some((p) => 'chargeLimit' in p)).toBe(false)
  })

  // seen on the real car on 2026-10-01: the FIRST limit set fails, the next one goes through
  it('`could_not_wake_buses` (online, buses still asleep): retried within the command, then the target published', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.commandResult = { result: false, reason: 'could_not_wake_buses' }
    const { plugin, ctx, clock, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    const limitCalls = () => t.calls.filter((c) => c.path.endsWith('/command/set_charge_limit')).length
    const done = plugin.execute(VIN, { type: 'vehicle.set_charge_limit', percent: 70 })
    for (let i = 0; i < 10; i++) await settle()
    expect(limitCalls()).toBe(1)
    tesla.world.commandResult = { result: true }
    clock.advance(2_500)
    await expect(done).resolves.toBeUndefined()
    expect(limitCalls()).toBe(2)
    expect(patches(ctx).at(-1)).toMatchObject({ chargeLimit: 70 })
  })

  it('buses that do not wake up: two new attempts within a command timeout, then the refusal surfaces', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.commandResult = { result: false, reason: 'could_not_wake_buses' }
    const { plugin, ctx, clock, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    const done = plugin.execute(VIN, { type: 'vehicle.set_charge_limit', percent: 70 })
    const outcome = expect(done).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: expect.stringContaining('could_not_wake_buses') })
    for (let i = 0; i < 2; i++) { for (let j = 0; j < 10; j++) await settle(); clock.advance(2_500) }
    await outcome
    expect(t.calls.filter((c) => c.path.endsWith('/command/set_charge_limit'))).toHaveLength(3)
    expect(patches(ctx).some((p) => 'chargeLimit' in p)).toBe(false)
  })

  it('setting the limit of a SLEEPING vehicle is refused: it is up to the paid wake-up to bring it back', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.asleep = true
    const { plugin, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.set_charge_limit', percent: 70 }))
      .rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    expect(t.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
  })

  it('the wake-up is the only action: POST wake_up, then a delayed re-read; the rest is refused', async () => {
    const tesla = fakeTesla()
    const { plugin, clock, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.lock' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('unknown', { type: 'vehicle.wake' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await plugin.execute(VIN, { type: 'vehicle.wake' })
    expect(t.calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/1/vehicles/${VIN}/wake_up` })
    expect(dataCalls(t)).toBe(0)
    tesla.world.list = VEHICLES_ONLINE
    clock.advance(15_000)
    await settle()
    expect(dataCalls(t)).toBe(1)
  })
})

describe('climate', () => {
  const commandPaths = (t: ReturnType<typeof fakeTesla>) => t.calls.filter((c) => c.path.includes('/command/')).map((c) => c.path.split('/command/')[1])
  const flush = async () => { for (let i = 0; i < 10; i++) await settle() }

  it('awake: the setpoint then switching on, the state published without re-read or wake-up', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, ctx, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.climate_start', targetTempC: 20 })
    expect(commandPaths(t)).toEqual(['set_temps', 'auto_conditioning_start'])
    expect(t.calls.find((c) => c.path.endsWith('/set_temps'))!.body).toBe('{"driver_temp":20,"passenger_temp":20}')
    expect(t.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
    expect(dataCalls(t)).toBe(0)
    expect(patches(ctx).at(-1)).toMatchObject({ climateOn: true, climateTargetC: 20 })
  })

  it('without a setpoint: the car keeps its own, only switching on goes out', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.climate_start' })
    expect(commandPaths(t)).toEqual(['auto_conditioning_start'])
  })

  it('asleep: woken, the command waits until it is online, then a read observes the effect', async () => {
    const tesla = fakeTesla()
    const { plugin, ctx, clock, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.climate_start', targetTempC: 21 })
    expect(t.calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/1/vehicles/${VIN}/wake_up` })
    expect(commandPaths(t)).toEqual([])               // nothing before the wake-up is observed
    clock.advance(5_000); await flush()               // still asleep: we wait
    expect(commandPaths(t)).toEqual([])
    tesla.world.list = VEHICLES_ONLINE
    clock.advance(5_000); await flush()
    expect(commandPaths(t)).toEqual(['set_temps', 'auto_conditioning_start'])
    expect(patches(ctx).some((p) => p.climateOn === true)).toBe(true)
    clock.advance(15_000); await flush()
    expect(dataCalls(t)).toBe(1)
  })

  it('a car that does not wake up: gives up at the cap, no command', async () => {
    const tesla = fakeTesla()
    const { plugin, clock, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.climate_start' })
    for (let i = 0; i < 20; i++) { clock.advance(5_000); await flush() }
    const lists = listCalls(t)
    clock.advance(5_000); await flush()
    expect(listCalls(t)).toBe(lists)                  // nothing runs anymore
    expect(commandPaths(t)).toEqual([])
  })

  it('low battery: the `low_soc` refusal becomes LOW_BATTERY', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.commandResult = { result: false, reason: 'low_soc' }
    const { plugin } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.climate_start' })).rejects.toMatchObject({ code: 'LOW_BATTERY' })
  })

  it('charge KNOWN to be below 20 %: refused BEFORE paying for a wake-up', async () => {
    const tesla = fakeTesla()
    const state = memoryState({ ...emptyState(), vehicles: { [VIN]: { soc: 17 } } })
    const { plugin, tesla: t } = await started({ tesla, tokens: linkedTokens(), state })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.climate_start' })).rejects.toMatchObject({ code: 'LOW_BATTERY' })
    expect(t.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
  })

  it('stopping a sleeping car does not wake it: its climate is necessarily off', async () => {
    const tesla = fakeTesla()
    const { plugin, ctx, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.climate_stop' })
    expect(t.calls.some((c) => c.path.endsWith('/wake_up') || c.path.includes('/command/'))).toBe(false)
    expect(patches(ctx).at(-1)).toMatchObject({ climateOn: false })
  })

  it('setting seats, steering wheel and setpoint: one command each, `seatHeat` published WHOLE (shallow merge)', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, ctx, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.climate_set', seatHeat: { fl: 3 } })
    await plugin.execute(VIN, { type: 'vehicle.climate_set', targetTempC: 20.5, seatHeat: { rc: 1 }, steeringWheelHeat: true })
    expect(commandPaths(t)).toEqual(['remote_seat_heater_request', 'set_temps', 'remote_seat_heater_request', 'remote_steering_wheel_heater_request'])
    const bodies = t.calls.filter((c) => c.path.includes('/command/')).map((c) => c.body)
    expect(bodies).toEqual(['{"heater":0,"level":3}', '{"driver_temp":20.5,"passenger_temp":20.5}', '{"heater":4,"level":1}', '{"on":true}'])
    expect(patches(ctx).filter((p) => 'seatHeat' in p).at(-1)).toEqual({ seatHeat: { fl: 3, rc: 1 } })
    expect(patches(ctx).at(-1)).toMatchObject({ steeringWheelHeat: true })
    expect(t.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
  })

  it('setting a SLEEPING car does not wake it: refused, like the charge limit', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.asleep = true
    const { plugin, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.climate_set', steeringWheelHeat: true })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    expect(t.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
  })

  it('stopping an awake car: one command, the state follows', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, ctx, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.climate_stop' })
    expect(commandPaths(t)).toEqual(['auto_conditioning_stop'])
    expect(patches(ctx).at(-1)).toMatchObject({ climateOn: false })
  })
})

describe('charge', () => {
  const commandPaths = (t: ReturnType<typeof fakeTesla>) => t.calls.filter((c) => c.path.includes('/command/')).map((c) => c.path.split('/command/')[1])
  const flush = async () => { for (let i = 0; i < 10; i++) await settle() }

  it('awake: charge_start, then a re-read a minute later OBSERVES the charge (nothing announced on the acknowledgment)', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, ctx, clock, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.start_charge' })
    expect(commandPaths(t)).toEqual(['charge_start'])
    expect(t.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
    expect(patches(ctx).some((p) => 'charging' in p)).toBe(false)
    clock.advance(60_000); await flush()
    expect(dataCalls(t)).toBe(1)
  })

  it('already charging (`is_charging`) is not a failure', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.commandResult = { result: false, reason: 'is_charging' }
    const { plugin } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.start_charge' })).resolves.toBeUndefined()
  })

  it('`could_not_wake_buses` (online, buses still asleep): accepted, retried behind, then re-read', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.commandResult = { result: false, reason: 'could_not_wake_buses' }
    const { plugin, clock, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.start_charge' })).resolves.toBeUndefined()
    expect(commandPaths(t)).toEqual(['charge_start'])
    tesla.world.commandResult = { result: true }
    clock.advance(5_000); await flush()
    expect(commandPaths(t)).toEqual(['charge_start', 'charge_start'])
    clock.advance(5_000); await flush()
    expect(commandPaths(t)).toHaveLength(2)          // succeeded: no further attempt
    clock.advance(60_000); await flush()
    expect(dataCalls(t)).toBe(1)
  })

  it('another refusal surfaces', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.commandResult = { result: false, reason: 'complete' }
    const { plugin } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.start_charge' })).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
  })

  it('asleep: woken, charge_start goes out once online', async () => {
    const tesla = fakeTesla()
    const { plugin, clock, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.start_charge' })
    expect(t.calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/1/vehicles/${VIN}/wake_up` })
    expect(commandPaths(t)).toEqual([])
    tesla.world.list = VEHICLES_ONLINE
    clock.advance(5_000); await flush()
    expect(commandPaths(t)).toEqual(['charge_start'])
  })

  it('unplugged according to the last state: refused BEFORE paying for a wake-up', async () => {
    const tesla = fakeTesla()
    const state = memoryState({ ...emptyState(), vehicles: { [VIN]: { pluggedIn: false } } })
    const { plugin, tesla: t } = await started({ tesla, tokens: linkedTokens(), state })
    await plugin.discover()
    await expect(plugin.execute(VIN, { type: 'vehicle.start_charge' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    expect(t.calls.some((c) => c.path.endsWith('/wake_up'))).toBe(false)
  })

  it('stopping: charge_stop and the state follows; asleep, nothing to stop or wake', async () => {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    const { plugin, ctx, tesla: t } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    await plugin.execute(VIN, { type: 'vehicle.stop_charge' })
    expect(commandPaths(t)).toEqual(['charge_stop'])
    expect(patches(ctx).at(-1)).toMatchObject({ charging: false })

    const sleeping = await started({ tesla: fakeTesla(), tokens: linkedTokens() })
    await sleeping.plugin.discover()
    await sleeping.plugin.execute(VIN, { type: 'vehicle.stop_charge' })
    expect(sleeping.tesla.calls.some((c) => c.path.endsWith('/wake_up') || c.path.includes('/command/'))).toBe(false)
  })
})

describe('software: release notes and update', () => {
  /** The car of the 2026-10-02 capture: 2026.32.7 installed, 2026.38 downloaded. */
  const AVAILABLE = { download_perc: 100, expected_duration_sec: 1200, install_perc: 10, status: 'available', version: '2026.38' }
  const software = (car_version: string, software_update: Record<string, unknown>) => {
    const d = structuredClone(VEHICLE_DATA_PARKED) as { response: { vehicle_state: Record<string, unknown> } }
    d.response.vehicle_state.car_version = car_version
    d.response.vehicle_state.software_update = software_update
    return d
  }
  async function awake(over: { state?: ReturnType<typeof memoryState> } = {}) {
    const tesla = fakeTesla()
    tesla.world.list = VEHICLES_ONLINE
    tesla.world.data = software('2026.32.7', AVAILABLE)
    const s = await started({ tesla, tokens: linkedTokens(), ...over })
    await s.plugin.discover()
    return s
  }
  const read = async (plugin: Awaited<ReturnType<typeof started>>['plugin']) => { await plugin.execute(VIN, { type: 'vehicle.refresh' }); await settle() }
  const softwarePatch = (ctx: PluginContext) => patches(ctx).filter((p) => 'softwareUpdate' in p).at(-1)?.softwareUpdate

  it('a full read brings the notes: the pending version, then the history without "Minor Fixes"', async () => {
    const { plugin } = await awake()
    // never read: nothing, and above all no call to serve them
    expect(await plugin.releaseNotes!(VIN, 'en')).toEqual({ history: [] })
    await read(plugin)
    const n = await plugin.releaseNotes!(VIN, 'en')
    expect(deviceReleaseNotesSchema.parse({ deviceId: `tesla:${VIN}`, ...n })).toBeTruthy()
    expect(n).toMatchObject({ installedVersion: '2026.32.7', fetchedAt: NOW })
    expect(n.pending?.version).toBe('2026.38')
    // the "pending" response mixes in 2026.32 notes: only those of 2026.38 remain
    expect(n.pending?.notes.map((x) => x.title)).toEqual(['Supercharger Site Maps', 'Security Improvements'])
    expect(n.history.map((h) => [h.version, h.notes.length])).toEqual([['2026.32', 2], ['2026.26.6', 7]])
    expect(n.history.flatMap((h) => h.notes).some((x) => x.title === 'Minor Fixes')).toBe(false)
  })

  it('ONE call per version: re-reading the car does not re-read the notes; one more installed version does — and the history grows', async () => {
    const { plugin, tesla, stateStore } = await awake()
    await read(plugin)
    await read(plugin)
    await read(plugin)
    expect(notesCalls(tesla)).toBe(2)                    // installed, then pending: once
    expect(stateStore.value?.releaseNotes[VIN]?.en?.pending?.version).toBe('2026.38')

    // 2026.38 installed: Tesla now only returns notes since the last major update
    tesla.world.data = software('2026.38', { status: '', download_perc: 0, install_perc: 1, expected_duration_sec: 2700 })
    tesla.world.notes = { response: {
      release_notes: [
        { title: 'Supercharger Site Maps', description: 'View Site Map.', customer_version: '2026.38', show_in_history: true },
        { title: 'Apple Music', description: 'Library.', customer_version: '2026.32', show_in_history: true },
      ],
      deployed_version: '2026.38', staged_version: null,
    } }
    await read(plugin)
    expect(notesCalls(tesla)).toBe(3)                    // nothing pending: no `staged` call
    const n = await plugin.releaseNotes!(VIN, 'en')
    expect(n.installedVersion).toBe('2026.38')
    expect(n.pending).toBeUndefined()
    // 2026.26.6 is no longer at Tesla, but Kasbah kept it
    expect(n.history.map((h) => h.version)).toEqual(['2026.38', '2026.32', '2026.26.6'])
    expect(n.history[1]!.notes.map((x) => x.title)).toEqual(['Apple Music'])
  })

  it('right after an installation, the new features of the installed version enter the history (Tesla returns them outside the history)', async () => {
    const { plugin, tesla } = await awake()
    await read(plugin)
    // real reading of 2026-10-02, 2026.38 just installed: its notes as `show_in_history: false`
    tesla.world.data = software('2026.38', { status: '', version: ' ', download_perc: 0, install_perc: 1, expected_duration_sec: 2700 })
    tesla.world.notes = { response: {
      release_notes: [
        { title: 'Supercharger Site Maps', description: 'View Site Map.', customer_version: '2026.38', show_in_history: false },
        { title: 'Security Improvements', description: 'Fixes.', customer_version: '2026.38', show_in_history: false },
        { title: 'Apple Music', description: 'Library.', customer_version: '2026.32', show_in_history: true },
      ],
      deployed_version: '2026.38', staged_version: null,
    } }
    await read(plugin)
    const n = await plugin.releaseNotes!(VIN, 'en')
    expect(n.pending).toBeUndefined()
    expect(n.history.map((h) => h.version)).toEqual(['2026.38', '2026.32', '2026.26.6'])
    expect(n.history[0]!.notes.map((x) => x.title)).toEqual(['Supercharger Site Maps', 'Security Improvements'])
  })

  it('the generic entry of the installed version ("Minor Fixes", `is_fallback`) stays out of the history', async () => {
    const { plugin } = await awake()
    await read(plugin)
    // the 2026-10-02 capture: 2026.32.7 installed, its "Minor Fixes" as fallback
    expect((await plugin.releaseNotes!(VIN, 'en')).history.map((h) => h.version)).not.toContain('2026.32.7')
  })

  it('illustrations expire: removed on display, the text stays; re-read one day before expiry', async () => {
    const { plugin, tesla, clock } = await awake()
    await read(plugin)
    const exp = 1792130420_000
    clock.advance(exp - NOW - 12 * 60 * MIN)            // the day before expiry
    expect((await plugin.releaseNotes!(VIN, 'en')).pending?.notes[0]).toHaveProperty('imageUrl')
    await read(plugin)
    expect(notesCalls(tesla)).toBe(4)                    // re-read: the URLs were about to expire
    // a car sleeping past the expiry: nothing is re-read, the images go, the text stays
    tesla.world.notes = null
    clock.advance(24 * 60 * MIN)
    const note = (await plugin.releaseNotes!(VIN, 'en')).history[0]!.notes[0]!
    expect(note).toEqual({ title: 'Apple Music', description: expect.any(String) })
  })

  it('a failure is not replayed on every read: new attempt six hours later', async () => {
    const { plugin, tesla, clock } = await awake()
    tesla.world.notes = null
    await read(plugin)
    await read(plugin)
    expect(notesCalls(tesla)).toBe(1)
    expect((await plugin.releaseNotes!(VIN, 'en')).history).toEqual([])
    tesla.world.notes = RELEASE_NOTES_INSTALLED
    clock.advance(6 * 60 * MIN + 1)
    await read(plugin)
    expect(notesCalls(tesla)).toBe(3)
    expect((await plugin.releaseNotes!(VIN, 'en')).history).toHaveLength(2)
  })

  it('in the app language: English first (fallback), French once requested and read', async () => {
    const { plugin, tesla } = await awake()
    // what Tesla would return in French: same entries, other titles
    const fr = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll('Security Improvements', 'Améliorations de la sécurité').replaceAll('Supercharger Site Maps', 'Plans des Superchargeurs').replaceAll('"Apple Music', '"Apple Music (fr)'))
    tesla.world.notesFr = fr(RELEASE_NOTES_INSTALLED)
    tesla.world.stagedNotesFr = fr(RELEASE_NOTES_STAGED)
    await read(plugin)
    expect(tesla.calls.filter((c) => c.path.includes('/release_notes')).map((c) => c.lang)).toEqual(['en', 'en'])
    // French has never been requested: English is served, and the request is kept
    const first = await plugin.releaseNotes!(VIN, 'fr')
    expect(first.lang).toBe('en')
    expect(first.pending?.notes[0]?.title).toBe('Supercharger Site Maps')
    await settle()                                       // awake: read right away, without waiting for a full read
    expect(notesCalls(tesla)).toBe(4)
    const n = await plugin.releaseNotes!(VIN, 'fr')
    expect(n.lang).toBe('fr')
    expect(n.pending?.notes.map((x) => x.title)).toEqual(['Plans des Superchargeurs', 'Améliorations de la sécurité'])
    expect(n.history[0]!.notes[0]!.title).toBe('Apple Music (fr)')
    // English is still served to whoever asks; a re-read reads nothing again (same versions)
    expect((await plugin.releaseNotes!(VIN, 'en')).pending?.notes[0]?.title).toBe('Supercharger Site Maps')
    await read(plugin)
    expect(notesCalls(tesla)).toBe(4)
  })

  it('Tesla ignores the requested language (same texts as in English): English is served, and the language is not re-read', async () => {
    const { plugin, tesla, stateStore } = await awake()
    await read(plugin)
    await plugin.releaseNotes!(VIN, 'fr')
    await settle()
    expect(stateStore.value?.releaseNotes[VIN]?.fr?.ignored).toBe(true)
    expect((await plugin.releaseNotes!(VIN, 'fr')).lang).toBe('en')
    const calls = notesCalls(tesla)
    await read(plugin)
    expect(notesCalls(tesla)).toBe(calls)
  })

  it('a language requested while the car is asleep waits for the next read: never a wake-up for notes', async () => {
    const tesla = fakeTesla()
    const { plugin } = await started({ tesla, tokens: linkedTokens() })
    await plugin.discover()
    expect(await plugin.releaseNotes!(VIN, 'fr')).toEqual({ history: [] })
    await settle()
    expect(tesla.calls.some((c) => c.path.includes('/release_notes') || c.path.endsWith('/wake_up'))).toBe(false)
  })

  it('scheduling the installation: one command, the state follows without re-read; rescheduling moves the time', async () => {
    const { plugin, ctx, tesla } = await awake()
    await read(plugin)
    const reads = dataCalls(tesla)
    await plugin.execute(VIN, { type: 'vehicle.schedule_update', delayS: 0 })
    expect(tesla.calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/1/vehicles/${VIN}/command/schedule_software_update`, body: '{"offset_sec":0}' })
    expect(softwarePatch(ctx)).toEqual({ status: 'scheduled', version: '2026.38', expectedDurationS: 1200, scheduledAt: NOW })
    await plugin.execute(VIN, { type: 'vehicle.schedule_update', delayS: 3600 })
    expect(softwarePatch(ctx)).toMatchObject({ status: 'scheduled', scheduledAt: NOW + 60 * MIN })
    expect(dataCalls(tesla)).toBe(reads)
  })

  it('cancelling: the update becomes available again; nothing scheduled, nothing is sent', async () => {
    const { plugin, ctx, tesla } = await awake()
    await read(plugin)
    const commands = () => tesla.calls.filter((c) => c.path.includes('/command/')).length
    await plugin.execute(VIN, { type: 'vehicle.cancel_update' })
    expect(commands()).toBe(0)
    await plugin.execute(VIN, { type: 'vehicle.schedule_update', delayS: 600 })
    await plugin.execute(VIN, { type: 'vehicle.cancel_update' })
    expect(tesla.calls.at(-1)).toMatchObject({ method: 'POST', path: `/api/1/vehicles/${VIN}/command/cancel_software_update` })
    expect(softwarePatch(ctx)).toEqual({ status: 'available', version: '2026.38', expectedDurationS: 1200 })
  })

  it('refused in advance: car asleep (no wake-up), or nothing downloaded', async () => {
    const asleep = await started({ tokens: linkedTokens() })
    await asleep.plugin.discover()
    await expect(asleep.plugin.execute(VIN, { type: 'vehicle.schedule_update', delayS: 0 })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    expect(asleep.tesla.calls.some((c) => c.path.endsWith('/wake_up') || c.path.includes('/command/'))).toBe(false)

    const { plugin, tesla } = await awake()
    tesla.world.data = software('2026.32.7', { status: 'downloading', version: '2026.38', download_perc: 40 })
    await read(plugin)
    await expect(plugin.execute(VIN, { type: 'vehicle.schedule_update', delayS: 0 }))
      .rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE', message: expect.stringContaining('downloading') })
    expect(tesla.calls.some((c) => c.path.includes('/command/'))).toBe(false)
  })

  it('"now": Tesla sets the time (countdown) — re-read 15 s later, then right after the start; the installation is re-read every round', async () => {
    const { plugin, ctx, tesla, clock } = await awake()
    await read(plugin)
    const reads = dataCalls(tesla)
    // Tesla leaves two minutes before starting (seen on the real car on 2026-10-02)
    tesla.world.data = software('2026.32.7', { ...AVAILABLE, status: 'scheduled', scheduled_time_ms: NOW + 2 * MIN })
    await plugin.execute(VIN, { type: 'vehicle.schedule_update', delayS: 0 })
    expect(softwarePatch(ctx)).toMatchObject({ status: 'scheduled', scheduledAt: NOW })        // our echo
    clock.advance(15_000); await settle()
    expect(dataCalls(tesla)).toBe(reads + 1)
    expect(softwarePatch(ctx)).toMatchObject({ status: 'scheduled', scheduledAt: NOW + 2 * MIN })   // Tesla's time
    // right after the scheduled time: read, installing
    tesla.world.data = software('2026.32.7', { ...AVAILABLE, status: 'installing', install_perc: 5 })
    clock.advance(2 * MIN + 60_000 - 15_000); await settle()
    expect(dataCalls(tesla)).toBe(reads + 2)
    expect(softwarePatch(ctx)).toEqual({ status: 'installing', version: '2026.38', installPct: 5, expectedDurationS: 1200 })
    // installing, no rest: the next read doesn't wait for TESLA_REST_MS
    await plugin.start(); await settle()
    const during = dataCalls(tesla)
    await ticks(clock, 1)
    expect(dataCalls(tesla)).toBe(during + 1)
  })

  it('cancelling removes the read planned at the start', async () => {
    const { plugin, tesla, clock } = await awake()
    await read(plugin)
    await plugin.execute(VIN, { type: 'vehicle.schedule_update', delayS: 600 })
    clock.advance(15_000); await settle()                // the re-read of Tesla's time
    const reads = dataCalls(tesla)
    await plugin.execute(VIN, { type: 'vehicle.cancel_update' })
    clock.advance(11 * MIN); await settle()
    expect(dataCalls(tesla)).toBe(reads)
  })

  it('the Tesla refusal surfaces, and the state does not move', async () => {
    const { plugin, ctx, tesla } = await awake()
    await read(plugin)
    tesla.world.commandResult = { result: false, reason: 'update_not_ready' }
    const before = softwarePatch(ctx)
    await expect(plugin.execute(VIN, { type: 'vehicle.schedule_update', delayS: 0 }))
      .rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: expect.stringContaining('update_not_ready') })
    expect(softwarePatch(ctx)).toEqual(before)
  })
})

describe('raw reading', () => {
  it('list then vehicle_data of the awake vehicles only, without waking the others', async () => {
    const { app, tesla } = await started({ tokens: linkedTokens() })
    const asleep = await app.inject({ method: 'GET', url: '/api/plugins/tesla/raw' }).then((r) => r.json())
    // the region first: it's what explains an empty list
    expect(Object.keys(asleep)).toEqual(['/api/1/users/region', '/api/1/vehicles'])
    expect(dataCalls(tesla)).toBe(0)
    expect(tesla.calls.some((c) => c.path.includes('/release_notes'))).toBe(false)   // asleep: nothing
    tesla.world.list = VEHICLES_ONLINE
    const awake = await app.inject({ method: 'GET', url: '/api/plugins/tesla/raw' }).then((r) => r.json())
    // awake: the full read, then the release notes (installed, then pending)
    expect(Object.keys(awake)).toHaveLength(5)
    expect(Object.keys(awake).filter((k) => k.includes('/release_notes'))).toHaveLength(2)
    expect(dataCalls(tesla)).toBe(1)
  })
})
