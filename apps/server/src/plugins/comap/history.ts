import type { ConsumptionPoint } from '@kasbah/shared'
import type { ComapHistoryState } from './state'

// Builds the consumption history from successive readings of `consumption` and `rtc` (the STATION's
// clock, source of truth for dating each reading — not the server's). PURE functions, no system
// clock or I/O: a state before, a state after.
//
// DAILY: `consumption.day` is already an absolute total since LOCAL midnight, reset by the station
// itself — a daily point is only ever a RE-READING of `day`, never a sum of deltas. The last value
// seen on a given day IS that day's total, whether it was read just before midnight or not: when
// the day changes, we simply stop updating its point and open a new one — no explicit "closing"
// step is needed.
//
// HOURLY: `day` only resets at midnight, not every hour — so the hour does not exist on the station
// side, it accumulates here delta by delta. A delta straddling an hour change is credited entirely
// to the hour that has just opened (the real error, at a polling rate of about a minute, is
// negligible). A gap of more than an hour between two readings, on the other hand, is TOO LONG to
// know in which hour the consumption happened: the hour opened on resuming restarts from zero
// rather than inheriting a delta that may not belong to it (no invented spike) — skipped hours stay
// ABSENT, never at zero.
//
// MONTHLY: see `monthlyOf`, below — never persisted, the station already provides it ready-made.

export const HOURLY_POINTS_MAX = 48
export const DAILY_POINTS_MAX = 62

const HOUR_MS = 3_600_000
/** Beyond this, we no longer know in which hour the observed consumption happened (see above). */
const MAX_BRIDGE_GAP_MS = HOUR_MS

/** A successful reading, reduced to what the history needs. */
export interface ComapReading {
  /** `consumption.day`: liters consumed since local midnight, according to the station. */
  day: number
  /** Instant of the reading (ms epoch) — see `readingAt`. */
  at: number
}

/**
 * What to keep from a reading to date and quantify the next one. NEVER persisted: a restart has no
 * previous reading (see `applyReading`), just like `model`/`failures` in `index.ts` — only the
 * points already computed (`ComapHistoryState`) survive a restart.
 */
export interface ComapHistoryCursor {
  at: number
  day: number
}

/**
 * `rtc.date`/`rtc.time` as the station returns them (`[day, month, year]`, `[hour, minute]`) → the
 * instant they designate, in the server's LOCAL time. Same assumption as Automower's default time
 * zone: the station is in the same house as the server reading it.
 */
export function readingAt(rtc: { date: readonly [number, number, number]; time: readonly [number, number] }): number {
  const [d, m, y] = rtc.date
  const [h, min] = rtc.time
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

function localDayStart(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function localHourStart(at: number): number {
  return Math.floor(at / HOUR_MS) * HOUR_MS
}

/** Replaces the last point if it already has this `t` (same time step), otherwise appends one — capped at `max`. */
function upsert(points: ConsumptionPoint[], t: number, litres: number, max: number): ConsumptionPoint[] {
  const last = points[points.length - 1]
  const next = last?.t === t ? [...points.slice(0, -1), { t, litres }] : [...points, { t, litres }]
  return next.length > max ? next.slice(next.length - max) : next
}

/** Adds `delta` to the last point if it already has this `t` (starts from 0 otherwise) — same cap as `upsert`. */
function addTo(points: ConsumptionPoint[], t: number, delta: number, max: number): ConsumptionPoint[] {
  const last = points[points.length - 1]
  return upsert(points, t, (last?.t === t ? last.litres : 0) + delta, max)
}

/**
 * Integrates a successful reading. `cursor` missing = no previous reading (the plugin's first poll,
 * or right after a restart): this reading then only sets the reference for the next one and yields
 * just a daily point — `day` being already a total, it needs no previous reading; `hourly` stays
 * unchanged (no delta can be computed without an earlier reading).
 */
export function applyReading(
  state: ComapHistoryState,
  cursor: ComapHistoryCursor | undefined,
  reading: ComapReading,
): { state: ComapHistoryState; cursor: ComapHistoryCursor } {
  const daily = upsert(state.daily, localDayStart(reading.at), reading.day, DAILY_POINTS_MAX)
  const nextCursor: ComapHistoryCursor = { at: reading.at, day: reading.day }

  if (!cursor) return { state: { hourly: state.hourly, daily }, cursor: nextCursor }

  const gapMs = reading.at - cursor.at
  const sameDay = localDayStart(reading.at) === localDayStart(cursor.at)
  // `day` resets at midnight: past the day change, the delta IS the new day's total (nothing to
  // subtract from a counter that no longer exists). `Math.max(0, …)` guards against a clock or a
  // counter going backwards without `rtc` noticing — never a negative delta published.
  const delta = Math.max(0, sameDay ? reading.day - cursor.day : reading.day)
  const hourStart = localHourStart(reading.at)
  const hourly = gapMs > MAX_BRIDGE_GAP_MS
    ? upsert(state.hourly, hourStart, 0, HOURLY_POINTS_MAX)
    : addTo(state.hourly, hourStart, delta, HOURLY_POINTS_MAX)

  return { state: { hourly, daily }, cursor: nextCursor }
}

/**
 * Monthly history: never persisted (see `state.ts`), the station already provides it ready-made.
 * `year[i]` for a CLOSED month, `month` (the running total) for the current month — which is 0 in
 * `year` until it is over, something only `month` can tell. Months not yet started (indexes after
 * the current month) stay ABSENT from the series: their 0 in `year` does not say "nothing
 * consumed", it says "has not happened yet".
 */
export function monthlyOf(rtc: { date: readonly [number, number, number] }, month: number, year: readonly number[]): ConsumptionPoint[] {
  const [, rtcMonth, rtcYear] = rtc.date
  const currentIndex = rtcMonth - 1
  const points: ConsumptionPoint[] = []
  for (let i = 0; i <= currentIndex && i < year.length; i++) {
    points.push({ t: new Date(rtcYear, i, 1).getTime(), litres: i === currentIndex ? month : year[i]! })
  }
  return points
}
