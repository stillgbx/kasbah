import { describe, expect, it } from 'vitest'
import type { AgendaEvent } from '../api/transport'
import { byDay, dayKey, eventDays, layoutDay, shift, visibleDays } from './agenda'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const timed = (id: string, start: number, end: number): AgendaEvent => ({ id, calendarId: 'c', title: id, allDay: false, start, end })
const allDay = (id: string, start: string, end: string): AgendaEvent => ({ id, calendarId: 'c', title: id, allDay: true, start, end })

describe('agenda periods', () => {
  it('shows six weeks from the Monday before the first of the month', () => {
    const days = visibleDays('month', new Date(2026, 8, 27))
    expect(days).toHaveLength(42)
    expect(dayKey(days[0]!)).toBe('2026-08-31')
    expect(dayKey(days[41]!)).toBe('2026-10-11')
  })

  it('starts a week on Monday, even from a Sunday', () => {
    const days = visibleDays('week', new Date(2026, 8, 27))
    expect(days.map(dayKey)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'])
  })

  it('moves by a month from the end of a long month', () => {
    expect(dayKey(shift('month', new Date(2026, 0, 31), 1))).toBe('2026-02-01')
    expect(dayKey(shift('week', new Date(2026, 8, 27), -1))).toBe('2026-09-20')
    expect(dayKey(shift('day', new Date(2026, 11, 31), 1))).toBe('2027-01-01')
  })
})

describe('agenda days of an event', () => {
  it('spreads an all-day event up to its exclusive end, a night event over both days', () => {
    expect(eventDays(allDay('v', '2026-10-03', '2026-10-06'))).toEqual(['2026-10-03', '2026-10-04', '2026-10-05'])
    expect(eventDays(timed('n', at(2026, 10, 3, 22), at(2026, 10, 4, 2)))).toEqual(['2026-10-03', '2026-10-04'])
    // finir pile à minuit ne déborde pas sur le lendemain ; sans durée, reste dans son jour
    expect(eventDays(timed('m', at(2026, 10, 3, 20), at(2026, 10, 4)))).toEqual(['2026-10-03'])
    expect(eventDays(timed('z', at(2026, 10, 3, 9), at(2026, 10, 3, 9)))).toEqual(['2026-10-03'])
  })

  it('lists all-day events first on each day, then by time', () => {
    const map = byDay([timed('b', at(2026, 10, 4, 9), at(2026, 10, 4, 10)), allDay('a', '2026-10-03', '2026-10-05'), timed('c', at(2026, 10, 4, 8), at(2026, 10, 4, 9))])
    expect(map.get('2026-10-04')!.map((e) => e.id)).toEqual(['a', 'c', 'b'])
    expect(map.get('2026-10-03')!.map((e) => e.id)).toEqual(['a'])
  })
})

describe('agenda day layout', () => {
  it('shares the width only inside a group of overlapping events', () => {
    const day = new Date(2026, 9, 5)
    const placed = layoutDay([
      timed('a', at(2026, 10, 5, 9), at(2026, 10, 5, 11)),
      timed('b', at(2026, 10, 5, 10), at(2026, 10, 5, 12)),
      timed('c', at(2026, 10, 5, 11), at(2026, 10, 5, 11, 30)),
      timed('d', at(2026, 10, 5, 14), at(2026, 10, 5, 15)),
      allDay('x', '2026-10-05', '2026-10-06'),
    ], day)
    expect(placed.map((p) => [p.event.id, p.col, p.cols])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 2], ['d', 0, 1]])
  })

  it('clips a night event to the day and gives a short one a readable height', () => {
    const placed = layoutDay([timed('n', at(2026, 10, 4, 22), at(2026, 10, 5, 2)), timed('s', at(2026, 10, 5, 9), at(2026, 10, 5, 9, 5))], new Date(2026, 9, 5))
    expect(placed.map((p) => [p.event.id, p.startMin, p.endMin])).toEqual([['n', 0, 120], ['s', 540, 570]])
  })
})
