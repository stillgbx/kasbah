import { describe, expect, it } from 'vitest'
import { applyReading, DAILY_POINTS_MAX, HOURLY_POINTS_MAX, monthlyOf, readingAt, type ComapHistoryCursor } from './history'
import { EMPTY_HISTORY, type ComapHistoryState } from './state'

// Pure functions: no system clock, no file — a state before, a state after. Instants are built with
// `readingAt`/`new Date(y, m-1, d, ...)`, never hard-coded ms constants, to stay independent of the
// time zone the tests run in (see `history.ts`).

const at = (d: number, m: number, y: number, h: number, min = 0) => readingAt({ date: [d, m, y], time: [h, min] })

describe('comap history: readingAt', () => {
  it('places the reading at the local instant rtc designates', () => {
    expect(at(16, 9, 2026, 22, 51)).toBe(new Date(2026, 8, 16, 22, 51).getTime())
  })
})

describe('comap history: applyReading — daily', () => {
  it("the very first reading sets the reference and opens the day's point, with no hourly history", () => {
    const { state, cursor } = applyReading(EMPTY_HISTORY, undefined, { day: 68, at: at(17, 9, 2026, 8, 30) })
    expect(state.daily).toEqual([{ t: new Date(2026, 8, 17).getTime(), litres: 68 }])
    expect(state.hourly).toEqual([])
    expect(cursor).toEqual({ at: at(17, 9, 2026, 8, 30), day: 68 })
  })

  it("a following reading, same day: the day's point is updated (day is already an absolute total)", () => {
    const first = applyReading(EMPTY_HISTORY, undefined, { day: 68, at: at(17, 9, 2026, 8, 30) })
    const second = applyReading(first.state, first.cursor, { day: 134, at: at(17, 9, 2026, 9, 0) })
    expect(second.state.daily).toEqual([{ t: new Date(2026, 8, 17).getTime(), litres: 134 }])
  })

  it("crossing midnight: a new day point, the previous day's stays frozen at its last value", () => {
    const evening = applyReading(EMPTY_HISTORY, undefined, { day: 412, at: at(16, 9, 2026, 23, 50) })
    const afterMidnight = applyReading(evening.state, evening.cursor, { day: 7, at: at(17, 9, 2026, 0, 5) })
    expect(afterMidnight.state.daily).toEqual([
      { t: new Date(2026, 8, 16).getTime(), litres: 412 },
      { t: new Date(2026, 8, 17).getTime(), litres: 7 },
    ])
  })

  it('caps at 62 points, dropping the oldest', () => {
    let history: ComapHistoryState = EMPTY_HISTORY
    let cursor: ComapHistoryCursor | undefined
    for (let day = 1; day <= DAILY_POINTS_MAX + 5; day++) {
      const applied = applyReading(history, cursor, { day: 10, at: at(1, 1, 2026 + day, 12, 0) })
      history = applied.state
      cursor = applied.cursor
    }
    expect(history.daily).toHaveLength(DAILY_POINTS_MAX)
    expect(history.daily[0]!.t).toBe(new Date(2032, 0, 1).getTime()) // the first 5 years have dropped out
  })
})

describe('comap history: applyReading — hourly', () => {
  it('two readings in the same hour: the delta accumulates in the open point', () => {
    const first = applyReading(EMPTY_HISTORY, undefined, { day: 100, at: at(17, 9, 2026, 8, 10) })
    const second = applyReading(first.state, first.cursor, { day: 106, at: at(17, 9, 2026, 8, 40) })
    expect(second.state.hourly).toEqual([{ t: new Date(2026, 8, 17, 8).getTime(), litres: 6 }])
    const third = applyReading(second.state, second.cursor, { day: 110, at: at(17, 9, 2026, 8, 55) })
    expect(third.state.hourly).toEqual([{ t: new Date(2026, 8, 17, 8).getTime(), litres: 10 }])
  })

  it('hour change: the straddling delta is credited entirely to the hour that opens', () => {
    const h8 = applyReading(EMPTY_HISTORY, undefined, { day: 96, at: at(17, 9, 2026, 8, 10) })
    const h8b = applyReading(h8.state, h8.cursor, { day: 100, at: at(17, 9, 2026, 8, 55) })
    const h9 = applyReading(h8b.state, h8b.cursor, { day: 104, at: at(17, 9, 2026, 9, 2) })
    expect(h9.state.hourly).toEqual([
      { t: new Date(2026, 8, 17, 8).getTime(), litres: 4 },  // the delta 96->100, entirely WITHIN hour 8-9
      { t: new Date(2026, 8, 17, 9).getTime(), litres: 4 },  // the delta 100->104 straddles 8:55-9:02, credited to 9:00
    ])
  })

  it('the very first reading of an hour yields no point: no previous one to know what was consumed before it', () => {
    const first = applyReading(EMPTY_HISTORY, undefined, { day: 100, at: at(17, 9, 2026, 8, 55) })
    const second = applyReading(first.state, first.cursor, { day: 104, at: at(17, 9, 2026, 9, 2) })
    // the 8:00-9:00 hour got a single reading (the very first, with no previous one): it is ABSENT
    expect(second.state.hourly.some((p) => p.t === new Date(2026, 8, 17, 8).getTime())).toBe(false)
    expect(second.state.hourly).toEqual([{ t: new Date(2026, 8, 17, 9).getTime(), litres: 4 }])
  })

  it("crossing midnight: the new hour's delta is the new day's total, never a negative", () => {
    const evening = applyReading(EMPTY_HISTORY, undefined, { day: 412, at: at(16, 9, 2026, 23, 50) })
    const afterMidnight = applyReading(evening.state, evening.cursor, { day: 7, at: at(17, 9, 2026, 0, 5) })
    const midnightHour = afterMidnight.state.hourly.find((p) => p.t === new Date(2026, 8, 17, 0).getTime())
    expect(midnightHour).toEqual({ t: new Date(2026, 8, 17, 0).getTime(), litres: 7 })
    expect(afterMidnight.state.hourly.every((p) => p.litres >= 0)).toBe(true)
  })

  it('gap of more than an hour between two readings: the resuming hour restarts from zero, no invented spike', () => {
    const before = applyReading(EMPTY_HISTORY, undefined, { day: 50, at: at(17, 9, 2026, 8, 0) })
    // the server (or the station) stayed unreachable from 8:00 to 11:00: 30 L consumed in between
    const after = applyReading(before.state, before.cursor, { day: 80, at: at(17, 9, 2026, 11, 5) })
    expect(after.state.hourly).toEqual([{ t: new Date(2026, 8, 17, 11).getTime(), litres: 0 }])
    // hours 8:00, 9:00, 10:00 stay ABSENT: never a zero that would claim "nothing consumed"
    expect(after.state.hourly.some((p) => p.t === new Date(2026, 8, 17, 8).getTime())).toBe(false)
  })

  it('the next hour after a gap resumes normally (the cursor was indeed updated)', () => {
    const before = applyReading(EMPTY_HISTORY, undefined, { day: 50, at: at(17, 9, 2026, 8, 0) })
    const gap = applyReading(before.state, before.cursor, { day: 80, at: at(17, 9, 2026, 11, 5) })
    const next = applyReading(gap.state, gap.cursor, { day: 85, at: at(17, 9, 2026, 11, 20) })
    expect(next.state.hourly.find((p) => p.t === new Date(2026, 8, 17, 11).getTime())).toEqual({ t: new Date(2026, 8, 17, 11).getTime(), litres: 5 })
  })

  it('caps at 48 points, dropping the oldest hours', () => {
    let history: ComapHistoryState = EMPTY_HISTORY
    let cursor: ComapHistoryCursor | undefined
    for (let h = 0; h < HOURLY_POINTS_MAX + 5; h++) {
      const applied = applyReading(history, cursor, { day: h, at: at(17, 9, 2026, h % 24, 30) + Math.floor(h / 24) * 86_400_000 })
      history = applied.state
      cursor = applied.cursor
    }
    expect(history.hourly).toHaveLength(HOURLY_POINTS_MAX)
  })
})

describe('comap history: monthlyOf', () => {
  it('the current month comes from `month`, never from `year` (where it is 0 until it closes)', () => {
    const rtc = { date: [17, 9, 2026] as const }
    const year = [10500, 9800, 10200, 11900, 10400, 10100, 11600, 7500, 0, 0, 0, 0]
    const points = monthlyOf(rtc, 7545, year)
    expect(points).toHaveLength(9) // January to September, index 0 to 8
    expect(points[8]).toEqual({ t: new Date(2026, 8, 1).getTime(), litres: 7545 })
    expect(points[0]).toEqual({ t: new Date(2026, 0, 1).getTime(), litres: 10500 })
  })

  it('months not yet started stay absent, not at zero', () => {
    const rtc = { date: [1, 2, 2026] as const } // February: a single closed month before the current one
    const points = monthlyOf(rtc, 500, [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(points).toEqual([
      { t: new Date(2026, 0, 1).getTime(), litres: 1000 },
      { t: new Date(2026, 1, 1).getTime(), litres: 500 },
    ])
  })
})
