import { describe, expect, it } from 'vitest'
import { deviceEnergyDaysSchema, deviceStateSchema, weatherForecastSchema, type StateFor, type StatePatch } from '@kasbah/shared'
import { ManualClock } from './clock'
import { Simulation } from './simulation'
import { SimError } from './types'
import { SCENARIOS } from './scenarios'

// Monday, September 7, 2026, 00:00 UTC, timezone 0 → local hours = UTC.
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
    expect(light).toBeUndefined()                       // a light that is off does not change
    const sensor = patches.find(([id]) => id === 'sensor-outdoor-temp')
    expect(sensor?.[1]).toHaveProperty('value')
    sim.stop()
  })

  it('a field removed from the state is emitted as null, so the client clears it', async () => {
    const sim = make()
    const patches: StatePatch[] = []
    sim.start((id, p) => { if (id === 'vehicle-tesla') patches.push(p) })
    sim.tick(1)
    expect(sim.getState('vehicle-tesla')).toHaveProperty('chargeMinutesRemaining')   // charging at midnight
    await sim.execute('vehicle-tesla', { type: 'vehicle.stop_charge' })
    sim.tick(1)
    expect(sim.getState('vehicle-tesla')).not.toHaveProperty('chargeMinutesRemaining')
    expect(patches.some((p) => (p as Record<string, unknown>).chargeMinutesRemaining === null)).toBe(true)
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

  it('favorite position: recall, then rewrite that moves nothing', async () => {
    const sim = make()
    // `cover-living` stores 27; the recall drives the cover there
    expect(sim.getState('cover-living')).toMatchObject({ presetPosition: 27 })
    await sim.execute('cover-living', { type: 'cover.preset' })
    for (let i = 0; i < 20; i++) sim.tick(1)
    expect(sim.getState('cover-living')).toMatchObject({ motion: 'stopped', position: 27 })

    // rewriting the memory is a SETTING: the state changes, the cover does not move
    await sim.execute('cover-living', { type: 'cover.set_preset', position: 60 })
    expect(sim.getState('cover-living')).toMatchObject({ presetPosition: 60, position: 27, motion: 'stopped' })
    // and the recall now follows the NEW value
    await sim.execute('cover-living', { type: 'cover.preset' })
    for (let i = 0; i < 20; i++) sim.tick(1)
    expect(sim.getState('cover-living')).toMatchObject({ position: 60 })

    // a shutter without memory refuses both commands
    await expect(sim.execute('cover-kitchen', { type: 'cover.preset' })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
    await expect(sim.execute('cover-kitchen', { type: 'cover.set_preset', position: 50 })).rejects.toMatchObject({ code: 'UNSUPPORTED_COMMAND' })
  })

  it('each cover DECLARES its kind, and the device set covers the three cases that diverge', () => {
    const covers = make().devices().filter((d) => d.kind === 'cover')
    // No silent cover: without `meta.cover.deviceClass`, everything that is decided on the kind of a
    // cover on the interface side (words, drawn shape, global gesture, list to assign) falls back on
    // the shutter case, and becomes unverifiable in simulation.
    for (const d of covers) expect(d.meta.cover?.deviceClass, d.externalId).toBeDefined()
    // The three cases that do NOT behave the same: the shutter, the awning (other words, flat shape,
    // inverted rest) and the gate (no global gesture, expects no opening).
    const classes = covers.map((d) => d.meta.cover?.deviceClass)
    expect(classes).toEqual(expect.arrayContaining(['shutter', 'awning', 'gate']))
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
    sim.tick(1.5 * 3600)                                    // 09:30, on the road / arrived
    const after = sim.getState('vehicle-tesla') as StateFor<'vehicle'>
    expect(after.pluggedIn).toBe(false)
    expect(after.soc).toBeLessThan(before.soc)
    expect(after.location!.lat).not.toBeCloseTo(before.location!.lat, 4)
    expect(sim.getState('charger-home')).toMatchObject({ status: 'disconnected', powerW: 0 })
  })

  it('mower follows its weekday schedule and moves within its area', () => {
    const sim = make()
    sim.tick(10.5 * 3600)                                   // Monday 10:30
    const m = sim.getState('mower-automower') as StateFor<'mower'>
    expect(m.activity).toBe('mowing')
    expect(m.position![0]).toBeGreaterThanOrEqual(-1)
    expect(m.position![0]).toBeLessThanOrEqual(26)
    sim.tick(2 * 3600)                                      // 12:30 → back home / charging
    expect(['returning', 'charging', 'parked']).toContain((sim.getState('mower-automower') as StateFor<'mower'>).activity)
  })

  it('chaos scenario flips availability and fails some commands', async () => {
    // slowRate 0: the simulated latency waits for the manual clock, which does not advance during an await
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

  it("hiddenFor takes away what belongs to the installation of the excluded kind", () => {
    const sim = make()
    const kinds = (ids: Set<string>) => new Set([...sim.devices()].filter((d) => ids.has(d.externalId)).map((d) => d.kind))

    // nothing excluded: nothing hidden
    expect(sim.hiddenFor([]).size).toBe(0)

    // a panel is a `sensor`, but it belongs to the solar installation: excluding `energy`
    // takes away the site AND the twenty panels, without touching the other simulated sensors
    const solar = sim.hiddenFor(['energy'])
    expect(kinds(solar)).toEqual(new Set(['energy', 'sensor']))
    expect([...solar].filter((id) => id.startsWith('panel-'))).toHaveLength(20)
    expect(solar.has('energy-site')).toBe(true)
    expect(solar.has('sensor-pool-temp')).toBe(false)          // the pool stays simulated

    // excluding `sensor` does remove all the sensors, panels included
    const sensors = sim.hiddenFor(['sensor'])
    expect(sensors.has('sensor-pool-temp')).toBe(true)
    expect(sensors.has('energy-site')).toBe(false)
  })

  it('runs on the injected clock with time scale', () => {
    const clock = new ManualClock(MONDAY)
    const sim = make({ clock, timeScale: 60 })
    sim.start(() => {})
    clock.advance(60_000)                                   // 1 real min = 1 simulated h
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
    // Monday September 7, local midnight: night, and the simulated world's sunrise/sunset frame the day
    expect(s.isDay).toBe(false)
    expect(s.sunrise).toBe(MONDAY + 6 * 3_600_000)
    expect(s.sunset).toBe(MONDAY + 20 * 3_600_000)
    expect(s.pollen).toMatchObject({ ragweed: 3 })          // September: ragweed
    sim.tick(13 * 3600)
    const noon = sim.getState('weather') as StateFor<'weather'>
    expect(noon.isDay).toBe(true)
    expect(noon.tempC).toBeGreaterThan(s.tempC)
    expect(deviceStateSchema.parse(noon)).toEqual(noon)
  })

  // The world drifts at every step; the weather, for its part, is re-read every 20 s of REAL time, whatever
  // the acceleration. Published at every step, it redid the sky of the 3D scene every second.
  it('publishes the weather every 20 real seconds, whatever the time scale', () => {
    const sim = make({ timeScale: 30 })
    const observed = () => (sim.getState('weather') as StateFor<'weather'>).observedAt
    const first = observed()
    sim.tick(19 * 30)                                       // 19 real s at ×30
    expect(observed()).toBe(first)
    sim.tick(2 * 30)                                        // past the 20 s
    const second = observed()
    expect(second).toBeGreaterThan(first)
    sim.tick(10 * 30)
    expect(observed()).toBe(second)
  })

  it('software update: refused asleep, scheduled once awake, installed at its time, then the notes move to the history', async () => {
    const sim = make()
    const tesla = () => sim.getState('vehicle-tesla') as StateFor<'vehicle'>
    expect(tesla()).toMatchObject({ softwareVersion: '2026.32.7', softwareUpdate: { status: 'available', version: '2026.38' } })
    expect(sim.releaseNotes('vehicle-tesla')).toMatchObject({ installedVersion: '2026.32.7', pending: { version: '2026.38' } })
    // at midnight it charges, so it stays awake: once the charge is stopped, it falls asleep
    await sim.execute('vehicle-tesla', { type: 'vehicle.stop_charge' })
    sim.tick(1)
    expect(tesla().sleepState).toBe('asleep')
    await expect(sim.execute('vehicle-tesla', { type: 'vehicle.schedule_update', delayS: 60 })).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' })
    await sim.execute('vehicle-tesla', { type: 'vehicle.wake' })
    sim.tick(5)
    expect(tesla().sleepState).toBe('online')            // a wake-up lasts: there is time to act
    await sim.execute('vehicle-tesla', { type: 'vehicle.schedule_update', delayS: 60 })
    // 60 s requested, but no less than the two-minute countdown that a "now" also leaves
    expect(tesla().softwareUpdate).toMatchObject({ status: 'scheduled', scheduledAt: MONDAY + 126_000 })
    sim.tick(121)
    expect(tesla().softwareUpdate).toMatchObject({ status: 'installing', installPct: 0 })
    sim.tick(600)
    expect(tesla().softwareUpdate?.installPct).toBeGreaterThan(40)
    sim.tick(700)
    expect(tesla().softwareVersion).toBe('2026.38')
    expect(tesla().softwareUpdate).toBeUndefined()
    const notes = sim.releaseNotes('vehicle-tesla')
    expect(notes.pending).toBeUndefined()
    expect(notes.history.map((h) => h.version)).toEqual(['2026.38', '2026.32', '2026.26.6'])
    for (const [, s] of sim.states()) expect(deviceStateSchema.parse(s)).toEqual(s)
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

  it('gives the solar site over a year of daily totals that the shared schema accepts, today last and local', () => {
    const sim = make()
    const h = sim.energyDays('energy-site')
    expect(deviceEnergyDaysSchema.parse({ deviceId: 'mock:energy-site', ...h })).toBeTruthy()
    expect(h.days.length).toBeGreaterThan(365)
    expect(h.since).toBe(h.days[0]!.t)
    expect(h.days.at(-1)).toMatchObject({ source: 'local' })
    // each simulated panel gets its share of the site, day by day
    expect(h.inverters!.devices.length).toBeGreaterThan(0)
    expect(h.inverters!.devices[0]!.wh).toHaveLength(h.days.length)
    // the house is shared out without inventing energy: sun + battery + grid = what it took, at most
    for (const d of h.days) expect(d.solarHomeWh! + (d.batteryHomeWh ?? 0) + d.gridHomeWh!).toBeLessThanOrEqual(d.consumptionWh! + 1)
    expect(() => sim.energyDays('weather')).toThrow(SimError)
  })
})
