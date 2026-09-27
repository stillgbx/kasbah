import Fastify from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { PluginContext } from '../../core/plugin'
import { expandEvents, localMs, parseIcs } from './ics'
import { createAgendaPlugin, normalizeUrl, type FetchIcs } from './index'
import { memoryCalendars } from './store'

// Flux écrit sur le modèle de l'adresse secrète iCal de Google (VTIMEZONE jointe, UTC en « Z »,
// occurrences déplacées et annulées par RECURRENCE-ID, description en HTML léger).
const ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'X-WR-CALNAME:Famille',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  // un rendez-vous simple, heure de Paris
  'BEGIN:VEVENT',
  'UID:dentiste@google.com',
  'DTSTART;TZID=Europe/Paris:20260929T143000',
  'DTEND;TZID=Europe/Paris:20260929T151500',
  'SUMMARY:Dentiste',
  'LOCATION:12 rue du Port',
  'DESCRIPTION:Apporter la <b>carte</b><br>Vitale',
  'END:VEVENT',
  // trois jours de vacances (fin exclue)
  'BEGIN:VEVENT',
  'UID:vacances@google.com',
  'DTSTART;VALUE=DATE:20261003',
  'DTEND;VALUE=DATE:20261006',
  'SUMMARY:Week-end à la mer',
  'END:VEVENT',
  // l'exception avant son maître, comme Google le fait parfois : le mardi 13 passe à 18 h
  'BEGIN:VEVENT',
  'UID:judo@google.com',
  'RECURRENCE-ID;TZID=Europe/Paris:20261013T170000',
  'DTSTART;TZID=Europe/Paris:20261013T180000',
  'DTEND;TZID=Europe/Paris:20261013T190000',
  'SUMMARY:Judo (décalé)',
  'END:VEVENT',
  // le judo chaque mardi, sauf le 6 (EXDATE) et le 20 (annulé)
  'BEGIN:VEVENT',
  'UID:judo@google.com',
  'DTSTART;TZID=Europe/Paris:20260908T170000',
  'DTEND;TZID=Europe/Paris:20260908T180000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU',
  'EXDATE;TZID=Europe/Paris:20261006T170000',
  'SUMMARY:Judo',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:judo@google.com',
  'RECURRENCE-ID;TZID=Europe/Paris:20261020T170000',
  'DTSTART;TZID=Europe/Paris:20261020T170000',
  'DTEND;TZID=Europe/Paris:20261020T180000',
  'STATUS:CANCELLED',
  'SUMMARY:Judo',
  'END:VEVENT',
  // un anniversaire chaque année, sans DTEND
  'BEGIN:VEVENT',
  'UID:anniv@google.com',
  'DTSTART;VALUE=DATE:20100930',
  'RRULE:FREQ=YEARLY',
  'SUMMARY:Anniversaire de Lou',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

/** Paris est à UTC+2 en octobre 2026 (heure d'été jusqu'au 25). */
const paris = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h - 2, mi)
const OCT_FROM = localMs('2026-10-01')
const OCT_TO = localMs('2026-11-01')

describe('agenda ics', () => {
  const cal = parseIcs(ICS)

  it('reads the calendar name', () => {
    expect(cal.name).toBe('Famille')
  })

  it('keeps a timed event in the zone of its TZID, with a plain-text description', () => {
    const [e] = expandEvents(cal, 'c1', localMs('2026-09-29'), localMs('2026-09-30')).filter((x) => x.title === 'Dentiste')
    expect(e).toMatchObject({ allDay: false, start: paris(2026, 9, 29, 14, 30), end: paris(2026, 9, 29, 15, 15), location: '12 rue du Port', description: 'Apporter la carte\nVitale' })
  })

  it('keeps all-day events as local dates with an exclusive end, one day when DTEND is missing', () => {
    const events = expandEvents(cal, 'c1', OCT_FROM, OCT_TO)
    expect(events.find((e) => e.title === 'Week-end à la mer')).toMatchObject({ allDay: true, start: '2026-10-03', end: '2026-10-06' })
    const sept = expandEvents(cal, 'c1', localMs('2026-09-01'), OCT_FROM)
    expect(sept.find((e) => e.title === 'Anniversaire de Lou')).toMatchObject({ allDay: true, start: '2026-09-30', end: '2026-10-01' })
  })

  it('expands a weekly rule with its excluded, moved and cancelled occurrences', () => {
    const judo = expandEvents(cal, 'c1', OCT_FROM, OCT_TO).filter((e) => e.title.startsWith('Judo'))
    expect(judo.map((e) => [e.title, e.start])).toEqual([
      ['Judo (décalé)', paris(2026, 10, 13, 18)],
      ['Judo', paris(2026, 10, 27, 17) + 3_600_000], // heure d'hiver depuis le 25 : UTC+1
    ])
    // occurrences distinctes, ids stables d'un appel à l'autre
    expect(new Set(judo.map((e) => e.id)).size).toBe(2)
    expect(expandEvents(cal, 'c1', OCT_FROM, OCT_TO).filter((e) => e.title.startsWith('Judo')).map((e) => e.id)).toEqual(judo.map((e) => e.id))
  })

  it('leaves out what ends before the period and sorts all-day events first on their day', () => {
    const day = expandEvents(cal, 'c1', localMs('2026-10-03'), localMs('2026-10-04'))
    expect(day.map((e) => e.title)).toEqual(['Week-end à la mer'])
  })

  it('refuses what is not a calendar', () => {
    expect(() => parseIcs('BEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD')).toThrow()
  })
})

describe('agenda url', () => {
  it('turns a webcal address into https and refuses other schemes', () => {
    expect(normalizeUrl(' webcal://calendar.google.com/calendar/ical/x/private-y/basic.ics ')).toBe('https://calendar.google.com/calendar/ical/x/private-y/basic.ics')
    expect(normalizeUrl('ftp://x/y.ics')).toBeNull()
    expect(normalizeUrl('pas une adresse')).toBeNull()
  })
})

function fakeCtx(config: Record<string, unknown>): PluginContext {
  return {
    pluginId: 'agenda',
    config,
    logger: pino({ level: 'silent' }),
    clock: new ManualClock(1_790_000_000_000),
    signal: new AbortController().signal,
    emitState: vi.fn(),
    setAvailable: vi.fn(),
    emitDevices: vi.fn(),
    emitScenes: vi.fn(),
    emitSceneState: vi.fn(),
    emitEvent: vi.fn(),
    parts: {},
    site: { lat: 0, lon: 0, alt: 0 },
  }
}

const SECRET = 'https://calendar.google.com/calendar/ical/famille%40group.calendar.google.com/private-abc123/basic.ics'

async function boot(fetchIcs: FetchIcs) {
  const store = memoryCalendars()
  const plugin = createAgendaPlugin({ store, fetchIcs })
  await plugin.init(fakeCtx(plugin.configSchema.parse({})))
  const app = Fastify()
  await app.register(async (sub) => plugin.registerRoutes!.call(plugin, sub), { prefix: '/api/plugins/agenda' })
  await app.ready()
  return { plugin, app, store }
}

describe('agenda plugin', () => {
  it('asks for a calendar until one is added, then names it from the feed and never returns its address', async () => {
    const { plugin, app, store } = await boot(async () => ICS)
    expect(plugin.health!().status).toBe('needs_pairing')
    const res = await app.inject({ method: 'POST', url: '/api/plugins/agenda/calendars', payload: { url: SECRET } })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('private-abc123')
    const [cal] = res.json().calendars
    expect(cal).toMatchObject({ name: 'Famille', color: '#3f8cff', error: null })
    expect((await store.load())[0]!.url).toBe(SECRET)
    expect(plugin.health!()).toMatchObject({ status: 'ok', detail: '1 calendar' })
    const again = await app.inject({ method: 'POST', url: '/api/plugins/agenda/calendars', payload: { url: SECRET } })
    expect(again.statusCode).toBe(409)
  })

  it('refuses an address that does not read as a calendar, without keeping it', async () => {
    const { app, store } = await boot(async () => '<html>not found</html>')
    const res = await app.inject({ method: 'POST', url: '/api/plugins/agenda/calendars', payload: { url: SECRET } })
    expect(res.statusCode).toBe(502)
    expect(res.body).not.toContain('private-abc123')
    expect(await store.load()).toEqual([])
  })

  it('serves the occurrences of every calendar on a bounded period', async () => {
    const { app } = await boot(async () => ICS)
    await app.inject({ method: 'POST', url: '/api/plugins/agenda/calendars', payload: { url: SECRET, name: 'Maison', color: '#2da44e' } })
    const res = await app.inject({ method: 'GET', url: `/api/plugins/agenda/events?from=${OCT_FROM}&to=${OCT_TO}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().events.map((e: { title: string }) => e.title)).toEqual(['Week-end à la mer', 'Judo (décalé)', 'Judo'])
    const tooLong = await app.inject({ method: 'GET', url: `/api/plugins/agenda/events?from=0&to=${OCT_TO}` })
    expect(tooLong.statusCode).toBe(400)
  })

  it('keeps the last good read when a feed fails, and says so in the health', async () => {
    let fail = false
    const { plugin, app } = await boot(async () => { if (fail) throw new Error('HTTP 404'); return ICS })
    await app.inject({ method: 'POST', url: '/api/plugins/agenda/calendars', payload: { url: SECRET } })
    fail = true
    const list = (await app.inject({ method: 'POST', url: '/api/plugins/agenda/refresh' })).json()
    expect(list.calendars[0].error).toBe('HTTP 404')
    expect(plugin.health!()).toMatchObject({ status: 'degraded' })
    const res = await app.inject({ method: 'GET', url: `/api/plugins/agenda/events?from=${OCT_FROM}&to=${OCT_TO}` })
    expect(res.json().events).toHaveLength(3)
  })

  it('renames, recolours and removes a calendar', async () => {
    const { app } = await boot(async () => ICS)
    const id = (await app.inject({ method: 'POST', url: '/api/plugins/agenda/calendars', payload: { url: SECRET } })).json().calendars[0].id
    const patched = await app.inject({ method: 'PATCH', url: `/api/plugins/agenda/calendars/${id}`, payload: { name: 'Nous', color: '#e5534b' } })
    expect(patched.json().calendars[0]).toMatchObject({ name: 'Nous', color: '#e5534b' })
    expect((await app.inject({ method: 'PATCH', url: '/api/plugins/agenda/calendars/nope', payload: { name: 'x' } })).statusCode).toBe(404)
    const removed = await app.inject({ method: 'DELETE', url: `/api/plugins/agenda/calendars/${id}` })
    expect(removed.json().calendars).toEqual([])
  })

  it('reorders the calendars, keeping every one of them', async () => {
    const { app, store } = await boot(async () => ICS)
    await app.inject({ method: 'POST', url: '/api/plugins/agenda/calendars', payload: { url: SECRET, name: 'A' } })
    const [a, b] = (await app.inject({ method: 'POST', url: '/api/plugins/agenda/calendars', payload: { url: `${SECRET}?b`, name: 'B' } })).json().calendars
    const res = await app.inject({ method: 'PUT', url: '/api/plugins/agenda/calendars/order', payload: { ids: [b.id, a.id] } })
    expect(res.json().calendars.map((c: { name: string }) => c.name)).toEqual(['B', 'A'])
    expect((await store.load()).map((c) => c.name)).toEqual(['B', 'A'])
    for (const ids of [[b.id], [b.id, b.id], [b.id, 'nope']]) {
      expect((await app.inject({ method: 'PUT', url: '/api/plugins/agenda/calendars/order', payload: { ids } })).statusCode).toBe(400)
    }
  })
})
