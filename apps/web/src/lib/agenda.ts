import type { AgendaEvent } from '../api/transport'

// Computation of the Agenda view, without Vue: displayed periods (six-week month, Monday-based week,
// day), distribution of occurrences by day, and columns of overlapping appointments.
// Everything is in the browser's LOCAL time (that of the house).

export type AgendaMode = 'month' | 'week' | 'day'
export const AGENDA_MODES: AgendaMode[] = ['month', 'week', 'day']

/** Local day `YYYY-MM-DD` (the shape of the server's whole days). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
/** The week starts on Monday. */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -((d.getDay() + 6) % 7))
}

/**
 * The days displayed for a mode around a date. The month ALWAYS has six weeks: the grid
 * keeps the same height from February to March.
 */
export function visibleDays(mode: AgendaMode, anchor: Date): Date[] {
  if (mode === 'day') return [startOfDay(anchor)]
  const first = mode === 'week' ? startOfWeek(anchor) : startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  return Array.from({ length: mode === 'week' ? 7 : 42 }, (_, i) => addDays(first, i))
}

/** The date of the next (`+1`) or previous (`-1`) period. */
export function shift(mode: AgendaMode, anchor: Date, dir: 1 | -1): Date {
  if (mode === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
  return addDays(anchor, dir * (mode === 'week' ? 7 : 1))
}

/**
 * The days (keys) that an occurrence touches. An appointment without a duration fits within its day.
 * With `within` (first and last displayed day), only those days: an event from a feed can span
 * millennia, one day at a time.
 */
export function eventDays(e: AgendaEvent, within?: [first: Date, last: Date]): string[] {
  const out: string[] = []
  if (e.allDay) {
    let d = fromKey(e.start)
    if (within && d < within[0]) d = within[0]
    for (; dayKey(d) < e.end && !(within && d > within[1]); d = addDays(d, 1)) out.push(dayKey(d))
    return out.length ? out : [e.start]
  }
  let d = startOfDay(new Date(e.start))
  let last = startOfDay(new Date(Math.max(e.start, e.end - 1)))
  if (within && d < within[0]) d = within[0]
  if (within && last > within[1]) last = within[1]
  for (; d <= last; d = addDays(d, 1)) out.push(dayKey(d))
  return out
}

/** Ended at `now`: a whole day is so on the day after its last day (end exclusive). */
export function isPast(e: AgendaEvent, now: number): boolean {
  if (!e.allDay) return e.end <= now
  const today = dayKey(new Date(now))
  return e.start < today && e.end <= today
}

/** Occurrences per day, whole days first, then by start time; only the days of `within` when given. */
export function byDay(events: AgendaEvent[], within?: [first: Date, last: Date]): Map<string, AgendaEvent[]> {
  const map = new Map<string, AgendaEvent[]>()
  for (const e of events) {
    for (const k of eventDays(e, within)) {
      const list = map.get(k)
      if (list) list.push(e)
      else map.set(k, [e])
    }
  }
  for (const list of map.values()) list.sort(compareEvents)
  return map
}

function compareEvents(a: AgendaEvent, b: AgendaEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  if (a.allDay && b.allDay) return a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)
  return (a.start as number) - (b.start as number) || (b.end as number) - (a.end as number)
}

/** An appointment placed in a day's column: minutes since midnight, column among `cols`. */
export interface PlacedEvent { event: AgendaEvent; startMin: number; endMin: number; col: number; cols: number }

/** Minimum displayed duration: a five-minute appointment stays readable and touchable. */
export const MIN_BLOCK_MIN = 30

/**
 * The appointments (excluding whole days) of a day, clipped to the day and distributed into columns:
 * overlapping blocks share the width, a group that overlaps nothing keeps it whole.
 */
export function layoutDay(events: AgendaEvent[], day: Date): PlacedEvent[] {
  const dayStart = startOfDay(day).getTime()
  const dayEnd = addDays(day, 1).getTime()
  const items = events
    .filter((e): e is AgendaEvent & { allDay: false } => !e.allDay && e.start < dayEnd && (e.end > dayStart || (e.end === e.start && e.start >= dayStart)))
    .map((event) => {
      // real minutes (the daylight saving shift is ignored: the grid counts 24 hours)
      const startMin = Math.max(0, Math.round((event.start - dayStart) / 60_000))
      const endMin = Math.min(24 * 60, Math.round((event.end - dayStart) / 60_000))
      return { event, startMin, endMin: Math.max(endMin, startMin + MIN_BLOCK_MIN), col: 0, cols: 1 }
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  let group: PlacedEvent[] = []
  let groupEnd = -1
  let colEnds: number[] = []
  const close = () => { for (const p of group) p.cols = colEnds.length }
  for (const p of items) {
    if (p.startMin >= groupEnd) { close(); group = []; colEnds = []; groupEnd = -1 }
    const free = colEnds.findIndex((end) => end <= p.startMin)
    p.col = free === -1 ? colEnds.length : free
    colEnds[p.col] = p.endMin
    group.push(p)
    groupEnd = Math.max(groupEnd, p.endMin)
  }
  close()
  return items
}
