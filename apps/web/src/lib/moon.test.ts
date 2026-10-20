import { describe, expect, it } from 'vitest'
import { moonAltitude, moonIllumination, moonPhaseName, moonTimes, nextPhase } from './moon'

const H = 3_600_000
// Published instants (USNO): new moon of the April 8, 2024 eclipse, full moon of April 23, 2024.
const NEW_2024_04_08 = Date.UTC(2024, 3, 8, 18, 21)
const FULL_2024_04_23 = Date.UTC(2024, 3, 23, 23, 49)
const PARIS = { lat: 48.857, lon: 2.352 }

describe('moon', () => {
  it('lights the whole disc at full moon, not at all at new moon', () => {
    expect(moonIllumination(FULL_2024_04_23).fraction).toBeGreaterThan(0.99)
    expect(moonIllumination(NEW_2024_04_08).fraction).toBeLessThan(0.01)
    expect(moonPhaseName(moonIllumination(FULL_2024_04_23).phase)).toBe('full')
    expect(moonPhaseName(moonIllumination(NEW_2024_04_08).phase)).toBe('new')
  })

  it('waxes between new and full moon, wanes afterwards', () => {
    expect(moonPhaseName(moonIllumination(NEW_2024_04_08 + 4 * 24 * H).phase)).toBe('waxingCrescent')
    expect(moonPhaseName(moonIllumination(FULL_2024_04_23 + 4 * 24 * H).phase)).toBe('waningGibbous')
  })

  it('finds the published instants to within a few hours', () => {
    expect(Math.abs(nextPhase(NEW_2024_04_08 + 24 * H, 0.5) - FULL_2024_04_23)).toBeLessThan(6 * H)
    expect(Math.abs(nextPhase(FULL_2024_04_23 - 20 * 24 * H, 0) - NEW_2024_04_08)).toBeLessThan(6 * H)
  })

  it('gives a rise and a set, each at the horizon crossing, within 26 hours', () => {
    const from = Date.UTC(2024, 3, 23, 12)
    const { rise, set } = moonTimes(from, PARIS.lat, PARIS.lon)
    expect(rise).toBeDefined()
    expect(set).toBeDefined()
    for (const t of [rise!, set!]) {
      expect(t).toBeGreaterThan(from)
      expect(t).toBeLessThan(from + 26 * H)
    }
    // full moon: it rises around sunset (≈ 19 h UTC in Paris at the end of April)
    expect(Math.abs(rise! - Date.UTC(2024, 3, 23, 19))).toBeLessThan(2 * H)
    expect(moonAltitude(rise! + 20 * 60_000, PARIS.lat, PARIS.lon)).toBeGreaterThan(moonAltitude(rise! - 20 * 60_000, PARIS.lat, PARIS.lon))
    expect(moonAltitude(set! + 20 * 60_000, PARIS.lat, PARIS.lon)).toBeLessThan(moonAltitude(set! - 20 * 60_000, PARIS.lat, PARIS.lon))
  })
})
