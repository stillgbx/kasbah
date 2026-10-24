import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PluginHealth } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import { sendError } from '../../http/errors'
import { expandEvents, parseIcs, type AgendaEvent, type ParsedCalendar } from './ics'
import { createCalendarsFile, type CalendarsStore, type StoredCalendar } from './store'

// Agenda plugin: the family's Google calendars, read through their "secret address in iCal
// format" — no Google Cloud project, no OAuth, and read-only by nature. No device published: the
// Calendar view queries `/events` over the period it displays. Feeds are re-read at a fixed
// interval and kept in memory; recurrences are expanded on demand.

export const agendaConfigSchema = z.object({
  AGENDA_FILE: z.string().trim().default(stateFile('agenda-calendars.json')),
  /** Google regenerates the feed on every read; ten minutes are enough for a family calendar. */
  AGENDA_REFRESH_MS: z.coerce.number().int().min(60_000).default(600_000),
})
export type AgendaConfig = z.infer<typeof agendaConfigSchema>

/** Color of a calendar added without one: the next one in this list. */
export const AGENDA_COLORS = ['#3f8cff', '#e5534b', '#2da44e', '#d38b22', '#a371f7', '#1bb3a7', '#db61a2', '#8d96a0']
/** A period longer than a displayed month (six weeks) has no use here. */
const MAX_RANGE_MS = 62 * 86_400_000
const FETCH_TIMEOUT_MS = 20_000

export type FetchIcs = (url: string, signal: AbortSignal) => Promise<string>

export interface AgendaPluginDeps {
  store?: CalendarsStore
  fetchIcs?: FetchIcs
}

interface Feed { parsed: ParsedCalendar | null; fetchedAt: number | null; error: string | null }

/** A family calendar weighs a few hundred KB; beyond this, the feed is refused rather than parsed. */
const MAX_FEED_BYTES = 10 * 1024 * 1024

const defaultFetch: FetchIcs = async (url, signal) => {
  const res = await fetch(url, { signal, headers: { accept: 'text/calendar' } })
  // the address does not go into the message: it is as good as a password
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const tooBig = new Error(`agenda trop volumineux (plus de ${MAX_FEED_BYTES / 1024 / 1024} Mo)`)
  if (Number(res.headers.get('content-length') ?? 0) > MAX_FEED_BYTES) throw tooBig
  const text = await res.text()
  if (text.length > MAX_FEED_BYTES) throw tooBig
  return text
}

/** `webcal://` is a calendar's subscription address; it is the same one over https. */
export function normalizeUrl(raw: string): string | null {
  const url = raw.trim().replace(/^webcals?:\/\//i, 'https://')
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch { return null }
}

const idOf = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 12)

export function createAgendaPlugin(deps: AgendaPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: AgendaConfig | null = null
  let store: CalendarsStore | null = null
  let calendars: StoredCalendar[] = []
  const feeds = new Map<string, Feed>()
  let poller: { stop(): void } | null = null
  const fetchIcs = deps.fetchIcs ?? defaultFetch

  async function load(cal: StoredCalendar): Promise<Feed> {
    const signal = AbortSignal.any([ctx?.signal ?? new AbortController().signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
    const prev = feeds.get(cal.id)
    try {
      const parsed = parseIcs(await fetchIcs(cal.url, signal))
      const feed = { parsed, fetchedAt: ctx?.clock.now() ?? Date.now(), error: null }
      feeds.set(cal.id, feed)
      return feed
    } catch (err) {
      // keep the last successful read: a feed that does not answer does not wipe the calendar
      const feed = { parsed: prev?.parsed ?? null, fetchedAt: prev?.fetchedAt ?? null, error: (err as Error).message }
      feeds.set(cal.id, feed)
      ctx?.logger.warn({ calendar: cal.name, err: feed.error }, 'agenda feed failed')
      return feed
    }
  }
  const refreshAll = () => Promise.all(calendars.map(load)).then(() => undefined)

  async function save(next: StoredCalendar[]) {
    calendars = next
    await store?.save(next)
  }

  /** What the UI sees of a calendar: everything but the address. */
  const view = (c: StoredCalendar) => {
    const f = feeds.get(c.id)
    return { id: c.id, name: c.name, color: c.color, fetchedAt: f?.fetchedAt ?? null, error: f?.error ?? null }
  }
  const list = () => ({ calendars: calendars.map(view) })

  return {
    id: 'agenda',
    configSchema: agendaConfigSchema,

    async init(context) {
      ctx = context
      config = agendaConfigSchema.parse(context.config)
      store = deps.store ?? createCalendarsFile(config.AGENDA_FILE, context.logger)
      calendars = await store.load()
    },
    async discover() { return [] },
    async start() {
      if (!ctx || !config) return
      poller = createPoller({ name: 'agenda', intervalMs: config.AGENDA_REFRESH_MS, fn: refreshAll, clock: ctx.clock, signal: ctx.signal, logger: ctx.logger })
    },
    async execute(_externalId, command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `agenda publishes no device (${command.type})`)
    },
    async stop() {
      poller?.stop()
      poller = null
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/calendars', async () => list())

      // Add: the feed is read right away — a wrong address is refused here, not discovered later
      // in the plugin's health.
      app.post<{ Body: unknown }>('/calendars', async (req, reply) => {
        const body = z.object({
          url: z.string().trim().min(1).max(4096),
          name: z.string().trim().max(80).optional(),
          color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        }).safeParse(req.body)
        const url = body.success ? normalizeUrl(body.data.url) : null
        if (!body.success || !url) return sendError(reply, 400, 'INVALID_BODY', 'an http(s) or webcal iCal address is required')
        const id = idOf(url)
        if (calendars.some((c) => c.id === id)) return sendError(reply, 409, 'ALREADY_EXISTS', 'this calendar is already added')
        const draft: StoredCalendar = { id, url, name: body.data.name || '…', color: body.data.color ?? AGENDA_COLORS[calendars.length % AGENDA_COLORS.length]! }
        const feed = await load(draft)
        if (!feed.parsed) {
          feeds.delete(id)
          return sendError(reply, 502, 'UPSTREAM_ERROR', `the address could not be read as a calendar (${feed.error})`)
        }
        await save([...calendars, { ...draft, name: body.data.name || feed.parsed.name || 'Agenda' }])
        return list()
      })

      app.patch<{ Params: { id: string }; Body: unknown }>('/calendars/:id', async (req, reply) => {
        const body = z.object({
          name: z.string().trim().min(1).max(80).optional(),
          color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'name (1-80 characters) or color (#rrggbb) expected')
        if (!calendars.some((c) => c.id === req.params.id)) return sendError(reply, 404, 'NOT_FOUND', `unknown calendar "${req.params.id}"`)
        await save(calendars.map((c) => (c.id === req.params.id ? { ...c, ...body.data } : c)))
        return list()
      })

      // Calendar order: the file keeps them in this order, the view lists them that way. We expect
      // ALL the ids, each one once — a partial list would lose calendars.
      app.put<{ Body: unknown }>('/calendars/order', async (req, reply) => {
        const body = z.object({ ids: z.array(z.string()) }).safeParse(req.body)
        const ids = body.success ? body.data.ids : []
        const byId = new Map(calendars.map((c) => [c.id, c]))
        if (!body.success || ids.length !== calendars.length || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) {
          return sendError(reply, 400, 'INVALID_BODY', 'ids must list every calendar exactly once')
        }
        await save(ids.map((id) => byId.get(id)!))
        return list()
      })

      app.delete<{ Params: { id: string } }>('/calendars/:id', async (req) => {
        feeds.delete(req.params.id)
        await save(calendars.filter((c) => c.id !== req.params.id))
        return list()
      })

      app.post('/refresh', async () => {
        await refreshAll()
        return list()
      })

      app.get<{ Querystring: { from?: string; to?: string } }>('/events', async (req, reply) => {
        const from = Number(req.query.from)
        const to = Number(req.query.to)
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > MAX_RANGE_MS) {
          return sendError(reply, 400, 'INVALID_QUERY', 'from < to (ms) spanning at most 62 days are required')
        }
        const events: AgendaEvent[] = []
        for (const c of calendars) {
          const parsed = feeds.get(c.id)?.parsed
          if (parsed) events.push(...expandEvents(parsed, c.id, from, to))
        }
        return { events }
      })
    },

    health(): PluginHealth {
      const keys = Object.keys(agendaConfigSchema.shape)
      if (!calendars.length) return { status: 'needs_pairing', detail: 'no calendar yet — add a secret iCal address', keys }
      const failing = calendars.filter((c) => feeds.get(c.id)?.error)
      const detail = `${calendars.length} calendar${calendars.length === 1 ? '' : 's'}`
      return failing.length
        ? { status: 'degraded', detail: `${detail} — unreadable: ${failing.map((c) => `${c.name} (${feeds.get(c.id)!.error})`).join(', ')}`, keys }
        : { status: 'ok', detail, keys }
    },
  }
}
