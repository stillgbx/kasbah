import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, JournalEntry, PluginHealth, StatePatch } from '@kasbah/shared'
import { createBackoff } from '../../core/backoff'
import { PluginError, type DevicePlugin, type PluginContext, type PluginJournal, type PluginSiteMap } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { AutomowerAuth } from './auth'
import { AutomowerClient } from './client'
import { actionBody, applyEvent, connectedOf, isTimeZone, parseMowers, toDescriptor, toJournal, toJournalEntry, toSiteMap, toStatePatch } from './mapping'
import { WINDOW_MS, WINDOW_REQUESTS, createUsageFile, currentUsage, type AutomowerUsage, type UsageStore } from './state'
import { AutomowerSocket, type WsFactory } from './ws'
import { mowerListSchema, wsEventSchema, wsReadySchema, type MowerData } from './types'

// Husqvarna Automower plugin — Automower Connect API (vendor cloud, nothing local).
//
// What the vendor imposes, and what the plugin does with it:
//
//  1. An APPLICATION on developer.husqvarnagroup.cloud, linked to the two APIs "Authentication" and
//     "Automower Connect": its key and secret are enough (`client_credentials`), the token
//     represents the account that created it — hence the robot's owner. No consent in a browser,
//     no token to keep: it is requested again, and lasts a day.
//  2. A QUOTA of 21 000 requests per seven-day window and per key (developer portal, read on
//     2026-09-16; third-party documentation said 10 000 per month), and one per second. Hence the
//     WebSocket: the vendor pushes battery, activity, schedule, position and cutting height there
//     as soon as they change, for free; REST only serves to read the full state at startup, on
//     each stream reconnection, then at a slow pace to resynchronize (`AUTOMOWER_POLL_MS`).
//     The window's counter survives a restart (`state.ts`) and shows in the view's gauge.
//  3. TIMESTAMPS in local time written as if it were UTC (next start, error): the house's time
//     zone turns them back into real instants (`mapping.ts`).
//
// The robot publishes its POSITION as GPS; it is the 3D scene that projects it onto the grounds, as
// for a vehicle. The plugin does not know the house's reference frame and does not need to.
//
// STATE OF THIS FILE: phase 1, verified on the real account on 2026-09-16 (list read, stream open,
// fixtures replaced by the capture of `GET /api/plugins/automower/raw`). The stream's events, for
// their part, are still to be captured.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const automowerConfigSchema = z.object({
  /** The application's key ("Application key") and secret, developer.husqvarnagroup.cloud. */
  AUTOMOWER_APP_KEY: optionalKey,
  AUTOMOWER_APP_SECRET: optionalKey,
  /**
   * Pace of the full re-read. The event stream carries the live data; this read only serves to
   * catch up on what it might have missed. 10 min = 4 320 requests per month, under half the quota.
   */
  AUTOMOWER_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(600_000),
  /** Time zone of the robot's "local" timestamps. Default: the server's. */
  AUTOMOWER_TIMEZONE: optionalKey.refine((tz) => tz === undefined || isTimeZone(tz), 'AUTOMOWER_TIMEZONE: fuseau IANA inconnu'),
  /** Where to keep the window's request count. Empty string = keep nothing. */
  AUTOMOWER_USAGE_FILE: z.string().trim().default(stateFile('automower-usage.json')),
  /**
   * A quota reset instant as the developer portal displays it ("Resets at …"), in ISO 8601: aligns
   * the seven-day window exactly. Absent = the first request is authoritative.
   */
  AUTOMOWER_QUOTA_RESET_AT: optionalKey.refine((v) => v === undefined || Number.isFinite(Date.parse(v)), 'AUTOMOWER_QUOTA_RESET_AT: date ISO 8601 attendue'),
})
export type AutomowerConfig = z.infer<typeof automowerConfigSchema>

/** What the Settings card and the tests read. Never the key or the secret. */
export interface AutomowerStatus {
  configured: boolean
  mowers: { id: string; name: string; model: string | null; connected: boolean }[]
  live: boolean
  pollMs: number
  timezone: string
  /** API requests since the start of the seven-day window, and when it resets. */
  requestsInWindow: number
  windowLimit: number
  windowResetAt: number
  lastError: string | null
}

export interface AutomowerPluginDeps {
  fetchImpl?: FetchLike
  wsFactory?: WsFactory
  usageStore?: UsageStore
}

/** Between two re-reads forced by the stream (reconnection, unknown robot), at least this. */
const RESYNC_MIN_MS = 60_000
/**
 * After a stay-out zone toggle, the state is re-read after this delay: the vendor acknowledges with a
 * 202 before the robot has applied it, and no stream event carries these zones.
 */
const ZONE_REFRESH_MS = 5_000
/** After "mow an area": the time for the robot to take the order and publish the target area. */
const AREA_REFRESH_MS = 10_000

/** Beyond this, a kept map is re-read on its next request: a REDRAWN outline changes neither id nor name. */
const SITE_MAP_MAX_AGE_MS = 24 * 3_600_000

/**
 * What the LIST (read every ten minutes, at no extra cost) says about a map's zones: their ids and
 * their NAMES — it is by name that the map links a drawn zone to its `workAreaId` —, and the
 * `dirty` flag, true while the robot synchronizes a map modified in the app. Not the enabled
 * state: it changes nothing in the outline. A different key = the kept map is stale.
 */
function zonesKey(m: MowerData): string {
  const list = (items: unknown[] | null | undefined, id: string) =>
    (items ?? []).map((z) => { const r = z as Record<string, unknown>; return `${String(r?.[id])}:${String(r?.name ?? '').trim()}` }).sort().join(',')
  return `${list(m.attributes.workAreas, 'workAreaId')}|${list(m.attributes.stayOutZones?.zones, 'id')}|${m.attributes.stayOutZones?.dirty === true}`
}

export function createAutomowerPlugin(deps: AutomowerPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: AutomowerConfig | null = null
  let auth: AutomowerAuth | null = null
  let client: AutomowerClient | null = null
  let socket: AutomowerSocket | null = null
  let poller: { stop(): void } | null = null
  let usageStore: UsageStore | null = null
  let usage: AutomowerUsage = { windowStart: 0, requests: 0 }
  let quotaAnchor: number | undefined
  let tz = 'UTC'
  let lastError: string | null = null
  let lastResync = 0
  /** Last full read of each robot, by vendor id. */
  const mowers = new Map<string, MowerData>()
  /**
   * The latest RAW stream messages, as received: this is how the event fixtures are captured
   * (`GET /raw/events`), the only ones not yet taken on the real account.
   */
  const recentEvents: { at: number; message: unknown }[] = []
  const RECENT_EVENTS_MAX = 200
  /**
   * Each robot's LOG, read from the vendor on first request (one request, counted), then kept up to
   * date by the stream's `message-event-v2` — without re-reading. `stale` after a stream cut:
   * messages may have gone by, the next request re-reads.
   */
  const journals = new Map<string, { entries: JournalEntry[]; stale: boolean }>()
  const JOURNAL_MAX = 100
  /**
   * Each robot's MAP, read from the vendor on first request (two requests: the grounds and the drawn
   * zones), kept with the list of zones it showed. When that list changes on a re-read (zone added
   * or removed in the app), the map is forgotten and will be read again.
   */
  const siteMaps = new Map<string, { map: PluginSiteMap; zones: string; at: number }>()
  /**
   * Re-read scheduled after a command whose effect the stream will not report: a stay-out zone
   * toggle (no event carries these zones), "mow an area" (the target area only arrives through the
   * full read). Only one at a time.
   */
  let zoneRefresh: unknown = null
  let published: DeviceDescriptor[] = []

  const log = () => ctx!.logger
  const configured = () => !!(config?.AUTOMOWER_APP_KEY && config?.AUTOMOWER_APP_SECRET)
  const mapOptions = () => ({ tz, now: ctx!.clock.now() })

  /** Every API request counts (not the tokens), and the count survives a restart. */
  function countCall(): void {
    usage = currentUsage(usage, ctx!.clock.now(), quotaAnchor)
    usage.requests += 1
    void usageStore?.save(usage)
  }
  const usageNow = () => currentUsage(usage, ctx?.clock.now() ?? Date.now(), quotaAnchor)

  /** Publishes the descriptors if the inventory changed (robot added, removed, renamed). */
  function publishDescriptors(): void {
    const next = [...mowers.values()].map(toDescriptor)
    if (JSON.stringify(next) === JSON.stringify(published)) return
    published = next
    ctx!.emitDevices(next)
  }

  function emitFull(m: MowerData): void {
    const patch: StatePatch<'mower'> = toStatePatch(m, mapOptions())
    ctx!.emitState(m.id, patch)
    ctx!.setAvailable(m.id, connectedOf(m))
  }

  /** A full read in `ms`, unless one is already scheduled. */
  function readSoon(ms: number): void {
    if (zoneRefresh !== null) return
    zoneRefresh = ctx!.clock.setTimeout(() => {
      zoneRefresh = null
      if (!ctx) return
      pollOnce(ctx.signal).catch((err) => { lastError = (err as Error).message; log().warn({ err }, 'Automower: read after a command failed') })
    }, ms)
  }

  /** A full read: the list, the descriptors if needed, each robot's state. */
  async function pollOnce(signal?: AbortSignal): Promise<void> {
    const raw = await client!.mowers(signal)
    if (!mowerListSchema.safeParse(raw).success) throw new PluginError('UPSTREAM_ERROR', 'GET /mowers has an unexpected shape')
    const list = parseMowers(raw, (issue) => log().warn({ issue }, 'Automower: a mower was skipped, unexpected shape'))
    mowers.clear()
    for (const m of list) mowers.set(m.id, m)
    for (const [id, cached] of siteMaps) {
      const m = mowers.get(id)
      if (!m || zonesKey(m) !== cached.zones) siteMaps.delete(id)
    }
    publishDescriptors()
    for (const m of list) emitFull(m)
    lastError = null
  }

  /** Re-read NOW, but not more than once a minute: the stream may ask often. */
  function resync(reason: string): void {
    const now = ctx!.clock.now()
    if (now - lastResync < RESYNC_MIN_MS) return
    lastResync = now
    log().info({ reason }, 'Automower: full read requested')
    pollOnce(ctx!.signal).catch((err) => {
      lastError = (err as Error).message
      log().warn({ err }, 'Automower: full read failed')
    })
  }

  function onEvent(message: unknown): void {
    recentEvents.push({ at: ctx!.clock.now(), message })
    if (recentEvents.length > RECENT_EVENTS_MAX) recentEvents.splice(0, recentEvents.length - RECENT_EVENTS_MAX)
    const ready = wsReadySchema.safeParse(message)
    if (ready.success && !('type' in (message as object))) {
      log().debug({ connectionId: ready.data.connectionId }, 'Automower websocket ready')
      return
    }
    const ev = wsEventSchema.safeParse(message)
    if (!ev.success) { log().debug({ message }, 'Automower websocket: unknown message'); return }
    // a log line: it joins the log we keep, if it has already been read
    if (ev.data.type === 'message-event-v2') {
      const entry = toJournalEntry(ev.data.attributes?.message, tz)
      const j = journals.get(ev.data.id)
      if (entry && j && !j.entries.some((e) => e.at === entry.at && e.code === entry.code)) {
        j.entries = [entry, ...j.entries].sort((a, b) => b.at - a.at).slice(0, JOURNAL_MAX)
      }
      return
    }
    // a robot the list does not know: it was just added to the account, re-read everything
    const current = mowers.get(ev.data.id)
    if (!current) { resync(`event for unknown mower ${ev.data.id}`); return }
    // a delta merges into the known robot, and the merged robot is what we keep for the next one
    const applied = applyEvent(ev.data, current, mapOptions())
    if (!applied) return
    mowers.set(ev.data.id, applied.next)
    ctx!.emitState(ev.data.id, applied.patch)
    // the activity changed (start, mowing, return) on a robot with areas: the current area is only
    // in the full read — re-read it, once a minute at most (`resync`)
    const was = current.attributes.mower?.activity, now = applied.next.attributes.mower?.activity
    if (ev.data.type === 'mower-event-v2' && current.attributes.capabilities?.workAreas && now && now !== was) resync('mower activity changed')
  }

  function status(): AutomowerStatus {
    return {
      configured: configured(),
      mowers: [...mowers.values()].map((m) => ({ id: m.id, name: toDescriptor(m).name, model: m.attributes.system?.model ?? null, connected: connectedOf(m) })),
      live: socket?.connected ?? false,
      pollMs: config?.AUTOMOWER_POLL_MS ?? 0,
      timezone: tz,
      requestsInWindow: usageNow().requests,
      windowLimit: WINDOW_REQUESTS,
      windowResetAt: usageNow().windowStart + WINDOW_MS,
      lastError,
    }
  }

  return {
    id: 'automower',
    configSchema: automowerConfigSchema,

    async init(context: PluginContext): Promise<void> {
      ctx = context
      config = context.config as AutomowerConfig
      // A plugin gets RESTARTED (toggle in Settings, sub-item changed): the host has then emptied
      // its devices with the result of `discover`. What we thought "already published" no longer is —
      // without this reset, `publishDescriptors` re-emitted nothing and the mower disappeared from
      // the registry while still being read (seen on the real server on 2026-09-16).
      published = []
      lastError = null
      lastResync = 0
      journals.clear()
      siteMaps.clear()
      zoneRefresh = null
      tz = config.AUTOMOWER_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
      usageStore = deps.usageStore ?? (config.AUTOMOWER_USAGE_FILE ? createUsageFile(config.AUTOMOWER_USAGE_FILE, context.logger) : null)
      quotaAnchor = config.AUTOMOWER_QUOTA_RESET_AT ? Date.parse(config.AUTOMOWER_QUOTA_RESET_AT) : undefined
      usage = currentUsage(await usageStore?.load() ?? null, context.clock.now(), quotaAnchor)
      if (!configured()) { log().info('Automower: no application key or secret, plugin idle (AUTOMOWER_APP_KEY / AUTOMOWER_APP_SECRET)'); return }
      const fetchImpl = deps.fetchImpl ?? fetch
      auth = new AutomowerAuth({ appKey: config.AUTOMOWER_APP_KEY!, appSecret: config.AUTOMOWER_APP_SECRET!, fetchImpl, now: () => context.clock.now() })
      client = new AutomowerClient({ auth, appKey: config.AUTOMOWER_APP_KEY!, fetchImpl, logger: context.logger, onCall: countCall })
      socket = new AutomowerSocket({
        token: (signal) => auth!.accessToken(signal),
        clock: context.clock, signal: context.signal, logger: context.logger,
        onEvent,
        // a reconnection may have missed events: the full state brings everything back in line, and
        // the log will be re-read on the next request
        onOpen: (reconnected) => {
          if (!reconnected) return
          for (const j of journals.values()) j.stale = true
          resync('websocket reconnected')
        },
        ...(deps.wsFactory ? { factory: deps.wsFactory } : {}),
      })
    },

    /**
     * No network call here (plugins start in series): the first read is in `start`. But what we
     * already KNOW (a restart keeps the last list) is repeated right away: the registry does not
     * stay empty during the re-read.
     */
    async discover(): Promise<DeviceDescriptor[]> {
      published = [...mowers.values()].map(toDescriptor)
      return published
    },

    async start(): Promise<void> {
      if (!configured()) return
      const intervalMs = config!.AUTOMOWER_POLL_MS
      poller = createPoller({
        name: 'automower', intervalMs, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
        // no tight retry: the quota is the scarce resource, and an upset API does not calm down in two seconds
        backoff: createBackoff({ initialMs: Math.min(intervalMs, 120_000), maxMs: intervalMs }),
        fn: async () => {
          try { await pollOnce(ctx!.signal) }
          catch (err) { lastError = (err as Error).message; throw err }
        },
      })
      socket!.start()
      log().info({ intervalMs, tz }, 'Automower started (polling + websocket)')
    },

    /**
     * Three gestures, translated into vendor actions (`mapping.ts`). The vendor acknowledges with a
     * 202 as soon as it has TAKEN the request; the effect then arrives through the event stream,
     * which is what updates the card — nothing is published here in anticipation.
     */
    async execute(externalId: string, command: Command): Promise<void> {
      if (!configured()) throw new PluginError('NEEDS_PAIRING', 'Automower: no application key or secret')
      const m = mowers.get(externalId)
      if (command.type === 'mower.set_stay_out_zone') {
        if (!m) throw new PluginError('DEVICE_UNAVAILABLE', `unknown mower ${externalId}`)
        // the map is syncing with the cloud: the vendor then refuses any toggle
        if (m.attributes.stayOutZones?.dirty) throw new PluginError('DEVICE_UNAVAILABLE', `stay-out zones of mower ${externalId} are syncing with Husqvarna, try again later`)
        await client!.stayOutZone(externalId, command.zoneId, command.enabled, ctx?.signal)
        log().info({ mower: externalId, zone: command.zoneId, enabled: command.enabled }, 'Automower stay-out zone change accepted')
        readSoon(ZONE_REFRESH_MS)
        return
      }
      if (command.type === 'mower.confirm_error') {
        if (!m) throw new PluginError('DEVICE_UNAVAILABLE', `unknown mower ${externalId}`)
        if (!connectedOf(m)) throw new PluginError('DEVICE_UNAVAILABLE', `mower ${externalId} is not connected to Husqvarna`)
        // an error the vendor does not clear remotely (code 2, no loop signal): refused without a call
        if (m.attributes.mower?.isErrorConfirmable !== true) throw new PluginError('DEVICE_UNAVAILABLE', `the current error of mower ${externalId} cannot be cleared remotely`)
        await client!.confirmError(externalId, ctx?.signal)
        log().info({ mower: externalId, code: m.attributes.mower?.errorCode }, 'Automower error confirmation accepted')
        return
      }
      const body = actionBody(command)
      if (!body) throw new PluginError('UNSUPPORTED_COMMAND', `Automower plugin does not support ${command.type}`)
      if (!m) throw new PluginError('DEVICE_UNAVAILABLE', `unknown mower ${externalId}`)
      if (!connectedOf(m)) throw new PluginError('DEVICE_UNAVAILABLE', `mower ${externalId} is not connected to Husqvarna`)
      await client!.action(externalId, body, ctx?.signal)
      log().info({ mower: externalId, action: body.data.type }, 'Automower action accepted')
      // the target area only arrives through the full read: re-read it once the robot has taken the order
      if (command.type === 'mower.start_in_area') readSoon(AREA_REFRESH_MS)
    },

    /**
     * The map of the grounds: the robot's survey (AIM, or failing that an EPOS robot's map), plus
     * the hand-drawn zones if there are any. Read once, then kept as long as the list says nothing
     * new (zones, names, synchronization: see `zonesKey`), and twenty-four hours at most: a redrawn
     * outline changes neither id nor name. At worst two requests a day, and only if someone looks.
     */
    async siteMap(externalId: string): Promise<PluginSiteMap> {
      if (!configured()) throw new PluginError('NEEDS_PAIRING', 'Automower: no application key or secret')
      const m = mowers.get(externalId)
      if (!m) throw new PluginError('DEVICE_UNAVAILABLE', `unknown mower ${externalId}`)
      const cached = siteMaps.get(externalId)
      if (cached && ctx!.clock.now() - cached.at < SITE_MAP_MAX_AGE_MS) return cached.map
      const maps: Parameters<typeof toSiteMap>[0] = []
      const read = async (source: 'generated' | 'zone' | 'site') => {
        const svg = await client!.mapSvg(externalId, source, ctx?.signal)
        if (svg !== null) maps.push({ svg, source })
        return svg !== null
      }
      // AIM: the surveyed grounds, then the drawn zones (404 as long as there are none); EPOS: its map
      if (await read('generated')) await read('zone')
      else await read('site')
      const map = toSiteMap(maps)
      siteMaps.set(externalId, { map, zones: zonesKey(m), at: ctx!.clock.now() })
      return map
    },

    /** The robot's log: read once from the vendor, then kept by the stream. */
    async journal(externalId: string): Promise<PluginJournal> {
      if (!configured()) throw new PluginError('NEEDS_PAIRING', 'Automower: no application key or secret')
      if (!mowers.has(externalId)) throw new PluginError('DEVICE_UNAVAILABLE', `unknown mower ${externalId}`)
      let j = journals.get(externalId)
      if (!j || j.stale) {
        const entries = toJournal(await client!.messages(externalId, ctx?.signal), tz).slice(0, JOURNAL_MAX)
        j = { entries, stale: false }
        journals.set(externalId, j)
      }
      return { entries: j.entries }
    },

    async stop(): Promise<void> {
      poller?.stop()
      poller = null
      if (zoneRefresh !== null) ctx?.clock.clearTimeout(zoneRefresh)
      zoneRefresh = null
      socket?.stop()
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status())

      /** The latest stream messages, raw and dated: the capture of the event fixtures. */
      app.get('/raw/events', async () => ({ live: socket?.connected ?? false, events: recentEvents }))

      /**
       * Realigns the counter on the developer PORTAL ("n of 21000 requests · Resets at …"): the
       * window's count, and the reset instant, kept in the usage file to align the following
       * windows. The estimate inevitably drifts (calls made outside Kasbah, file restarted from
       * zero); the portal remains the only truth — like Tesla's console.
       */
      app.post('/usage', async (req, reply) => {
        if (!ctx) return reply.code(409).send({ error: 'plugin not started' })
        const body = z.object({
          requests: z.number().int().min(0),
          resetAt: z.union([z.string().refine((v) => Number.isFinite(Date.parse(v)), 'ISO 8601'), z.number().int()]).optional(),
        }).safeParse(req.body)
        if (!body.success) return reply.code(400).send({ error: 'send { requests, resetAt? } (resetAt: ISO 8601 or ms epoch)' })
        const now = ctx.clock.now()
        if (body.data.resetAt !== undefined) quotaAnchor = typeof body.data.resetAt === 'number' ? body.data.resetAt : Date.parse(body.data.resetAt)
        usage = { ...currentUsage(usage, now, quotaAnchor), requests: body.data.requests, ...(quotaAnchor === undefined ? {} : { anchor: quotaAnchor }) }
        await usageStore?.save(usage)
        log().info({ usage }, 'Automower usage realigned on the developer portal')
        return status()
      })

      /** A robot's log as the vendor returns it (one request, counted). */
      app.get<{ Params: { id: string } }>('/raw/messages/:id', async (req, reply) => {
        if (!configured() || !client) return reply.code(409).send({ error: 'Automower: no application key or secret' })
        try { return { messages: await client.messages(req.params.id, ctx?.signal) } }
        catch (err) { lastError = (err as Error).message; return reply.code(502).send({ error: lastError }) }
      })

      /**
       * Raw readout, to capture as soon as the keys are set: it is what will replace the fixtures. One
       * request to the vendor, counted like the others.
       */
      app.get('/raw', async (_req, reply) => {
        if (!configured() || !client) return reply.code(409).send({ error: 'Automower: no application key or secret' })
        try {
          return { mowers: await client.mowers(ctx?.signal) }
        } catch (err) {
          lastError = (err as Error).message
          const code = err instanceof PluginError && err.code === 'NEEDS_PAIRING' ? 401 : 502
          return reply.code(code).send({ error: lastError })
        }
      })
    },

    health(): PluginHealth {
      const deviceCount = mowers.size
      if (!configured()) return { status: 'needs_pairing', detail: 'AUTOMOWER_APP_KEY and AUTOMOWER_APP_SECRET missing', deviceCount: 0 }
      const u = usageNow()
      const quota = { used: u.requests, limit: WINDOW_REQUESTS, labelKey: 'mower.quotaRequests', since: u.windowStart }
      if (lastError) return { status: 'degraded', detail: lastError, deviceCount, quota }
      const connected = [...mowers.values()].filter(connectedOf).length
      const flow = socket?.connected ? 'live events' : 'polling only'
      return { status: 'ok', detail: `${deviceCount} mower(s), ${connected} connected · ${flow} · ${u.requests}/${WINDOW_REQUESTS} requests this week`, deviceCount, quota }
    },
  }
}
