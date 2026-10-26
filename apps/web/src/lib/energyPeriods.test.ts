import { describe, expect, it } from 'vitest'
import type { DeviceEnergyDays, EnergyDay, StateFor } from '@kasbah/shared'
import { energyUnit, formatEnergyTotal, inverterPeaks, inverterTotals, mergeRecentDays, periodBars, periodStart, periodTotals } from './energyPeriods'

// Wednesday 2026-06-17, 15:00 local; days built with the Date constructor (any time zone).
const now = new Date(2026, 5, 17, 15).getTime()
const day = (d: number, m = 5, y = 2026) => new Date(y, m, d).getTime()
const local = (t: number, over: Partial<EnergyDay> = {}): EnergyDay => ({ t, source: 'local', productionWh: 1000, importWh: 100, ...over })

/** Every day from the 1st of January 2026 to today, 1 kWh produced each. */
const year = (() => {
  const out: EnergyDay[] = []
  for (const d = new Date(2026, 0, 1); d.getTime() <= now; d.setDate(d.getDate() + 1)) out.push(local(d.getTime()))
  return out
})()

describe('periodStart', () => {
  it('rolling: the last 7 and 31 days and 12 months, today included', () => {
    expect(periodStart('week', 'rolling', now, null)).toBe(day(11))
    expect(periodStart('month', 'rolling', now, null)).toBe(day(18, 4))
    expect(periodStart('year', 'rolling', now, null)).toBe(day(1, 6, 2025))
  })
  it('calendar: Monday, the 1st, the 1st of January', () => {
    expect(periodStart('week', 'calendar', now, null)).toBe(day(15))
    expect(periodStart('month', 'calendar', now, null)).toBe(day(1))
    expect(periodStart('year', 'calendar', now, null)).toBe(day(1, 0))
  })
  it('the day is today, the lifetime starts at the first day the vendor knows', () => {
    expect(periodStart('day', 'calendar', now, null)).toBe(day(17))
    expect(periodStart('lifetime', 'rolling', now, day(16, 10, 2025))).toBe(day(16, 10, 2025))
  })
})

describe('periodTotals', () => {
  it('adds up the days of the period, field by field; a field no day carries stays absent', () => {
    const t = periodTotals(year, 'week', 'calendar', now, null)
    expect(t).toEqual({ productionWh: 3000, importWh: 300, incomplete: false })
    expect(periodTotals(year, 'week', 'rolling', now, null).productionWh).toBe(7000)
    expect(periodTotals(year, 'month', 'calendar', now, null).productionWh).toBe(17_000)
  })

  it("today's production and consumption come from the live counters", () => {
    const live = { todayProductionWh: 4321, todayConsumptionWh: 1234 } as StateFor<'energy'>
    const t = periodTotals(year, 'day', 'rolling', now, null, live)
    expect(t).toMatchObject({ productionWh: 4321, consumptionWh: 1234, importWh: 100 })
  })

  it('a missing or partial day makes the period incomplete; the days before the first one known do not', () => {
    const holed = year.filter((d) => d.t !== day(16))
    expect(periodTotals(holed, 'week', 'calendar', now, null).incomplete).toBe(true)
    const partial = year.map((d) => (d.t === day(16) ? { ...d, partial: true } : d))
    expect(periodTotals(partial, 'week', 'calendar', now, null).incomplete).toBe(true)
    // history started on the 16th: the week is not "incomplete" for the days before
    const young = year.filter((d) => d.t >= day(16))
    expect(periodTotals(young, 'week', 'calendar', now, null).incomplete).toBe(false)
  })
})

describe('periodBars', () => {
  it('the calendar week reserves the days to come, empty', () => {
    const bars = periodBars(year, 'week', 'calendar', now, null)
    expect(bars.map((b) => b.wh)).toEqual([1000, 1000, 1000, null, null, null, null])
    expect(bars.map((b) => b.future)).toEqual([false, false, false, true, true, true, true])
  })

  it('the year sums the days into months', () => {
    const bars = periodBars(year, 'year', 'calendar', now, null)
    expect(bars).toHaveLength(12)
    expect(bars[0]!.wh).toBe(31_000)
    expect(bars[5]!.wh).toBe(17_000)
    expect(bars[6]).toMatchObject({ wh: null, future: true })
  })

  it('the lifetime runs month by month from the first one known, a month without data stays empty', () => {
    const days = [local(day(20, 10, 2025)), ...year]
    const bars = periodBars(days, 'lifetime', 'rolling', now, day(20, 10, 2025))
    expect(bars.map((b) => new Date(b.t).getMonth())).toEqual([10, 11, 0, 1, 2, 3, 4, 5])
    expect(bars[1]!.wh).toBeNull()
  })
})

describe('formatEnergyTotal', () => {
  it('kWh with a decimal, then whole kWh, then MWh from 1 000 kWh', () => {
    expect(formatEnergyTotal(950, 'en')).toBe('950 Wh')
    expect(formatEnergyTotal(12_340, 'en')).toBe('12.3 kWh')
    expect(formatEnergyTotal(923_100, 'en')).toBe('923 kWh')
    expect(formatEnergyTotal(4_699_000, 'en')).toBe('4.70 MWh')
    expect(formatEnergyTotal(17_171_000, 'en')).toBe('17.2 MWh')
  })
})

describe('inverterTotals', () => {
  // two inverters, the 14th to today (17th); the second missed the 16th
  const inv = { from: day(14), syncedAt: null, devices: [
    { externalId: 'A', lifetimeWh: 900_000, wh: [100, 200, 300, 400] },
    { externalId: 'B', wh: [110, 210, null, 410] },
  ] }

  it('adds up the days of the period, a missed day counts for nothing', () => {
    const week = inverterTotals(inv, 'week', 'calendar', now, null)
    expect(week.get('A')).toBe(900)   // Monday 15th → today
    expect(week.get('B')).toBe(620)
    expect(inverterTotals(inv, 'day', 'rolling', now, null).get('A')).toBe(400)
  })

  it("the lifetime is the inverter's own counter when the gateway gives it, the sum of its days otherwise", () => {
    const life = inverterTotals(inv, 'lifetime', 'rolling', now, day(14))
    expect(life.get('A')).toBe(900_000)
    expect(life.get('B')).toBe(730)
  })

  it('an inverter with nothing measured in the period is null, not zero', () => {
    const only = { from: day(14), syncedAt: null, devices: [{ externalId: 'C', wh: [5, null, null, null] }] }
    expect(inverterTotals(only, 'day', 'rolling', now, null).get('C')).toBeNull()
  })
})

describe('energyUnit', () => {
  it('picks the unit from the largest value, three significant figures', () => {
    expect(energyUnit(420)).toEqual({ unit: 'Wh', div: 1, digits: 0 })
    expect(energyUnit(23_600)).toEqual({ unit: 'kWh', div: 1000, digits: 1 })
    expect(energyUnit(428_000)).toEqual({ unit: 'kWh', div: 1000, digits: 0 })
    expect(energyUnit(1_430_000)).toEqual({ unit: 'MWh', div: 1_000_000, digits: 2 })
  })
})

describe('inverterPeaks', () => {
  // the 14th to today (17th): A peaked on the 14th, B has no peak known on the 16th
  const inv = { from: day(14), syncedAt: null, devices: [
    { externalId: 'A', wh: [1, 1, 1, 1], peakW: [320, 240, 180, 130] },
    { externalId: 'B', wh: [1, 1, 1, 1], peakW: [300, 250, null, 260] },
    { externalId: 'C', wh: [1, 1, 1, 1] },
  ] }

  it("the record of a period is the best daily peak inside it", () => {
    expect(inverterPeaks(inv, 'day', 'rolling', now, null).get('A')).toBe(130)
    const week = inverterPeaks(inv, 'week', 'calendar', now, null)   // Monday 15th → today
    expect(week.get('A')).toBe(240)
    expect(week.get('B')).toBe(260)
    expect(inverterPeaks(inv, 'lifetime', 'rolling', now, day(14)).get('A')).toBe(320)
  })

  it('an inverter without peaks has no record, not zero', () => {
    expect(inverterPeaks(inv, 'lifetime', 'rolling', now, null).get('C')).toBeNull()
    const quiet = { from: day(14), syncedAt: null, devices: [{ externalId: 'B', wh: [1, 1, 1, 1], peakW: [300, 250, null, null] }] }
    expect(inverterPeaks(quiet, 'day', 'rolling', now, null).get('B')).toBeNull()
  })
})

describe('mergeRecentDays', () => {
  // the whole history, the 14th to today (17th), then its last two days asked again a minute later
  const full: DeviceEnergyDays = {
    deviceId: 'site', since: day(14), syncedAt: 1,
    days: [14, 15, 16, 17].map((d) => local(day(d))),
    inverters: { from: day(14), syncedAt: 2, devices: [{ externalId: 'A', lifetimeWh: 900, wh: [1, 2, 3, 4], peakW: [10, 20, 30, 40] }] },
  }
  const recent: DeviceEnergyDays = {
    deviceId: 'site', since: day(14), syncedAt: 1,
    days: [local(day(16)), local(day(17), { productionWh: 1500 })],
    inverters: { from: day(16), syncedAt: 2, devices: [{ externalId: 'A', lifetimeWh: 950, wh: [3, 9], peakW: [30, 45] }] },
  }

  it('replaces the last days and keeps the past', () => {
    const m = mergeRecentDays(full, recent)!
    expect(m.days.map((d) => d.productionWh)).toEqual([1000, 1000, 1000, 1500])
    expect(m.inverters).toEqual({ from: day(14), syncedAt: 2, devices: [{ externalId: 'A', lifetimeWh: 950, wh: [1, 2, 3, 9], peakW: [10, 20, 30, 45] }] })
  })

  it('a whole history answered in place of the last days merges too (the in-process mock)', () => {
    expect(mergeRecentDays(full, full)).toEqual(full)
  })

  it('refuses what does not fit, so the caller reloads everything', () => {
    expect(mergeRecentDays(full, { ...recent, syncedAt: 3 })).toBeNull()                                   // a resync rewrote the past
    expect(mergeRecentDays(full, { ...recent, inverters: { ...recent.inverters!, syncedAt: 5 } })).toBeNull()
    const newcomer = { ...recent, inverters: { ...recent.inverters!, devices: [...recent.inverters!.devices, { externalId: 'B', wh: [1, 1], peakW: [5, 5] }] } }
    expect(mergeRecentDays(full, newcomer)).toBeNull()                                                     // an inverter appeared
    const tomorrow = { ...recent, inverters: { ...recent.inverters!, from: day(19) } }
    expect(mergeRecentDays(full, tomorrow)).toBeNull()                                                     // a gap: the day changed
    const firstPeaks = { ...full, inverters: { ...full.inverters!, devices: [{ externalId: 'A', wh: [1, 2, 3, 4] }] } }
    expect(mergeRecentDays(firstPeaks, recent)).toBeNull()                                                 // the first peaks arrived
  })
})
