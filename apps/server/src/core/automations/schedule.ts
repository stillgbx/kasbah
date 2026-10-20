import { sunTimes, type TimeTrigger } from '@kasbah/shared'

// Next due time of a time trigger. Everything is reasoned in LOCAL WALL-CLOCK TIME (the process
// time zone, like the rest of the server): a day is built with `new Date(y, m, d + k)` and never by
// adding 24 h, otherwise a DST change would shift every following due time by an hour. A time that
// does not exist (02:30 on the day clocks go forward) is normalized by `Date` to 03:30; a time that
// exists twice is taken only once.

/** At most one year ahead: beyond that, a date range or weekdays that never meet. */
const HORIZON_DAYS = 366

export interface Site { lat: number; lon: number }

/** "YYYY-MM-DD" of the local day, to compare with the bounds of a date range. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Instant of a wall-clock time "HH:MM" on the local day `day`. */
export function wallClock(day: Date, hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime()
}

/** Time of the trigger on day `day`, or `undefined` if the sun does not pass through it that day. */
export function occurrenceOn(trigger: TimeTrigger, day: Date, site: Site): number | undefined {
  const at = trigger.at
  if (at.kind === 'clock') return wallClock(day, at.time)
  // local noon: `sunTimes` slices the day that CONTAINS the given date
  const base = sunTimes(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12), site.lat, site.lon)[at.event]
  if (base === undefined) return undefined
  let t = base + (at.offsetMin ?? 0) * 60_000
  if (at.notBefore) t = Math.max(t, wallClock(day, at.notBefore))
  if (at.notAfter) t = Math.min(t, wallClock(day, at.notAfter))
  return t
}

/** Is the day kept by the trigger's weekdays and date range? */
function dayAllowed(trigger: TimeTrigger, day: Date): boolean {
  if (trigger.days && !trigger.days.includes(day.getDay())) return false
  if (trigger.dateRange) {
    const d = isoDay(day)
    if (d < trigger.dateRange.from || d > trigger.dateRange.to) return false
  }
  return true
}

/** First due time STRICTLY after `fromMs`, or `undefined` if there is none left within the year. */
export function nextOccurrence(trigger: TimeTrigger, fromMs: number, site: Site): number | undefined {
  const from = new Date(fromMs)
  for (let k = 0; k <= HORIZON_DAYS; k++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + k)
    if (!dayAllowed(trigger, day)) continue
    const t = occurrenceOn(trigger, day, site)
    if (t !== undefined && t > fromMs) return t
  }
  return undefined
}
