import ICAL from 'ical.js'

// Reads an iCalendar feed (a Google calendar's "secret address in iCal format") and expands its
// events over a period. Recurrences (RRULE, EXDATE, occurrences moved or cancelled through
// RECURRENCE-ID) are left to ical.js: that is the whole trap of the format.

/**
 * One event occurrence. All-day: local `YYYY-MM-DD` dates, end EXCLUDED (as in the feed) — never
 * an instant, otherwise a birthday slips by a day depending on the time zone. Otherwise: instants
 * in ms.
 */
export type AgendaEvent = {
  id: string
  calendarId: string
  title: string
  location?: string
  description?: string
} & ({ allDay: true; start: string; end: string } | { allDay: false; start: number; end: number })

export interface ParsedCalendar {
  /** `X-WR-CALNAME`: the name Google gives the calendar, suggested when adding it. */
  name: string | null
  /** Master events, with their moved occurrences attached; plus the orphan occurrences. */
  events: ICAL.Event[]
}

export function parseIcs(text: string): ParsedCalendar {
  const root = new ICAL.Component(ICAL.parse(text))
  if (root.name !== 'vcalendar') throw new Error('not an iCalendar feed')
  // Google attaches the VTIMEZONEs it cites; without them a "TZID=Europe/Paris" time would be
  // read as floating. The registry is global, but a zone has the same definition everywhere.
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  for (const v of root.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(v)
    if (e.isRecurrenceException()) exceptions.push(e)
    else masters.set(e.uid, e)
  }
  const orphans: ICAL.Event[] = []
  // the moved occurrence may come before its master in the file: attached afterwards
  for (const e of exceptions) {
    const master = masters.get(e.uid)
    if (master) master.relateException(e)
    else orphans.push(e)
  }
  const name = root.getFirstPropertyValue('x-wr-calname')
  return { name: typeof name === 'string' && name.trim() ? name.trim() : null, events: [...masters.values(), ...orphans] }
}

/** Safeguard: a daily rule open for years must not loop forever. */
const MAX_OCCURRENCES = 20_000
/** A moved occurrence can fall inside the period while its original date lies outside it. */
const MOVED_SLACK_MS = 31 * 86_400_000

/** Every occurrence touching `[from, to[`, sorted by start. */
export function expandEvents(cal: ParsedCalendar, calendarId: string, from: number, to: number): AgendaEvent[] {
  const out: AgendaEvent[] = []
  for (const e of cal.events) {
    if (!e.isRecurring()) {
      push(out, calendarId, e, e.startDate, e.endDate, e.startDate, from, to)
      continue
    }
    const it = e.iterator()
    for (let n = 0, next = it.next(); next && n < MAX_OCCURRENCES; n++, next = it.next()) {
      if (next.toJSDate().getTime() >= to + MOVED_SLACK_MS) break
      const d = e.getOccurrenceDetails(next)
      push(out, calendarId, d.item, d.startDate, d.endDate, next, from, to)
    }
  }
  return out.sort((a, b) => sortKey(a) - sortKey(b))
}

function push(out: AgendaEvent[], calendarId: string, item: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null, recurrence: ICAL.Time, from: number, to: number) {
  // a cancelled occurrence arrives as an exception with STATUS:CANCELLED
  if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return
  const base = {
    id: `${calendarId}:${item.uid}:${recurrence.toString()}`,
    calendarId,
    title: item.summary?.trim() || '',
    ...(item.location?.trim() ? { location: item.location.trim() } : {}),
    ...(item.description?.trim() ? { description: plainText(item.description) } : {}),
  }
  if (start.isDate) {
    const startDay = start.toString()
    // RFC 5545: an all-day event without DTEND lasts one day
    const endDay = end && end.compare(start) > 0 ? end.toString() : nextDay(startDay)
    if (localMs(endDay) <= from || localMs(startDay) >= to) return
    out.push({ ...base, allDay: true, start: startDay, end: endDay })
    return
  }
  const s = start.toJSDate().getTime()
  const f = end ? Math.max(s, end.toJSDate().getTime()) : s
  // an appointment without duration stays visible at its time
  if (f <= from && !(f === s && s >= from)) return
  if (s >= to) return
  out.push({ ...base, allDay: false, start: s, end: f })
}

/** Local midnight of a `YYYY-MM-DD` day (the server's time zone is the house's). */
export function localMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!).getTime()
}

function nextDay(day: string): string {
  const t = new Date(localMs(day))
  t.setDate(t.getDate() + 1)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

const sortKey = (e: AgendaEvent) => (e.allDay ? localMs(e.start) - 1 : e.start)

/** Google writes descriptions in light HTML: we keep the text and the line breaks. */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
