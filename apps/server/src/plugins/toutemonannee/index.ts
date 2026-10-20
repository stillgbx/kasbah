import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PluginHealth } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import { describeError, sendError } from '../../http/errors'
import { createTmaClient, SessionLostError, type FetchLike, type TmaClient } from './client'
import {
  ackResponseSchema, eventsPageSchema, mapHomework, mapJournals, mapMessage, mapPost, postSchema, postsPageSchema,
  spacesSchema, transmissionsPageSchema, type RawEvent, type SchoolJournal, type SchoolMessage, type SchoolPost,
} from './mapping'
import { createTmaFile, emptyTmaState, type TmaState, type TmaStore } from './store'

// TouteMonAnnée plugin: the homework diary, the home-school notebook (the teacher's messages) and
// the class posts, read through the PRIVATE API of the site's web app. No device: the School view
// queries `/school`. The account is linked once by login and password — never kept —; it is the
// cookies obtained (including `remember_web_…`) that last.
//
// Write: a homework's "done" checkbox. When the teacher has opened it on the site (`ack_needed`),
// it is the site's one, which she sees; otherwise it stays in Kasbah.

export const tmaConfigSchema = z.object({
  TMA_FILE: z.string().trim().default(stateFile('toutemonannee.json')),
  /** Homework changes a few times a day: half an hour is enough. */
  TMA_REFRESH_MS: z.coerce.number().int().min(300_000).default(1_800_000),
  /** Past days re-read, to look back at what was due. */
  TMA_PAST_DAYS: z.coerce.number().int().min(0).max(31).default(7),
})
export type TmaConfig = z.infer<typeof tmaConfigSchema>

/** Pagination bounds: enough to cover a class, not enough to scrape the site. */
const MAX_EVENT_PAGES = 5
const MAX_MESSAGE_PAGES = 3
const MAX_POST_PAGES = 2

export interface TmaPluginDeps {
  store?: TmaStore
  fetch?: FetchLike
}

/** What we keep of the last successful read (homework stays in raw form: the local "done"
 * checkbox is merged on each read of the route). */
interface Snapshot {
  journals: SchoolJournal[]
  events: { journalId: string; raw: RawEvent }[]
  messages: SchoolMessage[]
  posts: SchoolPost[]
  fetchedAt: number
}

const localDay = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function createToutemonanneePlugin(deps: TmaPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: TmaConfig | null = null
  let store: TmaStore | null = null
  let state: TmaState = emptyTmaState()
  let client: TmaClient | null = null
  let snapshot: Snapshot | null = null
  let sessionLost = false
  let lastError: string | null = null
  let poller: { stop(): void } | null = null

  const persist = () => store?.save(state).catch((err) => ctx?.logger.warn({ err }, 'toutemonannee state not saved'))

  function makeClient() {
    client = createTmaClient({
      cookies: state.cookies,
      fetch: deps.fetch,
      signal: ctx?.signal,
      onCookies: (cookies) => { state = { ...state, cookies }; void persist() },
    })
  }

  async function fetchJournal(c: TmaClient, j: SchoolJournal, today: string) {
    const events: RawEvent[] = []
    for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
      const p = eventsPageSchema.parse(await c.events(j.id, { page })).events
      events.push(...p.data)
      if (p.current_page >= p.last_page) break
    }
    const now = Date.parse(`${today}T12:00:00`)
    for (let i = 1; i <= (config?.TMA_PAST_DAYS ?? 0); i++) {
      const date = localDay(now - i * 86_400_000)
      events.push(...eventsPageSchema.parse(await c.events(j.id, { date, page: 1 })).events.data)
    }
    const messages: SchoolMessage[] = []
    for (let page = 1; page <= MAX_MESSAGE_PAGES; page++) {
      const p = transmissionsPageSchema.parse(await c.transmissions(j.id, page))
      messages.push(...p.data.map((t) => mapMessage(t, j.id)))
      if (p.current_page >= p.last_page) break
    }
    const posts: SchoolPost[] = []
    for (let page = 1; page <= MAX_POST_PAGES; page++) {
      const p = postsPageSchema.parse(await c.posts(j.id, page))
      for (const item of p.data) {
        const post = postSchema.safeParse(item)
        if (post.success) posts.push(mapPost(post.data, j.id))
      }
      if (!p.next_page) break
    }
    return { events, messages, posts }
  }

  async function refresh(): Promise<void> {
    if (!state.account || !client || sessionLost) return
    try {
      const journals = mapJournals(spacesSchema.parse(await client.spaces()))
      const today = localDay(ctx?.clock.now() ?? Date.now())
      const events = new Map<number, { journalId: string; raw: RawEvent }>()
      const messages: SchoolMessage[] = []
      const posts = new Map<number, SchoolPost>()
      for (const j of journals) {
        const r = await fetchJournal(client, j, today)
        for (const e of r.events) events.set(e.id, { journalId: j.id, raw: e })
        messages.push(...r.messages)
        // a school announcement arrives in every class: only once here
        for (const p of r.posts) if (!posts.has(p.id)) posts.set(p.id, p)
      }
      snapshot = {
        journals,
        events: [...events.values()].sort((a, b) => a.raw.date.localeCompare(b.raw.date) || a.raw.id - b.raw.id),
        messages: messages.sort((a, b) => b.at.localeCompare(a.at)),
        posts: [...posts.values()].sort((a, b) => b.at.localeCompare(a.at)),
        fetchedAt: ctx?.clock.now() ?? Date.now(),
      }
      lastError = null
    } catch (err) {
      // keep the last successful read: a site that does not answer does not wipe the homework
      lastError = (err as Error).message
      if (err instanceof SessionLostError) { sessionLost = true; ctx?.logger.warn('toutemonannee session lost'); return }
      throw err
    }
  }

  const status = () => ({
    linked: !!state.account,
    username: state.account?.username ?? null,
    sessionLost,
    fetchedAt: snapshot?.fetchedAt ?? null,
    error: lastError,
  })

  const school = () => {
    const done = new Set(state.done)
    return {
      ...status(),
      journals: snapshot?.journals ?? [],
      homework: (snapshot?.events ?? []).map((e) => mapHomework(e.raw, e.journalId, done.has(e.raw.id))),
      messages: snapshot?.messages ?? [],
      posts: snapshot?.posts ?? [],
      filters: state.filters,
      postsSeen: state.postsSeen,
    }
  }

  async function setDone(journalId: string, id: number, done: boolean) {
    const entry = snapshot?.events.find((e) => e.raw.id === id && e.journalId === journalId)
    if (!entry) throw new PluginError('UPSTREAM_ERROR', `unknown homework ${id}`)
    if (!(entry.raw.ack_needed && entry.raw.can_ack)) {
      const set = new Set(state.done)
      if (done) set.add(id)
      else set.delete(id)
      state = { ...state, done: [...set] }
      await persist()
      return
    }
    // The site's checkbox TOGGLES on each call: we re-read the state first, and only toggle if it
    // differs — two screens or two quick clicks do not cancel each other out.
    if (!client) throw new SessionLostError()
    const day = eventsPageSchema.parse(await client.events(journalId, { date: entry.raw.date, page: 1 })).events.data
    const current = day.find((e) => e.id === id) ?? entry.raw
    let fresh = current
    if ((current.has_acknowledged === true) !== done) {
      fresh = ackResponseSchema.parse(await client.acknowledge(journalId, id)).event
      if ((fresh.has_acknowledged === true) !== done) throw new PluginError('UPSTREAM_ERROR', 'TouteMonAnnée did not take the change')
    }
    entry.raw = fresh
  }

  return {
    id: 'toutemonannee',
    configSchema: tmaConfigSchema,

    async init(context) {
      ctx = context
      config = tmaConfigSchema.parse(context.config)
      store = deps.store ?? createTmaFile(config.TMA_FILE, context.logger)
      state = await store.load()
      makeClient()
    },
    async discover() { return [] },
    async start() {
      if (!ctx || !config) return
      poller = createPoller({ name: 'toutemonannee', intervalMs: config.TMA_REFRESH_MS, fn: refresh, clock: ctx.clock, signal: ctx.signal, logger: ctx.logger })
    },
    async execute(_externalId, command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `toutemonannee publishes no device (${command.type})`)
    },
    async stop() {
      poller?.stop()
      poller = null
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status())
      app.get('/school', async () => school())

      /**
       * Link the account. The password only lives for the duration of this request: neither kept,
       * nor logged, nor returned. What comes out are the cookies in the state file.
       */
      app.post<{ Body: unknown }>('/login', async (req, reply) => {
        const body = z.object({ username: z.string().trim().min(1).max(200), password: z.string().min(1).max(200) }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'username and password are required')
        try {
          await client!.login(body.data.username, body.data.password)
        } catch (err) {
          const e = describeError(err)
          return sendError(reply, e.code === 'NEEDS_PAIRING' ? 401 : 502, e.code, e.message)
        }
        state = { ...state, account: { username: body.data.username }, cookies: client!.cookies }
        await persist()
        sessionLost = false
        lastError = null
        await refresh().catch(() => undefined)
        return school()
      })

      /** Unlink: the cookies are erased; the filters and the "done" checkboxes stay. */
      app.post('/logout', async () => {
        client?.forget()
        state = { ...state, account: null, cookies: {} }
        await persist()
        snapshot = null
        sessionLost = false
        lastError = null
        return school()
      })

      app.post('/refresh', async (_req, reply) => {
        try { await refresh() } catch (err) {
          const e = describeError(err)
          return sendError(reply, 502, e.code, e.message)
        }
        return school()
      })

      app.put<{ Params: { journal: string; id: string }; Body: unknown }>('/homework/:journal/:id/done', async (req, reply) => {
        const body = z.object({ done: z.boolean() }).safeParse(req.body)
        const id = Number(req.params.id)
        if (!body.success || !Number.isInteger(id)) return sendError(reply, 400, 'INVALID_BODY', '{ done: boolean } expected')
        if (!snapshot?.events.some((e) => e.raw.id === id && e.journalId === req.params.journal)) return sendError(reply, 404, 'NOT_FOUND', `unknown homework ${id}`)
        try { await setDone(req.params.journal, id, body.data.done) } catch (err) {
          if (err instanceof SessionLostError) sessionLost = true
          const e = describeError(err)
          return sendError(reply, e.code === 'NEEDS_PAIRING' ? 401 : 502, e.code, e.message)
        }
        return school()
      })

      app.put<{ Body: unknown }>('/filters', async (req, reply) => {
        const body = z.object({
          hiddenJournals: z.array(z.string().max(80)).max(50),
          hiddenLevels: z.array(z.string().max(10)).max(20),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'hiddenJournals and hiddenLevels (string arrays) expected')
        state = { ...state, filters: body.data }
        await persist()
        return school()
      })

      app.put<{ Body: unknown }>('/posts/seen', async (req, reply) => {
        const body = z.object({ id: z.number().int().min(0) }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', '{ id: number } expected')
        if (body.data.id > state.postsSeen) {
          state = { ...state, postsSeen: body.data.id }
          await persist()
        }
        return school()
      })
    },

    health(): PluginHealth {
      const keys = Object.keys(tmaConfigSchema.shape)
      if (!state.account) return { status: 'needs_pairing', detail: 'no TouteMonAnnée account linked', keys }
      if (sessionLost) return { status: 'needs_pairing', detail: 'TouteMonAnnée session lost — link the account again', keys }
      if (lastError) return { status: 'degraded', detail: lastError, keys }
      const n = snapshot?.journals.length ?? 0
      return { status: 'ok', detail: `${n} class${n === 1 ? '' : 'es'}`, keys }
    },
  }
}
