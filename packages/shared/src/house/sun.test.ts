// Timezone imposed BEFORE any date computation: `sunTimes` slices the LOCAL day. Node re-reads `TZ` at
// run time; the guard below skips the file if the platform ignores it.
// (package without Node types: `process` goes through `globalThis`)
;(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Paris'

import { describe, expect, it } from 'vitest'
import { sunTimes } from './sun'

const tzApplied = new Date(2026, 0, 1).getTimezoneOffset() === -60
const DIJON = { lat: 47.322, lon: 5.041 }
const hm = (t: number | undefined) => t === undefined ? undefined
  : new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
/** Gap in minutes between an instant and a wall-clock hour of Paris the same day. */
const offBy = (t: number | undefined, day: Date, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const ref = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime()
  return t === undefined ? Infinity : Math.abs(t - ref) / 60_000
}

describe.skipIf(!tzApplied)('sunTimes', () => {
  // Reference: solar noon in Dijon at 13:41 CEST (longitude 5.04° E, equation of time −1.8 min)
  // and 15 h 56 of daylight at the solstice → sunrise 05:43, sunset 21:40.
  it('gives Dijon summer solstice times within two minutes', () => {
    const day = new Date(2026, 5, 21, 12)
    const s = sunTimes(day, DIJON.lat, DIJON.lon)
    expect(offBy(s.sunrise, day, '05:43')).toBeLessThan(2)
    expect(offBy(s.sunset, day, '21:40')).toBeLessThan(2)
    expect(s.dawn! < s.sunrise! && s.sunrise! < s.sunset! && s.sunset! < s.dusk!).toBe(true)
  })

  it('gives Dijon winter solstice times within two minutes', () => {
    const day = new Date(2026, 11, 21, 12)
    const s = sunTimes(day, DIJON.lat, DIJON.lon)
    expect(offBy(s.sunrise, day, '08:24')).toBeLessThan(2)
    expect(offBy(s.sunset, day, '16:52')).toBeLessThan(2)
  })

  it('has no passage during the polar day', () => {
    expect(sunTimes(new Date(2026, 5, 21, 12), 78, 15)).toEqual({})
  })

  // At 60° in June, the previous day's twilight falls after midnight: it must not be taken for
  // that of the day, which itself falls after the following midnight — hence absent.
  it('never returns the previous evening dusk after midnight', () => {
    const s = sunTimes(new Date(2026, 5, 21, 12), 60, 10)
    expect(hm(s.dawn)).toBe('02:09')
    expect(s.dusk === undefined || s.dusk > s.sunset!).toBe(true)
  })
})
