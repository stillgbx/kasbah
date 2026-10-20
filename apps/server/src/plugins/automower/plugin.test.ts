import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { MAP_GENERATED_SVG, MAP_ZONE_SVG, MOWERS_ZONES, STAY_OUT_ID, WS_MOWER_LEAVING, MESSAGES, MOWERS_ERROR, MOWERS_MOWING, MOWERS_PARKED, MOWER_ID, WS_MESSAGE_ERROR, TOKEN_INVALID_CLIENT, TOKEN_RESPONSE, TOKEN_RESPONSE_2, WS_MOWER_ERROR_CODE, WS_MOWER_HOME, WS_MOWER_STOPPED, WS_PLANNER, WS_POSITION, WS_READY, WS_UNKNOWN_MOWER } from './__fixtures__/automower'
import { TOKEN_URL } from './auth'
import { API_BASE_URL } from './client'
import { automowerConfigSchema, createAutomowerPlugin, type AutomowerStatus } from './index'
import { currentUsage, type AutomowerUsage, type UsageStore } from './state'
import type { WsFactory, WsLike } from './ws'

// What the plugin must hold up against the vendor: read the full state at startup and publish it,
// let the STREAM carry the live data (position) without spending the quota, count every request,
// request a new token on a 401 and declare itself "to configure" on a refused key, translate the
// three gestures into JSON:API actions. No real account or robot is touched.

const NOW = Date.UTC(2026, 8, 16, 12)
const MIN = 60_000
const ENV = { AUTOMOWER_APP_KEY: 'app-key', AUTOMOWER_APP_SECRET: 'app-secret', AUTOMOWER_TIMEZONE: 'Europe/Paris', AUTOMOWER_POLL_MS: String(10 * MIN), AUTOMOWER_USAGE_FILE: '' }

const response = (body: unknown, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => body,
  text: async () => (body === null ? '' : JSON.stringify(body)),
})

/** Fake Husqvarna: token server and API, driven by a mutable state. */
function fakeHusqvarna() {
  const world = {
    list: MOWERS_ERROR as unknown,
    /** The token the API accepts; another one → 401. */
    accepts: TOKEN_RESPONSE.access_token,
    /** What the token server returns on the next call. */
    nextToken: TOKEN_RESPONSE as unknown,
    tokenStatus: 200,
    /** The SVG maps; `null` = 404, like a robot without a drawn zone. */
    maps: { generated: MAP_GENERATED_SVG as string | null, zone: null as string | null, site: null as string | null },
  }
  const calls: { method: string; path: string; body?: string; headers: Record<string, string> }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const method = init?.method ?? 'GET'
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const body = init?.body === undefined ? undefined : String(init.body)
    if (url === TOKEN_URL) {
      calls.push({ method, path: 'token', body, headers })
      return response(world.nextToken, world.tokenStatus)
    }
    const path = url.replace(API_BASE_URL, '')
    calls.push({ method, path, body, headers })
    if (headers.authorization !== `Bearer ${world.accepts}`) return response({ errors: [{ title: 'Unauthorized' }] }, 401)
    if (headers['x-api-key'] !== 'app-key' || headers['authorization-provider'] !== 'husqvarna') return response({ errors: [{ title: 'Forbidden' }] }, 403)
    if (path === '/mowers') return response(world.list)
    if (path.endsWith('/messages')) return response(MESSAGES)
    if (path.endsWith('/actions') || path.endsWith('/errors/confirm')) return response(null, 202)
    if (method === 'PATCH' && path.includes('/stayOutZones/')) return response(null, 202)
    const map = /\/maps\/(generated|zone|site)$/.exec(path)?.[1] as keyof typeof world.maps | undefined
    if (map) {
      const svg = world.maps[map]
      if (svg === null) return response({ errors: [{ code: `map.${map}.not_found` }] }, 404)
      return { ok: true, status: 200, body: null, json: async () => { throw new Error('not JSON') }, text: async () => svg }
    }
    return response({ errors: [{ title: 'Not found' }] }, 404)
  })
  return { fetchImpl, calls, world }
}

/** Fake WebSocket: we hold the handlers, and play the events by hand. */
function fakeWs() {
  const sockets: (WsLike & { handlers: Record<string, ((...a: unknown[]) => void)[]>; headers: Record<string, string>; pings: number; closed: boolean })[] = []
  const factory: WsFactory = (_url, headers) => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
    const s = {
      handlers, headers, pings: 0, closed: false,
      on(event: string, fn: (...a: unknown[]) => void) { (handlers[event] ??= []).push(fn); return s },
      ping() { s.pings++ },
      close() { s.closed = true },
      terminate() { s.closed = true },
    }
    sockets.push(s as never)
    return s as never
  }
  const emit = (i: number, event: string, ...args: unknown[]) => { for (const fn of sockets[i]!.handlers[event] ?? []) fn(...args) }
  return { factory, sockets, emit }
}

function memoryUsage(initial: AutomowerUsage | null = null): UsageStore & { value: AutomowerUsage | null } {
  const s = { value: initial, load: async () => s.value, save: async (u: AutomowerUsage) => { s.value = { ...u } } }
  return s
}

async function started(over: { env?: Record<string, string>; hq?: ReturnType<typeof fakeHusqvarna>; usage?: ReturnType<typeof memoryUsage>; start?: boolean } = {}) {
  const hq = over.hq ?? fakeHusqvarna()
  const ws = fakeWs()
  const usage = over.usage ?? memoryUsage()
  const plugin = createAutomowerPlugin({ fetchImpl: hq.fetchImpl, wsFactory: ws.factory, usageStore: usage })
  const clock = new ManualClock(NOW)
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'automower',
    config: automowerConfigSchema.parse({ ...ENV, ...over.env }),
    logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  await plugin.init(ctx)
  const app = Fastify()
  plugin.registerRoutes?.(app)
  await app.ready()
  expect(await plugin.discover()).toEqual([])
  if (over.start !== false) {
    await plugin.start()
    await flush()
  }
  const statusOf = async () => (await app.inject({ method: 'GET', url: '/status' })).json() as AutomowerStatus
  return { plugin, ctx, clock, hq, ws, usage, app, ctrl, statusOf }
}

/** Lets the poller's and the stream's microtasks run. */
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('automower — startup', () => {
  it('without a key: idle, needs_pairing, no call', async () => {
    const { plugin, hq } = await started({ env: { AUTOMOWER_APP_KEY: '', AUTOMOWER_APP_SECRET: '' } })
    expect(plugin.health!().status).toBe('needs_pairing')
    expect(hq.calls).toHaveLength(0)
    await expect(plugin.execute(MOWER_ID, { type: 'mower.pause' })).rejects.toMatchObject({ code: 'NEEDS_PAIRING' })
  })

  it('reads the list at startup, publishes the descriptor and the full state, then opens the stream with the token', async () => {
    const { ctx, hq, ws, plugin } = await started()
    // a token, then the list — with the vendor's three headers
    expect(hq.calls.map((c) => c.path)).toEqual(['token', '/mowers'])
    expect(hq.calls[0]!.body).toContain('grant_type=client_credentials')
    expect(hq.calls[1]!.headers).toMatchObject({ authorization: `Bearer ${TOKEN_RESPONSE.access_token}`, 'authorization-provider': 'husqvarna', 'x-api-key': 'app-key' })
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)
    expect((ctx.emitDevices as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject([{ id: `automower:${MOWER_ID}`, kind: 'mower', name: 'Tondeuse' }])
    expect(ctx.emitState).toHaveBeenCalledWith(MOWER_ID, expect.objectContaining({ activity: 'error', errorCode: 2, errorMessage: 'No loop signal', battery: 100 }))
    expect(ctx.setAvailable).toHaveBeenCalledWith(MOWER_ID, true)
    expect(ws.sockets).toHaveLength(1)
    expect(ws.sockets[0]!.headers).toEqual({ Authorization: `Bearer ${TOKEN_RESPONSE.access_token}` })
    // a single request counted: the LIST; the token does not count (the portal does not count it)
    expect(plugin.health!()).toMatchObject({ status: 'ok', deviceCount: 1, quota: { used: 1, limit: 21_000, labelKey: 'mower.quotaRequests', since: NOW } })
    expect(plugin.health!().detail).toContain('polling only')
  })

  it('a key refused by the token server: degraded, and the command says NEEDS_PAIRING', async () => {
    const hq = fakeHusqvarna()
    hq.world.nextToken = TOKEN_INVALID_CLIENT
    hq.world.tokenStatus = 400
    const { plugin, ctx } = await started({ hq })
    expect(ctx.emitDevices).not.toHaveBeenCalled()
    expect(plugin.health!().status).toBe('degraded')
    expect(plugin.health!().detail).toContain('refused the application key')
  })
})

describe('automower — the stream carries the live data', () => {
  it('ready then position: the state gains a location without a new request; the health says "live"', async () => {
    const { ctx, hq, ws, plugin, clock } = await started()
    ws.emit(0, 'open')
    ws.emit(0, 'message', JSON.stringify(WS_READY))
    ws.emit(0, 'message', JSON.stringify(WS_POSITION))
    expect(ctx.emitState).toHaveBeenLastCalledWith(MOWER_ID, { location: { lat: WS_POSITION.attributes.position.latitude, lon: WS_POSITION.attributes.position.longitude, at: NOW } })
    expect(hq.calls).toHaveLength(2)
    expect(plugin.health!().detail).toContain('live events')
    // the ping keeps the connection alive
    clock.advance(61_000)
    expect(ws.sockets[0]!.pings).toBe(1)
  })

  it('successive deltas: each merges into the known robot, the next start survives the planner', async () => {
    const hq = fakeHusqvarna()
    hq.world.list = MOWERS_PARKED
    const { ctx, ws } = await started({ hq })
    ws.emit(0, 'open')
    ws.emit(0, 'message', JSON.stringify(WS_MOWER_STOPPED))
    expect(ctx.emitState).toHaveBeenLastCalledWith(MOWER_ID, expect.objectContaining({ activity: 'stopped', errorCode: null }))
    ws.emit(0, 'message', JSON.stringify(WS_MOWER_HOME))
    expect(ctx.emitState).toHaveBeenLastCalledWith(MOWER_ID, expect.objectContaining({ restrictedReason: 'park_override' }))
    ws.emit(0, 'message', JSON.stringify(WS_PLANNER))
    // the stream's planner does not repeat the next start: the list's one holds
    expect(ctx.emitState).toHaveBeenLastCalledWith(MOWER_ID, { nextStartAt: Date.UTC(2026, 8, 17, 8), restrictedReason: 'park_override' })
  })

  it('an event for an unknown robot re-reads the list (once a minute at most)', async () => {
    const { hq, ws } = await started()
    ws.emit(0, 'open')
    ws.emit(0, 'message', JSON.stringify(WS_UNKNOWN_MOWER))
    ws.emit(0, 'message', JSON.stringify(WS_UNKNOWN_MOWER))
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(2)
  })

  it('the stream closes: reconnection after backoff with a token, and a full re-read', async () => {
    const { hq, ws, clock } = await started()
    ws.emit(0, 'open')
    ws.emit(0, 'close', 1006)
    clock.advance(6_500)
    await flush()
    expect(ws.sockets).toHaveLength(2)
    ws.emit(1, 'open')
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(2)
  })

  it('polling re-reads at its pace, and publishes the new state', async () => {
    const { ctx, hq, clock } = await started()
    hq.world.list = MOWERS_MOWING
    clock.advance(10 * MIN + 1)
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(2)
    expect(ctx.emitState).toHaveBeenLastCalledWith(MOWER_ID, expect.objectContaining({ activity: 'mowing', errorCode: null, battery: 83 }))
    // same robot, same name: the descriptor is not republished
    expect(ctx.emitDevices).toHaveBeenCalledTimes(1)
  })
})

describe('automower — token and quota', () => {
  it('a 401 requests ONE new token and replays; the window counter counts API calls, not tokens, and survives', async () => {
    const usage = memoryUsage({ windowStart: NOW - 3 * 86_400_000, requests: 40 })
    const { hq, clock, plugin, statusOf } = await started({ usage })
    // the token becomes stale on the vendor's side
    hq.world.accepts = TOKEN_RESPONSE_2.access_token
    hq.world.nextToken = TOKEN_RESPONSE_2
    clock.advance(10 * MIN + 1)
    await flush()
    expect(hq.calls.map((c) => c.path)).toEqual(['token', '/mowers', '/mowers', 'token', '/mowers'])
    // 40 + list + (refused list + replayed list) = 43, written as they go; the two tokens do not count
    expect(usage.value).toEqual({ windowStart: NOW - 3 * 86_400_000, requests: 43 })
    expect((await statusOf()).requestsInWindow).toBe(43)
    expect((await statusOf()).windowResetAt).toBe(NOW + 4 * 86_400_000)
    expect(plugin.health!().quota).toMatchObject({ used: 43, limit: 21_000, since: NOW - 3 * 86_400_000 })
  })

  it('POST /usage realigns the count and the portal’s reset instant, which survives in the file', async () => {
    const usage = memoryUsage()
    const { app, plugin, hq, clock } = await started({ usage })
    const resetAt = '2026-09-23T17:00:00+02:00'
    const res = await app.inject({ method: 'POST', url: '/usage', payload: { requests: 33, resetAt } })
    expect(res.statusCode).toBe(200)
    // the grid is the portal's (reset on the 23rd at 5 pm Paris time); the test clock is the 16th
    // at 12:00 UTC, BEFORE the reset of the 16th at 15:00 UTC: the current window started on the 9th
    const start = Date.parse(resetAt) - 14 * 86_400_000
    expect(plugin.health!().quota).toMatchObject({ used: 33, since: start })
    expect(usage.value).toEqual({ windowStart: start, requests: 33, anchor: Date.parse(resetAt) })
    // one more request adds to the realigned count
    hq.world.list = MOWERS_MOWING
    clock.advance(10 * MIN + 1)
    await flush()
    expect(plugin.health!().quota).toMatchObject({ used: 34 })
    // an invalid body is refused
    expect((await app.inject({ method: 'POST', url: '/usage', payload: { requests: -1 } })).statusCode).toBe(400)
    // the anchor kept in the file aligns the next window without configuration
    const later = memoryUsage(usage.value)
    const clock2 = NOW + 8 * 86_400_000
    expect(currentUsage(later.value, clock2)).toEqual({ windowStart: Date.parse(resetAt), requests: 0, anchor: Date.parse(resetAt) })
  })

  it('an elapsed seven-day window restarts from zero, on the same grid', async () => {
    const usage = memoryUsage({ windowStart: NOW - 10 * 86_400_000, requests: 9_000 })
    const { plugin } = await started({ usage })
    expect(plugin.health!().quota).toMatchObject({ used: 1, since: NOW - 3 * 86_400_000 })
  })

  it('a configured reset instant (the portal’s) aligns the grid, even in the future', async () => {
    const { plugin } = await started({ env: { AUTOMOWER_QUOTA_RESET_AT: new Date(NOW + 2 * 86_400_000).toISOString() } })
    expect(plugin.health!().quota).toMatchObject({ used: 1, since: NOW - 5 * 86_400_000 })
  })
})

describe('automower — commands', () => {
  it('mow for an hour, pause, park: three JSON:API actions, acknowledged with 202', async () => {
    const { plugin, hq } = await started()
    await plugin.execute(MOWER_ID, { type: 'mower.start', durationMin: 60 })
    await plugin.execute(MOWER_ID, { type: 'mower.pause' })
    await plugin.execute(MOWER_ID, { type: 'mower.park', untilNextSchedule: true })
    const actions = hq.calls.filter((c) => c.path.endsWith('/actions'))
    expect(actions.map((c) => c.path)).toEqual(Array(3).fill(`/mowers/${MOWER_ID}/actions`))
    expect(actions.map((c) => JSON.parse(c.body!))).toEqual([
      { data: { type: 'Start', attributes: { duration: 60 } } },
      { data: { type: 'Pause' } },
      { data: { type: 'ParkUntilNextSchedule' } },
    ])
    expect(actions[0]!.headers['content-type']).toBe('application/vnd.api+json')
  })

  it('mow without duration = resume the program: ResumeSchedule', async () => {
    const { plugin, hq } = await started()
    await plugin.execute(MOWER_ID, { type: 'mower.start' })
    expect(hq.calls.filter((c) => c.path.endsWith('/actions')).map((c) => JSON.parse(c.body!))).toEqual([{ data: { type: 'ResumeSchedule' } }])
  })

  it('clear the error: POST errors/confirm without body if the robot says it is confirmable, refusal without a call otherwise', async () => {
    const { plugin, hq, ws } = await started()
    // the initial list: confirmable error
    await plugin.execute(MOWER_ID, { type: 'mower.confirm_error' })
    const confirm = () => hq.calls.filter((c) => c.path.endsWith('/errors/confirm'))
    expect(confirm().map((c) => [c.method, c.path, c.body])).toEqual([['POST', `/mowers/${MOWER_ID}/errors/confirm`, undefined]])
    // the stream reports error 2, which the vendor does not clear remotely (capture of 2026-09-16)
    ws.emit(0, 'open')
    ws.emit(0, 'message', JSON.stringify(WS_MOWER_ERROR_CODE))
    await expect(plugin.execute(MOWER_ID, { type: 'mower.confirm_error' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    expect(confirm()).toHaveLength(1)
  })

  it('refuses a command of another kind, an unknown robot, an offline robot', async () => {
    const { plugin, hq, clock } = await started()
    await expect(plugin.execute(MOWER_ID, { type: 'vacuum.start' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(plugin.execute('nope', { type: 'mower.pause' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    hq.world.list = { data: [{ ...MOWERS_ERROR.data[0]!, attributes: { ...MOWERS_ERROR.data[0]!.attributes, metadata: { connected: false, statusTimestamp: 1 } } }] }
    clock.advance(10 * MIN + 1)
    await flush()
    await expect(plugin.execute(MOWER_ID, { type: 'mower.pause' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
  })
})

describe('automower — restart', () => {
  /**
   * Seen on the real server: after a toggle in Settings, the host empties the plugin's devices with
   * the result of `discover`, then calls `start` again. The plugin believed it had already published
   * its descriptors and did not re-emit them — robot read, stream open, and yet absent from the registry.
   */
  it('stop then init/discover/start: known robots are repeated by discover, and republished after the re-read', async () => {
    const { plugin, ctx, hq } = await started()
    await plugin.stop()
    // second life: same instance, new context (that is what the host does)
    const ctx2: PluginContext = { ...ctx, emitDevices: vi.fn(), emitState: vi.fn(), setAvailable: vi.fn(), signal: new AbortController().signal }
    await plugin.init(ctx2)
    const known = await plugin.discover()
    expect(known).toHaveLength(1)
    await plugin.start()
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(2)
    expect(ctx2.emitState).toHaveBeenCalledWith(MOWER_ID, expect.objectContaining({ activity: 'error' }))
    // the list did not change: what `discover` declared holds, no useless republication
    expect(ctx2.emitDevices).not.toHaveBeenCalled()
    await plugin.stop()
  })
})

describe('automower — log', () => {
  it('read from the vendor once, kept by the stream afterwards, re-read after a cut', async () => {
    const hq = fakeHusqvarna()
    hq.world.list = MOWERS_PARKED
    const { plugin, hq: h, ws, ctx } = await started({ hq })
    const before = h.calls.length
    const j1 = await plugin.journal!(MOWER_ID)
    expect(j1.entries).toHaveLength(22)
    expect(j1.entries[0]).toMatchObject({ code: 2, severity: 'error' })
    expect(h.calls.length).toBe(before + 1)
    expect(h.calls.at(-1)!.path).toBe(`/mowers/${MOWER_ID}/messages`)
    // second request: nothing more to the vendor
    await plugin.journal!(MOWER_ID)
    expect(h.calls.length).toBe(before + 1)
    // a line arrives through the stream: it joins the log, without duplicate
    ws.emit(0, 'open')
    const fresh = { ...WS_MESSAGE_ERROR, attributes: { message: { ...WS_MESSAGE_ERROR.attributes.message, time: 1789586535, code: 9 } } }
    ws.emit(0, 'message', JSON.stringify(fresh))
    ws.emit(0, 'message', JSON.stringify(fresh))
    const j2 = await plugin.journal!(MOWER_ID)
    expect(j2.entries).toHaveLength(23)
    expect(j2.entries[0]).toMatchObject({ code: 9, message: 'Trapped' })
    expect(ctx.emitState).not.toHaveBeenCalledWith(MOWER_ID, expect.objectContaining({ errorCode: 9 }))
    // the stream drops then comes back: lines may have gone by, the next request re-reads
    ws.emit(0, 'close', 1006)
    const { clock } = { clock: (ctx.clock as unknown as { advance(ms: number): void }) }
    clock.advance(6_500)
    await flush()
    ws.emit(1, 'open')
    await flush()
    const calls = h.calls.length
    await plugin.journal!(MOWER_ID)
    expect(h.calls.length).toBe(calls + 1)
    expect(h.calls.at(-1)!.path).toBe(`/mowers/${MOWER_ID}/messages`)
  })

  it('refuses an unknown robot', async () => {
    const { plugin } = await started()
    await expect(plugin.journal!('nope')).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
  })
})

describe('automower — routes and stop', () => {
  it('/status carries neither key nor secret; /raw re-reads the list and counts it', async () => {
    const { app, statusOf, plugin } = await started()
    const s = await statusOf()
    expect(s).toMatchObject({ configured: true, live: false, timezone: 'Europe/Paris', windowLimit: 21_000, mowers: [{ id: MOWER_ID, name: 'Tondeuse', connected: true }] })
    expect(JSON.stringify(s)).not.toContain('app-secret')
    const raw = await app.inject({ method: 'GET', url: '/raw' })
    expect(raw.statusCode).toBe(200)
    expect(raw.json()).toEqual({ mowers: MOWERS_ERROR })
    expect(plugin.health!().quota?.used).toBe(2)
  })

  it('stop closes the stream and stops polling', async () => {
    const { plugin, ws, hq, clock } = await started()
    ws.emit(0, 'open')
    await plugin.stop()
    expect(ws.sockets[0]!.closed).toBe(true)
    clock.advance(30 * MIN)
    await flush()
    expect(hq.calls.filter((c) => c.path === '/mowers')).toHaveLength(1)
  })
})

describe('automower — zones and map', () => {
  it('mow an area: StartInWorkArea with its duration, acknowledged with 202', async () => {
    const { plugin, hq } = await started()
    await plugin.execute(MOWER_ID, { type: 'mower.start_in_area', workAreaId: 123456, durationMin: 60 })
    const action = hq.calls.find((c) => c.path.endsWith('/actions'))!
    expect(JSON.parse(action.body!)).toEqual({ data: { type: 'StartInWorkArea', attributes: { workAreaId: 123456, duration: 60 } } })
  })

  it('toggle a stay-out zone: JSON:API PATCH, then ONE re-read a few seconds later', async () => {
    const hq = fakeHusqvarna()
    hq.world.list = MOWERS_ZONES
    const { plugin, clock, ctx } = await started({ hq })
    const reads = () => hq.calls.filter((c) => c.path === '/mowers').length
    const before = reads()
    await plugin.execute(MOWER_ID, { type: 'mower.set_stay_out_zone', zoneId: STAY_OUT_ID, enabled: false })
    await plugin.execute(MOWER_ID, { type: 'mower.set_stay_out_zone', zoneId: STAY_OUT_ID, enabled: true })
    const patches = hq.calls.filter((c) => c.method === 'PATCH')
    expect(patches.map((c) => c.path)).toEqual(Array(2).fill(`/mowers/${MOWER_ID}/stayOutZones/${STAY_OUT_ID}`))
    expect(JSON.parse(patches[0]!.body!)).toEqual({ data: { type: 'stayOutZone', id: STAY_OUT_ID, attributes: { enable: false } } })
    // the effect is not published in advance: the re-read will tell
    expect(reads()).toBe(before)
    clock.advance(5_000)
    await flush()
    expect(reads()).toBe(before + 1)
    expect(ctx.emitState).toHaveBeenLastCalledWith(MOWER_ID, expect.objectContaining({ stayOutZones: [{ id: STAY_OUT_ID, name: 'Massif', enabled: true }] }))
  })

  it('a map being synchronized: the vendor would refuse, the plugin says so without calling', async () => {
    const hq = fakeHusqvarna()
    const m = MOWERS_ZONES.data[0]!
    hq.world.list = { data: [{ ...m, attributes: { ...m.attributes, stayOutZones: { ...m.attributes.stayOutZones, dirty: true } } }] }
    const { plugin } = await started({ hq })
    await expect(plugin.execute(MOWER_ID, { type: 'mower.set_stay_out_zone', zoneId: STAY_OUT_ID, enabled: false })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    expect(hq.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('the map: grounds then zones (404 = none), read ONCE, re-read when the zone list changes', async () => {
    const { plugin, hq, clock } = await started()
    const mapCalls = () => hq.calls.filter((c) => c.path.includes('/maps/')).map((c) => c.path.slice(c.path.lastIndexOf('/') + 1))
    const map = await plugin.siteMap!(MOWER_ID)
    expect(map.station).toEqual([2, -0.5])
    expect(map.shapes.map((s) => s.kind)).toEqual(['station', 'lawn', 'obstacle', 'guide'])
    await plugin.siteMap!(MOWER_ID)
    expect(mapCalls()).toEqual(['generated', 'zone'])
    // a zone drawn in the app: the re-read sees it, the map is read again with its zones
    hq.world.list = MOWERS_ZONES
    hq.world.maps.zone = MAP_ZONE_SVG
    clock.advance(10 * MIN + 1)
    await flush()
    const next = await plugin.siteMap!(MOWER_ID)
    expect(next.shapes.map((s) => s.kind)).toContain('stay_out')
    expect(mapCalls()).toEqual(['generated', 'zone', 'generated', 'zone'])
  })

  it('an EPOS robot (no generated map): its site map', async () => {
    const hq = fakeHusqvarna()
    hq.world.maps = { generated: null, zone: null, site: MAP_ZONE_SVG }
    const { plugin } = await started({ hq })
    const map = await plugin.siteMap!(MOWER_ID)
    expect(map.shapes.map((s) => s.kind)).toEqual(['work_area', 'stay_out', 'rewilding', 'transport'])
    expect(map.station).toBeNull()
  })
})

describe('automower — map: detect a modified outline without spending the quota', () => {
  const zonesWith = (patch: (a: typeof MOWERS_ZONES.data[0]['attributes']) => object) => {
    const m = MOWERS_ZONES.data[0]!
    return { data: [{ ...m, attributes: { ...m.attributes, ...patch(m.attributes) } }] }
  }
  async function withMap() {
    const hq = fakeHusqvarna()
    hq.world.list = MOWERS_ZONES
    hq.world.maps.zone = MAP_ZONE_SVG
    const s = await started({ hq })
    const mapReads = () => hq.calls.filter((c) => c.path.endsWith('/maps/generated')).length
    const poll = async () => { s.clock.advance(10 * MIN + 1); await flush() }
    await s.plugin.siteMap!(MOWER_ID)
    return { ...s, hq, mapReads, poll }
  }

  it('nothing new in the list: the kept map is served, without a request', async () => {
    const { plugin, mapReads, poll } = await withMap()
    await poll()
    await plugin.siteMap!(MOWER_ID)
    expect(mapReads()).toBe(1)
  })

  it('a zone RENAMED in the app: the map is read again (its name links the shape to the zone)', async () => {
    const { plugin, hq, mapReads, poll } = await withMap()
    hq.world.list = zonesWith((a) => ({ workAreas: a.workAreas.map((w) => (w.workAreaId === 123456 ? { ...w, name: 'Verger' } : w)) }))
    await poll()
    await plugin.siteMap!(MOWER_ID)
    expect(mapReads()).toBe(2)
  })

  it('the synchronization of a modified map (`dirty`): re-read when it starts, and when it ends', async () => {
    const { plugin, hq, mapReads, poll } = await withMap()
    hq.world.list = zonesWith((a) => ({ stayOutZones: { ...a.stayOutZones, dirty: true } }))
    await poll()
    await plugin.siteMap!(MOWER_ID)
    hq.world.list = MOWERS_ZONES
    await poll()
    await plugin.siteMap!(MOWER_ID)
    expect(mapReads()).toBe(3)
  })

  it('an outline redrawn without changing anything else: re-read the next day at the latest', async () => {
    const { plugin, clock, mapReads } = await withMap()
    clock.advance(23 * 60 * MIN)
    await flush()
    await plugin.siteMap!(MOWER_ID)
    expect(mapReads()).toBe(1)
    clock.advance(61 * MIN)
    await flush()
    await plugin.siteMap!(MOWER_ID)
    expect(mapReads()).toBe(2)
  })
})

describe('automower — the current area follows the orders', () => {
  it('an activity change on a robot with areas re-reads the list (the area is only there), once a minute at most', async () => {
    const hq = fakeHusqvarna()
    hq.world.list = MOWERS_ZONES
    const { ws, clock } = await started({ hq })
    const reads = () => hq.calls.filter((c) => c.path === '/mowers').length
    const before = reads()
    clock.advance(61_000)
    await flush()
    ws.emit(0, 'open')
    ws.emit(0, 'message', JSON.stringify(WS_MOWER_LEAVING))
    await flush()
    expect(reads()).toBe(before + 1)
    // same activity repeated: nothing; another change within the minute: nothing either
    ws.emit(0, 'message', JSON.stringify(WS_MOWER_LEAVING))
    ws.emit(0, 'message', JSON.stringify({ ...WS_MOWER_LEAVING, attributes: { mower: { activity: 'MOWING' } } }))
    await flush()
    expect(reads()).toBe(before + 1)
  })

  it('"mow an area": the list is re-read ten seconds later, to publish the target area', async () => {
    const hq = fakeHusqvarna()
    hq.world.list = MOWERS_ZONES
    const { plugin, clock } = await started({ hq })
    const reads = () => hq.calls.filter((c) => c.path === '/mowers').length
    const before = reads()
    await plugin.execute(MOWER_ID, { type: 'mower.start_in_area', workAreaId: 123456, durationMin: 60 })
    clock.advance(9_000)
    await flush()
    expect(reads()).toBe(before)
    clock.advance(1_000)
    await flush()
    expect(reads()).toBe(before + 1)
  })
})
