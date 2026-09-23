// Fuseau imposé : les échéances se raisonnent en heure murale locale. Node relit `TZ` à l'exécution ;
// la garde saute le fichier si la plateforme l'ignorait.
process.env.TZ = 'Europe/Paris'

import type { TimeTrigger } from '@kasbah/shared'
import { describe, expect, it } from 'vitest'
import { nextOccurrence } from './schedule'

const tzApplied = new Date(2026, 0, 1).getTimezoneOffset() === -60
const DIJON = { lat: 47.322, lon: 5.041 }
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const local = (t: number | undefined) => t === undefined ? undefined : new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
const clock = (time: string, extra: Partial<TimeTrigger> = {}): TimeTrigger => ({ type: 'time', at: { kind: 'clock', time }, ...extra })

describe.skipIf(!tzApplied)('nextOccurrence', () => {
  it('fires today when the time is still ahead, tomorrow otherwise', () => {
    expect(nextOccurrence(clock('07:30'), at(2026, 9, 22, 6), DIJON)).toBe(at(2026, 9, 22, 7, 30))
    expect(nextOccurrence(clock('07:30'), at(2026, 9, 22, 7, 30), DIJON)).toBe(at(2026, 9, 23, 7, 30))
  })

  it('skips to the next allowed weekday (the gate on Mondays and Fridays)', () => {
    // mardi 22/09/2026 → vendredi 25
    expect(nextOccurrence(clock('12:00', { days: [1, 5] }), at(2026, 9, 22, 13), DIJON)).toBe(at(2026, 9, 25, 12))
  })

  it('waits for the start of the date range and stops after its end', () => {
    const t = clock('12:00', { dateRange: { from: '2026-10-01', to: '2026-10-02' } })
    expect(nextOccurrence(t, at(2026, 9, 22), DIJON)).toBe(at(2026, 10, 1, 12))
    expect(nextOccurrence(t, at(2026, 10, 2, 13), DIJON)).toBeUndefined()
  })

  it('offsets a sun event and clamps it to notAfter', () => {
    // 21/06 à Dijon, crépuscule civil vers 22:20 : −15 min → 22:05, borné à 22:00
    const dusk: TimeTrigger = { type: 'time', at: { kind: 'sun', event: 'dusk', offsetMin: -15, notAfter: '22:00' } }
    expect(nextOccurrence(dusk, at(2026, 6, 21, 12), DIJON)).toBe(at(2026, 6, 21, 22))
    // 21/12, crépuscule vers 17:28 : −15 min ≈ 17:13, pas de bornage
    const winter = nextOccurrence(dusk, at(2026, 12, 21, 12), DIJON)!
    expect(Math.abs(winter - at(2026, 12, 21, 17, 13))).toBeLessThan(2 * 60_000)
  })

  it('raises a sun event to notBefore', () => {
    const sunrise: TimeTrigger = { type: 'time', at: { kind: 'sun', event: 'sunrise', notBefore: '07:00' } }
    expect(nextOccurrence(sunrise, at(2026, 6, 21, 1), DIJON)).toBe(at(2026, 6, 21, 7))
  })

  it('keeps the wall-clock time across the spring DST change', () => {
    // 29/03/2026 : 02:00 → 03:00. Ajouter 24 h à 07:30 la veille donnerait 08:30.
    expect(local(nextOccurrence(clock('07:30'), at(2026, 3, 28, 8), DIJON))).toBe('29/03/2026 07:30:00')
    // une heure qui n'existe pas ce jour-là tombe une seule fois, à 03:30
    expect(local(nextOccurrence(clock('02:30'), at(2026, 3, 29, 0), DIJON))).toBe('29/03/2026 03:30:00')
  })

  it('fires once on the autumn DST change', () => {
    const first = nextOccurrence(clock('02:30'), at(2026, 10, 25, 0), DIJON)!
    const second = nextOccurrence(clock('02:30'), first, DIJON)!
    expect(local(first)).toBe('25/10/2026 02:30:00')
    expect(local(second)).toBe('26/10/2026 02:30:00')
  })
})
