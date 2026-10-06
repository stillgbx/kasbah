import { Duplex, PassThrough } from 'node:stream'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from '../../core/plugin'
import { STATION_READ } from './__fixtures__/station'
import { comapConfigSchema, createComapPlugin } from './index'
import type { SocketFactory } from './socket'
import type { ComapHistoryState } from './state'

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

type Behavior = 'reply' | 'silent' | 'refuse'

/**
 * Station simulée : chaque connexion est une paire de `PassThrough` en mémoire, comme le récepteur
 * Cast des tests google_cast. `silent` reproduit la panne réelle observée le 2026-09-16 : la station
 * ACCEPTE la connexion (déjà occupée par l'appli du fabricant) mais ne répond jamais.
 */
function fakeStation() {
  let behavior: Behavior = 'reply'
  const opened: { closed: boolean }[] = []
  const requests: string[] = []
  const connect: SocketFactory = vi.fn(async () => {
    if (behavior === 'refuse') throw new Error('ECONNREFUSED')
    const toStation = new PassThrough(), fromStation = new PassThrough()
    const entry = { closed: false }
    opened.push(entry)
    let buf = ''
    toStation.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      if (!buf.includes('\n')) return
      requests.push(buf)
      if (behavior !== 'silent') fromStation.write(`${JSON.stringify(STATION_READ)}\n`)
    })
    const socket = Duplex.from({ writable: toStation, readable: fromStation })
    socket.on('close', () => { entry.closed = true })
    return socket
  })
  return {
    connect, requests,
    setBehavior: (b: Behavior) => { behavior = b },
    openCount: () => opened.length,
    allClosed: () => opened.every((o) => o.closed),
  }
}

function fakeContext(clock: ManualClock, config: Record<string, string> = {}): { ctx: PluginContext; ctrl: AbortController } {
  const ctrl = new AbortController()
  const ctx: PluginContext = {
    pluginId: 'comap', config: comapConfigSchema.parse({ COMAP_HOST: '192.168.1.50', ...config }), logger: pino({ level: 'silent' }), clock, signal: ctrl.signal,
    emitState: vi.fn(), setAvailable: vi.fn(), emitDevices: vi.fn(), emitScenes: vi.fn(), emitSceneState: vi.fn(), emitEvent: vi.fn(),
    parts: {}, site: { lat: 47.3, lon: 5.05, alt: 180 },
  }
  return { ctx, ctrl }
}

const patches = (ctx: PluginContext, externalId: string) =>
  (ctx.emitState as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === externalId).map((c) => c[1] as Record<string, unknown>)

describe('comap plugin', () => {
  it('declares the station without reaching the network in discover(), then fills it in start()', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const station = fakeStation()
    const plugin = createComapPlugin({ connect: station.connect })
    await plugin.init(ctx)
    const descriptors = await plugin.discover()
    expect(descriptors).toEqual([{
      id: 'comap:station', pluginId: 'comap', externalId: 'station', kind: 'water', name: 'Station de filtration',
      capabilities: ['consumables', 'water_flow', 'water_usage', 'uv_lamp'], meta: { manufacturer: 'COMAP' },
    }])
    expect(station.connect).not.toHaveBeenCalled()

    await plugin.start()
    await flush()
    expect(patches(ctx, 'station').at(-1)).toEqual({
      prefilterPct: 95, carbon1Pct: 95, carbon2Pct: 95, uvLampPct: 96,
      uvOn: true, flowLph: 0, todayL: 412, weekL: 1210, monthL: 6980, warning: false, defect: false,
    })
    // le modèle, connu seulement après la première lecture, republie le descripteur
    expect(ctx.emitDevices).toHaveBeenCalledWith([expect.objectContaining({ meta: { manufacturer: 'COMAP', model: 'Proteo V3' } })])
    await plugin.stop()
  })

  it('opens one short connection per poll, and never keeps one open (the station allows a single connection)', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock, { COMAP_POLL_MS: '30000' })
    const station = fakeStation()
    const plugin = createComapPlugin({ connect: station.connect })
    await plugin.init(ctx)
    await plugin.discover()
    await plugin.start()
    await flush()
    expect(station.openCount()).toBe(1)
    expect(station.allClosed()).toBe(true)
    expect(station.requests[0]).toContain('"read":["status","about","alert","config","consumption","flow","lamp","rtc","wear"]')

    clock.advance(30_000)
    await flush()
    expect(station.openCount()).toBe(2)
    expect(station.allClosed()).toBe(true)
    await plugin.stop()
  })

  it('tolerates a few consecutive silent reads (another connection busy on the station) before going unavailable', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock, { COMAP_POLL_MS: '30000', COMAP_TIMEOUT_MS: '5000' })
    const station = fakeStation()
    station.setBehavior('silent')
    const plugin = createComapPlugin({ connect: station.connect })
    await plugin.init(ctx)
    await plugin.discover()
    await plugin.start()

    // trois échecs de suite : les deux premiers ne rendent pas la station indisponible
    for (let i = 0; i < 3; i++) {
      clock.advance(5000); await flush()                    // le timeout de lecture se déclenche
      expect(plugin.health!()).toMatchObject({ status: i < 2 ? 'ok' : 'degraded' })
      if (i < 2) {
        expect(ctx.setAvailable).not.toHaveBeenCalled()
        clock.advance(10_000); await flush()                // laisse le backoff du poller relancer une tentative
      }
    }
    expect(ctx.setAvailable).toHaveBeenCalledWith('station', false)
    expect(ctx.setAvailable).toHaveBeenCalledTimes(1)
    expect(station.allClosed()).toBe(true)                  // même en échec, la connexion est refermée

    // la station se libère : une lecture qui aboutit efface le compteur d'échecs
    station.setBehavior('reply')
    clock.advance(10_000)
    await flush()
    expect(patches(ctx, 'station').length).toBeGreaterThan(0)
    expect(plugin.health!()).toMatchObject({ status: 'ok' })
    await plugin.stop()
  })

  it('refuses every command: the station is read-only', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const plugin = createComapPlugin({ connect: fakeStation().connect })
    await plugin.init(ctx)
    await expect(plugin.execute('station', { type: 'water.foo' } as never)).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
  })

  it('forgets everything on restart: model and failure count do not survive stop() (closure pitfall)', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const station = fakeStation()
    const plugin = createComapPlugin({ connect: station.connect })
    await plugin.init(ctx)
    await plugin.discover()
    await plugin.start()
    await flush()
    expect(plugin.health!()).toMatchObject({ detail: 'Proteo (Proteo V3)' })
    await plugin.stop()

    // redémarrage : un nouveau contexte, comme le ferait l'hôte après un changement de réglages
    const { ctx: ctx2 } = fakeContext(clock)
    await plugin.init(ctx2)
    const descriptors = await plugin.discover()
    expect(descriptors[0]!.meta.model).toBeUndefined()       // pas le modèle du tour précédent
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: 'Proteo' })
  })

  it('defaults to a read-only poll on the LAN, no auth key, and no station address', () => {
    const config = comapConfigSchema.parse({})
    expect(config).toEqual({
      COMAP_PORT: 23, COMAP_POLL_MS: 30_000, COMAP_TIMEOUT_MS: 5000,
      COMAP_HISTORY_FILE: expect.stringContaining('comap-consumption.json'),
    })
  })

  it('without COMAP_HOST, declares nothing, never connects, and says what is missing', async () => {
    const clock = new ManualClock(0)
    const ctrl = new AbortController()
    const ctx: PluginContext = { ...fakeContext(clock).ctx, config: comapConfigSchema.parse({}), signal: ctrl.signal }
    const station = fakeStation()
    const plugin = createComapPlugin({ connect: station.connect, historyStore: { load: async () => null, save: async () => {} } })
    await plugin.init(ctx)
    expect(await plugin.discover()).toEqual([])
    await plugin.start()
    for (let i = 0; i < 10; i++) { clock.advance(30_000); await flush() }
    expect(station.openCount()).toBe(0)
    expect(ctx.emitState).not.toHaveBeenCalled()
    expect(ctx.setAvailable).not.toHaveBeenCalled()             // pas de poller qui échoue en boucle
    expect(plugin.health!()).toEqual({ status: 'error', detail: 'set COMAP_HOST to the station address' })
  })

  it('serves the consumption history it has already built, never a fresh read', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const plugin = createComapPlugin({ connect: fakeStation().connect, historyStore: { load: async () => null, save: async () => {} } })
    await plugin.init(ctx)
    await plugin.discover()
    await plugin.start()
    await flush()

    const consumption = await plugin.consumption!('station')
    // premier sondage : pose la référence, un seul point journalier (`day` est déjà un cumul), pas d'horaire
    expect(consumption.hourly).toEqual([])
    expect(consumption.daily).toEqual([{ t: new Date(2026, 8, 16).getTime(), litres: 412 }])
    // mensuel : dérivé de `year`/`month` de la fixture, jamais un nouvel appel à la station
    expect(consumption.monthly).toHaveLength(9) // janvier à septembre (rtc.date = [16, 9, 2026])
    expect(consumption.monthly.at(-1)).toEqual({ t: new Date(2026, 8, 1).getTime(), litres: 6980 })
    await plugin.stop()
  })

  it('refuses an unknown external id', async () => {
    const clock = new ManualClock(0)
    const { ctx } = fakeContext(clock)
    const plugin = createComapPlugin({ connect: fakeStation().connect })
    await plugin.init(ctx)
    await expect(plugin.consumption!('not-the-station')).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
  })

  it('the consumption history survives a restart (read back from its file), unlike the delta cursor', async () => {
    const clock = new ManualClock(0)
    let saved: ComapHistoryState | null = null
    const historyStore = { load: async () => saved, save: async (h: ComapHistoryState) => { saved = h } }

    const ctx1 = fakeContext(clock).ctx
    const station = fakeStation()
    const plugin = createComapPlugin({ connect: station.connect, historyStore })
    await plugin.init(ctx1)
    await plugin.discover()
    await plugin.start()
    await flush()
    expect((await plugin.consumption!('station')).daily).toEqual([{ t: new Date(2026, 8, 16).getTime(), litres: 412 }])
    await plugin.stop()

    // redémarrage : nouveau contexte, MÊME fichier d'historique (simulé par `historyStore`)
    const ctx2 = fakeContext(clock).ctx
    await plugin.init(ctx2)
    // l'historique déjà connu revient immédiatement, sans attendre un nouveau sondage
    expect((await plugin.consumption!('station')).daily).toEqual([{ t: new Date(2026, 8, 16).getTime(), litres: 412 }])
    await plugin.stop()
  })
})
