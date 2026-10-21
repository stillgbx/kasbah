import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import { createBackoff } from '../../core/backoff'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { DEFAULT_APP_VERSION, DEFAULT_BASE_URL, MelcloudAuth, createSessionFile, type SessionStore } from './auth'
import { MelcloudClient } from './client'
import { HeatingHistory, createHistoryFile, type HistoryStore } from './history'
import { toDescriptors, toDeviceLinks, toStatePatch, toSystem, toZones, zoneExternalId } from './mapping'
import type { DeviceLink, SystemReading } from './types'

// MELCloud plugin (Mitsubishi Electric heat pumps) — the vendor's cloud API.
//
// Nothing exists locally: an Ecodan's Wi-Fi module only talks to Mitsubishi's cloud, and there is
// NO public API for an individual. What remains is the MELCloud app's API, with what that implies:
//
//  1. A PASSWORD, not an OAuth. It crosses the server once (`POST /login`) and is never kept;
//     only the `ContextKey` survives (see `auth.ts`).
//  2. Responses ALWAYS IN HTTP 200, with the failure in the body (`ErrorId`) — the same trap as
//     Gigya at Renault.
//  3. A pace bounded by PHYSICS: the captured machine announces `NextCommunication` one minute
//     after `LastCommunication`. Polling faster than that re-reads the same thing.
//
// WHAT THE PLUGIN PUBLISHES: one `climate` device per heating ZONE, read-only. Not one device per
// machine — the reference installation has three Zubadan in cascade behind a single controller,
// and MELCloud only shows one. No tank either: `HasHotWaterTank` is false, this house's tank is
// not driven by the heat pump.
//
// WHAT IT DOES NOT PUBLISH: the MACHINE's state (defrost, backup heaters, circulators, flow/return,
// demand). A dozen sensors for values only looked at in one place would clutter the inventory,
// the search and the 3D scene; they are served to the Heating view by
// `GET /api/plugins/melcloud/system`.

/** Depth of the `raw` energy report, when the request asks for no other. */
const REPORT_DAYS = 7

export const melcloudConfigSchema = z.object({
  /**
   * API entry point. In the configuration for the same reason as the Renault keys: the vendor may
   * move it, and a new address must go into `.env` without touching the code.
   */
  MELCLOUD_BASE_URL: z.string().url().default(DEFAULT_BASE_URL),
  /** Application version announced at sign-in (MELCloud requires it). */
  MELCLOUD_APP_VERSION: z.string().trim().min(1).default(DEFAULT_APP_VERSION),
  /** Where to keep the session key. The account's password is NEVER written there. */
  MELCLOUD_SESSION_FILE: z.string().trim().default(stateFile('melcloud-session.json')),
  /**
   * Read pace. ONE single call per round whatever the number of machines: `ListDevices` returns
   * the whole account at once, and it is richer than the detailed read (210 fields against 42).
   * One minute follows a machine that reports to the cloud every minute (the user asked for fresher
   * figures than two minutes gave: up to five minutes late on the Heating view), and it is the floor.
   */
  MELCLOUD_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(60_000),
  /**
   * Where to keep the ALREADY COMPUTED operating history (one week of hours, a few tens of
   * kilobytes). The vendor serves none on this installation: it is built poll after poll, and
   * without this file it would start from zero on every restart. Empty string = keep nothing.
   */
  MELCLOUD_HISTORY_FILE: z.string().trim().default(stateFile('melcloud-history.json')),
})
export type MelcloudConfig = z.infer<typeof melcloudConfigSchema>

/** What the Settings card displays. Never carries the password or the session key. */
export interface MelcloudStatus {
  linked: boolean
  /** Account name as MELCloud returns it, to confirm the right one was linked. */
  accountName: string | null
  devices: { deviceId: string; name: string; family: string | null; buildingName: string | null }[]
  /** Number of devices published to the house: one heating zone, not one machine. */
  zoneCount: number
  pollMs: number
  sessionFile: string | null
  lastError: string | null
}

export interface MelcloudPluginDeps {
  /** Injected by the tests: every request (sign-in and API). */
  fetchImpl?: FetchLike
  sessionStore?: SessionStore
  historyStore?: HistoryStore
}

export function createMelcloudPlugin(deps: MelcloudPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: MelcloudConfig | null = null
  let auth: MelcloudAuth | null = null
  let client: MelcloudClient | null = null
  let links: DeviceLink[] = []
  let systems: SystemReading[] = []
  let lastError: string | null = null
  let poller: { stop(): void } | null = null
  let history = new HeatingHistory()
  let historyStore: HistoryStore | null = null
  /**
   * What has already been published to the registry, so as not to repeat it every round. Reset in
   * `init`: the host restarts a plugin WITHOUT re-instantiating it, and a surviving fingerprint
   * would suggest published devices that the registry has just emptied.
   */
  let publishedFingerprint: string | null = null

  const log = () => ctx!.logger

  /** The house's devices: one heating zone each, all machines together. */
  function descriptors(): DeviceDescriptor[] {
    return links.flatMap((l) => toDescriptors(l))
  }

  /**
   * One read round. ONE call for the whole account, then one state per zone.
   *
   * The descriptors are only republished if they changed: a machine that switches its zone 2 from
   * room temperature to the weather curve changes its `meta.climate.control`, and the UI must know
   * — but repeating the same thing every minute would churn the registry for nothing.
   */
  async function pollOnce(signal?: AbortSignal): Promise<void> {
    links = toDeviceLinks(await client!.listDevices(signal))
    const now = ctx!.clock.now()
    systems = links.map((l) => toSystem(l, now))

    const found = descriptors()
    const fingerprint = JSON.stringify(found)
    if (fingerprint !== publishedFingerprint) {
      ctx!.emitDevices(found)
      publishedFingerprint = fingerprint
      log().info({ zones: found.length, units: links.length }, 'MELCloud devices published')
    }

    let rolled = false
    for (const link of links) {
      const zones = toZones(link.fields)
      for (const z of zones) {
        ctx!.emitState(zoneExternalId(link.deviceId, z.zone), toStatePatch(link.fields, z, now))
      }
      // the history only follows the FIRST machine: a household has one, and mixing two heat pumps
      // in a single curve would mean nothing. To be revisited the day there are two.
      if (link === links[0]) rolled = history.record(toSystem(link, now), zones, now)
    }
    // write on the hour rollover, not on every poll: one read a minute would make 1440
    // writes a day to save at best a minute of trace
    if (rolled) await historyStore?.save(history.toState())
    lastError = null
  }

  /** Window asked for by the request, when it gives one (`?from=2026-01-01&to=2026-03-01`). */
  function pickRange(q: { from?: string; to?: string }): { from?: string; to?: string } {
    const clean = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(0, 10)}T00:00:00` : undefined)
    const from = clean(q.from)
    const to = clean(q.to)
    return { ...(from ? { from } : {}), ...(to ? { to } : {}) }
  }

  /** Bounds of the energy report, in the format MELCloud expects (local, no time zone). */
  function reportRange(now: number): { from: string; to: string } {
    const iso = (t: number) => new Date(t).toISOString().slice(0, 19)
    return { from: iso(now - REPORT_DAYS * 86_400_000), to: iso(now) }
  }

  function status(): MelcloudStatus {
    return {
      linked: auth?.linked ?? false,
      accountName: auth?.accountName ?? null,
      devices: links.map((l) => ({ deviceId: l.deviceId, name: l.name, family: l.family, buildingName: l.buildingName })),
      zoneCount: descriptors().length,
      pollMs: config?.MELCLOUD_POLL_MS ?? 0,
      sessionFile: config?.MELCLOUD_SESSION_FILE ?? null,
      lastError,
    }
  }

  return {
    id: 'melcloud',
    configSchema: melcloudConfigSchema,

    async init(context: PluginContext): Promise<void> {
      ctx = context
      config = context.config as MelcloudConfig
      // reset: the host RESTARTS a plugin without re-instantiating it, and anything used to decide
      // "have I already published?" would lie on the next round (`3_2_ecrire-un-plugin.md`)
      links = []
      systems = []
      publishedFingerprint = null
      lastError = null
      const store = deps.sessionStore ?? createSessionFile(config.MELCLOUD_SESSION_FILE, context.logger)
      historyStore = deps.historyStore ?? (config.MELCLOUD_HISTORY_FILE ? createHistoryFile(config.MELCLOUD_HISTORY_FILE, context.logger) : null)
      history = new HeatingHistory(await historyStore?.load())
      auth = new MelcloudAuth({
        baseUrl: config.MELCLOUD_BASE_URL,
        appVersion: config.MELCLOUD_APP_VERSION,
        fetchImpl: deps.fetchImpl ?? fetch,
        store,
        logger: context.logger,
      })
      client = new MelcloudClient({
        baseUrl: config.MELCLOUD_BASE_URL,
        auth,
        fetchImpl: deps.fetchImpl ?? fetch,
        logger: context.logger,
      })
      if (await auth.restore()) log().info('MELCloud account restored from the session cache')
      else log().info('no MELCloud account linked yet: POST /api/plugins/melcloud/login')
    },

    /**
     * NO network call: plugins start in series, and a slow API would delay all the following ones.
     * We repeat what we already know (nothing on the first start); it is the poller's first read,
     * immediate, that publishes the zones through `emitDevices`.
     */
    async discover(): Promise<DeviceDescriptor[]> {
      return descriptors()
    },

    async start(): Promise<void> {
      if (!auth?.linked) return
      const intervalMs = config!.MELCLOUD_POLL_MS
      poller = createPoller({
        name: 'melcloud',
        intervalMs,
        clock: ctx!.clock,
        signal: ctx!.signal,
        logger: ctx!.logger,
        // no tight retry: the machine will say nothing new before its next report, and retrying
        // in two seconds would only upset an API that is already silent
        backoff: createBackoff({ initialMs: intervalMs, maxMs: intervalMs }),
        fn: () => pollOnce(ctx!.signal),
      })
      log().info({ intervalMs }, 'MELCloud polling started')
    },

    /**
     * Deliberately read-only. The opposite of an oversight: the zones declare neither `target_temp`
     * nor `hvac_mode`, so the UI offers no button that would end up here.
     */
    async execute(_externalId: string, command: Command): Promise<void> {
      throw new PluginError('UNSUPPORTED_COMMAND', `MELCloud plugin is read-only for now (${command.type})`)
    },

    async stop(): Promise<void> {
      poller?.stop()
      poller = null
      // the current hour is not written yet (we only write on rollover): saving it here avoids
      // losing it on every restart, which would punch a hole in the curve once per work session
      await historyStore?.save(history.toState())
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status())

      /**
       * The MACHINES' state, for the Heating view: what does not deserve to be a device but that we
       * want to see on a page. Returns the poll's last read, never a new call — same rule as the
       * weather forecast and the consumption history.
       */
      app.get('/system', async (_req, reply) => {
        if (!auth?.linked) return reply.code(409).send({ error: 'no MELCloud account linked' })
        return { units: systems, pollMs: config!.MELCLOUD_POLL_MS }
      })

      /**
       * The operating history, built poll after poll. Returned as is: it is an accumulated trace,
       * never a report redone on demand.
       */
      app.get('/history', async () => ({ ...history.toState(), pollMs: config!.MELCLOUD_POLL_MS }))

      /**
       * Link the account. The password only lives for the duration of this request: it is neither
       * kept, nor logged, nor returned. What comes out is a `ContextKey` in the session file.
       */
      app.post<{ Body: { email?: string; password?: string } }>('/login', async (req, reply) => {
        const body = z.object({ email: z.string().trim().min(1), password: z.string().min(1) }).safeParse(req.body)
        if (!body.success) return reply.code(400).send({ error: 'email and password are required' })
        try {
          await auth!.login(body.data.email, body.data.password, ctx?.signal)
          await pollOnce(ctx?.signal)
          log().info({ units: links.length }, 'MELCloud account linked')
          return status()
        } catch (err) {
          lastError = (err as Error).message
          const code = err instanceof PluginError && err.code === 'NEEDS_PAIRING' ? 401 : 502
          return reply.code(code).send({ error: lastError })
        }
      })

      /** Unlink: the session key is erased, nothing else was ever kept. */
      app.post('/logout', async () => {
        await auth!.forget()
        links = []
        systems = []
        publishedFingerprint = null
        ctx?.emitDevices([])
        return status()
      })

      /**
       * Raw readout, as used to write the mapping and the fixtures. Each read is attempted
       * separately and its failure is RETURNED rather than thrown — knowing what MELCloud refuses
       * is worth as much as knowing what it gives.
       *
       * The energy report's window is adjustable (`?from=2026-01-15&to=2026-02-15`): a September
       * week returns zeros on a machine that is not heating, which proves nothing about whether a
       * meter exists. Winter had to be queried to settle it.
       *
       * Contains account ids and building names: to be ANONYMIZED before turning it into a repo
       * fixture.
       */
      app.get<{ Querystring: { from?: string; to?: string } }>('/raw', async (req, reply) => {
        if (!auth?.linked) return reply.code(409).send({ error: 'no MELCloud account linked' })
        try {
          const list = await client!.listDevices(ctx?.signal)
          const found = toDeviceLinks(list)
          links = found
          const { from, to } = { ...reportRange(ctx!.clock.now()), ...pickRange(req.query) }
          const details: unknown[] = []
          const reports: unknown[] = []
          for (const link of found) {
            try { details.push({ deviceId: link.deviceId, ok: true, body: await client!.device({ deviceId: link.deviceId, buildingId: link.buildingId, signal: ctx?.signal }) }) }
            catch (err) { details.push({ deviceId: link.deviceId, ok: false, error: (err as Error).message }) }
            try { reports.push({ deviceId: link.deviceId, ok: true, from, to, body: await client!.energyReport({ deviceId: link.deviceId, from, to, signal: ctx?.signal }) }) }
            catch (err) { reports.push({ deviceId: link.deviceId, ok: false, from, to, error: (err as Error).message }) }
          }
          return { devices: found.map((l) => ({ ...l, fields: undefined })), list, details, reports }
        } catch (err) {
          lastError = (err as Error).message
          return reply.code(502).send({ error: lastError })
        }
      })
    },

    health(): PluginHealth {
      const keys = ['MELCLOUD_BASE_URL', 'MELCLOUD_APP_VERSION', 'MELCLOUD_SESSION_FILE', 'MELCLOUD_POLL_MS', 'MELCLOUD_HISTORY_FILE']
      const zones = descriptors().length
      if (!auth?.linked) return { status: 'needs_pairing', detail: 'no MELCloud account linked', keys, deviceCount: 0 }
      if (lastError) return { status: 'degraded', detail: lastError, keys, deviceCount: zones }
      // say what we publish AND what we do not: "2 zones" on "1 unit" is exactly what surprises
      // someone who believes they have three heat pumps
      const faulty = systems.filter((s) => s.error.hasError).length
      const detail = `${zones} zone(s) on ${links.length} unit(s) · read-only${faulty ? ` · ${faulty} in error` : ''}`
      return { status: faulty ? 'degraded' : 'ok', detail, keys, deviceCount: zones }
    },
  }
}
