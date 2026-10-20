import { describe, expect, it } from 'vitest'
import { frenchAverageDailyLitres, frenchAverageReference } from './consumption'

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
