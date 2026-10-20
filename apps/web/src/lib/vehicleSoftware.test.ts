import { describe, expect, it } from 'vitest'
import { dayOf, delayUntil } from './vehicleSoftware'

// LOCAL hours: we build the dates as the user reads them, whatever the machine's time zone.
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime()

describe('scheduling an installation', () => {
  it('a time not yet passed falls today, a time passed tomorrow', () => {
    expect(delayUntil('02:00', at(2, 1, 30))).toBe(30 * 60)
    expect(delayUntil('02:00', at(2, 14))).toBe(12 * 3600)
  })
  it('to the millisecond, the delay lands AT the chosen time, not a second before', () => {
    const now = at(2, 1, 30) + 400
    const target = new Date(now + delayUntil('02:00', now) * 1000)
    expect([target.getHours(), target.getMinutes()]).toEqual([2, 0])
  })
  it('the current time means tomorrow: "now" is another button', () => {
    expect(delayUntil('14:00', at(2, 14))).toBe(24 * 3600)
  })
  it('today, tomorrow, later', () => {
    expect(dayOf(at(2, 23), at(2, 8))).toBe('today')
    expect(dayOf(at(3, 2), at(2, 23))).toBe('tomorrow')
    expect(dayOf(at(5, 2), at(2, 23))).toBe('later')
  })
})
