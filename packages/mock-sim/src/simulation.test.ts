import { describe, expect, it } from 'vitest'
import { deviceStateSchema, weatherForecastSchema, type StateFor, type StatePatch } from '@kasbah/shared'
import { ManualClock } from './clock'
import { Simulation } from './simulation'
import { SimError } from './types'
import { SCENARIOS } from './scenarios'

// Lundi 7 septembre 2026, 00:00 UTC, fuseau 0 → heures locales = UTC.
const MONDAY = Date.UTC(2026, 8, 7)
const make = (extra: Partial<ConstructorParameters<typeof Simulation>[0]> = {}) =>
  new Simulation({ scenario: 'default', seed: 7, startTime: MONDAY, tzOffsetMin: 0, clock: new ManualClock(MONDAY), ...extra })

describe('Simulation', () => {
  it('builds valid descriptors and states for the default scenario', () => {
    const sim = make()
    expect(sim.devices().length).toBeGreaterThan(15)
    for (const [, s] of sim.states()) expect(deviceStateSchema.parse(s)).toEqual(s)
    expect(sim.getState('light-living')?.kind).toBe('light')
  })

  it('is deterministic for a given seed', () => {
    const a = make(), b = make()
    a.tick(3600); b.tick(3600)
    expect([...a.states()]).toEqual([...b.states()])
  })

  it('emits only changed fields', () => {
    const sim = make()
    const patches: [string, StatePatch][] = []
    sim.start((id, p) => patches.push([id, p]))
    sim.tick(60)
    const light = patches.find(([id]) => id === 'light-living')
    expect(light).toBeUndefined()                       // une lampe éteinte ne change pas
    const sensor = patches.find(([id]) => id === 'sensor-outdoor-temp')
    expect(sensor?.[1]).toHaveProperty('value')
    sim.stop()
  })

  it('cover moves at 5 %/s, stop freezes it', async () => {
    const sim = make()
    await sim.execute('cover-living', { type: 'cover.close' })
    expect(sim.getState('cover-living')).toMatchObject({ motion: 'closing', position: 100 })
    for (let i = 0; i < 20; i++) sim.tick(1)
    expect(sim.getState('cover-living')).toMatchObject({ motion: 'stopped', position: 0 })
    await sim.execute('cover-living', { type: 'cover.set_position', position: 100 })
    for (let i = 0; i < 7; i++) sim.tick(1)
    await sim.execute('cover-living', { type: 'cover.stop' })
    expect(sim.getState('cover-living')).toMatchObject({ motion: 'stopped', position: 35 })
  })

  it('position favorite : rappel, puis reecriture qui ne deplace rien', async () => {
    const sim = make()
    // `cover-living` memorise 27 ; le rappel y conduit l'ouvrant
    expect(sim.getState('cover-living')).toMatchObject({ presetPosition: 27 })
    await sim.execute('cover-living', { type: 'cover.preset' })
    for (let i = 0; i < 20; i++) sim.tick(1)
    expect(sim.getState('cover-living')).toMatchObject({ motion: 'stopped', position: 27 })

    // reecrire la memoire est un REGLAGE : l'etat change, l'ouvrant ne bouge pas
    await sim.execute('cover-living', { type: 'cover.set_preset', position: 60 })
    expect(sim.getState('cover-living')).toMatchObject({ presetPosition: 60, position: 27, motion: 'stopped' })
    // et le rappel suit desormais la NOUVELLE valeur
    await sim.execute('cover-living', { type: 'cover.preset' })
    for (let i = 0; i < 20; i++) sim.tick(1)
    expect(sim.getState('cover-living')).toMatchObject({ position: 60 })

    // un volet sans memoire refuse les deux commandes
    await expect(sim.execute('cover-kitchen', { type: 'cover.preset' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(sim.execute('cover-kitchen', { type: 'cover.set_preset', position: 50 })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
  })

  it('light.set applies on/brightness/color and rejects other kinds', async () => {
    const sim = make()
    await sim.execute('light-living', { type: 'light.set', on: true, brightness: 55, color: { x: 0.2, y: 0.3 } })
    expect(sim.getState('light-living')).toMatchObject({ on: true, brightness: 55, color: { x: 0.2, y: 0.3 } })
    await sim.execute('light-living', { type: 'light.set', brightness: 0 })
    expect(sim.getState('light-living')).toMatchObject({ on: false })
    await expect(sim.execute('light-living', { type: 'cover.open' })).rejects.toBeInstanceOf(SimError)
    await expect(sim.execute('sensor-outdoor-temp', { type: 'cover.open' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(sim.execute('nope', { type: 'cover.open' })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
  })

  it('solar production is zero at night and positive at midday; energy balance holds', () => {
    const sim = make()
    sim.tick(2 * 3600)                                      // 02:00
    let e = sim.getState('energy-site') as StateFor<'energy'>
    expect(e.productionW).toBe(0)
    sim.tick(11 * 3600)                                     // 13:00
    e = sim.getState('energy-site') as StateFor<'energy'>
    expect(e.productionW).toBeGreaterThan(1000)
    for (let i = 0; i < 30; i++) {
      sim.tick(60)
      const s = sim.getState('energy-site') as StateFor<'energy'>
      expect(s.gridW).toBe(s.consumptionW - s.productionW + (s.batteryW ?? 0))
    }
  })

  it('vehicle leaves on a weekday morning and loses charge while driving', () => {
    const sim = make()
    sim.tick(8 * 3600)                                      // 08:00
    const before = sim.getState('vehicle-tesla') as StateFor<'vehicle'>
    expect(before.pluggedIn).toBe(true)
    sim.tick(1.5 * 3600)                                    // 09:30, en route / arrivé
    const after = sim.getState('vehicle-tesla') as StateFor<'vehicle'>
    expect(after.pluggedIn).toBe(false)
    expect(after.soc).toBeLessThan(before.soc)
    expect(after.location!.lat).not.toBeCloseTo(before.location!.lat, 4)
    expect(sim.getState('charger-home')).toMatchObject({ status: 'disconnected', powerW: 0 })
  })

  it('mower follows its weekday schedule and moves within its area', () => {
    const sim = make()
    sim.tick(10.5 * 3600)                                   // lundi 10:30
    const m = sim.getState('mower-automower') as StateFor<'mower'>
    expect(m.activity).toBe('mowing')
    expect(m.position![0]).toBeGreaterThanOrEqual(-1)
    expect(m.position![0]).toBeLessThanOrEqual(26)
    sim.tick(2 * 3600)                                      // 12:30 → rentrée / charge
    expect(['returning', 'charging', 'parked']).toContain((sim.getState('mower-automower') as StateFor<'mower'>).activity)
  })

  it('chaos scenario flips availability and fails some commands', async () => {
    // slowRate 0 : la latence simulée attend l'horloge manuelle, qui n'avance pas pendant un await
    const sim = make({ scenario: { ...SCENARIOS.chaos, chaos: { ...SCENARIOS.chaos.chaos!, slowRate: 0 } } })
    const flips: [string, boolean][] = []
    sim.start(() => {}, (id, a) => flips.push([id, a]))
    sim.tick(600)
    expect(flips.some(([, a]) => a === false)).toBe(true)
    expect(flips.some(([, a]) => a === true)).toBe(true)
    let failures = 0
    for (let i = 0; i < 60; i++) {
      try { await sim.execute('light-kitchen', { type: 'light.set', on: i % 2 === 0 }) }
      catch (e) { if ((e as SimError).code === 'UPSTREAM_ERROR') failures++ }
    }
    expect(failures).toBeGreaterThan(0)
    sim.stop()
  })

  it("hiddenFor emporte ce qui appartient a l'installation du kind exclu", () => {
    const sim = make()
    const kinds = (ids: Set<string>) => new Set([...sim.devices()].filter((d) => ids.has(d.externalId)).map((d) => d.kind))

    // rien d'exclu : rien de masque
    expect(sim.hiddenFor([]).size).toBe(0)

    // un panneau est un `sensor`, mais il appartient a l'installation solaire : exclure `energy`
    // emporte le site ET les vingt panneaux, sans toucher aux autres capteurs simules
    const solar = sim.hiddenFor(['energy'])
    expect(kinds(solar)).toEqual(new Set(['energy', 'sensor']))
    expect([...solar].filter((id) => id.startsWith('panel-'))).toHaveLength(20)
    expect(solar.has('energy-site')).toBe(true)
    expect(solar.has('sensor-pool-temp')).toBe(false)          // la piscine reste simulee

    // exclure `sensor` retire bien tous les capteurs, panneaux compris
    const sensors = sim.hiddenFor(['sensor'])
    expect(sensors.has('sensor-pool-temp')).toBe(true)
    expect(sensors.has('energy-site')).toBe(false)
  })

  it('runs on the injected clock with time scale', () => {
    const clock = new ManualClock(MONDAY)
    const sim = make({ clock, timeScale: 60 })
    sim.start(() => {})
    clock.advance(60_000)                                   // 1 min réelle = 1 h simulée
    expect(sim.simTime()).toBeCloseTo(MONDAY + 3_600_000, -2)
    sim.stop()
  })
})

describe('simulated weather', () => {
  it('publishes a valid weather state that follows the world', () => {
    const sim = make()
    const s = sim.getState('weather') as StateFor<'weather'>
    expect(s.kind).toBe('weather')
    expect(deviceStateSchema.parse(s)).toEqual(s)
    // lundi 7 septembre, minuit locale : nuit, et le lever/coucher du monde simulé encadrent la journée
    expect(s.isDay).toBe(false)
    expect(s.sunrise).toBe(MONDAY + 6 * 3_600_000)
    expect(s.sunset).toBe(MONDAY + 20 * 3_600_000)
    expect(s.pollen).toMatchObject({ ragweed: 3 })          // septembre : l'ambroisie
    sim.tick(13 * 3600)
    const noon = sim.getState('weather') as StateFor<'weather'>
    expect(noon.isDay).toBe(true)
    expect(noon.tempC).toBeGreaterThan(s.tempC)
    expect(deviceStateSchema.parse(noon)).toEqual(noon)
  })

  it('derives a forecast that the shared schema accepts, and refuses one for other kinds', () => {
    const sim = make()
    const f = sim.forecast('weather')
    expect(f.hourly).toHaveLength(24)
    expect(f.daily).toHaveLength(7)
    expect(f.hourly[0]!.t).toBeGreaterThanOrEqual(MONDAY)
    expect(f.daily[0]!.t).toBe(MONDAY)
    expect(weatherForecastSchema.parse({ deviceId: 'mock:weather', ...f })).toBeTruthy()
    expect(() => sim.forecast('light-living')).toThrow(SimError)
  })
})
