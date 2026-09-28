import { describe, expect, it } from 'vitest'
import { moonAltitude, moonIllumination, moonPhaseName, moonTimes, nextPhase } from './moon'

const H = 3_600_000
// Instants publiés (USNO) : nouvelle lune de l'éclipse du 8 avril 2024, pleine lune du 23 avril 2024.
const NEW_2024_04_08 = Date.UTC(2024, 3, 8, 18, 21)
const FULL_2024_04_23 = Date.UTC(2024, 3, 23, 23, 49)
const PARIS = { lat: 48.857, lon: 2.352 }

describe('moon', () => {
  it('éclaire le disque en entier à la pleine lune, pas du tout à la nouvelle', () => {
    expect(moonIllumination(FULL_2024_04_23).fraction).toBeGreaterThan(0.99)
    expect(moonIllumination(NEW_2024_04_08).fraction).toBeLessThan(0.01)
    expect(moonPhaseName(moonIllumination(FULL_2024_04_23).phase)).toBe('full')
    expect(moonPhaseName(moonIllumination(NEW_2024_04_08).phase)).toBe('new')
  })

  it('croît entre la nouvelle et la pleine lune, décroît ensuite', () => {
    expect(moonPhaseName(moonIllumination(NEW_2024_04_08 + 4 * 24 * H).phase)).toBe('waxingCrescent')
    expect(moonPhaseName(moonIllumination(FULL_2024_04_23 + 4 * 24 * H).phase)).toBe('waningGibbous')
  })

  it('retrouve les instants publiés à quelques heures près', () => {
    expect(Math.abs(nextPhase(NEW_2024_04_08 + 24 * H, 0.5) - FULL_2024_04_23)).toBeLessThan(6 * H)
    expect(Math.abs(nextPhase(FULL_2024_04_23 - 20 * 24 * H, 0) - NEW_2024_04_08)).toBeLessThan(6 * H)
  })

  it('donne un lever et un coucher, chacun au passage de l’horizon, dans les 26 heures', () => {
    const from = Date.UTC(2024, 3, 23, 12)
    const { rise, set } = moonTimes(from, PARIS.lat, PARIS.lon)
    expect(rise).toBeDefined()
    expect(set).toBeDefined()
    for (const t of [rise!, set!]) {
      expect(t).toBeGreaterThan(from)
      expect(t).toBeLessThan(from + 26 * H)
    }
    // pleine lune : elle se lève vers le coucher du soleil (≈ 19 h UTC à Paris fin avril)
    expect(Math.abs(rise! - Date.UTC(2024, 3, 23, 19))).toBeLessThan(2 * H)
    expect(moonAltitude(rise! + 20 * 60_000, PARIS.lat, PARIS.lon)).toBeGreaterThan(moonAltitude(rise! - 20 * 60_000, PARIS.lat, PARIS.lon))
    expect(moonAltitude(set! + 20 * 60_000, PARIS.lat, PARIS.lon)).toBeLessThan(moonAltitude(set! - 20 * 60_000, PARIS.lat, PARIS.lon))
  })
})
