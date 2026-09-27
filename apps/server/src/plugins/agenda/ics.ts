import ICAL from 'ical.js'

// Lecture d'un flux iCalendar (l'« adresse secrète au format iCal » d'un agenda Google) et
// déroulé de ses événements sur une période. Les récurrences (RRULE, EXDATE, occurrences
// déplacées ou annulées par RECURRENCE-ID) sont confiées à ical.js : c'est tout le piège du format.

/**
 * Une occurrence d'événement. Journée entière : des dates locales `YYYY-MM-DD`, fin EXCLUE (comme
 * dans le flux) — jamais d'instant, sinon un anniversaire glisse d'un jour selon le fuseau. Sinon :
 * des instants en ms.
 */
export type AgendaEvent = {
  id: string
  calendarId: string
  title: string
  location?: string
  description?: string
} & ({ allDay: true; start: string; end: string } | { allDay: false; start: number; end: number })

export interface ParsedCalendar {
  /** `X-WR-CALNAME` : le nom que Google donne à l'agenda, proposé à l'ajout. */
  name: string | null
  /** Événements maîtres, occurrences déplacées rattachées ; plus les occurrences orphelines. */
  events: ICAL.Event[]
}

export function parseIcs(text: string): ParsedCalendar {
  const root = new ICAL.Component(ICAL.parse(text))
  if (root.name !== 'vcalendar') throw new Error('not an iCalendar feed')
  // Google joint les VTIMEZONE qu'il cite ; sans elles une heure « TZID=Europe/Paris » serait
  // lue comme flottante. Le registre est global, mais une zone a la même définition partout.
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  for (const v of root.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(v)
    if (e.isRecurrenceException()) exceptions.push(e)
    else masters.set(e.uid, e)
  }
  const orphans: ICAL.Event[] = []
  // l'occurrence déplacée peut précéder son maître dans le fichier : rattachée après coup
  for (const e of exceptions) {
    const master = masters.get(e.uid)
    if (master) master.relateException(e)
    else orphans.push(e)
  }
  const name = root.getFirstPropertyValue('x-wr-calname')
  return { name: typeof name === 'string' && name.trim() ? name.trim() : null, events: [...masters.values(), ...orphans] }
}

/** Garde-fou : une règle quotidienne ouverte depuis des années ne doit pas tourner sans fin. */
const MAX_OCCURRENCES = 20_000
/** Une occurrence déplacée peut tomber dans la période alors que sa date d'origine en sort. */
const MOVED_SLACK_MS = 31 * 86_400_000

/** Toutes les occurrences qui touchent `[from, to[`, triées par début. */
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
  // une occurrence annulée arrive comme une exception en STATUS:CANCELLED
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
    // RFC 5545 : une journée sans DTEND dure un jour
    const endDay = end && end.compare(start) > 0 ? end.toString() : nextDay(startDay)
    if (localMs(endDay) <= from || localMs(startDay) >= to) return
    out.push({ ...base, allDay: true, start: startDay, end: endDay })
    return
  }
  const s = start.toJSDate().getTime()
  const f = end ? Math.max(s, end.toJSDate().getTime()) : s
  // un rendez-vous sans durée reste visible à son heure
  if (f <= from && !(f === s && s >= from)) return
  if (s >= to) return
  out.push({ ...base, allDay: false, start: s, end: f })
}

/** Minuit local d'un jour `YYYY-MM-DD` (le fuseau du serveur est celui de la maison). */
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

/** Google écrit les descriptions en HTML léger : on garde le texte et les retours à la ligne. */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
