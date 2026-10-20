import type { Command, ConsumptionPoint, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginConsumption, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { createPoller } from '../../core/poll'
import { sendError } from '../../http/errors'
import { applyReading, monthlyOf, readingAt, type ComapHistoryCursor } from './history'
import { modelOf, parseRead, readRequest, toDescriptor, toStatePatch, STATION_ID } from './mapping'
import { netSocketFactory, readOnce, type SocketFactory } from './socket'
import { createHistoryFile, EMPTY_HISTORY, type ComapHistoryState, type HistoryStore } from './state'


// COMAP Proteo 2 plugin: a water filtration station read as plain JSON over TCP/23, no
// authentication, LAN only, fixed address in `COMAP_HOST` (no default). ONE SINGLE `water` device
// published — the station stays a single object, not one sensor per consumable. Read-only: the
// protocol can write (UVc lamp settings), but a remote mistake on drinking water would cost more
// than the comfort gained; this plugin never sends a `write` frame.
//
// The station accepts only ONE TCP connection at a time (verified 2026-09-16: a read made while the
// vendor's mobile app held the connection got no answer, even though the connection was accepted).
// Two consequences:
//  - each poll opens a SHORT connection, reads, closes (`socket.ts`) — never a permanent
//    connection, which would hog the station and break the owner's app;
//  - a silent read is a NORMAL event (someone else is talking to the station), not a failure: the
//    device only goes unavailable after several failures IN A ROW
//    (`AVAILABILITY_FAILURE_THRESHOLD`), never on a single silence.

export const comapConfigSchema = z.object({
  /**
   * Station address. No default: the station cannot be discovered, and an example address would
   * probe a random machine. When missing, the plugin declares nothing and says so in its health
   * (like `TAHOMA_HOST`), instead of blocking the configuration of every plugin at startup.
   */
  COMAP_HOST: z.string().trim().min(1).optional(),
  COMAP_PORT: z.coerce.number().int().min(1).max(65535).default(23),
  /**
   * Polling rate. The station is on the LAN, with no quota or cloud, but nothing justifies hammering
   * it: consumable wear and consumption counters change slowly, and closer polling would mostly
   * raise the risk of landing during a session of the vendor's app (only one TCP connection at a
   * time). Thirty seconds tracks the instantaneous flow closely enough for display without ever
   * squeezing the station.
   */
  COMAP_POLL_MS: z.coerce.number().int().min(5_000).max(600_000).default(30_000),
  /** The station accepts the connection even when it is already busy, and then never answers. */
  COMAP_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  /** Where to keep the consumption history already computed (see `history.ts`). Empty string = keep nothing. */
  COMAP_HISTORY_FILE: z.string().trim().default(stateFile('comap-consumption.json')),
})
export type ComapConfig = z.infer<typeof comapConfigSchema>

export interface ComapPluginDeps {
  /** Injected by tests: TCP socket factory (see `socket.ts`). */
  connect?: SocketFactory
  /** Injected by tests: consumption history file (see `state.ts`). */
  historyStore?: HistoryStore
}

/**
 * Consecutive read failures tolerated before declaring the station unavailable. Three polls missed
 * in a row, at the default rate, cover 90 s of silence — well beyond the observed session of the
 * vendor's app (23:09:34-23:10:24, 50 s) — before concluding to a real failure rather than a
 * connection busy elsewhere.
 */
const AVAILABILITY_FAILURE_THRESHOLD = 3

export function createComapPlugin(deps: ComapPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: ComapConfig | null = null
  let connect: SocketFactory = netSocketFactory
  let model: string | undefined
  let msgId = 0
  let failures = 0
  let lastError: string | null = null
  let poller: { stop(): void } | null = null
  let historyStore: HistoryStore | null = null
  /** History already computed: SURVIVES a restart (re-read from the file in `init`). */
  let history: ComapHistoryState = EMPTY_HISTORY
  /**
   * What is needed to date and quantify the NEXT delta. Unlike `history`, does NOT survive a restart:
   * a poll following a restart has no previous reading (see `history.ts`).
   */
  let cursor: ComapHistoryCursor | undefined
  /** Monthly: never persisted, derived from the last successful reading (`year` + `month`). */
  let monthly: ConsumptionPoint[] = []

  async function read(): Promise<unknown> {
    const host = config!.COMAP_HOST
    if (!host) throw new Error('COMAP_HOST is not set')
    msgId += 1
    return readOnce({
      host, port: config!.COMAP_PORT, request: readRequest(msgId),
      connect, clock: ctx!.clock, signal: ctx!.signal, timeoutMs: config!.COMAP_TIMEOUT_MS,
    })
  }

  async function pollOnce(): Promise<void> {
    const raw = await read()
    const parsed = parseRead(raw)
    if (!parsed) throw new Error('unexpected COMAP response shape')
    ctx!.emitState(STATION_ID, toStatePatch(parsed))                 // implicit `available: true`
    const next = modelOf(parsed)
    if (next && next !== model) { model = next; ctx!.emitDevices([toDescriptor(model)]) }
    // `day`/`rtc` date and quantify the history; without either, nothing to get out of it this time.
    if (parsed.consumption?.day !== undefined && parsed.rtc) {
      const applied = applyReading(history, cursor, { day: parsed.consumption.day, at: readingAt(parsed.rtc) })
      history = applied.state
      cursor = applied.cursor
      void historyStore?.save(history)
      if (parsed.consumption.month !== undefined && parsed.consumption.year) {
        monthly = monthlyOf(parsed.rtc, parsed.consumption.month, parsed.consumption.year)
      }
    }
  }

  return {
    id: 'comap',
    configSchema: comapConfigSchema,

    async init(context) {
      ctx = context
      config = context.config as ComapConfig
      connect = deps.connect ?? netSocketFactory
      // A plugin is a closure that SURVIVES `stop()`: everything that decides "already published" or
      // "failing" is reset here, not only at module declaration.
      model = undefined
      msgId = 0
      failures = 0
      lastError = null
      // `history`, however, is NOT reset here: it is precisely what must survive a restart (see
      // `state.ts`). Only `cursor` (the previous reading for the next delta) starts from nothing.
      cursor = undefined
      monthly = []
      historyStore = deps.historyStore ?? (config.COMAP_HISTORY_FILE ? createHistoryFile(config.COMAP_HISTORY_FILE, context.logger) : null)
      history = await historyStore?.load() ?? EMPTY_HISTORY
    },

    /** No network call here: the device declares itself with its capabilities, the poller's first reading fills it in. */
    async discover(): Promise<DeviceDescriptor[]> {
      if (!config?.COMAP_HOST) return []
      return [toDescriptor(model)]
    },

    async start() {
      if (!config?.COMAP_HOST) return
      poller = createPoller({
        name: 'comap', intervalMs: config!.COMAP_POLL_MS, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
        fn: async () => {
          try {
            await pollOnce()
            failures = 0
            lastError = null
          } catch (err) {
            failures += 1
            lastError = (err as Error).message
            if (failures >= AVAILABILITY_FAILURE_THRESHOLD) ctx!.setAvailable(STATION_ID, false)
            throw err
          }
        },
      })
    },

    async execute(_externalId: string, command: Command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `COMAP station is read-only (${command.type})`)
    },

    /** The history kept poll after poll (`history.ts`): never a fresh reading on demand. */
    async consumption(externalId: string): Promise<PluginConsumption> {
      if (externalId !== STATION_ID) throw new PluginError('DEVICE_UNAVAILABLE', `unknown water device "${externalId}"`)
      return { hourly: history.hourly, daily: history.daily, monthly }
    },

    async stop() {
      poller?.stop()
      poller = null
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      /** Raw reading, to capture a fixture from a real response rather than the manual. */
      app.get('/raw', async (_req, reply) => {
        if (!ctx) return sendError(reply, 409, 'DEVICE_UNAVAILABLE', 'plugin not started')
        if (!config?.COMAP_HOST) return sendError(reply, 409, 'DEVICE_UNAVAILABLE', 'COMAP_HOST is not set')
        try { return await read() }
        catch (err) { return sendError(reply, 502, 'UPSTREAM_ERROR', (err as Error).message) }
      })
    },

    health(): PluginHealth {
      if (!ctx) return { status: 'error', detail: 'plugin not started' }
      if (!config?.COMAP_HOST) return { status: 'error', detail: 'set COMAP_HOST to the station address' }
      if (failures >= AVAILABILITY_FAILURE_THRESHOLD) {
        return { status: 'degraded', detail: lastError ?? 'station silent', deviceCount: 1 }
      }
      return { status: 'ok', detail: model ? `Proteo (${model})` : 'Proteo', deviceCount: 1 }
    },
  }
}
