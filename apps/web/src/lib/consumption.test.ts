import { describe, expect, it } from 'vitest'
import { bucketSlots, frenchAverageDailyLitres, frenchAverageReference } from './consumption'

// French average consumption marker (SISPEA 2023, 145 L/person/day): pure functions,
// covered independently of the chart that displays them (see WaterConsumptionChart.vue).

describe('frenchAverageDailyLitres', () => {
  it('multiplies 145 L by the number of people', () => {
    expect(frenchAverageDailyLitres(1)).toBe(145)
    expect(frenchAverageDailyLitres(3)).toBe(435)
    expect(frenchAverageDailyLitres(10)).toBe(1450)
  })
})

describe('frenchAverageReference', () => {
  it("day: never a marker per bar — an hour does not consume a fixed share of the day", () => {
    expect(frenchAverageReference('day', 3)).toBeNull()
  })

  it('week and month: the same flat marker', () => {
    expect(frenchAverageReference('week', 3)).toBe(435)
    expect(frenchAverageReference('month', 3)).toBe(435)
    expect(frenchAverageReference('week', 3)).toBe(frenchAverageReference('month', 3))
  })

  it('year: a STRAIGHT LINE, N × 145 × 30.44 d (average month length) — February is a month like the others, no more staircase following the real number of days in the month', () => {
    expect(frenchAverageReference('year', 3)).toBeCloseTo(435 * 30.44, 5)
  })

  it('the marker grows with the household, never negative nor zero for a declared household', () => {
    expect(frenchAverageReference('month', 1)).toBeLessThan(frenchAverageReference('month', 5)!)
  })
})

describe('bucketSlots', () => {
  // The days the clocks change (Europe: last Sundays of March and October) have 23 or 25 wall-clock
  // hours. Under a zone without DST (UTC in CI) these cases pass anyway; they bite under Europe/Paris.
  it.each([
    ['clocks go back', new Date(2026, 9, 25, 13, 30)],
    ['clocks go forward', new Date(2026, 2, 29, 13, 30)],
  ])('the day keeps 24 real hours, one hour apart, the day the %s', (_, now) => {
    const hourStart = new Date(now).setMinutes(0, 0, 0)
    const points = Array.from({ length: 24 }, (_, i) => ({ t: hourStart - i * 3600_000, litres: 10 }))
    const slots = bucketSlots(points, 'day', now.getTime())
    expect(slots.slice(1).map((s, i) => s.t - slots[i]!.t)).toEqual(Array(23).fill(3600_000))
    expect(slots.filter((s) => s.litres !== null)).toHaveLength(24)
  })
})
