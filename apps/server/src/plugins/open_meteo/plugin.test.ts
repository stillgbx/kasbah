import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import pino from 'pino'
import { ManualClock } from '@kasbah/mock-sim'
import { PluginError, type PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { AIR_QUALITY, FORECAST } from './__fixtures__/open-meteo'
import { createOpenMeteoPlugin, openMeteoConfigSchema } from './index'

// The plugin facing a fake Open-Meteo: two hosts, each of which can go down. The clock is the
// capture's (September 16, 2026, 09:50 in Paris) so that "the current hour" falls within the series.

const NOW = 1789545000 * 1000

/** The MeteoAlarm feed with a single message, for Côte-d'Or (the department of `site`). */
const alarm = (level: number, onset: string, expires: string) => ({ warnings: [{ alert: { sent: onset, info: [{
  onset, expires, area: [{ areaDesc: "Côte-d'Or" }],
  parameter: [{ valueName: 'awareness_type', value: '3; thunderstorm' }, { valueName: 'awareness_level', value: `${level}; x; y` }],
}] } }] })

function fakeService(over: { forecastStatus?: number; airStatus?: number; hang?: boolean; feed?: unknown; feedStatus?: number; departement?: string | null } = {}) {
  /** Calls to Open-Meteo only; the weather-warning ones (MeteoAlarm, Géo API) kept apart. */
  const calls: string[] = []
  const vigilanceCalls: string[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Awaited<ReturnType<FetchLike>>
    if (url.includes('meteoalarm')) { vigilanceCalls.push(url); return reply(over.feedStatus ?? 200, over.feed ?? { warnings: [] }) }
    if (url.includes('geo.api.gouv.fr')) {
      vigilanceCalls.push(url)
      const d = over.departement === undefined ? '21' : over.departement
      return reply(200, d === null ? [] : [{ nom: 'Dijon', departement: { code: d, nom: "Côte-d'Or" } }])
    }
    calls.push(url)
    if (over.hang) await new Promise<void>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const air = url.includes('air-quality')
    const status = air ? over.airStatus ?? 200 : over.forecastStatus ?? 200
    const body = air ? AIR_QUALITY : FORECAST
    return reply(status, body)
  }
  return { fetchImpl, calls, vigilanceCalls }
}

/** Lets in-flight promises resolve (the poller runs on the injected clock). */
const settle = () => new Promise((r) => setTimeout(r, 0))

function makeCtx(clock: ManualClock, env: Record<string, string> = {}): PluginContext {
  return {
    pluginId: 'open_meteo',
    config: openMeteoConfigSchema.parse(env),
    logger: pino({ level: 'silent' }), clock, signal: new AbortController().signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.309343, lon: 5.045591, alt: 180 },
  }
}

/** The host's full cycle: init → discover → start, then the poller's first reading. */
async function started(fetchImpl: FetchLike, env: Record<string, string> = {}) {
  const plugin = createOpenMeteoPlugin({ fetchImpl, requestTimeoutMs: 500 })
  const clock = new ManualClock(NOW)
  const ctx = makeCtx(clock, env)
  await plugin.init(ctx)
  const devices = await plugin.discover()
  await plugin.start()
  await settle()
  return { plugin, ctx, clock, devices }
}

describe('startup', () => {
  it('declares the device without touching the network, then reads both APIs at the house position', async () => {
    const service = fakeService()
    const plugin = createOpenMeteoPlugin({ fetchImpl: service.fetchImpl, requestTimeoutMs: 500 })
    const ctx = makeCtx(new ManualClock(NOW))
    await plugin.init(ctx)
    const devices = await plugin.discover()
    expect(service.calls).toHaveLength(0)                    // plugins start one after the other: nothing blocks
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ id: 'open_meteo:home', kind: 'weather', capabilities: ['forecast', 'air_quality', 'pollen'] })
    await plugin.start()
    await settle()
    expect(service.calls).toHaveLength(2)
    expect(service.calls[0]).toContain('latitude=47.30934&longitude=5.04559')
    expect(ctx.emitState).toHaveBeenCalledWith('home', expect.objectContaining({ condition: 'cloudy', tempC: 16.8, aqi: 17 }))
    expect(ctx.emitDevices).not.toHaveBeenCalled()          // air answers: nothing to redeclare
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
    expect(plugin.health!().keys).toEqual(['OPEN_METEO_POLL_MS'])
    await plugin.stop()
  })

  it('without air quality, the device is redeclared without the air capabilities but the weather goes through', async () => {
    const { ctx, plugin } = await started(fakeService({ airStatus: 503 }).fetchImpl)
    expect(ctx.emitDevices).toHaveBeenCalledWith([expect.objectContaining({ capabilities: ['forecast'] })])
    expect(ctx.emitState).toHaveBeenCalledWith('home', expect.objectContaining({ tempC: 16.8, aqi: null, pollen: null }))
    expect(plugin.health!().detail).toMatch(/weather only/)
    await plugin.stop()
  })

  it('a silent service at startup does not block: device declared, unavailable, health in error', async () => {
    const { ctx, devices, plugin } = await started(fakeService({ forecastStatus: 500 }).fetchImpl)
    expect(devices).toHaveLength(1)
    expect(ctx.emitState).not.toHaveBeenCalled()
    expect(ctx.setAvailable).toHaveBeenCalledWith('home', false)
    expect(plugin.health!()).toMatchObject({ status: 'error' })
    await plugin.stop()
  })

  it('bounds each request: a service that does not answer gives TIMEOUT, not a frozen poller', async () => {
    const { plugin } = await started(fakeService({ hang: true }).fetchImpl)
    await new Promise((r) => setTimeout(r, 700))            // the 500 ms delay is real (AbortSignal.timeout)
    expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringMatching(/did not answer/) })
    await plugin.stop()
  })
})

describe('forecast and commands', () => {
  it('returns the last reading shaped at the current hour, without a new call', async () => {
    const service = fakeService()
    const { plugin } = await started(service.fetchImpl)
    const before = service.calls.length
    const f = await plugin.forecast!('home')
    expect(service.calls).toHaveLength(before)
    expect(f.hourly).toHaveLength(24)
    expect(f.hourly[0]!.t).toBe(Math.floor(NOW / 3_600_000) * 3_600_000)
    expect(f.daily).toHaveLength(7)
    await expect(plugin.forecast!('elsewhere')).rejects.toBeInstanceOf(PluginError)
    await plugin.stop()
  })

  it('refuses any command: weather is read-only', async () => {
    const { plugin } = await started(fakeService().fetchImpl)
    await expect(plugin.execute('home', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await plugin.stop()
  })
})

describe('polling', () => {
  it('re-reads at the configured rate, and marks the device unavailable when the service goes down', async () => {
    const calls: string[] = []
    let status = 200
    const flaky: FetchLike = (url, init) => { if (url.includes('open-meteo')) calls.push(url); return fakeService({ forecastStatus: status, airStatus: status }).fetchImpl(url, init) }
    const { plugin, ctx, clock } = await started(flaky, { OPEN_METEO_POLL_MS: '60000' })
    expect(calls).toHaveLength(2)                            // the first reading comes from the poller
    clock.advance(60_000); await settle()
    expect(calls).toHaveLength(4)
    status = 500
    clock.advance(60_000); await settle()
    expect(ctx.setAvailable).toHaveBeenCalledWith('home', false)
    expect(plugin.health!()).toMatchObject({ status: 'degraded' })
    await plugin.stop()
  })
})

describe('away from the house (Weather view)', () => {
  /** Geocoding reduced to what the API really returns (capture of 2026-09-24, postal codes removed). */
  const DIJON = { id: 3021372, name: 'Dijon', latitude: 47.31344, longitude: 5.01391, country_code: 'FR', timezone: 'Europe/Paris', country: 'France', admin1: 'Bourgogne' }
  function routed() {
    const service = fakeService()
    const fetchImpl: FetchLike = async (url, init) => {
      if (!url.includes('geocoding')) return service.fetchImpl(url, init)
      service.calls.push(url)
      const body = url.includes('name=zz') ? { generationtime_ms: 0.2 } : { results: [DIJON] }
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Awaited<ReturnType<FetchLike>>
    }
    return { service, fetchImpl }
  }
  async function app(fetchImpl: FetchLike) {
    const s = await started(fetchImpl)
    const a = Fastify()
    s.plugin.registerRoutes?.(a)
    return { ...s, app: a }
  }

  it('searches a place by name, and returns an empty list when there is no result', async () => {
    const { service, fetchImpl } = routed()
    const { app: a, plugin } = await app(fetchImpl)
    const res = await a.inject({ method: 'GET', url: '/places?q=Dijon&lang=fr' })
    expect(res.json()).toEqual({ places: [{ id: '3021372', name: 'Dijon', region: 'Bourgogne, France', countryCode: 'FR', lat: 47.31344, lon: 5.01391 }] })
    expect(service.calls.at(-1)).toContain('name=Dijon')
    expect((await a.inject({ method: 'GET', url: '/places?q=zzqqx' })).json()).toEqual({ places: [] })
    expect((await a.inject({ method: 'GET', url: '/places?q=a' })).statusCode).toBe(400)
    await plugin.stop()
  })

  it('reads the full weather of another position, and keeps it for one poll interval', async () => {
    const { service, fetchImpl } = routed()
    const { app: a, plugin, clock } = await app(fetchImpl)
    const paris = () => service.calls.filter((u) => u.includes('latitude=48.85660&longitude=2.35220')).length
    const before = service.calls.length
    const body = (await a.inject({ method: 'GET', url: '/at?lat=48.8566&lon=2.3522' })).json()
    expect(service.calls.slice(before).every((u) => u.includes('latitude=48.85660&longitude=2.35220'))).toBe(true)
    expect(body.state).toMatchObject({ kind: 'weather', available: true })
    expect(body.state.tempC).toEqual(expect.any(Number))
    expect(Object.values(body.state)).not.toContain(null)        // the patch's clears don't leak
    expect(body.forecast.hourly).toHaveLength(24)
    expect(body.attribution).toContain('Open-Meteo')
    await a.inject({ method: 'GET', url: '/at?lat=48.8566&lon=2.3522' })
    expect(paris()).toBe(2)                                       // re-read from cache: no new call
    clock.advance(600_000)
    await a.inject({ method: 'GET', url: '/at?lat=48.8566&lon=2.3522' })
    expect(paris()).toBe(4)
    expect((await a.inject({ method: 'GET', url: '/at?lat=91&lon=0' })).statusCode).toBe(400)
    await plugin.stop()
  })

  it('plugin mounted but never started: a plain 409 DEVICE_UNAVAILABLE, not a 500', async () => {
    const a = Fastify()
    createOpenMeteoPlugin({ fetchImpl: fakeService().fetchImpl }).registerRoutes?.(a)
    for (const url of ['/places?q=Pornic', '/at?lat=47.11&lon=-2.1', '/alerts?lat=47.11&lon=-2.1']) {
      const res = await a.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(409)
      expect(res.json().error, url).toMatchObject({ code: 'DEVICE_UNAVAILABLE', message: 'open_meteo plugin is not started' })
    }
  })
})

describe('house weather warnings', () => {
  const emitted = (ctx: PluginContext) => (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]

  it('publishes in the state the department CURRENT warnings, not upcoming ones', async () => {
    const feed = { warnings: [
      ...alarm(3, '2026-09-16T06:00:00+02:00', '2026-09-17T00:00:00+02:00').warnings,
      ...alarm(4, '2026-09-17T00:00:00+02:00', '2026-09-17T12:00:00+02:00').warnings,
    ] }
    const service = fakeService({ feed })
    const { ctx, plugin } = await started(service.fetchImpl)
    expect(emitted(ctx).vigilance).toEqual([{ type: 'thunderstorm', level: 'orange', onset: Date.parse('2026-09-16T06:00:00+02:00'), expires: Date.parse('2026-09-17T00:00:00+02:00') }])
    expect(service.calls).toHaveLength(2)                      // weather warnings add nothing to Open-Meteo
    await plugin.stop()
  })

  it('no warning = empty list; outside mainland France = cleared; feed down = nothing touched', async () => {
    const none = await started(fakeService().fetchImpl)
    expect(emitted(none.ctx).vigilance).toEqual([])
    const abroad = await started(fakeService({ departement: '971' }).fetchImpl)
    expect(emitted(abroad.ctx).vigilance).toBeNull()
    const down = await started(fakeService({ feedStatus: 503 }).fetchImpl)
    expect(emitted(down.ctx)).not.toHaveProperty('vigilance')
    expect(emitted(down.ctx)).toMatchObject({ condition: 'cloudy' })   // the weather goes through anyway
    for (const s of [none, abroad, down]) await s.plugin.stop()
  })
})
