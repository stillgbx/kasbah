import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, DeviceDescriptor, PluginHealth, StatePatch, VehicleSeat } from '@kasbah/shared'
import { createBackoff } from '../../core/backoff'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { sleep } from '../../core/clock'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import {
  DEFAULT_GIGYA_API_KEY, DEFAULT_GIGYA_URL, DEFAULT_KAMEREON_API_KEY, DEFAULT_KAMEREON_URL,
  RenaultAuth, createSessionFile, type SessionStore,
} from './auth'
import { DEFAULT_RATE_PER_HOUR, RenaultClient, carDataPath, isDeferred, isEndpointUnavailable } from './client'
import {
  chargeStartPayload, climateSettingsPayload, commandSummary, hvacSocThreshold, hvacStartPayload, inWindow, socTargetPayload, toAccounts, toDescriptor, toStatePatch, batteryFrame, levelRising, trackLevel, type LevelTrack,
  toMileageContracts, toVehicleLinks, wakePayload, type VehicleReadings,
} from './mapping'
import type { VehicleLink } from './types'

// Renault plugin (vehicles) — private Gigya + Kamereon API, the one used by the MY Renault app.
//
// There is NO official route for an individual: Ampere's developer portal only serves to write
// Android apps that run IN the car, and the vehicle data is resold B2B by an aggregator. What
// remains is the private API, with what that implies:
//
//  1. A PASSWORD, not OAuth. It passes through the server once (`POST /login`) and is never kept;
//     only Gigya's `login_token` survives (see `auth.ts`).
//  2. API KEYS that Renault rotates without notice — May 2026 broke every third-party integration
//     on the same day. Hence their presence in configuration, with a default.
//  3. A tight RATE (60 calls per hour), enforced by the client, not by the polling rate.
//
// And a peculiarity of the R5 E-Tech, which holds for the whole recent platform: several legacy
// readings answer 403 `err.func.wired.forbidden` (locking, tire pressure, charge mode). It's not
// an outage, it's "not for this vehicle": the plugin strikes them off its list instead of asking
// for them again.
//
// STATE OF THIS FILE: account linking, vehicle inventory and raw reading. The readings mapping and
// the polling await the capture of the real account (`GET /api/plugins/renault/raw`) — writing
// fixtures from the documentation is the mistake this project has already made twice.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const renaultConfigSchema = z.object({
  /** The account's country, required as a parameter on ALL Kamereon routes. */
  RENAULT_COUNTRY: z.string().trim().length(2).toUpperCase().default('FR'),
  /**
   * Endpoint and key for Gigya (authentication) then Kamereon (data). The defaults are those of
   * `fr_FR`; they are in configuration because Renault rotates them — a new key goes into `.env`
   * without touching the code.
   */
  RENAULT_GIGYA_URL: z.string().url().default(DEFAULT_GIGYA_URL),
  RENAULT_GIGYA_API_KEY: z.string().trim().min(1).default(DEFAULT_GIGYA_API_KEY),
  RENAULT_KAMEREON_URL: z.string().url().default(DEFAULT_KAMEREON_URL),
  RENAULT_KAMEREON_API_KEY: z.string().trim().min(1).default(DEFAULT_KAMEREON_API_KEY),
  /** Kamereon account to read, when the person has several. Absent = the first active account. */
  RENAULT_ACCOUNT_ID: optionalKey,
  /** Where to keep the Gigya session token. The password, for its part, is NEVER written there. */
  RENAULT_SESSION_FILE: z.string().trim().default(stateFile('renault-session.json')),
  /**
   * Read rate, 10 min like Tesla. Five readings per vehicle per round, i.e. some thirty calls per
   * hour — comfortably under the 60 Renault tolerates.
   */
  RENAULT_POLL_MS: z.coerce.number().int().min(120_000).max(3_600_000).default(600_000),
  /** Cap on calls per hour that the plugin imposes on itself, before Renault answers 429. */
  RENAULT_RATE_PER_HOUR: z.coerce.number().int().min(1).max(600).default(DEFAULT_RATE_PER_HOUR),
  /**
   * Time window of the charge wake-up (the server's LOCAL time). Outside this range, a plugged-in
   * car that isn't charging is most often waiting for its scheduled charge: shaking it would mean
   * fighting its own setting. Equal bounds = never.
   */
  RENAULT_WAKE_FROM: z.string().trim().default('08:00'),
  RENAULT_WAKE_TO: z.string().trim().default('20:00'),
  /** Minimum delay between two wake-ups of the SAME vehicle. */
  RENAULT_WAKE_EVERY_MS: z.coerce.number().int().min(300_000).max(21_600_000).default(900_000),
})
export type RenaultConfig = z.infer<typeof renaultConfigSchema>

/**
 * Readings attempted by the raw reading: everything the platform can serve, including what we
 * expect to see refused. That's precisely the point — the capture will tell what THIS vehicle
 * answers, and it's the capture that will decide the polling list.
 */
export const PROBE_ENDPOINTS = [
  { endpoint: 'battery-status', version: 2, adapter: 'kca' },
  { endpoint: 'cockpit', version: 1, adapter: 'kca' },
  { endpoint: 'cockpit', version: 2, adapter: 'kca' },
  { endpoint: 'location', version: 1, adapter: 'kca' },
  { endpoint: 'hvac-status', version: 1, adapter: 'kca' },
  { endpoint: 'charging-settings', version: 1, adapter: 'kca' },
  { endpoint: 'charge-mode', version: 1, adapter: 'kca' },
  { endpoint: 'lock-status', version: 1, adapter: 'kca' },
  { endpoint: 'pressure', version: 1, adapter: 'kca' },
  { endpoint: 'res-state', version: 1, adapter: 'kca' },
  { endpoint: 'ev/soc-levels', version: 1, adapter: 'kcm' },
  { endpoint: 'ev/settings', version: 1, adapter: 'kcm' },
] as const

/**
 * The polling readings: those the R5 accepted at capture, each filed under the key `toStatePatch`
 * expects. `cockpit` is in **v1** — v2 answers an HTTP 200 with no data.
 *
 * Six calls per vehicle per round (`ev/settings` carries the climate settings). At the 10-minute
 * default that makes 36 calls per hour for one vehicle, under the 60 Renault tolerates; the vehicle list is NOT re-read every round
 * (unlike Tesla, there is no sleep to watch). With two vehicles the cap would be crossed: it's
 * the client's token bucket that then refuses, without calling.
 */
export const READ_ENDPOINTS = [
  { key: 'battery', endpoint: 'battery-status', version: 2, adapter: 'kca' },
  { key: 'cockpit', endpoint: 'cockpit', version: 1, adapter: 'kca' },
  { key: 'location', endpoint: 'location', version: 1, adapter: 'kca' },
  { key: 'hvac', endpoint: 'hvac-status', version: 1, adapter: 'kca' },
  { key: 'socLevels', endpoint: 'ev/soc-levels', version: 1, adapter: 'kcm' },
  { key: 'settings', endpoint: 'ev/settings', version: 1, adapter: 'kcm' },
] as const satisfies readonly { key: keyof VehicleReadings; endpoint: string; version: number; adapter: 'kca' | 'kcm' }[]

/**
 * The charge wake-up is a checkable SUB-ITEM, not an environment variable: it writes to the car,
 * and the user must be able to turn it off from the interface without touching the server.
 */
/** Re-read after a climate command: the time for the telematics unit to take it and report it. */
const CLIMATE_FOLLOW_UP_MS = 60_000

export const CHARGE_WAKE = 'charge_wake'
const CHARGE_WAKE_PART = [{ id: CHARGE_WAKE, labelKey: 'vehicle.chargeWake', enabledByDefault: true }] as const

/**
 * What became of the last wake-up. Without this, a failing wake-up shows up NOWHERE except in the
 * server console: on 2026-09-19, five hours of refusals went unnoticed while a day of solar
 * surplus was being lost. It's the real flaw this session found.
 */
export interface WakeOutcome {
  at: number
  /** `sent` the command is filed; `deferred` Renault says "not now"; `failed` the rest. */
  result: 'sent' | 'deferred' | 'failed'
  /** The returned command (`type status commandId`), or the refusal message. */
  detail: string | null
}

/** What the Settings card displays. Never carries the password or a token. */
export interface RenaultStatus {
  linked: boolean
  country: string
  /** The chosen Kamereon account, and those the person owns. */
  accountId: string | null
  accounts: { accountId: string; accountType: string | null }[]
  vehicles: { vin: string; name: string }[]
  pollMs: number
  ratePerHour: number
  /** Delay (s) before the rate budget lets a call through; 0 = right away. */
  rateWaitS: number
  sessionFile: string | null
  lastError: string | null
  /** The last charge wake-up attempted, and what became of it. `null`: none since startup. */
  lastWake: WakeOutcome | null
}

export interface RenaultPluginDeps {
  /** Injected by tests: all requests (Gigya and Kamereon). */
  fetchImpl?: FetchLike
  sessionStore?: SessionStore
}

export function createRenaultPlugin(deps: RenaultPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: RenaultConfig | null = null
  let auth: RenaultAuth | null = null
  let client: RenaultClient | null = null
  let accountId: string | null = null
  let accounts: { accountId: string; accountType: string | null }[] = []
  let links: VehicleLink[] = []
  let lastError: string | null = null
  let poller: { stop(): void } | null = null
  /**
   * Readings THIS vehicle doesn't serve (`vin:endpoint`). The R5 refuses several, permanently:
   * asking for them again every seven minutes would waste the rate budget on always the same
   * answer. Emptied on restart — a model can gain an endpoint through a software update.
   */
  const unavailable = new Set<string>()
  /** Last wake-up sent per VIN: a vehicle doesn't get shaken in a loop. */
  const lastWake = new Map<string, number>()
  /** What became of the last wake-up attempted, all vehicles combined. */
  let lastWakeOutcome: WakeOutcome | null = null
  /** Last level and last climate threshold read, per VIN: enough to refuse BEFORE the action. */
  const lastHvac = new Map<string, { soc?: number; threshold?: number }>()
  /** The seats as published, per VIN: the state merge is shallow, `seatHeat` goes out whole. */
  const lastSeats = new Map<string, Partial<Record<VehicleSeat, number>>>()
  /** Level tracked frame after frame, per VIN: the charge's second witness only counts if it rises. */
  const levels = new Map<string, LevelTrack>()

  const log = () => ctx!.logger

  /** The Kamereon account to read: the configured one, otherwise the first active account. */
  async function resolveAccount(signal?: AbortSignal): Promise<string | null> {
    if (config!.RENAULT_ACCOUNT_ID) return (accountId = config!.RENAULT_ACCOUNT_ID)
    const personId = auth!.personId
    if (!personId) return null
    const found = toAccounts(await client!.person(personId, signal))
    accounts = found.map((a) => ({ accountId: a.accountId, accountType: a.accountType ?? null }))
    // failing an explicit Renault account, the first active one: that's the single-account household case
    const preferred = found.find((a) => a.accountType?.toUpperCase() === 'MYRENAULT') ?? found[0]
    return (accountId = preferred?.accountId ?? null)
  }

  /** Lists the account's vehicles, keeping the links for the status and the descriptors. */
  async function listVehicles(signal?: AbortSignal): Promise<VehicleLink[]> {
    const id = accountId ?? await resolveAccount(signal)
    if (!id) return (links = [])
    return (links = toVehicleLinks(await client!.vehicles(id, signal)))
  }

  /**
   * Reads a vehicle and publishes its state. Each reading is attempted separately: a refused
   * reading (403 or 404) is struck off for good, a failing reading doesn't stop the others from
   * publishing. We emit even partially — half a state is better than nothing, and `readAt` dates it.
   */
  async function readVehicle(vin: string, signal?: AbortSignal): Promise<void> {
    const id = accountId ?? await resolveAccount(signal)
    if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
    const readings: VehicleReadings = {}
    for (const r of READ_ENDPOINTS) {
      if (unavailable.has(`${vin}:${r.endpoint}`)) continue
      try {
        readings[r.key] = await client!.carData({ accountId: id, vin, endpoint: r.endpoint, version: r.version, adapter: r.adapter, signal })
      } catch (err) {
        if (isEndpointUnavailable(err)) {
          unavailable.add(`${vin}:${r.endpoint}`)
          log().info({ endpoint: r.endpoint }, 'Renault does not serve this reading for this vehicle, not asking again')
          continue
        }
        throw err
      }
    }
    const frame = batteryFrame(readings.battery)
    if (frame) levels.set(vin, trackLevel(levels.get(vin), frame.at, frame.soc))
    const patch = toStatePatch(readings, ctx!.clock.now(), { levelRising: levelRising(levels.get(vin)) })
    ctx!.emitState(vin, patch)
    lastHvac.set(vin, { soc: patch.soc ?? lastHvac.get(vin)?.soc, threshold: hvacSocThreshold(readings.hvac) ?? lastHvac.get(vin)?.threshold })
    if (patch.seatHeat) lastSeats.set(vin, { ...patch.seatHeat })
    // a failed wake-up must not make the reading fail: the state is already published
    try { await maybeWake(vin, patch, signal) }
    catch (err) {
      // "Not now" is not an outage: a command already pending (409) or the actions quota (429) are
      // the normal life of this API. Logging them as `warn` like the rest drowned the real signal.
      const deferred = isDeferred(err)
      lastWakeOutcome = { at: ctx!.clock.now(), result: deferred ? 'deferred' : 'failed', detail: (err as Error).message }
      if (deferred) log().info({ vin, err }, 'Renault is not taking a charge wake-up right now')
      else log().warn({ err, vin }, 'Renault charge wake-up failed')
    }
  }

  /**
   * The charge wake-up. The R5 DOES NOT RESUME charging on its own after a power cut (charger
   * driven by solar surplus, a passing cloud): it's a vehicle defect, unfixed for over a year. The
   * equivalent manual action is to lock/unlock it with the remote; through the API, what wakes it
   * is REWRITING its EV settings.
   *
   * Five conditions, all required: the sub-item is checked, we KNOW it's plugged in and not
   * charging (a missing field authorizes nothing), **the charge limit is not reached**, the time
   * is within the window, and the last wake-up is old enough. The plugin does NOT see the solar
   * surplus — no automation engine links two plugins yet — but it doesn't need to: "plugged in and
   * not charging" is exactly what the user notices before going to shake the car.
   *
   * Limit reached is the ORDINARY case of a plugged-in car that isn't charging: the night after a
   * finished charge, it no longer charges because it's FULL. Shaking it wouldn't change anything,
   * and this wake-up WRITES to the car — doing it every quarter hour all day would be disturbing
   * it for nothing.
   */
  async function maybeWake(vin: string, patch: StatePatch<'vehicle'>, signal?: AbortSignal): Promise<void> {
    if (!ctx!.parts[CHARGE_WAKE]) return
    if (patch.pluggedIn !== true || patch.charging !== false) return
    // level or target unknown: we can't PROVE the charge is finished, and a plugged-in car that
    // isn't charging remains the sign we're looking for — we wake it (unlike `pluggedIn` /
    // `charging`, whose absence forbids everything)
    const target = patch.chargeLimit
    if (patch.soc !== undefined && target != null && patch.soc >= target) return
    const now = ctx!.clock.now()
    if (!inWindow(new Date(now), config!.RENAULT_WAKE_FROM, config!.RENAULT_WAKE_TO)) return
    const since = now - (lastWake.get(vin) ?? 0)
    if (since < config!.RENAULT_WAKE_EVERY_MS) return
    const id = accountId
    if (!id) return
    // the settings to replay are READ first: we only rewrite what the car gave us
    const body = wakePayload(await client!.carData({ accountId: id, vin, endpoint: 'ev/settings', version: 1, adapter: 'kcm', signal }), now)
    if (!body) return
    // the response is a filed COMMAND, not a save: it, and it alone, says whether the wake-up was
    // taken — we used to throw it away
    const command = commandSummary(await client!.writeEvSettings({ accountId: id, vin, body, signal }))
    lastWake.set(vin, now)
    lastWakeOutcome = { at: now, result: 'sent', detail: command }
    log().info({ vin, soc: patch.soc, target: patch.chargeLimit, command, dataAgeMs: patch.readAt ? now - patch.readAt : null },
      'Renault charge wake-up sent (plugged in, not charging, below target)')
  }

  /** One round: all known vehicles. An error goes up to the poller, which logs it. */
  async function pollOnce(signal?: AbortSignal): Promise<void> {
    for (const link of links) await readVehicle(link.vin, signal)
    lastError = null
  }

  function status(): RenaultStatus {
    return {
      linked: auth?.linked ?? false,
      country: config?.RENAULT_COUNTRY ?? 'FR',
      accountId,
      accounts,
      vehicles: links.map((l) => ({ vin: l.vin, name: toDescriptor(l).name })),
      pollMs: config?.RENAULT_POLL_MS ?? 0,
      ratePerHour: config?.RENAULT_RATE_PER_HOUR ?? 0,
      rateWaitS: Math.ceil((client?.waitMs() ?? 0) / 1000),
      sessionFile: config?.RENAULT_SESSION_FILE ?? null,
      lastError,
      lastWake: lastWakeOutcome,
    }
  }

  return {
    id: 'renault',
    configSchema: renaultConfigSchema,
    parts: CHARGE_WAKE_PART,

    async init(context: PluginContext): Promise<void> {
      ctx = context
      config = context.config as RenaultConfig
      const store = deps.sessionStore ?? createSessionFile(config.RENAULT_SESSION_FILE, context.logger)
      auth = new RenaultAuth({
        gigyaUrl: config.RENAULT_GIGYA_URL,
        gigyaApiKey: config.RENAULT_GIGYA_API_KEY,
        fetchImpl: deps.fetchImpl ?? fetch,
        store,
        now: () => context.clock.now(),
        logger: context.logger,
      })
      client = new RenaultClient({
        baseUrl: config.RENAULT_KAMEREON_URL,
        apiKey: config.RENAULT_KAMEREON_API_KEY,
        country: config.RENAULT_COUNTRY,
        auth,
        fetchImpl: deps.fetchImpl ?? fetch,
        clock: context.clock,
        logger: context.logger,
        ratePerHour: config.RENAULT_RATE_PER_HOUR,
      })
      if (await auth.restore()) log().info('Renault account restored from the session cache')
      else log().info('no Renault account linked yet: POST /api/plugins/renault/login')
    },

    async discover(): Promise<DeviceDescriptor[]> {
      if (!auth?.linked) return []
      try {
        return (await listVehicles(ctx!.signal)).map((l) => toDescriptor(l))
      } catch (err) {
        lastError = (err as Error).message
        log().warn({ err }, 'could not list Renault vehicles')
        return []
      }
    },

    async start(): Promise<void> {
      if (!auth?.linked) return
      const intervalMs = config!.RENAULT_POLL_MS
      poller = createPoller({
        name: 'renault',
        intervalMs,
        clock: ctx!.clock,
        signal: ctx!.signal,
        logger: ctx!.logger,
        // no tight retry after a failure: the rate is the scarce resource, and retrying in two
        // seconds would only empty the token bucket on an already annoyed API
        backoff: createBackoff({ initialMs: intervalMs, maxMs: intervalMs }),
        fn: () => pollOnce(ctx!.signal),
      })
      log().info({ vehicles: links.length, intervalMs }, 'Renault polling started')
    },

    /**
     * `vehicle.refresh` (re-read NOW), the charge TARGET, the climate and STARTING the charge. Each
     * comes with a capability the plugin declares; not honoring it would make the UI offer a
     * button the plugin would refuse. Stopping the charge is something the R5 can't do: the server
     * stops the charger in its place (`meta.vehicle.stopViaCharger`).
     */
    async execute(externalId: string, command: Command): Promise<void> {
      if (command.type === 'vehicle.set_charge_limit') {
        const id = accountId
        if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
        // the levels are READ first: the floor is the user's setting, we replay it as is
        const levels = await client!.carData({ accountId: id, vin: externalId, endpoint: 'ev/soc-levels', version: 1, adapter: 'kcm', signal: ctx?.signal })
        const body = socTargetPayload(levels, command.percent, ctx!.clock.now())
        if (!body) throw new PluginError('UPSTREAM_ERROR', 'Renault gave no EV levels back to rewrite')
        await client!.writeSocLevels({ accountId: id, vin: externalId, body, signal: ctx?.signal })
        // the target is published right away: the next polling round will confirm it
        ctx!.emitState(externalId, { chargeLimit: command.percent })
        log().info({ vin: externalId, percent: command.percent }, 'Renault charge target set')
        return
      }
      if (command.type === 'vehicle.climate_start' || command.type === 'vehicle.climate_stop') {
        const id = accountId
        if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
        const start = command.type === 'vehicle.climate_start'
        // the R5 itself says below which level it refuses: we don't spend an action, a scarce one, on a certain refusal
        const known = lastHvac.get(externalId)
        if (start && known?.soc !== undefined && known.threshold !== undefined && known.soc < known.threshold) {
          throw new PluginError('LOW_BATTERY', `battery at ${known.soc} %, below the ${known.threshold} % climate threshold of this vehicle`)
        }
        const res = await client!.hvacStart({
          accountId: id, vin: externalId, signal: ctx?.signal,
          body: hvacStartPayload(start ? 'start' : 'cancel', start ? command.targetTempC : undefined),
        })
        log().info({ vin: externalId, action: start ? 'start' : 'cancel', command: commandSummary(res) }, 'Renault climate command sent')
        // a filed COMMAND, not an effect: we re-read a minute later to OBSERVE (`hvacStatus`)
        void (async () => {
          await sleep(ctx!.clock, CLIMATE_FOLLOW_UP_MS, ctx!.signal)
          if (!ctx || ctx.signal.aborted) return
          try { await readVehicle(externalId, ctx.signal) }
          catch (err) { log().debug({ err, vin: externalId }, 'Renault follow-up read after a climate command failed') }
        })()
        return
      }
      if (command.type === 'vehicle.climate_set') {
        const id = accountId
        if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
        // the settings are READ first: start time and programs are the user's
        const settings = await client!.carData({ accountId: id, vin: externalId, endpoint: 'ev/settings', version: 1, adapter: 'kcm', signal: ctx?.signal })
        const body = climateSettingsPayload(settings, command, ctx!.clock.now())
        if (!body) throw new PluginError('UPSTREAM_ERROR', 'Renault gave no EV settings back to rewrite')
        const res = await client!.writeEvSettings({ accountId: id, vin: externalId, body, signal: ctx?.signal })
        const seats = Object.fromEntries(Object.entries(command.seatHeat ?? {}).filter(([, v]) => v !== undefined))
        if (Object.keys(seats).length) lastSeats.set(externalId, { ...lastSeats.get(externalId), ...seats })
        ctx!.emitState(externalId, {
          ...(command.targetTempC !== undefined ? { climateTargetC: command.targetTempC } : {}),
          ...(Object.keys(seats).length ? { seatHeat: lastSeats.get(externalId) } : {}),
          ...(command.steeringWheelHeat !== undefined ? { steeringWheelHeat: command.steeringWheelHeat } : {}),
        })
        log().info({ vin: externalId, command: commandSummary(res) }, 'Renault climate settings written')
        return
      }
      if (command.type === 'vehicle.start_charge') {
        const id = accountId
        if (!id) throw new PluginError('NEEDS_PAIRING', 'no Kamereon account for this person')
        // the settings are READ first: only the active charge programs change (see `chargeStartPayload`)
        const settings = await client!.carData({ accountId: id, vin: externalId, endpoint: 'ev/settings', version: 1, adapter: 'kcm', signal: ctx?.signal })
        const now = ctx!.clock.now()
        const payload = chargeStartPayload(settings, now)
        if (!payload) throw new PluginError('UPSTREAM_ERROR', 'Renault gave no EV settings back to rewrite')
        let res: unknown
        try { res = await client!.writeEvSettings({ accountId: id, vin: externalId, body: payload.body, signal: ctx?.signal }) }
        catch (err) {
          // a settings command already pending (409): not an outage, but nothing went out
          if (isDeferred(err)) throw new PluginError('RATE_LIMITED', 'a Renault settings command is already pending for this vehicle: try again in a few minutes', { cause: err })
          throw err
        }
        // it's also a settings write: the charge wake-up must not post another one right behind it (409)
        lastWake.set(externalId, now)
        log().info({ vin: externalId, deactivatedPrograms: payload.deactivated, command: commandSummary(res) }, 'Renault charge start sent')
        // a filed COMMAND, not an effect: we re-read a minute later to OBSERVE the charge
        void (async () => {
          await sleep(ctx!.clock, CLIMATE_FOLLOW_UP_MS, ctx!.signal)
          if (!ctx || ctx.signal.aborted) return
          try { await readVehicle(externalId, ctx.signal) }
          catch (err) { log().debug({ err, vin: externalId }, 'Renault follow-up read after a charge start failed') }
        })()
        return
      }
      if (command.type === 'vehicle.stop_charge') {
        // the server stops the CHARGER instead (`meta.vehicle.stopViaCharger`); we only get here if
        // it found no single charger charging it at home
        throw new PluginError('UNSUPPORTED_COMMAND', 'this Renault cannot stop its charge remotely, and no single charger is charging it at home: stop it from the charger')
      }
      if (command.type !== 'vehicle.refresh') {
        throw new PluginError('UNSUPPORTED_COMMAND', `Renault plugin does not support ${command.type} yet`)
      }
      await readVehicle(externalId, ctx?.signal)
    },

    async stop(): Promise<void> {
      poller?.stop()
      poller = null
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => status())

      /**
       * Link the account. The password only lives for the duration of this request: it is not
       * kept, not logged, not sent back. What comes out of it is a `login_token` in the session file.
       */
      app.post<{ Body: { email?: string; password?: string } }>('/login', async (req, reply) => {
        const body = z.object({ email: z.string().trim().min(1), password: z.string().min(1) }).safeParse(req.body)
        if (!body.success) return reply.code(400).send({ error: 'email and password are required' })
        try {
          await auth!.login(body.data.email, body.data.password, ctx?.signal)
          accountId = null
          accounts = []
          await listVehicles(ctx?.signal)
          lastError = null
          log().info({ vehicles: links.length }, 'Renault account linked')
          return status()
        } catch (err) {
          lastError = (err as Error).message
          const code = err instanceof PluginError && err.code === 'NEEDS_PAIRING' ? 401 : 502
          return reply.code(code).send({ error: lastError })
        }
      })

      /** Unlink: the session token is erased, nothing else was ever kept. */
      app.post('/logout', async () => {
        await auth!.forget()
        accountId = null
        accounts = []
        links = []
        return status()
      })

      /**
       * A vehicle's maintenance contracts capped in km, to SUGGEST a lease-purchase in the "Edit"
       * panel: read on click, never when polling. Nothing is written, the user chooses.
       */
      app.get<{ Params: { vin: string }; Querystring: { lang?: string } }>('/contracts/:vin', async (req, reply) => {
        if (!auth?.linked) return reply.code(409).send({ error: 'no Renault account linked' })
        try {
          const id = accountId ?? await resolveAccount(ctx?.signal)
          if (!id) return reply.code(409).send({ error: 'no Kamereon account found for this person' })
          const known = links.length ? links : await listVehicles(ctx?.signal)
          if (!known.some((l) => l.vin === req.params.vin)) return reply.code(404).send({ error: 'unknown vehicle' })
          const lang = /^[a-z]{2}$/.test(req.query.lang ?? '') ? req.query.lang! : 'fr'
          const body = await client!.vehicleContracts(id, req.params.vin, `${lang}-${config!.RENAULT_COUNTRY}`, ctx?.signal)
          return { contracts: toMileageContracts(body) }
        } catch (err) {
          if (err instanceof PluginError && err.code === 'RATE_LIMITED') return reply.code(429).send({ error: err.message })
          return reply.code(502).send({ error: (err as Error).message })
        }
      })

      /**
       * Raw reading, to be captured as soon as the account is linked: it's what will decide the
       * mapping and the fixtures. Each reading is attempted separately and its failure is RETURNED
       * rather than thrown — knowing what the vehicle refuses is worth as much as knowing what it gives.
       */
      app.get('/raw', async (_req, reply) => {
        if (!auth?.linked) return reply.code(409).send({ error: 'no Renault account linked' })
        try {
          const id = accountId ?? await resolveAccount(ctx?.signal)
          if (!id) return reply.code(409).send({ error: 'no Kamereon account found for this person' })
          const vehicles = await listVehicles(ctx?.signal)
          const readings: unknown[] = []
          const details: unknown[] = []
          for (const link of vehicles) {
            try { details.push({ vin: link.vin, ok: true, body: await client!.vehicleDetails(id, link.vin, ctx?.signal) }) }
            catch (err) { details.push({ vin: link.vin, ok: false, error: (err as Error).message }) }
            for (const probe of PROBE_ENDPOINTS) {
              const path = carDataPath({ accountId: id, vin: link.vin, ...probe })
              try {
                readings.push({ vin: link.vin, ...probe, ok: true, body: await client!.carData({ accountId: id, vin: link.vin, ...probe, signal: ctx?.signal }) })
              } catch (err) {
                readings.push({ vin: link.vin, ...probe, ok: false, unavailable: isEndpointUnavailable(err), error: (err as Error).message, path })
              }
            }
          }
          return { accountId: id, accounts, vehicles, details, readings }
        } catch (err) {
          lastError = (err as Error).message
          return reply.code(502).send({ error: lastError })
        }
      })
    },

    health(): PluginHealth {
      const keys = ['RENAULT_COUNTRY', 'RENAULT_ACCOUNT_ID', 'RENAULT_SESSION_FILE', 'RENAULT_POLL_MS', 'RENAULT_RATE_PER_HOUR']
      if (!auth?.linked) return { status: 'needs_pairing', detail: 'no MY Renault account linked', keys, deviceCount: 0 }
      if (lastError) return { status: 'degraded', detail: lastError, keys, deviceCount: links.length }
      // "read-only" is no longer true when the charge wake-up is checked: it WRITES to the car.
      // Health must say so, it's the only line where the user can notice it.
      const wake = ctx?.parts[CHARGE_WAKE]
        ? `charge wake-up ${config!.RENAULT_WAKE_FROM}-${config!.RENAULT_WAKE_TO}`
        : 'read-only'
      return { status: 'ok', detail: `${links.length} vehicle(s) · ${wake}`, keys, deviceCount: links.length }
    },
  }
}
