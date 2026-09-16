import { describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { ManualClock } from '@kasbah/mock-sim'
import { PluginError, type PluginContext } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { AIR_QUALITY, FORECAST } from './__fixtures__/open-meteo'
import { createOpenMeteoPlugin, openMeteoConfigSchema } from './index'

// Le plugin face à un faux Open-Meteo : deux hôtes, chacun peut tomber. L'horloge est celle de la
// capture (16 septembre 2026, 09:50 à Paris) pour que « l'heure courante » tombe dans les séries.

const NOW = 1789545000 * 1000

function fakeService(over: { forecastStatus?: number; airStatus?: number; hang?: boolean } = {}) {
  const calls: string[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push(url)
    if (over.hang) await new Promise<void>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const air = url.includes('air-quality')
    const status = air ? over.airStatus ?? 200 : over.forecastStatus ?? 200
    const body = air ? AIR_QUALITY : FORECAST
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as Awaited<ReturnType<FetchLike>>
  }
  return { fetchImpl, calls }
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
    const flaky: FetchLike = (url, init) => { calls.push(url); return fakeService({ forecastStatus: status, airStatus: status }).fetchImpl(url, init) }
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
