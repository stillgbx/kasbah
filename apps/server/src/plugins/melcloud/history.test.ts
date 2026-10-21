import { describe, expect, it } from 'vitest'
import { HOURLY_POINTS_MAX, HeatingHistory } from './history'
import type { SystemReading, ZoneReading } from './types'

// The history is BUILT here, for lack of a meter on the vendor's side. What it must hold up:
//
//  - count the HEATING, not being switched on. An Ecodan is `Power: true` almost all year round;
//    it is `idle` that tells an hour of heating from an hour of standby, and getting that wrong
//    would draw a flat line from January to December.
//  - tell the scale of each hour (`n`): an hour with three samples must not pass for an idle hour.
//  - invent nothing when the machine is offline.

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 0, 15, 8)

const system = (over: Partial<SystemReading> = {}): SystemReading => ({
  deviceId: '1', name: 'Chauffage', power: true, heating: false, offline: false, stale: false,
  outdoorTempC: 4, flowTempC: 38, returnTempC: 33, condensingTempC: 42, demandPercent: 100,
  defrosting: false, boosterHeater: false, immersionHeater: false, pumps: [true, false, false, false], valve3Way: false,
  error: { hasError: false, code: 8000, message: null },
  lastSeen: null, wifi: 'NORMAL', energyMeter: false,
  ...over,
})

const zone = (idle: boolean): ZoneReading => ({
  zone: 1, control: 'room', currentTempC: 19, targetTempC: 19.5,
  idle, heating: true, cooling: false, bounds: [0, 40], name: null,
})

describe('MELCloud — operating history', () => {
  it('files the samples by hour and rolls over on the hour', () => {
    const h = new HeatingHistory()
    expect(h.record(system(), [zone(false)], T0)).toBe(true)           // opens the hour
    expect(h.record(system(), [zone(false)], T0 + 120_000)).toBe(false)
    expect(h.record(system(), [zone(false)], T0 + HOUR)).toBe(true)    // next hour
    const pts = h.points()
    expect(pts).toHaveLength(2)
    expect(pts[0]).toMatchObject({ t: T0, n: 2, heating: 2 })
    expect(pts[1]).toMatchObject({ t: T0 + HOUR, n: 1 })
  })

  /** THE point of this file: switched on ≠ heating. */
  it('counts the heating, not being switched on', () => {
    const h = new HeatingHistory()
    h.record(system(), [zone(true)], T0)                  // on, idle
    h.record(system(), [zone(false)], T0 + 60_000)        // on, heating
    h.record(system({ power: false }), [zone(false)], T0 + 120_000)   // off
    expect(h.points()[0]).toMatchObject({ n: 3, heating: 1 })
  })

  /** A cascade: the units run while MELCloud keeps the zones idle; the machine's own state counts. */
  it('counts the machine heating even when the zones say idle', () => {
    const h = new HeatingHistory()
    h.record(system({ heating: true }), [zone(true)], T0)
    h.record(system(), [zone(true)], T0 + 60_000)
    expect(h.points()[0]).toMatchObject({ n: 2, heating: 1 })
  })

  it('counts defrost and electric backup heaters separately', () => {
    const h = new HeatingHistory()
    h.record(system({ defrosting: true }), [zone(false)], T0)
    h.record(system({ immersionHeater: true }), [zone(false)], T0 + 60_000)
    h.record(system({ boosterHeater: true }), [zone(false)], T0 + 120_000)
    expect(h.points()[0]).toMatchObject({ n: 3, defrost: 1, booster: 2 })
  })

  it('averages the hour’s temperatures', () => {
    const h = new HeatingHistory()
    h.record(system({ outdoorTempC: 2, flowTempC: 30 }), [zone(false)], T0)
    h.record(system({ outdoorTempC: 5, flowTempC: 35 }), [zone(false)], T0 + 60_000)
    expect(h.points()[0]).toMatchObject({ outdoorC: 3.5, flowC: 32.5 })
  })

  it('returns null for a temperature the machine never gave', () => {
    const h = new HeatingHistory()
    h.record(system({ outdoorTempC: null }), [zone(false)], T0)
    expect(h.points()[0]!.outdoorC).toBeNull()
  })

  /** A silent machine must not dig a hole that looks like an hour without heating. */
  it('opens no hour for a machine we no longer follow', () => {
    const h = new HeatingHistory()
    h.record(system({ stale: true }), [zone(false)], T0)
    expect(h.points()).toEqual([])
    h.record(system(), [zone(false)], T0)
    h.record(system({ stale: true }), [zone(false)], T0 + 60_000)
    expect(h.points()[0]).toMatchObject({ n: 1 })   // the silent sample is not counted
  })

  /**
   * `offline` is the vendor's flag, and it lies (see `mapping.ts`). The history must not get a hole
   * because MELCloud ticked a box while the machine was talking.
   */
  it('keeps recording a machine the vendor wrongly calls "offline"', () => {
    const h = new HeatingHistory()
    h.record(system({ offline: true, stale: false }), [zone(false)], T0)
    expect(h.points()[0]).toMatchObject({ n: 1, heating: 1 })
  })

  it('keeps only one week of hours', () => {
    const h = new HeatingHistory()
    for (let i = 0; i < HOURLY_POINTS_MAX + 20; i++) h.record(system(), [zone(false)], T0 + i * HOUR)
    const pts = h.points()
    expect(pts).toHaveLength(HOURLY_POINTS_MAX)
    expect(pts[0]!.t).toBe(T0 + 20 * HOUR)   // the oldest ones are gone
  })

  it('reads back from disk without losing what was there', () => {
    const h = new HeatingHistory()
    h.record(system(), [zone(false)], T0)
    h.record(system(), [zone(true)], T0 + 60_000)
    const again = new HeatingHistory(h.toState())
    expect(again.points()).toEqual(h.points())
    // and the current hour keeps accumulating after the read-back
    again.record(system(), [zone(false)], T0 + 120_000)
    expect(again.points()[0]).toMatchObject({ n: 3, heating: 2 })
  })
})
