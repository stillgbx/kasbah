import type { ConsumptionPoint, DeviceConsumption } from '@kasbah/shared'

/**
 * Water consumption history (`GET /api/devices/:id/consumption`) put into columns for a
 * bar chart. Three principles, all dictated by the contract (`deviceConsumptionSchema`):
 *
 * 1. Each period has a FIXED number of columns (`PERIOD_STEPS`): the chart's width
 *    never depends on what the server measured, only on the chosen period.
 * 2. A step never measured stays `litres: null`, never `0` — the contract says so
 *    ("a step never measured is absent, not at zero"), and it is what distinguishes on screen
 *    "measured at 0 L" from "no measurement".
 * 3. `week` and `month` both read `daily` (the same series serves both scales); only
 *    the number of columns kept changes.
 */
export type ConsumptionPeriod = 'day' | 'week' | 'month' | 'year'
export const CONSUMPTION_PERIODS: readonly ConsumptionPeriod[] = ['day', 'week', 'month', 'year']

/** Number of columns reserved per period — never the number of points received. */
export const PERIOD_STEPS: Record<ConsumptionPeriod, number> = { day: 24, week: 7, month: 31, year: 12 }

/** The contract series that feeds this period. */
export function seriesFor(consumption: DeviceConsumption | null, period: ConsumptionPeriod): readonly ConsumptionPoint[] {
  if (!consumption) return []
  switch (period) {
    case 'day': return consumption.hourly
    case 'week':
    case 'month': return consumption.daily
    case 'year': return consumption.monthly
  }
}

export interface ConsumptionSlot { t: number; litres: number | null }

/** Start of the current step (full hour / midnight / first of the month), depending on the period. */
function currentStepStart(period: ConsumptionPeriod, now: number): Date {
  const d = new Date(now)
  if (period === 'day') { d.setMinutes(0, 0, 0); return d }
  d.setHours(0, 0, 0, 0)
  if (period === 'year') d.setDate(1)
  return d
}

/**
 * Steps back `n` steps (hours, days or calendar months) from a step start. Hours are REAL hours,
 * not wall-clock ones: the day the clocks go back, `setHours` spread the 24 bars over 25 hours and
 * one measured hour had no bar; the day they go forward, two bars fell on the same instant.
 */
function stepBack(period: ConsumptionPeriod, from: Date, n: number): number {
  if (period === 'day') return from.getTime() - n * 3600_000
  const d = new Date(from)
  if (period === 'year') d.setMonth(d.getMonth() - n)
  else d.setDate(d.getDate() - n)
  return d.getTime()
}

/** Tolerance for matching point ↔ expected step: a little less than half a step, to never confuse two neighboring steps. */
function tolerance(period: ConsumptionPeriod, stepStart: number, prevStepStart: number): number {
  return (stepStart - prevStepStart) * 0.4
}

/**
 * How a period is cut. `rolling`: the last steps up to now (the last 7 days, 31 days, 12 months).
 * `calendar`: the current day, week (Monday first), month or year, whole — the steps still to come
 * stay empty, and the totals compare with a vendor's app that counts "this month".
 */
export type PeriodMode = 'rolling' | 'calendar'

/** Starts of the steps of the CURRENT calendar period: 23 to 25 hours, 7 days, 28 to 31 days, 12 months. */
function calendarStarts(period: ConsumptionPeriod, now: number): number[] {
  const d = new Date(now); d.setHours(0, 0, 0, 0)
  const starts: number[] = []
  if (period === 'day') {
    const end = new Date(d); end.setDate(end.getDate() + 1)
    for (let t = d.getTime(); t < end.getTime(); t += 3600_000) starts.push(t)
    return starts
  }
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  if (period === 'month') d.setDate(1)
  if (period === 'year') d.setMonth(0, 1)
  const count = period === 'week' ? 7 : period === 'year' ? 12 : new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  for (let i = 0; i < count; i++) {
    const s = new Date(d)
    if (period === 'year') s.setMonth(i, 1)
    else s.setDate(d.getDate() + i)
    starts.push(s.getTime())
  }
  return starts
}

/**
 * Puts the received points into the expected steps, FROM OLDEST TO MOST RECENT: the last
 * `PERIOD_STEPS[period]` steps, or those of the current calendar period (`mode`). A step with no
 * point nearby stays `null`: it is a step never measured, not a zero consumption. Matching is done
 * by proximity (not strict equality of `t`) because nothing in the contract guarantees that the
 * server's clock lands exactly on the browser's hour.
 */
export function bucketSlots(points: readonly ConsumptionPoint[], period: ConsumptionPeriod, now = Date.now(), mode: PeriodMode = 'rolling'): ConsumptionSlot[] {
  const count = PERIOD_STEPS[period]
  const latest = currentStepStart(period, now)
  const starts = mode === 'calendar'
    ? calendarStarts(period, now)
    : Array.from({ length: count }, (_, i) => stepBack(period, latest, count - 1 - i))
  // the step before the first one: what bounds its tolerance
  const before = mode === 'calendar' ? starts[0]! - (starts[1]! - starts[0]!) : stepBack(period, latest, count)
  return starts.map((t, i) => {
    const tol = tolerance(period, t, i > 0 ? starts[i - 1]! : before)
    const hit = points.find((p) => Math.abs(p.t - t) <= tol)
    return { t, litres: hit ? hit.litres : null }
  })
}

/** The current calendar month or year, as a chart title says it: "Octobre 2026", "2026". The week has
 * its own sentence (`energy.scale.thisWeek`). */
export function calendarTitle(period: 'month' | 'year', now: number, locale: string): string {
  const d = new Date(now)
  if (period === 'year') return String(d.getFullYear())
  const m = d.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  return m.charAt(0).toUpperCase() + m.slice(1)
}

/** Sum of the measured steps of a window (absent steps count neither for nor against). */
export function slotsTotal(slots: readonly ConsumptionSlot[]): number {
  return slots.reduce((sum, s) => sum + (s.litres ?? 0), 0)
}

/** The largest measured step of a window, floored at 1 to never divide by zero. */
export function slotsMax(slots: readonly ConsumptionSlot[]): number {
  return Math.max(1, ...slots.map((s) => s.litres ?? 0))
}

/**
 * Round ticks for the y-axis: 3 to 4 readable values (multiples of 1, 2 or 5 × 10ⁿ),
 * never the raw measured maximum (an axis showing "12,396" teaches nothing that an axis at 5,000 /
 * 10,000 does not say better). The series step (D3 `tickStep`) rounds upward: a tick that
 * would exceed the real maximum is discarded rather than stretching the bars to reach it — this is what
 * produces the example above (12,396 real maximum, ticks 5,000 and 10,000 only).
 */
export function niceAxisTicks(max: number, targetCount = 3): number[] {
  if (max <= 0) return []
  const roughStep = max / targetCount
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const residual = roughStep / magnitude
  const step = (residual >= Math.sqrt(50) ? 10 : residual >= Math.sqrt(10) ? 5 : residual >= Math.sqrt(2) ? 2 : 1) * magnitude
  const ticks: number[] = []
  for (let v = step; v <= max + step * 1e-9; v += step) ticks.push(v)
  return ticks
}

/**
 * Average consumption of a French household, in liters per person per day — Observatoire
 * national des services publics d'eau et d'assainissement (SISPEA, 2023 data, published 2025);
 * stable between 144 and 150 L since 2014.
 *
 * An ORDER OF MAGNITUDE, never a verdict: consumption PER PERSON drops as the household
 * grows (≈148 L/pers. for two, ≈101 L/pers. for four — CIEAU/INSEE) and varies strongly from one
 * region to another (INSEE reports 100 L/d/inhabitant in 133 communes of the Paris region). `N × 145` therefore
 * only claims to situate, not to judge.
 */
export const FRENCH_AVERAGE_LPD_PER_PERSON = 145

/** French average consumption marker for a household of `householdSize` people, in L/day. */
export function frenchAverageDailyLitres(householdSize: number): number {
  return FRENCH_AVERAGE_LPD_PER_PERSON * householdSize
}

/** Average length of a calendar month (365.25 / 12): the yearly marker uses it to stay a STRAIGHT LINE
 * rather than a staircase following the real number of days of each month — owner's choice (see
 * `frenchAverageReference`). */
const AVERAGE_DAYS_PER_MONTH = 30.44

/**
 * The marker to compare to ONE step of the chosen period, or `null` when the comparison makes no
 * sense for that step:
 * - `day`: each bar is an HOUR — nobody consumes uniformly over 24 h, an hourly line
 *   would lie. The marker is compared to the day's TOTAL, not to a bar (see the chart).
 * - `week` / `month`: each bar is a DAY — the marker is the same for all, `N × 145`.
 * - `year`: each bar is a MONTH — the marker is also a STRAIGHT LINE, `N × 145 × 30.44`, not a
 *   staircase following the real number of days of each month: a flat line reads at a glance
 *   on a wall, which the owner prefers to the staircase's exactness (13.49 m³ for a 31-day
 *   month, 12.18 in February). Accepted trade-off: February is compared to an average month and thus appears
 *   a bit more economical than it is (nuance given in a tooltip, see `referenceHint`).
 */
export function frenchAverageReference(period: ConsumptionPeriod, householdSize: number): number | null {
  if (period === 'day') return null
  const perDay = frenchAverageDailyLitres(householdSize)
  return period === 'year' ? perDay * AVERAGE_DAYS_PER_MONTH : perDay
}
