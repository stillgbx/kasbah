import { randomBytes } from 'node:crypto'
import type { Command, CommandOf, DeviceDescriptor, PluginHealth, ReleaseNote, StateFor, VehicleFinish, VehicleSeat, VehicleSleepState } from '@kasbah/shared'
import { RELEASE_NOTES_FALLBACK_LANG } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { fetch as undiciFetch } from 'undici'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext, type PluginReleaseNotes } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { sleep } from '../../core/clock'
import type { FetchLike } from '../../core/sse'
import { describeError, sendError } from '../../http/errors'
import {
  PUBLIC_KEY_PATH, REGION_BASE_URLS, TeslaAuth, authorizationUrl, createKeyFile, createTokenFile, ensureKeyPair, generateKeyPair,
  samePublicKey, type KeyPair, type KeyStore, type TeslaRegion, type TokenStore,
} from './auth'
import { TeslaClient } from './client'
import {
  bodyColor, bodyFinish, compareVersions, imagesExpireAt, isResting, notesByVersion, parseReleaseNotes, SEAT_HEATER_INDEX, toDataPatch,
  toDescriptor, toSleepPatch, toSleepState, withoutExpiredImages,
} from './mapping'
import {
  MONTHLY_CREDIT_USD, billableKind, countCall, createStateFile, currentCycle, cycleCostUsd, cycleStart, emptyState,
  type TeslaState, type TeslaStateStore,
} from './state'
import { commandResultSchema, partnerPublicKeySchema, releaseNotesResponseSchema, vehicleDataSchema, vehicleSummarySchema, vehiclesListSchema, type VehicleSummary } from './types'

// Tesla plugin: vehicles read through the Fleet API (the vendor's cloud, nothing exists locally).
// Read: charge, range, cable, locking, position, mileage, speed and gear, tire pressure,
// temperatures, and the SLEEP STATE. Written: the charge limit, the only setting accepted for now —
// plus wake-up and re-read, on demand.
//
// Three vendor constraints dictate the plugin's shape:
//
//  1. An application declared on developer.tesla.com, and a public HTTPS DOMAIN that serves the
//     application's public key (`auth.ts`). Kasbah runs on the LAN: the public key is generated
//     here, displayed in Settings, and it's the user who puts it on their domain (a NAS). The plugin
//     then registers the domain with Tesla and checks what Tesla read.
//
//  2. The API has been BILLED by usage since 2025, with $10 of monthly credit per account: a full
//     read (`vehicle_data`) costs $1 per 500, a wake-up $1 per 50. Hence a daily read budget
//     (`TESLA_DAILY_DATA_BUDGET`), beyond which nothing is read until the next day — without a
//     registered bank card, Tesla cuts off anyway once the credit is used up.
//
//  3. The vehicle SLEEPS. A quarter of an hour after parking, it shuts down its computer and answers
//     408 to any read. The vehicle list gives its sleep state without waking it: we only read
//     `vehicle_data` if it's awake, and we never wake it of our own accord (a pre-2021 Model S
//     drains its battery staying awake). Once read at REST — parked, nobody on board, not charging
//     — we leave it alone for `TESLA_REST_MS`, the time it takes to fall asleep.
//
// The fixtures in `__fixtures__/fleet.ts` are written from the documentation, for lack of a linked
// account at the time of writing: `GET /api/plugins/tesla/raw` serves to replace them with a real capture.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const teslaConfigSchema = z.object({
  /** Credentials of the application created on developer.tesla.com. */
  TESLA_CLIENT_ID: optionalKey,
  TESLA_CLIENT_SECRET: optionalKey,
  /** Domain (host only) that serves the public key, the one declared in the application. */
  TESLA_DOMAIN: optionalKey,
  /** Region of the Tesla account: decides the API base. */
  TESLA_REGION: z.enum(['eu', 'na']).default('eu'),
  /** Must be declared as is in the application ("Allowed Redirect URI"). */
  TESLA_REDIRECT_URI: z.string().url().default('http://localhost:8787/api/plugins/tesla/auth/callback'),
  /** Where to keep the account tokens (the refresh token is single-use: we rewrite it every round). */
  TESLA_TOKEN_FILE: z.string().trim().default(stateFile('tesla-token.json')),
  /** Where to keep the application's private key (its public key is the one put on the domain). */
  TESLA_KEY_FILE: z.string().trim().default(stateFile('tesla-key.json')),
  /**
   * Where to keep the LAST STATE of each vehicle and the month's usage (see `state.ts`). Without it,
   * a restart starts again from an empty card until the next read — which may take hours — and the
   * quota gauge loses count. Empty string = keep nothing.
   */
  TESLA_STATE_FILE: z.string().trim().default(stateFile('tesla-state.json')),
  /** Rate of the vehicle list (sleep state) and, when a vehicle is awake, of its full read. */
  TESLA_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(600_000),
  /** After a read at rest, time without re-reading: the time it takes the vehicle to fall asleep. 0 = never rest. */
  TESLA_REST_MS: z.coerce.number().int().min(0).max(7_200_000).default(900_000),
  /** Full reads per day, at most ($1 per 500 at Tesla). 0 = no read, sleep state only. */
  TESLA_DAILY_DATA_BUDGET: z.coerce.number().int().min(0).max(10_000).default(100),
})
export type TeslaConfig = z.infer<typeof teslaConfigSchema>

/** After a requested wake-up, delay before re-reading: the vehicle takes a few seconds to answer. */
const WAKE_FOLLOW_UP_MS = 15_000
/** Preconditioning a sleeping car: the sleep state re-read (list, free) at this step, up to this cap. */
const CLIMATE_WAKE_POLL_MS = 5_000
const CLIMATE_WAKE_MAX_MS = 90_000
/**
 * Software update: re-read `UPDATE_FOLLOW_UP_MS` after the acknowledgment — Tesla ITSELF sets the
 * time of a "now" (a countdown, seen on the real car on 2026-10-02) —, then `UPDATE_START_GRACE_MS`
 * after the scheduled time, to confirm the installation has started.
 */
const UPDATE_FOLLOW_UP_MS = 15_000
const UPDATE_START_GRACE_MS = 60_000
/** Beyond this, no timer: the ordinary polling will notice the start. */
const UPDATE_WATCH_MAX_MS = 6 * 3_600_000
/** After a charge start or stop, delay before re-reading: the charger takes 20 s to 1 min to deliver current. */
const CHARGE_FOLLOW_UP_MS = 60_000
/** Transient `could_not_wake_buses` refusal: new attempts, at the `CLIMATE_WAKE_POLL_MS` step. */
const BUSES_RETRIES = 3
/**
 * The same refusal on the charge limit: retried WITHIN the command (the UI awaits the result, the
 * slider holds the requested value), hence shorter — 2 attempts at 2.5 s fit, requests included,
 * under a command's timeout (`KASBAH_COMMAND_TIMEOUT_MS`, 10 s by default).
 */
const LIMIT_BUSES_RETRIES = 2
const LIMIT_BUSES_PAUSE_MS = 2_500
/** Below this level, Tesla refuses `auto_conditioning_start` (`low_soc`). */
const LOW_SOC_PCT = 20
/** Release notes re-read one day before their illustrations (signed URLs, ~14 days) expire. */
const NOTES_REFRESH_BEFORE_MS = 86_400_000
/** After a failed notes read, no new attempt before this: otherwise every full read would replay it. */
const NOTES_RETRY_MS = 6 * 3_600_000
/** Notes read rule, in the cache key: changing it makes the caches re-read once. */
const NOTES_RULE = 'language+installed'
/** App languages kept for the notes, at most (English on top): a request can't grow the list endlessly. */
const NOTES_MAX_LANGS = 4
/** Sections of `vehicle_data` read. `location_data` is REQUIRED for the position since software 2023.38. */
const DATA_ENDPOINTS = ['charge_state', 'drive_state', 'vehicle_state', 'climate_state', 'location_data', 'vehicle_config'].join(';')


/** What the Settings card displays. Never carries a secret, nor the private key. */
export interface TeslaStatus {
  /** Application credentials present in configuration. */
  configured: boolean
  domain: string | null
  region: TeslaRegion
  redirectUri: string
  /** Public key to put on the domain, and the exact URL where Tesla will read it. */
  publicKeyPem: string | null
  publicKeyUrl: string | null
  /** Last check of the domain registration; `undefined` = never checked. */
  registered: boolean | undefined
  linked: boolean
  vehicles: { vin: string; name: string; sleepState: VehicleSleepState }[]
  budget: { used: number; limit: number }
  pollMs: number
  restMs: number
  tokenFile: string | null
  lastError: string | null
}

export interface TeslaPluginDeps {
  /** Injected by tests: all requests (auth server and API). */
  fetchImpl?: FetchLike
  tokenStore?: TokenStore
  keyStore?: KeyStore
  stateStore?: TeslaStateStore
}

interface VehicleTrack {
  summary: VehicleSummary
  sleepState: VehicleSleepState
  /** Don't re-read before (vehicle seen at rest). */
  restUntil: number
  /**
   * Paint read from `vehicle_config`: color and finish. It is NOT in the vehicle list — it only
   * arrives with a full read, so the descriptor is born without paint and gains it afterwards.
   */
  paint?: { color?: string; finish?: VehicleFinish }
}

export function createTeslaPlugin(deps: TeslaPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: TeslaConfig | null = null
  let auth: TeslaAuth | null = null
  let client: TeslaClient | null = null
  let keys: KeyPair | null = null
  let keyStore: KeyStore | null = null
  let registered: boolean | undefined
  let lastError: string | null = null
  /** Polling: a timer re-armed after each round, and after each manual read (the delay restarts). */
  let polling = false
  let timer: unknown = null
  const vehicles = new Map<string, VehicleTrack>()
  /** `state` values issued by /auth/url and expected on return: a link is only accepted if we started it. */
  const pendingStates = new Set<string>()
  /** Full reads of the day (server's local date): it's what the budget bounds. */
  let budget = { day: '', used: 0 }
  let budgetWarned = false
  /** What survives a restart: last state per vehicle, the month's usage (`state.ts`). */
  let store: TeslaStateStore | null = null
  let saved: TeslaState = emptyState()

  const log = () => ctx!.logger
  /** Writes the state file without making the caller wait: losing it never prevents reading. */
  const persist = () => { void store?.save(saved) }
  const fetchImpl: FetchLike = deps.fetchImpl
    ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
  const configured = () => !!(config?.TESLA_CLIENT_ID && config.TESLA_CLIENT_SECRET)
  const publicKeyUrl = () => (config?.TESLA_DOMAIN ? `https://${config.TESLA_DOMAIN}${PUBLIC_KEY_PATH}` : null)

  function status(): TeslaStatus {
    return {
      configured: configured(),
      domain: config?.TESLA_DOMAIN ?? null,
      region: config?.TESLA_REGION ?? 'eu',
      redirectUri: config?.TESLA_REDIRECT_URI ?? '',
      publicKeyPem: keys?.publicPem ?? null,
      publicKeyUrl: publicKeyUrl(),
      registered,
      linked: !!auth?.linked,
      vehicles: [...vehicles.values()].map((v) => ({ vin: v.summary.vin, name: toDescriptor(v.summary).name, sleepState: v.sleepState })),
      budget: { used: budgetUsedToday(), limit: config?.TESLA_DAILY_DATA_BUDGET ?? 0 },
      pollMs: config?.TESLA_POLL_MS ?? 0,
      restMs: config?.TESLA_REST_MS ?? 0,
      tokenFile: config?.TESLA_TOKEN_FILE || null,
      lastError,
    }
  }

  // ---- budget -------------------------------------------------------------------------------

  const today = () => new Date(ctx!.clock.now()).toDateString()
  function budgetUsedToday(): number {
    if (!ctx) return 0
    if (budget.day !== today()) { budget = { day: today(), used: 0 }; budgetWarned = false }
    return budget.used
  }
  /** Reserves a read; `false` when the day's budget is spent (logged once a day). */
  function takeBudget(): boolean {
    const used = budgetUsedToday()
    if (used >= config!.TESLA_DAILY_DATA_BUDGET) {
      if (!budgetWarned) {
        log().warn({ used, limit: config!.TESLA_DAILY_DATA_BUDGET }, 'Tesla daily vehicle_data budget spent: only sleep state until tomorrow')
        budgetWarned = true
      }
      return false
    }
    budget.used = used + 1
    return true
  }

  // ---- reads --------------------------------------------------------------------------------

  const descriptors = (): DeviceDescriptor[] => [...vehicles.values()].map((v) => toDescriptor(v.summary, v.paint))
  const vins = () => [...vehicles.keys()].sort().join(',')

  /** Vehicle list: each one's sleep state, without waking it. Validates vehicle by vehicle. */
  async function listVehicles(): Promise<VehicleSummary[]> {
    const raw = vehiclesListSchema.parse(await client!.request('GET', '/api/1/vehicles', { signal: ctx!.signal }))
    const out: VehicleSummary[] = []
    for (const item of raw.response) {
      const parsed = vehicleSummarySchema.safeParse(item)
      if (parsed.success) out.push(parsed.data)
      else log().warn({ issues: parsed.error.issues }, 'Tesla vehicle entry has an unexpected shape, skipping it')
    }
    return out
  }

  /**
   * Updates the list and republishes the descriptors if a vehicle appears or disappears.
   * `emit: false` during `discover`: it's the return value that counts then, not an emission.
   */
  function adoptList(list: VehicleSummary[], emit = true): void {
    const before = vins()
    const seen = new Set<string>()
    for (const s of list) {
      seen.add(s.vin)
      const track = vehicles.get(s.vin)
      const paint = saved.paints[s.vin]
      if (track) {
        track.summary = s
        // restart: the track is reborn without paint, the state file gives it back
        if (!track.paint && paint) track.paint = paint
      } else {
        vehicles.set(s.vin, {
          summary: s, sleepState: toSleepState(s.state), restUntil: 0,
          ...(paint ? { paint } : {}),
        })
      }
    }
    for (const vin of [...vehicles.keys()]) if (!seen.has(vin)) vehicles.delete(vin)
    if (vins() !== before && emit) {
      log().info({ vehicles: vehicles.size }, 'Tesla vehicle list changed')
      ctx!.emitDevices(descriptors())
    }
  }

  /** Full read of ONE vehicle, counted against the budget. Throws `DEVICE_UNAVAILABLE` if it's asleep. */
  async function readVehicle(vin: string): Promise<void> {
    const track = vehicles.get(vin)
    if (!track) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Tesla vehicle ${vin}`)
    const path = `/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data?endpoints=${encodeURIComponent(DATA_ENDPOINTS)}`
    const data = vehicleDataSchema.parse(await client!.request('GET', path, { signal: ctx!.signal })).response
    const patch = { ...toDataPatch(data), readAt: ctx!.clock.now() }
    ctx!.emitState(vin, patch)
    // kept for the next startup: the card gets these values back instead of starting empty
    saved.vehicles[vin] = { ...saved.vehicles[vin], ...patch } as Record<string, unknown>
    track.sleepState = toSleepState(data.state)
    // The paint only arrives here, and it can CHANGE without us having anything to do with it: the
    // dashboard screen's "Colorizer" picks color AND finish. We then republish the descriptor —
    // it's the only moment it changes without the vehicle list having changed.
    const paint = { color: bodyColor(data), finish: bodyFinish(data) }
    if (paint.color || paint.finish) {
      const changed = paint.color !== track.paint?.color || paint.finish !== track.paint?.finish
      track.paint = paint
      saved.paints[vin] = paint
      if (changed) ctx!.emitDevices(descriptors())
    }
    persist()
    // the car is awake, now's the time: release notes re-read if a version changed
    void refreshNotes(vin)
    watchUpdateStart(vin)
    // at rest: we let it fall asleep, the next read will wait
    track.restUntil = isResting(data) && config!.TESLA_REST_MS > 0 ? ctx!.clock.now() + config!.TESLA_REST_MS : 0
    // a read, wherever it comes from (polling, wake-up, requested refresh), resets the polling
    // countdown: re-read ten minutes after the last read, not on a fixed schedule
    if (polling) scheduleNext(config!.TESLA_POLL_MS)
  }

  async function poll(): Promise<void> {
    const now = ctx!.clock.now()
    adoptList(await listVehicles())
    for (const track of vehicles.values()) {
      const vin = track.summary.vin
      track.sleepState = toSleepState(track.summary.state)
      ctx!.emitState(vin, toSleepPatch(track.summary))
      if (track.sleepState !== 'online') { track.restUntil = 0; continue }
      if (track.restUntil > now) continue
      if (!takeBudget()) continue
      try {
        await readVehicle(vin)
      } catch (err) {
        // fell asleep between the list and the read: normal response, not an incident
        if (err instanceof PluginError && err.code === 'DEVICE_UNAVAILABLE') {
          track.sleepState = 'asleep'
          ctx!.emitState(vin, { sleepState: 'asleep' })
          continue
        }
        throw err
      }
    }
    lastError = null
  }

  /**
   * Homemade polling rather than `createPoller`: the timer must be RE-ARMABLE after a manual read.
   * A failure doesn't trigger a tight backoff — the API is billed, ten minutes later is enough.
   */
  function scheduleNext(ms: number): void {
    if (timer !== null) ctx!.clock.clearTimeout(timer)
    timer = ctx!.clock.setTimeout(() => { timer = null; void runPoll() }, ms)
  }
  let failing = false
  async function runPoll(): Promise<void> {
    if (!polling || ctx!.signal.aborted) return
    try {
      await poll()
      if (failing) log().info('Tesla polling recovered')
      failing = false
    } catch (err) {
      lastError = (err as Error).message
      const l = failing ? log().debug.bind(log()) : log().warn.bind(log())
      l({ err }, 'Tesla poll failed')
      failing = true
    }
    if (polling) scheduleNext(config!.TESLA_POLL_MS)
  }
  function startPolling(): void {
    if (polling || !auth?.linked) return
    polling = true
    void runPoll()
  }

  // ---- climate ------------------------------------------------------------------------------

  /** A REST command, refused as HTTP 200 with `result: false` (see the charge limit). */
  async function vehicleCommand(vin: string, name: string, body?: unknown): Promise<void> {
    const res = commandResultSchema.parse(await client!.request(
      'POST', `/api/1/vehicles/${encodeURIComponent(vin)}/command/${name}`, { body, signal: ctx!.signal },
    ))
    if (res.response?.result !== true) {
      const reason = res.response?.reason
      throw new PluginError('UPSTREAM_ERROR', `Tesla refused ${name}${reason ? `: ${reason}` : ''}`)
    }
  }

  /** The setpoint first (same value on both sides), then on or off; the state follows without a re-read. */
  async function climateCommand(vin: string, command: CommandOf<'vehicle.climate_start'> | CommandOf<'vehicle.climate_stop'>): Promise<void> {
    if (command.type === 'vehicle.climate_stop') {
      await vehicleCommand(vin, 'auto_conditioning_stop')
      ctx!.emitState(vin, { climateOn: false })
      log().info({ vin }, 'Tesla climate stopped')
      return
    }
    if (command.targetTempC !== undefined) {
      await vehicleCommand(vin, 'set_temps', { driver_temp: command.targetTempC, passenger_temp: command.targetTempC })
    }
    try {
      // Below 20 %, Tesla refuses (`low_soc`). Its app asks for confirmation then forces; the REST API
      // does NOT: the official proxy (vehicle-command, `pkg/proxy/command.go`) reads no
      // `manual_override` for `auto_conditioning_start` (only keeper / max / bioweapon), and sending it
      // anyway was ignored — observed on the real car on 2026-10-01
      await vehicleCommand(vin, 'auto_conditioning_start')
    } catch (err) {
      if (err instanceof PluginError && err.message.endsWith(': low_soc')) {
        throw new PluginError('LOW_BATTERY', 'Tesla refuses to start the climate on a low battery (low_soc)')
      }
      throw err
    }
    ctx!.emitState(vin, { climateOn: true, ...(command.targetTempC !== undefined ? { climateTargetC: command.targetTempC } : {}) })
    log().info({ vin, targetTempC: command.targetTempC }, 'Tesla climate started')
  }

  /**
   * Set the setpoint, seats and steering wheel of an AWAKE car — never a wake-up for a setting, as
   * for the charge limit (asleep: 408, `DEVICE_UNAVAILABLE`). One command per setting, the state
   * published as acknowledgments come in: a refusal midway leaves the card right about what went through.
   */
  async function setClimate(vin: string, command: CommandOf<'vehicle.climate_set'>): Promise<void> {
    if (command.targetTempC !== undefined) {
      await vehicleCommand(vin, 'set_temps', { driver_temp: command.targetTempC, passenger_temp: command.targetTempC })
      ctx!.emitState(vin, { climateTargetC: command.targetTempC })
    }
    // the state merge is SHALLOW: `seatHeat` is published whole, starting from the last known one
    const last = (saved.vehicles[vin] ??= {}) as { seatHeat?: Partial<Record<VehicleSeat, number>> }
    for (const [seat, level] of Object.entries(command.seatHeat ?? {}) as [VehicleSeat, number | undefined][]) {
      if (level === undefined) continue
      await vehicleCommand(vin, 'remote_seat_heater_request', { heater: SEAT_HEATER_INDEX[seat], level })
      last.seatHeat = { ...last.seatHeat, [seat]: level }
      ctx!.emitState(vin, { seatHeat: last.seatHeat })
    }
    if (command.steeringWheelHeat !== undefined) {
      await vehicleCommand(vin, 'remote_steering_wheel_heater_request', { on: command.steeringWheelHeat })
      ctx!.emitState(vin, { steeringWheelHeat: command.steeringWheelHeat })
    }
    log().info({ vin, command }, 'Tesla climate settings changed')
  }

  /**
   * Precondition. Awake, the command goes out right away. Asleep — the normal case on a morning —, we
   * WAKE it: it's the very purpose of the command, and the user wanted it that way (agreed on
   * 2026-10-01, including from an automation). The wake-up takes about ten seconds, far more than a
   * command's timeout: `execute` returns at the wake-up's acknowledgment, the rest runs behind (sleep
   * state re-read through the list, free, every `CLIMATE_WAKE_POLL_MS`), then a full read OBSERVES
   * the effect. A background failure shows up in the server log.
   */
  async function startClimate(vin: string, command: CommandOf<'vehicle.climate_start'>): Promise<void> {
    const track = vehicles.get(vin)!
    // the `low_soc` refusal is KNOWN in advance: below the threshold, we refuse BEFORE paying for a
    // wake-up, which would be followed by a refusal nobody would see (it arrives in the background)
    const soc = saved.vehicles[vin]?.soc
    if (typeof soc === 'number' && soc < LOW_SOC_PCT) {
      throw new PluginError('LOW_BATTERY', `battery at ${soc} %, below Tesla's ${LOW_SOC_PCT} % climate threshold (low_soc)`)
    }
    if (track.sleepState === 'online') {
      try { await climateCommand(vin, command); return }
      catch (err) { if (!(err instanceof PluginError && err.code === 'DEVICE_UNAVAILABLE')) throw err }
    }
    await wakeThen(vin, 'start its climate', () => climateCommand(vin, command), WAKE_FOLLOW_UP_MS)
  }

  /**
   * Wake up, then run `run` as soon as the (free) list says the car is online, and re-read it
   * `followUpMs` later to OBSERVE the effect. `execute` returns at the wake-up's acknowledgment: the
   * rest runs behind, and its failure shows up in the server log.
   */
  async function wakeThen(vin: string, what: string, run: () => Promise<void>, followUpMs: number): Promise<void> {
    await client!.request('POST', `/api/1/vehicles/${encodeURIComponent(vin)}/wake_up`, { signal: ctx!.signal })
    log().info({ vin }, `Tesla vehicle woken to ${what}`)
    vehicles.get(vin)!.restUntil = 0
    void (async () => {
      const deadline = ctx!.clock.now() + CLIMATE_WAKE_MAX_MS
      try {
        while (ctx!.clock.now() < deadline) {
          await sleep(ctx!.clock, CLIMATE_WAKE_POLL_MS, ctx!.signal)
          if (ctx!.signal.aborted) return
          adoptList(await listVehicles())
          const t = vehicles.get(vin)
          if (!t) return
          t.sleepState = toSleepState(t.summary.state)
          ctx!.emitState(vin, toSleepPatch(t.summary))
          if (t.sleepState !== 'online') continue
          await run()
          await sleep(ctx!.clock, followUpMs, ctx!.signal)
          if (!ctx!.signal.aborted && takeBudget()) await readVehicle(vin)
          return
        }
        log().warn({ vin, waitedMs: CLIMATE_WAKE_MAX_MS }, `Tesla vehicle did not wake up: could not ${what}`)
      } catch (err) {
        if (!ctx!.signal.aborted) log().warn({ err, vin }, `Tesla could not ${what} after wake`)
      }
    })()
  }

  // ---- charge -------------------------------------------------------------------------------

  /**
   * `charge_start` / `charge_stop`, unsigned like the charge limit. Already in the desired state
   * (`is_charging`, `not_charging`) is not a failure. `charging` is NOT published on the
   * acknowledgment: the car accepts before current flows (the charger takes 20 s to 1 min, observed
   * on 2026-10-01), it's a re-read `CHARGE_FOLLOW_UP_MS` later that observes it.
   */
  async function chargeCommand(vin: string, start: boolean): Promise<void> {
    try { await vehicleCommand(vin, start ? 'charge_start' : 'charge_stop') }
    catch (err) {
      if (!(err instanceof PluginError && err.message.endsWith(start ? ': is_charging' : ': not_charging'))) throw err
    }
    log().info({ vin }, start ? 'Tesla charge started' : 'Tesla charge stopped')
  }

  /**
   * Start or stop the charge. Unplugged according to the last known state: refused BEFORE any
   * wake-up. Asleep, stopping has nothing to do (a car that is charging doesn't sleep); starting, on
   * the other hand, WAKES it, like the climate: it's an action of the user or of a rule they wrote.
   */
  async function charge(vin: string, start: boolean): Promise<void> {
    const track = vehicles.get(vin)!
    if (start && saved.vehicles[vin]?.pluggedIn === false) throw new PluginError('DEVICE_UNAVAILABLE', 'vehicle not plugged in')
    if (track.sleepState !== 'online') {
      if (!start) { ctx!.emitState(vin, { charging: false }); return }
      await wakeThen(vin, 'start charging', () => chargeCommand(vin, true), CHARGE_FOLLOW_UP_MS)
      return
    }
    try { await chargeCommand(vin, start) }
    catch (err) {
      if (start && err instanceof PluginError && err.code === 'DEVICE_UNAVAILABLE') {
        await wakeThen(vin, 'start charging', () => chargeCommand(vin, true), CHARGE_FOLLOW_UP_MS)
        return
      }
      // "online" according to the list, but its internal buses are still asleep: TRANSIENT refusal,
      // observed on the real car on 2026-10-01 right after forcing the charger. We retry behind.
      if (!(err instanceof PluginError && err.message.endsWith(': could_not_wake_buses'))) throw err
      log().info({ vin }, 'Tesla buses still asleep: retrying the charge command')
      void retryThenFollowUp(vin, start)
      return
    }
    if (!start) ctx!.emitState(vin, { charging: false })
    void followUp(vin)
  }

  async function retryThenFollowUp(vin: string, start: boolean): Promise<void> {
    for (let attempt = 1; attempt <= BUSES_RETRIES; attempt++) {
      await sleep(ctx!.clock, CLIMATE_WAKE_POLL_MS, ctx!.signal)
      if (ctx!.signal.aborted) return
      try {
        await chargeCommand(vin, start)
        if (!start) ctx!.emitState(vin, { charging: false })
        break
      } catch (err) {
        if (!(err instanceof PluginError && err.message.endsWith(': could_not_wake_buses')) || attempt === BUSES_RETRIES) {
          log().warn({ err, vin }, 'Tesla charge command failed after retries')
          break
        }
      }
    }
    await followUp(vin)
  }

  /** Re-read `CHARGE_FOLLOW_UP_MS` later: it's the read that says whether current is flowing. */
  async function followUp(vin: string): Promise<void> {
    await sleep(ctx!.clock, CHARGE_FOLLOW_UP_MS, ctx!.signal)
    if (ctx!.signal.aborted || !takeBudget()) return
    try { await readVehicle(vin) }
    catch (err) { log().debug({ err, vin }, 'Tesla charge follow-up read failed') }
  }

  // ---- software: release notes and update -----------------------------------------------------

  type SoftwareUpdate = NonNullable<StateFor<'vehicle'>['softwareUpdate']>
  const lastSoftware = (vin: string) => saved.vehicles[vin] as { softwareVersion?: string; softwareUpdate?: SoftwareUpdate | null } | undefined
  /** Notes read in flight, per VIN: two close full reads only start one. */
  const notesInFlight = new Set<string>()
  /** No new attempt before this date (epoch ms), per VIN, after a failure. */
  const notesRetryAt = new Map<string, number>()

  /**
   * Re-read the release notes — ONLY when the installed or the pending version changed since the
   * last read, or when their illustrations are about to expire. Called after a full read (car
   * awake), without making it wait: a failure only costs a log message, and the next read will
   * try again.
   */
  async function refreshNotes(vin: string): Promise<void> {
    const installed = lastSoftware(vin)?.softwareVersion
    if (!installed || notesInFlight.has(vin)) return
    if ((notesRetryAt.get(vin) ?? 0) > ctx!.clock.now()) return
    notesInFlight.add(vin)
    try {
      // English first: it's the fallback, and the reference that tells whether Tesla publishes the other language
      for (const lang of [RELEASE_NOTES_FALLBACK_LANG, ...saved.releaseNotesLangs.filter((l) => l !== RELEASE_NOTES_FALLBACK_LANG)]) {
        await refreshNotesIn(vin, lang)
      }
    } catch (err) {
      if (ctx!.signal.aborted) return
      notesRetryAt.set(vin, ctx!.clock.now() + NOTES_RETRY_MS)
      log().warn({ err, vin }, 'could not read Tesla release notes')
    } finally {
      notesInFlight.delete(vin)
    }
  }

  /**
   * The notes of ONE language, requested from Tesla with the `language` parameter (two letters).
   * Tried on the real car on 2026-10-02: `language=fr` returns the Tesla app's French ("Cartes de
   * sites Superchargeur"); `Accept-Language`, `locale=fr_FR` and `locale=fr-FR` are ignored (English).
   * Nothing is translated here: if Tesla returns the same texts as in English, it doesn't publish
   * that language (`ignored`), and we serve English.
   */
  async function refreshNotesIn(vin: string, lang: string): Promise<void> {
    const last = lastSoftware(vin)
    const installed = last?.softwareVersion
    if (!installed) return
    const staged = last.softwareUpdate?.version
    // the key also says HOW we read: the way of asking (`language=`; `Accept-Language` is ignored by
    // Tesla) and the sorting rule (`NOTES_RULE`). A cache read differently is re-read once
    const key = `${NOTES_RULE}|${installed}|${staged ?? ''}`
    const byLang = (saved.releaseNotes[vin] ??= {})
    const cache = byLang[lang]
    if (cache?.key === key && (cache.expiresAt === undefined || cache.expiresAt - NOTES_REFRESH_BEFORE_MS > ctx!.clock.now())) return
    {
      const base = `/api/1/vehicles/${encodeURIComponent(vin)}/release_notes`
      const current = releaseNotesResponseSchema.parse(await client!.request('GET', `${base}?language=${lang}`, { signal: ctx!.signal })).response
      // the history: what Tesla itself shows in "Release Notes" (`show_in_history`), PLUS the new
      // features of the installed version — which Tesla returns as `show_in_history: false` right
      // after installation (recorded on 2026-10-02, 2026.38) —, without the generic entry of a minor
      // version ("Minor Fixes", `is_fallback`). Added to what we kept: Tesla doesn't go back before
      // the last major update
      const deployed = current.deployed_version ?? installed
      const shown = notesByVersion(parseReleaseNotes(current.release_notes).filter((e) =>
        e.show_in_history !== false || (e.customer_version === deployed && e.is_fallback !== true)))
      let pending: { version: string; notes: ReleaseNote[] } | undefined
      if (staged) {
        const next = releaseNotesResponseSchema.parse(await client!.request('GET', `${base}?staged=true&language=${lang}`, { signal: ctx!.signal })).response
        // the "pending" response mixes in older notes: only those of the expected version count
        const notes = notesByVersion(parseReleaseNotes(next.release_notes))[staged]
        if (notes?.length) pending = { version: staged, notes }
      }
      const fetched = [...Object.values(shown).flat(), ...(pending?.notes ?? [])]
      const expiresAt = imagesExpireAt(fetched)
      // same titles as in English, just read: Tesla ignores the requested language
      const en = byLang[RELEASE_NOTES_FALLBACK_LANG]
      const enTitles = new Set([...Object.values(en?.history ?? {}).flat(), ...(en?.pending?.notes ?? [])].map((n) => n.title))
      const ignored = lang !== RELEASE_NOTES_FALLBACK_LANG && fetched.length > 0 && fetched.every((n) => enTitles.has(n.title))
      byLang[lang] = {
        key, fetchedAt: ctx!.clock.now(), history: { ...cache?.history, ...shown },
        installedVersion: current.deployed_version ?? installed,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(pending ? { pending } : {}),
        ...(ignored ? { ignored } : {}),
      }
      persist()
      log().info({ vin, lang, installed, staged, ignored, versions: Object.keys(byLang[lang].history).length }, 'Tesla release notes read')
    }
  }

  /** The cache, as is: never a call here. Pending notes only count for the version still expected. */
  function releaseNotesOf(vin: string, wanted: string): PluginReleaseNotes {
    const byLang = saved.releaseNotes[vin] ?? {}
    const own = byLang[wanted]
    const lang = own && !own.ignored ? wanted : RELEASE_NOTES_FALLBACK_LANG
    const cache = byLang[lang]
    const last = lastSoftware(vin)
    const now = ctx!.clock.now()
    const clean = (notes: ReleaseNote[]) => notes.map((n) => withoutExpiredImages(n, now))
    const installedVersion = last?.softwareVersion ?? cache?.installedVersion
    const pending = cache?.pending && cache.pending.version === last?.softwareUpdate?.version ? cache.pending : undefined
    return {
      ...(cache ? { lang } : {}),
      ...(installedVersion ? { installedVersion } : {}),
      ...(pending ? { pending: { version: pending.version, notes: clean(pending.notes) } } : {}),
      history: Object.entries(cache?.history ?? {})
        .sort(([a], [b]) => compareVersions(b, a))
        .map(([version, notes]) => ({ version, notes: clean(notes) })),
      ...(cache ? { fetchedAt: cache.fetchedAt } : {}),
    }
  }

  /**
   * Schedule or cancel the installation of an ALREADY downloaded update. Awake car only (never an
   * implicit wake-up for a setting, like the charge limit), and refused in advance when nothing is
   * ready: Tesla doesn't install what it hasn't finished downloading. The state follows the
   * acknowledgment, without a re-read (billed): the next read will confirm it.
   */
  /** A read planned per VIN to observe the start of a scheduled installation. */
  const updateWatch = new Map<string, unknown>()
  function clearUpdateWatch(vin: string): void {
    const t = updateWatch.get(vin)
    if (t !== undefined) ctx!.clock.clearTimeout(t)
    updateWatch.delete(vin)
  }
  /** Read `delayMs` later (counted against the budget); a car fallen asleep in the meantime only costs a log line. */
  function readLater(vin: string, delayMs: number): unknown {
    return ctx!.clock.setTimeout(() => {
      updateWatch.delete(vin)
      if (ctx!.signal.aborted || !vehicles.has(vin) || !takeBudget()) return
      readVehicle(vin).catch((err) => log().debug({ err, vin }, 'Tesla software update follow-up read failed'))
    }, delayMs)
  }
  /**
   * Scheduled installation: a read right after the scheduled time, to see it START (otherwise the
   * car seen at rest would only be re-read after `TESLA_REST_MS`, and the card would announce a time
   * already past). During installation, `isResting` is false: every polling round re-reads.
   */
  function watchUpdateStart(vin: string): void {
    clearUpdateWatch(vin)
    const su = lastSoftware(vin)?.softwareUpdate
    if (su?.status !== 'scheduled' || su.scheduledAt === undefined) return
    const delay = su.scheduledAt - ctx!.clock.now() + UPDATE_START_GRACE_MS
    if (delay <= 0 || delay > UPDATE_WATCH_MAX_MS) return
    updateWatch.set(vin, readLater(vin, delay))
  }

  async function softwareCommand(vin: string, command: CommandOf<'vehicle.schedule_update'> | CommandOf<'vehicle.cancel_update'>): Promise<void> {
    if (vehicles.get(vin)!.sleepState !== 'online') throw new PluginError('DEVICE_UNAVAILABLE', 'vehicle is asleep: wake it first')
    const last = lastSoftware(vin)?.softwareUpdate ?? undefined
    let next: SoftwareUpdate
    if (command.type === 'vehicle.schedule_update') {
      if (last?.status !== 'available' && last?.status !== 'scheduled') {
        throw new PluginError('DEVICE_UNAVAILABLE', `no downloaded software update to install${last ? ` (${last.status})` : ''}`)
      }
      await vehicleCommand(vin, 'schedule_software_update', { offset_sec: command.delayS })
      next = { ...last, status: 'scheduled', scheduledAt: ctx!.clock.now() + command.delayS * 1000 }
      log().info({ vin, version: last.version, delayS: command.delayS }, 'Tesla software update scheduled')
    } else {
      // nothing scheduled: nothing to cancel, and nothing to pay
      if (last?.status !== 'scheduled') return
      await vehicleCommand(vin, 'cancel_software_update')
      const { scheduledAt: _dropped, ...rest } = last
      next = { ...rest, status: 'available' }
      log().info({ vin, version: last.version }, 'Tesla software update cancelled')
    }
    ctx!.emitState(vin, { softwareUpdate: next })
    saved.vehicles[vin] = { ...saved.vehicles[vin], softwareUpdate: next }
    persist()
    // the published time is OURS; Tesla sets its own (countdown of a "now"): we re-read it.
    // Cancelled, nothing left to watch
    clearUpdateWatch(vin)
    if (command.type === 'vehicle.schedule_update') updateWatch.set(vin, readLater(vin, UPDATE_FOLLOW_UP_MS))
  }

  // ---- domain registration ------------------------------------------------------------------

  /**
   * Did Tesla read OUR public key on the domain? It returns it as a hexadecimal EC POINT (`04…`),
   * not as PEM (`samePublicKey` accepts both). Registering the domain again with a changed key
   * UPDATES what Tesla holds (`updated_at` moves): that's how a rotation is caught up.
   */
  async function verifyRegistration(partnerToken: string): Promise<boolean> {
    const raw = await client!.partnerRequest('GET', `/api/1/partner_accounts/public_key?domain=${encodeURIComponent(config!.TESLA_DOMAIN!)}`, partnerToken, { signal: ctx!.signal })
    const served = partnerPublicKeySchema.parse(raw).response?.public_key
    registered = !!served && !!keys && samePublicKey(served, keys.publicPem)
    return registered
  }

  return {
    id: 'tesla',
    configSchema: teslaConfigSchema,

    async init(context) {
      ctx = context
      config = context.config as TeslaConfig
      // the key pair depends on nothing: generated from the very first startup, the Settings card
      // can show the public key to put on the domain even before the application exists
      keyStore = deps.keyStore ?? (config.TESLA_KEY_FILE ? createKeyFile(config.TESLA_KEY_FILE, context.logger) : null)
      if (keyStore) keys = await ensureKeyPair(keyStore, context.logger)

      if (!configured()) {
        log().warn('Tesla application not configured: set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET and TESLA_DOMAIN')
        return
      }
      store = deps.stateStore ?? (config.TESLA_STATE_FILE ? createStateFile(config.TESLA_STATE_FILE, context.logger) : null)
      saved = (await store?.load()) ?? emptyState()
      if (saved.cycle) log().info({ month: saved.cycle.month, usd: cycleCostUsd(saved.cycle) }, 'Tesla usage of the current billing cycle restored')

      const tokens = deps.tokenStore ?? (config.TESLA_TOKEN_FILE ? createTokenFile(config.TESLA_TOKEN_FILE, context.logger) : null)
      auth = new TeslaAuth({
        clientId: config.TESLA_CLIENT_ID!, clientSecret: config.TESLA_CLIENT_SECRET!, redirectUri: config.TESLA_REDIRECT_URI,
        region: config.TESLA_REGION, fetchImpl, store: tokens, now: () => context.clock.now(), logger: context.logger,
      })
      client = new TeslaClient({
        baseUrl: REGION_BASE_URLS[config.TESLA_REGION], auth, fetchImpl, logger: context.logger,
        onCall: (path) => {
          const kind = billableKind(path)
          if (!kind) return
          countCall(saved, kind, context.clock.now())
          persist()
        },
      })
      if (await auth.restore()) log().info('Tesla account tokens restored from cache')
      else log().warn('no Tesla account linked: open the Settings card (GET /api/plugins/tesla/auth/url)')
    },

    /** Without an account, nothing to publish: the Settings card says what to do. */
    async discover(): Promise<DeviceDescriptor[]> {
      if (!auth?.linked) return []
      try {
        adoptList(await listVehicles(), false)
        log().info({ vehicles: vehicles.size }, 'Tesla vehicles listed')
      } catch (err) {
        lastError = (err as Error).message
        log().warn({ err }, 'could not list Tesla vehicles')
      }
      return descriptors()
    },

    async start() {
      // the last known values BEFORE any read: otherwise the card stays empty ("Never read")
      // until the car wakes up, which can take hours
      for (const [vin, patch] of Object.entries(saved.vehicles)) {
        if (vehicles.has(vin)) ctx!.emitState(vin, patch as never)
      }
      startPolling()
    },

    async execute(externalId, command: Command) {
      if (!client) throw new PluginError('NEEDS_PAIRING', 'Tesla plugin not configured')
      if (!vehicles.has(externalId)) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Tesla vehicle ${externalId}`)
      if (command.type === 'vehicle.refresh') {
        // re-read NOW: the list first (the vehicle may have fallen asleep since it was displayed),
        // then the full read if it's awake, counted against the budget. Asleep, we don't wake it:
        // that's the other button, and it costs ten times more
        adoptList(await listVehicles())
        const track = vehicles.get(externalId)!
        track.sleepState = toSleepState(track.summary.state)
        ctx!.emitState(externalId, toSleepPatch(track.summary))
        if (track.sleepState !== 'online') return
        if (!takeBudget()) throw new PluginError('RATE_LIMITED', `Tesla daily vehicle_data budget spent (${config!.TESLA_DAILY_DATA_BUDGET}): try again tomorrow`)
        try { await readVehicle(externalId) }
        catch (err) {
          if (err instanceof PluginError && err.code === 'DEVICE_UNAVAILABLE') { track.sleepState = 'asleep'; ctx!.emitState(externalId, { sleepState: 'asleep' }); return }
          throw err
        }
        return
      }
      /**
       * Set the charge limit. A COMMAND costs $0.001 — ten times less than a read — but requires the
       * car AWAKE: asleep, Tesla answers 408, and it's the "Wake up" button, paid and explicit, that
       * brings it back. Never an implicit wake-up for a setting.
       *
       * The target is published RIGHT AWAY: without a re-read (billed, and the car may fall asleep
       * again within the minute), it's our echo that keeps the card up to date until the next round.
       */
      if (command.type === 'vehicle.set_charge_limit') {
        // "online" according to the list, but its internal buses are still asleep: TRANSIENT refusal,
        // seen on the real car on 2026-10-01 (the first limit set failed, the next one went through)
        for (let attempt = 0; ; attempt++) {
          const body = commandResultSchema.parse(await client.request(
            'POST', `/api/1/vehicles/${encodeURIComponent(externalId)}/command/set_charge_limit`,
            { body: { percent: command.percent }, signal: ctx!.signal },
          ))
          if (body.response?.result === true) break
          const reason = body.response?.reason
          if (reason === 'could_not_wake_buses' && attempt < LIMIT_BUSES_RETRIES) {
            log().info({ vin: externalId }, 'Tesla buses still asleep: retrying the charge limit')
            await sleep(ctx!.clock, LIMIT_BUSES_PAUSE_MS, ctx!.signal)
            continue
          }
          throw new PluginError('UPSTREAM_ERROR', `Tesla refused the charge limit${reason ? `: ${reason}` : ''}`)
        }
        ctx!.emitState(externalId, { chargeLimit: command.percent })
        log().info({ vin: externalId, percent: command.percent }, 'Tesla charge limit set')
        return
      }
      if (command.type === 'vehicle.climate_stop') {
        // asleep, the car doesn't have its climate running: nothing to stop, and above all nothing to wake
        if (vehicles.get(externalId)!.sleepState !== 'online') { ctx!.emitState(externalId, { climateOn: false }); return }
        await climateCommand(externalId, command)
        return
      }
      if (command.type === 'vehicle.climate_set') {
        await setClimate(externalId, command)
        return
      }
      if (command.type === 'vehicle.climate_start') {
        await startClimate(externalId, command)
        return
      }
      if (command.type === 'vehicle.start_charge' || command.type === 'vehicle.stop_charge') {
        await charge(externalId, command.type === 'vehicle.start_charge')
        return
      }
      if (command.type === 'vehicle.schedule_update' || command.type === 'vehicle.cancel_update') {
        await softwareCommand(externalId, command)
        return
      }
      if (command.type !== 'vehicle.wake') {
        throw new PluginError('UNSUPPORTED_COMMAND', `Tesla plugin does not support ${command.type} yet`)
      }
      // a wake-up costs ten reads at Tesla, and it's a user ACTION: never automatic
      await client.request('POST', `/api/1/vehicles/${encodeURIComponent(externalId)}/wake_up`, { signal: ctx!.signal })
      log().info({ vin: externalId }, 'Tesla vehicle wake requested')
      const track = vehicles.get(externalId)!
      track.restUntil = 0
      // delayed re-read: we woke the vehicle in order to SEE it
      void (async () => {
        await sleep(ctx!.clock, WAKE_FOLLOW_UP_MS, ctx!.signal)
        if (ctx!.signal.aborted || !takeBudget()) return
        try { await readVehicle(externalId) }
        catch (err) { log().debug({ err, vin: externalId }, 'vehicle still asleep after wake') }
      })()
    },

    async stop() {
      persist()
      if (ctx) for (const vin of [...updateWatch.keys()]) clearUpdateWatch(vin)
      polling = false
      if (timer !== null && ctx) ctx.clock.clearTimeout(timer)
      timer = null
      client = null
      auth = null
      vehicles.clear()
      pendingStates.clear()
    },

    registerRoutes(app: FastifyInstance) {
      // Where the setup stands, for the Settings card. Never a secret.
      app.get('/status', async () => status())

      // The application's public key, as it must be served on the domain.
      app.get('/public-key', async (_req, reply) => {
        if (!keys) return sendError(reply, 409, 'NEEDS_PAIRING', 'no key pair yet (TESLA_KEY_FILE is empty?)')
        return reply.type('application/x-pem-file').send(keys.publicPem)
      })

      /**
       * New key pair. Tesla only accepts a public key for ONE application: recreating the application
       * (another developer account) makes the old key unusable. After rotation, the public key must be
       * PUT BACK on the domain, then the domain registered again.
       */
      app.post('/public-key/rotate', async (_req, reply) => {
        if (!keyStore) return sendError(reply, 409, 'NEEDS_PAIRING', 'no key store (TESLA_KEY_FILE is empty)')
        const pair = generateKeyPair()
        await keyStore.save(pair.privatePem)
        keys = pair
        registered = undefined
        lastError = null
        log().warn('Tesla application key pair rotated: publish the new public key on the domain, then register again')
        return status()
      })

      /**
       * Registers the domain with Tesla (partner token), then checks what Tesla read of the public
       * key. To be done once the key is on the domain; to be redone if it changes.
       */
      app.post('/register', async (_req, reply) => {
        if (!client || !auth) return sendError(reply, 409, 'NEEDS_PAIRING', 'set TESLA_CLIENT_ID and TESLA_CLIENT_SECRET first')
        if (!config!.TESLA_DOMAIN) return sendError(reply, 409, 'NEEDS_PAIRING', 'set TESLA_DOMAIN: the domain that serves the public key')
        try {
          const token = await auth.partnerToken(ctx!.signal)
          // check first: a domain already registered with THIS key has nothing to redo, and Tesla in
          // fact refuses to register it again (422 "Public key hash has already been taken", observed
          // on the real account). So that particular 422 means "already done", not "failed".
          // the check itself may be refused (403 "This account does not have access to <domain>" on
          // the real account, even though the region's API answers): it's not proof of
          // non-registration, we try it without depending on it
          let taken: string | null = null
          const verify = () => verifyRegistration(token).catch((err) => { log().warn({ err }, 'could not verify the Tesla registration'); return undefined })
          if ((await verify()) !== true) {
            let alreadyTaken: string | null = null
            try {
              await client.partnerRequest('POST', '/api/1/partner_accounts', token, { body: { domain: config!.TESLA_DOMAIN }, signal: ctx!.signal })
            } catch (err) {
              const m = /(Domain|Public key hash) has already been taken/i.exec((err as Error).message)
              if (!m) throw err
              alreadyTaken = m[0]
              log().info({ domain: config!.TESLA_DOMAIN, reason: alreadyTaken }, 'Tesla says the registration already exists')
            }
            // Tesla knows the key (422) and can't tell us which one it serves: we take its word
            if ((await verify()) === undefined) registered = alreadyTaken ? true : undefined
            taken = alreadyTaken
          }
          lastError = registered ? null : `Tesla did not read our public key at ${publicKeyUrl()}`
          log().info({ domain: config!.TESLA_DOMAIN, registered }, 'Tesla partner account registered')
          // an account linked before registration couldn't list its vehicles: now it can.
          // And it's the REAL test of the registration: a 412 "must be registered" after a 422 "key
          // already taken" means the key is registered by ANOTHER application (observed: application
          // recreated under a second account, same key). A new key pair is then needed
          // (`POST /public-key/rotate`), to be put back on the domain.
          if (auth.linked) {
            try { adoptList(await listVehicles()); ctx!.emitDevices(descriptors()); startPolling() }
            catch (err) {
              const msg = (err as Error).message
              if (/must be registered/i.test(msg)) {
                // "already taken" + "not registered" = taken by ANOTHER application (another client id).
                // Observed: application recreated under a second developer account, same domain — a
                // domain belongs to only ONE application. The key can be changed; the domain can't.
                registered = false
                lastError = /Domain/i.test(taken ?? '')
                  ? `Tesla refuses this application in region ${config!.TESLA_REGION}: the domain ${config!.TESLA_DOMAIN} is registered by ANOTHER application (another client id). Reuse that application's TESLA_CLIENT_ID / TESLA_CLIENT_SECRET (any Tesla account can then consent), or delete it on developer.tesla.com, then register again`
                  : `Tesla refuses this application in region ${config!.TESLA_REGION}: the public key is registered by another application. Generate a new key (POST /api/plugins/tesla/public-key/rotate), publish it on ${publicKeyUrl()}, then register again`
              } else lastError = msg
              log().warn({ err }, 'Tesla vehicle list still failing after registration')
            }
          }
        } catch (err) {
          lastError = (err as Error).message
          const d = describeError(err)
          return sendError(reply, d.status, d.code, d.message)
        }
        return status()
      })

      // Link to open in a browser to link the Tesla account to the application.
      app.get('/auth/url', async (_req, reply) => {
        if (!auth) return sendError(reply, 409, 'NEEDS_PAIRING', 'set TESLA_CLIENT_ID and TESLA_CLIENT_SECRET first')
        const state = randomBytes(16).toString('hex')
        pendingStates.add(state)
        return { url: authorizationUrl({ clientId: config!.TESLA_CLIENT_ID!, redirectUri: config!.TESLA_REDIRECT_URI, state }), redirectUri: config!.TESLA_REDIRECT_URI }
      })

      // Return from Tesla after consent: the code becomes tokens, kept by the server.
      app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>('/auth/callback', async (req, reply) => {
        if (!auth) return sendError(reply, 409, 'NEEDS_PAIRING', 'plugin not configured')
        const { code, state, error } = req.query
        if (error) return sendError(reply, 400, 'OAUTH_DENIED', `Tesla returned "${error}"${req.query.error_description ? `: ${req.query.error_description}` : ''}`)
        if (!state || !pendingStates.has(state)) return sendError(reply, 400, 'INVALID_STATE', 'unknown or missing state: start again from /auth/url')
        if (!code) return sendError(reply, 400, 'INVALID_BODY', 'missing code')
        pendingStates.delete(state)
        try {
          await auth.exchangeCode(code, ctx!.signal)
        } catch (err) {
          lastError = (err as Error).message
          const d = describeError(err)
          return sendError(reply, d.status, d.code, d.message)
        }
        // the account is linked and its tokens kept: what follows may fail without undoing the link
        // (observed: 412 "must be registered in the current region" when the application isn't yet
        // registered for THIS account — the polling will retry, registration is done from the card)
        let listError: string | null = null
        try {
          adoptList(await listVehicles())
          ctx!.emitDevices(descriptors())
          lastError = null
        } catch (err) {
          listError = (err as Error).message
          lastError = listError
          log().warn({ err }, 'Tesla account linked but the vehicle list failed')
        }
        startPolling()
        log().info({ vehicles: vehicles.size }, 'Tesla account linked')
        return reply.type('text/html; charset=utf-8').send(linkedPage(descriptors().map((d) => d.name), !!config!.TESLA_TOKEN_FILE, listError))
      })

      /**
       * Realigns the month's counter on the vendor's CONSOLE, which alone bills. The estimate
       * inevitably drifts: unpublished pricing categories, rounding, and calls made outside Kasbah
       * (another third-party application shares the same credit). Body: `{ data, wakes, commands }`
       * — the DATE isn't realigned: the cycle starts on the 1st of the month, the console says so too.
       */
      app.post('/usage', async (req, reply) => {
        if (!ctx) return sendError(reply, 409, 'NEEDS_PAIRING', 'plugin not started')
        const body = z.object({
          data: z.number().int().min(0), wakes: z.number().int().min(0), commands: z.number().int().min(0),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'send { data, wakes, commands }')
        const cycle = currentCycle(saved, ctx.clock.now())
        saved.cycle = { ...cycle, ...body.data }
        persist()
        log().info({ cycle: saved.cycle, usd: cycleCostUsd(saved.cycle) }, 'Tesla usage realigned on the vendor console')
        return { cycle: saved.cycle, estimatedUsd: cycleCostUsd(saved.cycle) }
      })

      /**
       * RAW reading: the list, then `vehicle_data` of each AWAKE vehicle. To write the fixtures from real responses. Each read is billed and counted against the budget; a
       * sleeping vehicle is NOT woken, it appears with its 408.
       */
      app.get('/raw', async (_req, reply) => {
        if (!client || !auth?.linked) return sendError(reply, 409, 'NEEDS_PAIRING', 'link the Tesla account first')
        const out: Record<string, unknown> = {}
        try {
          // which region Tesla files this account in: an EMPTY list often comes from an API base that
          // isn't the right one (`/users/me`, for its part, requires the `user_data` scope we don't request)
          try { out['/api/1/users/region'] = await client.request('GET', '/api/1/users/region', { signal: ctx!.signal }) }
          catch (err) { out['/api/1/users/region'] = { error: (err as Error).message } }
          const list = await client.request('GET', '/api/1/vehicles', { signal: ctx!.signal })
          out['/api/1/vehicles'] = list
          for (const item of vehiclesListSchema.parse(list).response) {
            const v = vehicleSummarySchema.safeParse(item)
            if (!v.success || toSleepState(v.data.state) !== 'online') continue
            const path = `/api/1/vehicles/${v.data.vin}/vehicle_data?endpoints=${encodeURIComponent(DATA_ENDPOINTS)}`
            if (!takeBudget()) { out[path] = { skipped: 'daily budget spent' }; continue }
            try { out[path] = await client.request('GET', path, { signal: ctx!.signal }) }
            catch (err) { out[path] = { error: (err as Error).message } }
            // release notes: documented with neither format nor parameters; `staged=true` (cited by
            // the community) would target the PENDING version. Captured here to derive the schema
            for (const notes of [`/api/1/vehicles/${v.data.vin}/release_notes`, `/api/1/vehicles/${v.data.vin}/release_notes?staged=true`]) {
              try { out[notes] = await client.request('GET', notes, { signal: ctx!.signal }) }
              catch (err) { out[notes] = { error: (err as Error).message } }
            }
          }
        } catch (err) {
          const d = describeError(err)
          return sendError(reply, d.status, d.code, d.message)
        }
        return out
      })
    },

    async releaseNotes(externalId, lang) {
      const track = vehicles.get(externalId)
      if (!track) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Tesla vehicle ${externalId}`)
      // a language never requested before: kept for the next reads (English is served until then),
      // and read right away if the car is awake — never a wake-up for notes
      if (lang !== RELEASE_NOTES_FALLBACK_LANG && !saved.releaseNotesLangs.includes(lang) && saved.releaseNotesLangs.length < NOTES_MAX_LANGS) {
        saved.releaseNotesLangs = [...saved.releaseNotesLangs, lang]
        persist()
        if (track.sleepState === 'online') void refreshNotes(externalId)
      }
      return releaseNotesOf(externalId, lang)
    },

    health(): PluginHealth {
      const keysList = ['TESLA_CLIENT_ID', 'TESLA_CLIENT_SECRET', 'TESLA_DOMAIN', 'TESLA_REGION', 'TESLA_REDIRECT_URI', 'TESLA_TOKEN_FILE', 'TESLA_KEY_FILE', 'TESLA_STATE_FILE', 'TESLA_POLL_MS', 'TESLA_REST_MS', 'TESLA_DAILY_DATA_BUDGET']
      if (!configured()) return { status: 'needs_pairing', detail: 'set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET and TESLA_DOMAIN, then follow the Settings card', keys: keysList }
      if (!auth?.linked) return { status: 'needs_pairing', detail: lastError ?? 'link the Tesla account from Settings', keys: keysList }
      const deviceCount = vehicles.size
      const asleep = [...vehicles.values()].filter((v) => v.sleepState !== 'online').length
      const used = budgetUsedToday()
      const limit = config!.TESLA_DAILY_DATA_BUDGET
      const parc = `${deviceCount} véhicule(s), ${asleep} en veille · ${used}/${limit} lectures aujourd'hui`
      // The quota published for the UI is the vendor's MONTHLY CREDIT ($10, calendar cycle), not the
      // daily budget the plugin imposes on itself: that's the one we don't want to exceed, and it's
      // what the user wants to see. An ESTIMATE, computed from the listed prices: only Tesla bills,
      // and its console remains the reference.
      const cycle = currentCycle(saved, ctx!.clock.now())
      const quota = {
        quota: {
          used: cycleCostUsd(cycle), limit: MONTHLY_CREDIT_USD,
          labelKey: 'vehicle.quotaCredit', unit: 'usd' as const, since: cycleStart(cycle.month),
        },
      }
      if (registered === false) return { status: 'degraded', detail: `domain ${config!.TESLA_DOMAIN} not registered with Tesla · ${parc}`, keys: keysList, deviceCount, ...quota }
      if (lastError) return { status: 'degraded', detail: lastError, keys: keysList, deviceCount, ...quota }
      return { status: 'ok', detail: parc, keys: keysList, deviceCount, ...quota }
    },
  }
}

function linkedPage(names: string[], kept: boolean, listError: string | null): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  return `<!doctype html><meta charset="utf-8"><title>Kasbah · Tesla</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#222}.warn{color:#a35a00}</style>
<h1>Compte Tesla lié</h1>
${listError
    ? `<p class="warn">La liste des véhicules a échoué : ${esc(listError)}.<br>Si Tesla demande d’enregistrer l’application dans la région, faites « Enregistrer le domaine » dans la carte Tesla des Réglages ; le compte reste lié.</p>`
    : `<p>${names.length} véhicule(s) : ${names.map(esc).join(', ') || 'aucun pour l’instant'}.</p>`}
<p>${kept ? 'Le serveur garde les jetons : il n’y a rien à recopier, la liaison survit aux redémarrages.' : 'Aucun fichier de jetons n’est configuré (TESLA_TOKEN_FILE est vide) : la liaison sera perdue au redémarrage du serveur.'}</p>
<p>Vous pouvez fermer cet onglet.</p>`
}
