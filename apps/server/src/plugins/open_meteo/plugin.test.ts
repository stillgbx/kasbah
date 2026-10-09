import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import pino from 'pino'
import { ManualClock } from '@kasbah/mock-sim'
import { PluginError, type PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { AIR_QUALITY, FORECAST } from './__fixtures__/open-meteo'
import { createOpenMeteoPlugin, openMeteoConfigSchema } from './index'

// Le plugin face à un faux Open-Meteo : deux hôtes, chacun peut tomber. L'horloge est celle de la
// capture (16 septembre 2026, 09:50 à Paris) pour que « l'heure courante » tombe dans les séries.

const NOW = 1789545000 * 1000

/** Le flux MeteoAlarm d'un seul message, sur la Côte-d'Or (le département de `site`). */
const alarm = (level: number, onset: string, expires: string) => ({ warnings: [{ alert: { sent: onset, info: [{
  onset, expires, area: [{ areaDesc: "Côte-d'Or" }],
  parameter: [{ valueName: 'awareness_type', value: '3; thunderstorm' }, { valueName: 'awareness_level', value: `${level}; x; y` }],
}] } }] })

function fakeService(over: { forecastStatus?: number; airStatus?: number; hang?: boolean; feed?: unknown; feedStatus?: number; departement?: string | null } = {}) {
  /** Appels à Open-Meteo seulement ; ceux de la vigilance (MeteoAlarm, API Géo) à part. */
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

/** Laisse les promesses en vol se résoudre (le poller tourne sur l'horloge injectée). */
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

/** Cycle complet de l'hôte : init → discover → start, puis la première lecture du poller. */
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

describe('démarrage', () => {
  it('déclare l’appareil sans toucher au réseau, puis lit les deux API à la position de la maison', async () => {
    const service = fakeService()
    const plugin = createOpenMeteoPlugin({ fetchImpl: service.fetchImpl, requestTimeoutMs: 500 })
    const ctx = makeCtx(new ManualClock(NOW))
    await plugin.init(ctx)
    const devices = await plugin.discover()
    expect(service.calls).toHaveLength(0)                    // les plugins démarrent l'un après l'autre : rien ne bloque
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ id: 'open_meteo:home', kind: 'weather', capabilities: ['forecast', 'air_quality', 'pollen'] })
    await plugin.start()
    await settle()
    expect(service.calls).toHaveLength(2)
    expect(service.calls[0]).toContain('latitude=47.30934&longitude=5.04559')
    expect(ctx.emitState).toHaveBeenCalledWith('home', expect.objectContaining({ condition: 'cloudy', tempC: 16.8, aqi: 17 }))
    expect(ctx.emitDevices).not.toHaveBeenCalled()          // l'air répond : rien à redéclarer
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
    expect(plugin.health!().keys).toEqual(['OPEN_METEO_POLL_MS'])
    await plugin.stop()
  })

  it('sans qualité de l’air, l’appareil est redéclaré sans les capacités d’air mais la météo passe', async () => {
    const { ctx, plugin } = await started(fakeService({ airStatus: 503 }).fetchImpl)
    expect(ctx.emitDevices).toHaveBeenCalledWith([expect.objectContaining({ capabilities: ['forecast'] })])
    expect(ctx.emitState).toHaveBeenCalledWith('home', expect.objectContaining({ tempC: 16.8, aqi: null, pollen: null }))
    expect(plugin.health!().detail).toMatch(/weather only/)
    await plugin.stop()
  })

  it('un service muet au démarrage ne bloque pas : appareil déclaré, indisponible, santé en erreur', async () => {
    const { ctx, devices, plugin } = await started(fakeService({ forecastStatus: 500 }).fetchImpl)
    expect(devices).toHaveLength(1)
    expect(ctx.emitState).not.toHaveBeenCalled()
    expect(ctx.setAvailable).toHaveBeenCalledWith('home', false)
    expect(plugin.health!()).toMatchObject({ status: 'error' })
    await plugin.stop()
  })

  it('borne chaque requête : un service qui ne répond pas donne TIMEOUT, pas un poller gelé', async () => {
    const { plugin } = await started(fakeService({ hang: true }).fetchImpl)
    await new Promise((r) => setTimeout(r, 700))            // le délai de 500 ms est réel (AbortSignal.timeout)
    expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringMatching(/did not answer/) })
    await plugin.stop()
  })
})

describe('prévisions et commandes', () => {
  it('rend la dernière lecture mise en forme à l’heure courante, sans nouvel appel', async () => {
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

  it('refuse toute commande : la météo se lit', async () => {
    const { plugin } = await started(fakeService().fetchImpl)
    await expect(plugin.execute('home', { type: 'light.set', on: true })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await plugin.stop()
  })
})

describe('sondage', () => {
  it('relit à la cadence configurée, et marque l’appareil indisponible quand le service tombe', async () => {
    const calls: string[] = []
    let status = 200
    const flaky: FetchLike = (url, init) => { if (url.includes('open-meteo')) calls.push(url); return fakeService({ forecastStatus: status, airStatus: status }).fetchImpl(url, init) }
    const { plugin, ctx, clock } = await started(flaky, { OPEN_METEO_POLL_MS: '60000' })
    expect(calls).toHaveLength(2)                            // la première lecture vient du poller
    clock.advance(60_000); await settle()
    expect(calls).toHaveLength(4)
    status = 500
    clock.advance(60_000); await settle()
    expect(ctx.setAvailable).toHaveBeenCalledWith('home', false)
    expect(plugin.health!()).toMatchObject({ status: 'degraded' })
    await plugin.stop()
  })
})

describe('ailleurs qu’à la maison (vue Météo)', () => {
  /** Géocodage réduit à ce que l'API renvoie vraiment (capture du 2026-09-24, codes postaux ôtés). */
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

  it('cherche un lieu par son nom, et rend une liste vide sans résultat', async () => {
    const { service, fetchImpl } = routed()
    const { app: a, plugin } = await app(fetchImpl)
    const res = await a.inject({ method: 'GET', url: '/places?q=Dijon&lang=fr' })
    expect(res.json()).toEqual({ places: [{ id: '3021372', name: 'Dijon', region: 'Bourgogne, France', countryCode: 'FR', lat: 47.31344, lon: 5.01391 }] })
    expect(service.calls.at(-1)).toContain('name=Dijon')
    expect((await a.inject({ method: 'GET', url: '/places?q=zzqqx' })).json()).toEqual({ places: [] })
    expect((await a.inject({ method: 'GET', url: '/places?q=a' })).statusCode).toBe(400)
    await plugin.stop()
  })

  it('lit la météo d’une autre position, complète, et la garde le temps d’un sondage', async () => {
    const { service, fetchImpl } = routed()
    const { app: a, plugin, clock } = await app(fetchImpl)
    const paris = () => service.calls.filter((u) => u.includes('latitude=48.85660&longitude=2.35220')).length
    const before = service.calls.length
    const body = (await a.inject({ method: 'GET', url: '/at?lat=48.8566&lon=2.3522' })).json()
    expect(service.calls.slice(before).every((u) => u.includes('latitude=48.85660&longitude=2.35220'))).toBe(true)
    expect(body.state).toMatchObject({ kind: 'weather', available: true })
    expect(body.state.tempC).toEqual(expect.any(Number))
    expect(Object.values(body.state)).not.toContain(null)        // les effacements du patch ne fuient pas
    expect(body.forecast.hourly).toHaveLength(24)
    expect(body.attribution).toContain('Open-Meteo')
    await a.inject({ method: 'GET', url: '/at?lat=48.8566&lon=2.3522' })
    expect(paris()).toBe(2)                                       // relue du cache : pas de nouvel appel
    clock.advance(600_000)
    await a.inject({ method: 'GET', url: '/at?lat=48.8566&lon=2.3522' })
    expect(paris()).toBe(4)
    expect((await a.inject({ method: 'GET', url: '/at?lat=91&lon=0' })).statusCode).toBe(400)
    await plugin.stop()
  })

  it('plugin monté mais jamais démarré : 409 DEVICE_UNAVAILABLE en clair, pas un 500', async () => {
    const a = Fastify()
    createOpenMeteoPlugin({ fetchImpl: fakeService().fetchImpl }).registerRoutes?.(a)
    for (const url of ['/places?q=Pornic', '/at?lat=47.11&lon=-2.1', '/alerts?lat=47.11&lon=-2.1']) {
      const res = await a.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(409)
      expect(res.json().error, url).toMatchObject({ code: 'DEVICE_UNAVAILABLE', message: 'open_meteo plugin is not started' })
    }
  })
})

describe('vigilance de la maison', () => {
  const emitted = (ctx: PluginContext) => (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]

  it('publie dans l’état les vigilances EN COURS du département, pas celles à venir', async () => {
    const feed = { warnings: [
      ...alarm(3, '2026-09-16T06:00:00+02:00', '2026-09-17T00:00:00+02:00').warnings,
      ...alarm(4, '2026-09-17T00:00:00+02:00', '2026-09-17T12:00:00+02:00').warnings,
    ] }
    const service = fakeService({ feed })
    const { ctx, plugin } = await started(service.fetchImpl)
    expect(emitted(ctx).vigilance).toEqual([{ type: 'thunderstorm', level: 'orange', onset: Date.parse('2026-09-16T06:00:00+02:00'), expires: Date.parse('2026-09-17T00:00:00+02:00') }])
    expect(service.calls).toHaveLength(2)                      // la vigilance n'ajoute rien à Open-Meteo
    await plugin.stop()
  })

  it('aucune vigilance = liste vide ; hors de la métropole = effacée ; flux tombé = rien de touché', async () => {
    const none = await started(fakeService().fetchImpl)
    expect(emitted(none.ctx).vigilance).toEqual([])
    const abroad = await started(fakeService({ departement: '971' }).fetchImpl)
    expect(emitted(abroad.ctx).vigilance).toBeNull()
    const down = await started(fakeService({ feedStatus: 503 }).fetchImpl)
    expect(emitted(down.ctx)).not.toHaveProperty('vigilance')
    expect(emitted(down.ctx)).toMatchObject({ condition: 'cloudy' })   // la météo passe quand même
    for (const s of [none, abroad, down]) await s.plugin.stop()
  })
})
