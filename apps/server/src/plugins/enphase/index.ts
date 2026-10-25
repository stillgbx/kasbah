import type { Command, DeviceDescriptor, PluginHealth, SettableChargeMode } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import type { FetchLike } from '../../core/sse'
import { TlsPin, createPinFile, type PinFile } from '../../core/tls-pin'
import { sendError } from '../../http/errors'
import { createPoller } from '../../core/poll'
import { sleep } from '../../core/clock'
import { EnphaseClient } from './client'
import {
  batteriesOf, chargerSummariesOf, chargersOf, enabledChargingMode, isBatteryAvailable, isPanelStale, toBatteryPatch, toChargerDescriptors,
  toChargerPatch, toDailyPatch, toDescriptors, toPanelPatch, toSitePatch, ENPHASE_CHARGE_MODE, SITE_ID, type EvCharger, type EvChargerSummary,
  type Inventory,
} from './mapping'
import {
  ensembleInventorySchema, ensemblePowerSchema, invertersSchema, livedataSchema, productionSchema,
  type EnsembleDevice, type Inverter,
} from './types'
import {
  RENEW_WARNING_DAYS, checkToken, createTokenFile, exchangeEnphaseToken, rejectionMessage, resolveEnphaseToken,
  type CheckedToken, type TokenSource, type TokenStore,
} from './token'
import {
  EnlightenClient, createCloudFile, openCloudSession, probeEvRaw, type CloudStore,
} from './cloud'
import { EnergyDays, addDays, createDaysFile, dayKey, keyStart as keyStartOf, lifetimeEnergySchema, type DayCounters, type DaysStore, type SitePower } from './days'
import {
  InverterDays, arrayLayoutSchema, createInverterDaysFile, deviceDataSchema, inverterEnergySchema, type InverterDaysStore,
} from './inverterDays'

// Enphase plugin: solar production, microinverters and batteries read from the IQ Gateway's LOCAL
// API (no cloud quota, no dependency on the Internet once the token is in place).
//
// Publishes an `energy` site, a power `sensor` per microinverter and a storage `energy` per IQ
// battery (see `mapping.ts`). Two rates: the meters measure in real time, the inverters only report
// every five minutes.
//
// The mapping was written AFTER capturing real responses (`GET /api/plugins/enphase/raw`, from
// which `__fixtures__/gateway.ts` is drawn): the TaHoma lesson is that fixtures written from the
// documentation let through bugs the real hardware finds straight away. It paid off again here, the
// storage sign being the opposite of what the contract expects.
//
// The IQ EV Charger 2 is NOT on the gateway: it talks to the Enphase cloud (the app's private
// API). An `ev_charger` sub-item and an Enlighten session separate from the local token.
// Mapping from `GET /api/plugins/enphase/ev/raw` of 09/20: read-only (no command captured),
// `SUSPENDED_EVSE` / `INSUFFICIENT_SOLAR` read as `connected`.

const optionalKey = z.string().trim().transform((s) => (s === '' ? undefined : s)).optional()

export const enphaseConfigSchema = z.object({
  /** Gateway name or IP. `envoy.local` is the name the vendor gives it on the LAN. */
  ENPHASE_HOST: z.string().trim().min(1).default('envoy.local'),
  /**
   * Bootstrap token, optional: the one obtained by hand on entrez.enphaseenergy.com. Without it,
   * the plugin starts in `needs_pairing` and pairing is done from Settings. The Enphase account
   * password is DELIBERATELY not a config key: it is asked for when minting a token, and never kept.
   */
  ENPHASE_TOKEN: optionalKey,
  /** Where to keep the token between two starts (it lasts a year). Empty string = keep nothing. */
  ENPHASE_TOKEN_FILE: z.string().trim().default(stateFile('enphase-token.json')),
  /**
   * Enlighten session (charger). Separate from the local token: pasting a gateway JWT does not open
   * the cloud. Empty string = do not keep the session, so retype the account to read the charger
   * again.
   */
  ENPHASE_CLOUD_FILE: z.string().trim().default(stateFile('enphase-cloud.json')),
  /** The site's daily totals (`days.ts`), kept for the lifetime of the installation. Empty string = in memory only. */
  ENPHASE_DAYS_FILE: z.string().trim().default(stateFile('enphase-days.json')),
  /** Each micro-inverter's daily production (`inverterDays.ts`). Empty string = in memory only. */
  ENPHASE_INVERTER_DAYS_FILE: z.string().trim().default(stateFile('enphase-inverter-days.json')),
  /** Meter rate: they measure in real time, it is what the Energy view shows. */
  ENPHASE_POLL_MS: z.coerce.number().int().min(2000).max(300_000).default(10_000),
  /**
   * Rate for the microinverters and batteries. No point going lower: an inverter ONLY reports about
   * every five minutes, polling faster would just re-read the same value.
   */
  ENPHASE_SLOW_POLL_MS: z.coerce.number().int().min(30_000).max(900_000).default(60_000),
})
export type EnphaseConfig = z.infer<typeof enphaseConfigSchema>

/** After a charger command, delay before reading again: the current arrives in 20 s to 1 min. */
const EV_FOLLOW_UP_MS = 45_000
/** Between switching to manual and going back to the previous mode: tried by hand with ~20 s, not faster. */
const MODE_RESTORE_GAP_MS = 5_000
/** The cloud takes a while to reflect the restored mode: we do not retry before that. */
const MODE_RESTORE_RETRY_MS = 15 * 60_000
/** The app's mode only changes by hand: read every ten minutes, not on every read. */
const PREFERENCE_TTL_MS = 10 * 60_000
/** The daily history is written at most this often: a restart loses no more than that. */
const DAYS_SAVE_MS = 5 * 60_000
/** The inverters' counters (`/ivp/pdm/device_data`, ~50 KB): they only move when an inverter reports, every ~5 min. */
const DEVICE_DATA_MS = 5 * 60_000
/** Between two days asked of Enlighten during an inverter resync: ~345 calls, spread out. */
const VENDOR_DAY_GAP_MS = 2_000

/** Raw reading: what needs capturing once to write the mapping fixtures. */
const RAW_PATHS = [
  '/production.json?details=1',
  '/api/v1/production/inverters',
  '/ivp/meters',
  '/ivp/meters/readings',
  '/ivp/livedata/status',
  '/ivp/ensemble/inventory',
  '/ivp/ensemble/power',
  '/ivp/meters/reports/consumption',
] as const

/**
 * Pairing body: a token already obtained, OR the account credentials to mint one. `force` overrides
 * the safeguard that refuses to mint a token while the current one is still good: each mint creates
 * a token AT Enphase, and piling up unused ones makes no sense.
 */
const pairingSchema = z.union([
  z.object({ token: z.string().min(1) }),
  z.object({ user: z.string().min(1), password: z.string().min(1), force: z.boolean().default(false) }),
])

/** What the UI shows of the pairing. NEVER carries the token itself. */
export interface TokenStatus {
  paired: boolean
  host: string
  serial: string | undefined
  software: string | undefined
  stage: 'ok' | 'expiring' | 'expired' | 'none'
  daysLeft: number | undefined
  expiresAt: number | undefined
  role: string | undefined
  username: string | undefined
  source: 'config' | 'cache' | 'minted' | undefined
  /** Threshold (days) below which the UI asks for a renewal. */
  renewUnderDays: number
  /**
   * Where the server keeps the token, or `null` if `ENPHASE_TOKEN_FILE` is empty. It is what tells
   * the UI whether there is something to copy by hand: with a cache, no, pairing from the UI is
   * enough and survives restarts. Without a cache, it will have to go into `.env`.
   */
  tokenFile: string | null
  /** Cached Enlighten session: required for the charger, useless to the gateway. */
  cloudLinked: boolean
  cloudFile: string | null
  siteId: string | undefined
  /** The daily history: last synchronization with Enphase's, and how many days are kept. */
  history: {
    syncedAt: number | null; since: number | null; days: number; syncing: boolean; error: string | null
    /** The micro-inverters' days: last full synchronization, and the one in progress (days done / to do). */
    inverters: { syncedAt: number | null; done: number | null; total: number | null; error: string | null }
    /**
     * Each past day since commissioning, one letter per day from `from` (local midnight): `c`
     * complete, `p` incomplete, `m` missing — the site and its inverters together, the worse wins.
     */
    coverage: { from: number; days: string } | null
  }
}

export interface EnphasePluginDeps {
  /** Injected by tests: requests to the gateway. */
  gatewayFetch?: FetchLike
  /** Injected by tests: requests to the Enphase cloud (token minting). */
  cloudFetch?: FetchLike
  /** Injected by tests: token cache (otherwise a file under `.state/`). */
  store?: TokenStore
  /** Injected by tests: Enlighten session (charger). */
  cloudStore?: CloudStore
  /** Injected by tests: the gateway certificate pin (otherwise a file under `.state/`). */
  pinFile?: PinFile
  /** Injected by tests: the daily history (otherwise a file under `.state/`). */
  daysStore?: DaysStore
  /** Injected by tests: the inverters' daily history (otherwise a file under `.state/`). */
  inverterDaysStore?: InverterDaysStore
}

export function createEnphasePlugin(deps: EnphasePluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: EnphaseConfig | null = null
  let client: EnphaseClient | null = null
  let store: TokenStore | null = null
  let cloudStore: CloudStore | null = null
  let enlighten: EnlightenClient | null = null
  /**
   * Gateway certificate, pinned on first use. In its own file, not the token's: that one is optional
   * (`ENPHASE_TOKEN_FILE` empty, token in `.env`), and the pin must survive a restart regardless.
   */
  let pin: TlsPin | null = null
  /** Gateway identity (`/info`, no token). Absent if it has not answered yet. */
  let gateway: { serial: string; software?: string } | null = null
  let token: (CheckedToken & { source: TokenSource }) | null = null
  let lastError: string | null = null
  /** Last known inventory (meters, inverters, batteries): source of the descriptors. */
  let inventory: Inventory | null = null
  let chargers: EvCharger[] | null = null
  let chargerSummaries: EvChargerSummary[] = []
  /** Chargers started or stopped by Kasbah since the last return to their mode. */
  const forced = new Set<string>()
  /** Mode to restore after a switch to manual whose return failed: we do not go through manual again. */
  const owed = new Map<string, string>()
  const lastRestore = new Map<string, number>()
  /** The app's mode per charger, and when it was read (`preferenceOf`). */
  const preferences = new Map<string, { mode: string | undefined; at: number }>()
  let pollers: { stop(): void }[] = []
  /** The site's daily totals: measured here, completed by Enphase's history. */
  let days: EnergyDays | null = null
  let daysStore: DaysStore | null = null
  let daysSavedAt = 0
  let syncing: Promise<void> | null = null
  let syncError: string | null = null
  let invDays: InverterDays | null = null
  let invStore: InverterDaysStore | null = null
  let deviceDataAt = 0
  /** The inverter resync in progress: days done and to do. */
  let invProgress: { done: number; total: number } | null = null
  let invError: string | null = null

  const log = () => ctx!.logger

  /** Reads `/info` again: gives the serial number, used to validate any proposed token. */
  async function readGateway(): Promise<void> {
    try {
      gateway = await client!.info(ctx!.signal)
      lastError = null
    } catch (err) {
      lastError = (err as Error).message
      log().warn({ err, host: config!.ENPHASE_HOST }, 'IQ Gateway did not answer /info')
    }
  }

  function status(): TokenStatus {
    return {
      paired: !!token,
      host: config?.ENPHASE_HOST ?? '',
      serial: gateway?.serial ?? token?.claims.serial,
      software: gateway?.software,
      stage: token?.stage ?? 'none',
      daysLeft: token?.daysLeft,
      expiresAt: token?.claims.expiresAt,
      role: token?.claims.role,
      username: token?.claims.username,
      source: token?.source,
      renewUnderDays: RENEW_WARNING_DAYS,
      tokenFile: config?.ENPHASE_TOKEN_FILE || null,
      cloudLinked: !!enlighten?.hasSession,
      cloudFile: config?.ENPHASE_CLOUD_FILE || null,
      siteId: enlighten?.current?.siteId,
      history: historyStatus(),
    }
  }

  function historyStatus(): TokenStatus['history'] {
    const snap = days && ctx ? days.snapshot(ctx.clock.now()) : null
    return {
      syncedAt: snap?.syncedAt ?? null, since: snap?.since ?? null, days: snap?.days.length ?? 0,
      syncing: !!syncing, error: syncError,
      inverters: {
        syncedAt: invDays?.toJSON().syncedAt ?? null,
        done: invProgress?.done ?? null, total: invProgress?.total ?? null, error: invError,
      },
      coverage: coverage(),
    }
  }

  /** The state of every past day, site and inverters together (see `TokenStatus['history']`). */
  function coverage(): TokenStatus['history']['coverage'] {
    const since = days?.sinceKey
    if (!days || !since || !ctx) return null
    const now = ctx.clock.now()
    const yesterday = addDays(dayKey(now), -1)
    const rank = { c: 0, p: 1, m: 2 } as const
    let out = ''
    for (let k = since; k <= yesterday; k = addDays(k, 1)) {
      const site = days.dayStatus(k, now)
      const inv = invDays?.tracked ? invDays.dayStatus(k) : 'c'
      out += rank[inv] > rank[site] ? inv : site
    }
    return { from: keyStartOf(since), days: out }
  }

  async function saveDays(force = false): Promise<void> {
    const now = ctx!.clock.now()
    if (!force && now - daysSavedAt < DAYS_SAVE_MS) return
    daysSavedAt = now
    if (days?.dirty && daysStore) await daysStore.save(days)
    if (invDays?.dirty && invStore) await invStore.save(invDays)
  }

  /**
   * Fetches each inverter's days from Enphase: the id ↔ serial map (`array_layout_x`), then ONE
   * call per day since commissioning (`inverter_data_x/energy.json` only sums the range asked), two
   * seconds apart, in the background. `force`: every day again; otherwise only the days that are not
   * complete (missing, or watched only in part), so an interrupted run picks up where it stopped.
   */
  async function syncInverters(force: boolean): Promise<void> {
    const inv = invDays
    if (invProgress || !inv || !days || !enlighten?.hasSession) return
    const since = days.snapshot(ctx!.clock.now()).since
    if (since === null) return
    invProgress = { done: 0, total: 0 }
    invError = null
    try {
      const siteId = await ensureSiteId()
      if (!siteId) throw new PluginError('NEEDS_PAIRING', 'no Enlighten site')
      const serialOf = arrayLayoutSchema.parse(await enlighten.getJson(`/pv/systems/${siteId}/array_layout_x`, ctx!.signal))
      const yesterday = addDays(dayKey(ctx!.clock.now()), -1)
      const todo: string[] = []
      for (let k = dayKey(since); k <= yesterday; k = addDays(k, 1)) if (force || inv.dayStatus(k) !== 'c') todo.push(k)
      invProgress.total = todo.length
      for (const key of todo) {
        await sleep(ctx!.clock, VENDOR_DAY_GAP_MS, ctx!.signal)
        if (ctx!.signal.aborted || invDays !== inv) return
        const parsed = inverterEnergySchema.parse(await enlighten.getJson(
          `/systems/${siteId}/inverter_data_x/energy.json?start_date=${key}&end_date=${key}`, ctx!.signal,
        ))
        inv.importVendorDay(key, parsed.production, serialOf, ctx!.clock.now())
        invProgress.done++
        if (invProgress.done % 20 === 0) await invStore?.save(inv)
      }
      inv.markSynced(ctx!.clock.now())
      await invStore?.save(inv)
      log().info({ days: todo.length }, 'Enphase inverter history synchronized')
    } catch (err) {
      invError = (err as Error).message
      log().warn({ err }, 'Enphase inverter history not synchronized')
      if (invStore) await invStore.save(inv)
    } finally { invProgress = null }
  }

  /**
   * Fetches Enphase's daily history: ONE call to Enlighten's private API, every day since
   * commissioning. Made when the history is empty and on request only: afterwards the plugin
   * counts the days itself.
   */
  function syncHistory(force = false): Promise<void> {
    syncing ??= (async () => {
      try {
        const siteId = await ensureSiteId()
        if (!siteId || !enlighten) {
          throw new PluginError('NEEDS_PAIRING', 'the Enphase history needs the Enphase account: pair with it (a pasted gateway token is not enough)')
        }
        const parsed = lifetimeEnergySchema.safeParse(await enlighten.getJson(`/pv/systems/${siteId}/lifetime_energy`, ctx!.signal))
        if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', 'Enlighten lifetime_energy has an unexpected shape')
        const result = days!.importVendor(parsed.data, ctx!.clock.now(), { onlyIncomplete: !force })
        await saveDays(true)
        syncError = null
        log().info(result, 'Enphase energy history synchronized')
        // the inverters follow, in the background: they need the commissioning date just read
        void syncInverters(force)
      } catch (err) {
        syncError = (err as Error).message
        throw err
      }
    })().finally(() => { syncing = null })
    return syncing
  }

  /** The first synchronization, by itself: as soon as the history is empty and the account linked. */
  function autoSync(): void {
    if (!days || !enlighten?.hasSession) return
    if (!days.synced) syncHistory().catch((err: unknown) => log().warn({ err }, 'Enphase energy history not synchronized'))
    else if (invDays && !invDays.synced) void syncInverters(false)
  }

  /** Checks a token for THIS gateway, then adopts it: client, cache, current state. */
  async function adopt(candidate: string): Promise<void> {
    const result = checkToken(candidate, { serial: gateway?.serial, now: ctx!.clock.now() })
    if (!result.ok) {
      throw new PluginError('NEEDS_PAIRING', rejectionMessage(result.reason, result.claims, gateway?.serial))
    }
    token = { ...result.checked, source: 'minted' }
    client!.setToken(result.checked.token)
    await store?.save(result.checked.token)
  }

  const get = async <T>(path: string, parse: (j: unknown) => T): Promise<T> =>
    parse(await client!.getJson(path, ctx!.signal))

  /**
   * Batteries are optional: a gateway without storage does not serve `/ivp/ensemble/`. A failure
   * here must therefore not deprive the user of their production.
   */
  async function readBatteries(): Promise<EnsembleDevice[]> {
    try { return batteriesOf(await get('/ivp/ensemble/inventory', (j) => ensembleInventorySchema.parse(j))) }
    catch (err) { log().debug({ err }, 'no Enphase storage inventory: assuming no battery'); return [] }
  }

/**
   * Reads what makes up the installation again. Requests are chained instead of sent together: the
   * gateway is a small box, and running them in parallel pushed it past the timeout.
   */
  async function readInventory(): Promise<Inventory> {
    const report = await get('/production.json?details=1', (j) => productionSchema.parse(j))
    const inverters = await get('/api/v1/production/inverters', (j) => invertersSchema.parse(j))
    const batteries = await readBatteries()
    return { report, inverters, batteries }
  }

  /** Inventory signature: changes when an inverter or a battery appears or disappears. */
  const deviceIds = (inv: Inventory) =>
    [...inv.inverters.map((i) => i.serialNumber), ...inv.batteries.map((b) => b.serial_num)].sort().join(',')

/**
   * Real-time measurement of the site, what the Energy view shows. ONE single request, to
   * `livedata`: it carries the same meters as `production.json` and answers in 0.2 s versus 1.5 to
   * 11 s.
   */
  async function pollMeters(): Promise<void> {
    const live = await get('/ivp/livedata/status', (j) => livedataSchema.parse(j))
    const patch = toSitePatch(live)
    ctx!.emitState(SITE_ID, patch)
    days?.recordSite(patch as SitePower, ctx!.clock.now())
    await saveDays()
    lastError = null
  }

  /**
   * Inverters and batteries. An inverter silent for half an hour (at night, or failed) becomes
   * unavailable rather than being assigned a zero we did not measure.
   */
  async function pollDevices(): Promise<void> {
    const inverters = await get('/api/v1/production/inverters', (j) => invertersSchema.parse(j))
    const batteries = await readBatteries()
    const power = await get('/ivp/ensemble/power', (j) => ensemblePowerSchema.parse(j)).catch(() => undefined)
    const now = ctx!.clock.now()
    for (const inv of inverters as Inverter[]) {
      if (isPanelStale(inv, now)) ctx!.setAvailable(inv.serialNumber, false)
      else ctx!.emitState(inv.serialNumber, toPanelPatch(inv))
    }
    for (const b of batteries) {
      if (!isBatteryAvailable(b)) { ctx!.setAvailable(b.serial_num, false); continue }
      ctx!.emitState(b.serial_num, toBatteryPatch(b, power))
    }
    // the day's totals are ONLY in `production.json`, which is slow: this is where we pay for it,
    // once a minute, and not on every real-time measurement
    const report = await get('/production.json?details=1', (j) => productionSchema.parse(j))
    const daily = toDailyPatch(report)
    ctx!.emitState(SITE_ID, daily)
    days?.recordCounters(daily as DayCounters, now)
    // each inverter's counters, at the pace its reports change; a failure costs only that reading
    if (invDays && now - deviceDataAt >= DEVICE_DATA_MS) {
      deviceDataAt = now
      try { invDays.recordGateway(await get('/ivp/pdm/device_data', (j) => deviceDataSchema.parse(j)), now) }
      catch (err) { log().debug({ err }, 'Enphase device_data unread') }
    }

    // an inverter added or removed changes the list: we republish, otherwise its state would go to
    // a device the registry does not know
    const next: Inventory = { report, inverters, batteries }
    if (!inventory || deviceIds(inventory) !== deviceIds(next)) {
      log().info({ inverters: inverters.length, batteries: batteries.length }, 'Enphase inventory changed')
      inventory = next
      publishDevices()
    } else inventory = next
    lastError = null
  }

  const chargersOn = () => ctx!.parts.ev_charger !== false

  function publishDevices() {
    ctx!.emitDevices([
      ...(inventory ? toDescriptors(inventory) : []),
      ...(chargers ? toChargerDescriptors(chargers, chargerSummaries) : []),
    ])
  }

  async function ensureSiteId(): Promise<string | undefined> {
    if (!enlighten?.hasSession) return undefined
    if (enlighten.current?.siteId) return enlighten.current.siteId
    const sites = await enlighten.readSites(ctx!.signal)
    if (!sites[0] || !enlighten.current) return undefined
    const session = { ...enlighten.current, siteId: sites[0].id }
    enlighten.setSession(session)
    await cloudStore?.save(session)
    return sites[0].id
  }

  async function fetchChargers(): Promise<void> {
    const siteId = await ensureSiteId()
    if (!siteId || !enlighten) { chargers = []; return }
    const status = await enlighten.getJson(`/service/evse_controller/${siteId}/ev_chargers/status`, ctx!.signal)
    const summary = await enlighten.getJson(
      `/service/evse_controller/api/v2/${siteId}/ev_chargers/summary?filter_retired=true`, ctx!.signal,
    ).catch(() => undefined)
    chargers = chargersOf(status)
    if (summary) chargerSummaries = chargerSummariesOf(summary)
  }

  /**
   * The app's mode only changes through the app or through Kasbah: we read it every ten minutes
   * (`PREFERENCE_TTL_MS`), and right after writing it, rather than on every charger read (one per
   * minute). A failed read keeps the old one.
   */
  async function preferenceOf(sn: string): Promise<string | undefined> {
    const known = preferences.get(sn)
    const now = ctx!.clock.now()
    if (known && now - known.at < PREFERENCE_TTL_MS) return known.mode
    const siteId = enlighten?.current?.siteId
    if (!siteId || !enlighten) return known?.mode
    try {
      const mode = enabledChargingMode(await enlighten.getJson(modePath(siteId, sn), ctx!.signal))
      preferences.set(sn, { mode, at: now })
      return mode
    } catch (err) {
      log().debug({ err }, 'Enphase charger mode unread')
      return known?.mode
    }
  }

  function emitCharger(c: EvCharger): void {
    const sum = chargerSummaries.find((s) => s.serialNumber === c.sn)
    ctx!.emitState(c.sn, toChargerPatch(c, sum, preferences.get(c.sn)?.mode))
    days?.recordChargerSession(c.sn, c.sessionWh, ctx!.clock.now())
  }

  async function pollChargers(): Promise<void> {
    await fetchChargers()
    publishDevices()
    for (const c of chargers ?? []) {
      if (!c.connected) ctx!.setAvailable(c.sn, false)
      else {
        await preferenceOf(c.sn)
        emitCharger(c)
      }
    }
    try { await restoreModes() }
    catch (err) { log().warn({ err }, 'Enphase charger mode not restored') }
  }

  /**
   * Give the unplugged charger back its mode from before the forcing. Seen on the real charger on
   * 2026-10-02: a forced charge finished and the car unplugged, the cancellation still held
   * (`mode` 0) and the app refused to switch green back on ("Charging mode is already enabled").
   * The previous mode is the app's preference, which forcing does not change; switching to manual
   * then writing it back lifts the cancellation (tried that day).
   *
   * Without a known forcing (server restart, action in the app), we only do it in green charging,
   * where `mode` 0 while unplugged is surely a forgotten cancellation. A manual preference is the
   * user's choice: nothing to give back. With the car still plugged in, it is the server that asks
   * for it, at its charge limit (`ev_charger.resume_mode`).
   */
  async function restoreModes(): Promise<void> {
    const siteId = enlighten?.current?.siteId
    if (!siteId || !enlighten) return
    for (const c of chargers ?? []) {
      if (!owed.has(c.sn)) {
        if (c.pluggedIn || !c.manualOverride) continue
        const now = ctx!.clock.now()
        if (now - (lastRestore.get(c.sn) ?? -Infinity) < MODE_RESTORE_RETRY_MS) continue
        lastRestore.set(c.sn, now)
        if (!await leaveOverride(siteId, c.sn, forced.has(c.sn))) continue
        await sleep(ctx!.clock, MODE_RESTORE_GAP_MS, ctx!.signal)
      }
      await giveModeBack(siteId, c.sn)
    }
  }

  const modePath = (siteId: string | number, sn: string) =>
    `/service/evse_scheduler/api/v1/iqevc/charging-mode/${siteId}/${encodeURIComponent(sn)}/preference`

  /**
   * First step: read the preference (the previous mode) and switch to manual. `known`: Kasbah forced
   * this charger, otherwise only green is given back. True when the previous mode is still to be
   * written back (`owed`).
   */
  async function leaveOverride(siteId: string | number, sn: string, known: boolean): Promise<boolean> {
    const path = modePath(siteId, sn)
    const preferred = enabledChargingMode(await enlighten!.getJson(path, ctx!.signal))
    preferences.set(sn, { mode: preferred, at: ctx!.clock.now() })
    if (!preferred || preferred === 'MANUAL_CHARGING') { forced.delete(sn); return false }
    if (!known && preferred !== 'GREEN_CHARGING') return false
    await enlighten!.send('PUT', path, { mode: 'MANUAL_CHARGING' }, ctx!.signal)
    owed.set(sn, preferred)
    return true
  }

  /** Second step: write the previous mode back. A failure leaves it owed: the next read retries it. */
  async function giveModeBack(siteId: string | number, sn: string): Promise<void> {
    const mode = owed.get(sn)
    if (!mode) return
    await enlighten!.send('PUT', modePath(siteId, sn), { mode }, ctx!.signal)
    owed.delete(sn)
    forced.delete(sn)
    log().info({ sn, mode }, 'Enphase charger back to its mode after a forced session')
  }

  /**
   * `ev_charger.resume_mode`: the server asks for it when the forced car reaches its limit, still
   * plugged in. Nothing if the charger is no longer under cancellation (`mode` 1 read back). The
   * return to the previous mode goes out 5 s later, outside the command timeout
   * (`KASBAH_COMMAND_TIMEOUT_MS`, 10 s).
   */
  async function resumeMode(sn: string): Promise<void> {
    if (!chargersOn() || !enlighten?.hasSession) throw new PluginError('NEEDS_PAIRING', 'no Enlighten session: pair with the Enphase account')
    const siteId = await ensureSiteId()
    if (!siteId) throw new PluginError('NEEDS_PAIRING', 'no Enlighten site')
    const charger = chargers?.find((c) => c.sn === sn)
    if (!charger) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Enphase charger ${sn}`)
    if (charger.manualOverride === false) { forced.delete(sn); return }
    if (!owed.has(sn) && !await leaveOverride(siteId, sn, true)) return
    void (async () => {
      await sleep(ctx!.clock, MODE_RESTORE_GAP_MS, ctx!.signal)
      if (ctx!.signal.aborted) return
      try { await giveModeBack(siteId, sn) }
      catch (err) { log().warn({ err }, 'Enphase charger mode not given back: retried at the next read') }
    })()
  }

  /**
   * `ev_charger.set_mode`: the app's mode, green or manual. Rewriting the current mode is refused
   * (`iqevc_sch_10028`, "already enabled"): the same mode under cancellation is `resumeMode`;
   * without cancellation, nothing. Another mode: a single PUT, which also lifts a cancellation (it
   * is the second step of `resumeMode`, tried on 2026-10-02). What Kasbah owed is no longer owed:
   * the user's choice comes first.
   */
  async function setMode(sn: string, mode: SettableChargeMode): Promise<void> {
    if (!chargersOn() || !enlighten?.hasSession) throw new PluginError('NEEDS_PAIRING', 'no Enlighten session: pair with the Enphase account')
    const siteId = await ensureSiteId()
    if (!siteId) throw new PluginError('NEEDS_PAIRING', 'no Enlighten site')
    const charger = chargers?.find((c) => c.sn === sn)
    if (!charger) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Enphase charger ${sn}`)
    const target = ENPHASE_CHARGE_MODE[mode]
    const path = modePath(siteId, sn)
    const current = enabledChargingMode(await enlighten.getJson(path, ctx!.signal))
    if (current === target) {
      if (charger.manualOverride && target !== 'MANUAL_CHARGING') await resumeMode(sn)
      return
    }
    await enlighten.send('PUT', path, { mode: target }, ctx!.signal)
    owed.delete(sn)
    forced.delete(sn)
    lastRestore.delete(sn)
    preferences.set(sn, { mode: target, at: ctx!.clock.now() })
    // the charger no longer follows a cancellation: another mode lifts it
    emitCharger({ ...charger, manualOverride: false })
    log().info({ mode: target }, 'Enphase charger mode set')
    followUp()
  }

  /** Read the charger `EV_FOLLOW_UP_MS` after a command: the current takes 20 s to 1 min to come. */
  function followUp(): void {
    void (async () => {
      await sleep(ctx!.clock, EV_FOLLOW_UP_MS, ctx!.signal)
      if (ctx!.signal.aborted) return
      try { await pollChargers() }
      catch (err) { log().debug({ err }, 'Enphase charger follow-up read failed') }
    })()
  }

  /**
   * Start or stop the charger. Tried on the real charger on 2026-10-01: in green charging, either
   * one sets a MANUAL CANCELLATION "until the next unplug" (the state's `mode` goes from 1 to 0, the
   * preference stays `GREEN_CHARGING`), then the charger resumes its mode by itself on unplug. A
   * `stop` therefore does NOT restore green charging: it cuts charging until the unplug, sun or not.
   *
   * The current is the app's: its "Charger maintenant" sends the summary's `defaultChargeLevel`
   * (24 A here). Without a current, the cloud took 32 A and the charger had delivered nothing in
   * 90 s. The state follows through a read `EV_FOLLOW_UP_MS` later: the current arrives in 20 s to
   * 1 min.
   */
  async function chargerCommand(sn: string, start: boolean): Promise<void> {
    if (!chargersOn() || !enlighten?.hasSession) throw new PluginError('NEEDS_PAIRING', 'no Enlighten session: pair with the Enphase account')
    const siteId = await ensureSiteId()
    if (!siteId) throw new PluginError('NEEDS_PAIRING', 'no Enlighten site')
    if (!chargers?.some((c) => c.sn === sn)) throw new PluginError('DEVICE_UNAVAILABLE', `unknown Enphase charger ${sn}`)
    const base = `/service/evse_controller/${siteId}/ev_chargers/${encodeURIComponent(sn)}`
    if (start) {
      const sum = chargerSummaries.find((s) => s.serialNumber === sn)
      const level = sum?.defaultChargeLevel ?? sum?.maxCurrent
      await enlighten.send('POST', `${base}/start_charging`, {
        ...(level !== undefined ? { chargingLevel: Math.round(level) } : {}), connectorId: 1,
      }, ctx!.signal)
    } else {
      await enlighten.send('PUT', `${base}/stop_charging`, undefined, ctx!.signal)
    }
    forced.add(sn)
    lastRestore.delete(sn)
    log().info({ start }, start ? 'Enphase charger forced to charge' : 'Enphase charger stopped')
    followUp()
  }

  return {
    id: 'enphase',
    configSchema: enphaseConfigSchema,
    parts: [{ id: 'ev_charger', labelKey: 'kinds.ev_charger', enabledByDefault: true }],

    async init(context) {
      ctx = context
      config = context.config as EnphaseConfig
      store = deps.store ?? (config.ENPHASE_TOKEN_FILE ? createTokenFile(config.ENPHASE_TOKEN_FILE, context.logger) : null)
      cloudStore = deps.cloudStore ?? (config.ENPHASE_CLOUD_FILE ? createCloudFile(config.ENPHASE_CLOUD_FILE, context.logger) : null)
      enlighten = new EnlightenClient({
        ...(deps.cloudFetch ? { fetchImpl: deps.cloudFetch } : {}),
        logger: context.logger,
      })
      const cloud = cloudStore ? await cloudStore.load() : null
      if (cloud) {
        enlighten.setSession(cloud)
        log().info({ siteId: cloud.siteId }, 'Enlighten session restored')
      }
      days = new EnergyDays({ siteGapMs: Math.max(2 * 60_000, 3 * config.ENPHASE_POLL_MS) })
      daysStore = deps.daysStore ?? (config.ENPHASE_DAYS_FILE ? createDaysFile(config.ENPHASE_DAYS_FILE, context.logger) : null)
      await daysStore?.load(days)
      invDays = new InverterDays()
      invStore = deps.inverterDaysStore ?? (config.ENPHASE_INVERTER_DAYS_FILE ? createInverterDaysFile(config.ENPHASE_INVERTER_DAYS_FILE, context.logger) : null)
      await invStore?.load(invDays)
      daysSavedAt = context.clock.now()
      const pinFile = deps.pinFile ?? createPinFile(stateFile('enphase-tls-pin.json'), context.logger)
      pin = new TlsPin(await pinFile.load(), (fp) => { void pinFile.save(fp) }, { device: 'IQ Gateway', logger: context.logger })
      client = new EnphaseClient({
        host: config.ENPHASE_HOST,
        pin,
        ...(deps.gatewayFetch ? { fetchImpl: deps.gatewayFetch } : {}),
        logger: context.logger,
      })

      // `/info` first: it needs no token and gives the serial number, so we know which gateway a
      // token must match before accepting it.
      await readGateway()

      const resolved = await resolveEnphaseToken({
        token: config.ENPHASE_TOKEN,
        ...(store ? { store } : {}),
        ...(gateway ? { serial: gateway.serial } : {}),
        now: context.clock.now(),
        logger: context.logger,
      })
      if (resolved) {
        token = resolved
        client.setToken(resolved.token)
        log().info({ source: resolved.source, daysLeft: resolved.daysLeft, role: resolved.claims.role }, 'Enphase token accepted')
        if (resolved.stage === 'expiring') {
          log().warn({ daysLeft: resolved.daysLeft }, 'Enphase token is about to expire: renew it from Settings')
        }
      } else {
        log().warn('no usable Enphase token: pair the gateway from Settings (POST /api/plugins/enphase/token)')
      }
    },

    /** Without a local token AND without a cloud session, nothing to publish. */
    async discover(): Promise<DeviceDescriptor[]> {
      const list: DeviceDescriptor[] = []
      if (client?.hasToken) {
        inventory = await readInventory()
        log().info({ inverters: inventory.inverters.length, batteries: inventory.batteries.length }, 'Enphase inventory read')
        list.push(...toDescriptors(inventory))
      }
      if (chargersOn() && enlighten?.hasSession) {
        try {
          await fetchChargers()
          if (chargers) list.push(...toChargerDescriptors(chargers, chargerSummaries))
        } catch (err) {
          log().warn({ err }, 'Enphase EV charger inventory unread')
        }
      }
      return list
    },

    async start() {
      pollers = []
      if (client?.hasToken) {
        pollers.push(
          createPoller({ name: 'enphase:meters', intervalMs: config!.ENPHASE_POLL_MS, fn: pollMeters, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger }),
          createPoller({ name: 'enphase:devices', intervalMs: config!.ENPHASE_SLOW_POLL_MS, fn: pollDevices, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger }),
        )
      }
      if (chargersOn() && enlighten?.hasSession) {
        pollers.push(createPoller({
          name: 'enphase:ev', intervalMs: config!.ENPHASE_SLOW_POLL_MS, fn: pollChargers,
          clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
        }))
      }
      autoSync()
    },

    async execute(externalId, command: Command) {
      if (command.type === 'ev_charger.start' || command.type === 'ev_charger.stop') {
        await chargerCommand(externalId, command.type === 'ev_charger.start')
        return
      }
      if (command.type === 'ev_charger.resume_mode') {
        await resumeMode(externalId)
        return
      }
      if (command.type === 'ev_charger.set_mode') {
        await setMode(externalId, command.mode)
        return
      }
      throw new PluginError('UNSUPPORTED_COMMAND', `Enphase devices are read-only (${command.type})`)
    },

    async stop() {
      for (const p of pollers) p.stop()
      pollers = []
      await saveDays(true)
      days = null
      invDays = null
      client = null
      token = null
      gateway = null
      inventory = null
      chargers = null
      chargerSummaries = []
      preferences.clear()
      enlighten = null
    },

    registerRoutes(app: FastifyInstance) {
      // Pairing state, for the Settings card. Never the token, only its expiry.
      app.get('/token', async () => status())

      /**
       * Pairing. Two bodies accepted:
       *  - `{ token }`: a token obtained by hand on entrez.enphaseenergy.com — opens the gateway,
       *    NOT the charger's cloud;
       *  - `{ user, password }`: account credentials. They first open an Enlighten session (kept,
       *    it is what reads the charger), then mint a local token if it is missing or expiring.
       *    The password is FORGOTTEN — never logged, written or sent back.
       */
      app.post('/token', async (req, reply) => {
        if (!client || !ctx) return sendError(reply, 409, 'NEEDS_PAIRING', 'plugin not started')
        const parsed = pairingSchema.safeParse(req.body)
        if (!parsed.success) {
          return sendError(reply, 400, 'INVALID_BODY', 'send either { token } or { user, password }')
        }
        // pairing again is what accepts a gateway whose certificate changed
        pin!.clear()
        // the gateway may have been unreachable at startup: we retry, its serial number is what
        // lets us refuse a token issued for another gateway
        if (!gateway) await readGateway()

        try {
          if ('token' in parsed.data) {
            await adopt(parsed.data.token)
          } else {
            const session = await openCloudSession({
              user: parsed.data.user, password: parsed.data.password,
              ...(deps.cloudFetch ? { fetchImpl: deps.cloudFetch } : {}),
              signal: ctx.signal, logger: ctx.logger,
            })
            enlighten?.setSession(session)
            await cloudStore?.save(session)
            autoSync()
            if (!gateway) {
              return sendError(reply, 502, 'UPSTREAM_ERROR', `cannot reach the gateway at ${config!.ENPHASE_HOST}: its serial number is needed to mint a token`)
            }
            // safeguard: a token still comfortably valid does not need replacing. Without this,
            // each account submission could create one more token at Enphase, all valid for a year
            // and all unused but the last. The cloud session, however, IS already saved: we answer
            // 200 (account linked, JWT intact). `force` remains the only way to replace it before
            // the 30-day warning.
            if (token && token.stage === 'ok' && !parsed.data.force) {
              log().info({ daysLeft: token.daysLeft, cloud: true }, 'Enphase Enlighten session linked, gateway token kept')
              return status()
            }
            const minted = await exchangeEnphaseToken({
              sessionId: session.sessionId, serial: gateway.serial, username: parsed.data.user,
              ...(deps.cloudFetch ? { fetchImpl: deps.cloudFetch } : {}),
              signal: ctx.signal,
            })
            await adopt(minted.token)
          }
        } catch (err) {
          const e = err as PluginError
          lastError = e.message
          const code = e.code ?? 'UPSTREAM_ERROR'
          return sendError(reply, code === 'NEEDS_PAIRING' ? 400 : 502, code, e.message)
        }
        log().info({ daysLeft: token?.daysLeft, role: token?.claims.role, cloud: !!enlighten?.hasSession }, 'Enphase gateway paired')
        return status()
      })

      /**
       * RAW reading of the local routes, to write the mapping fixtures from real responses (and
       * not from the documentation). Read-only; a failing route is returned with its error instead
       * of failing the whole reading.
       */
      app.get('/raw', async (_req, reply) => {
        if (!client?.hasToken) return sendError(reply, 409, 'NEEDS_PAIRING', 'pair the gateway first')
        const out: Record<string, unknown> = { info: gateway }
        for (const path of RAW_PATHS) {
          try { out[path] = await client.getJson(path, ctx!.signal) }
          catch (err) { out[path] = { error: (err as Error).message } }
        }
        return out
      })

      /**
       * RAW reading of the EVSE cloud, to write the charger fixtures from real responses.
       * Independent of the local token: pasting a gateway JWT is not enough, the account is needed.
       * A failing route is returned with its error instead of bringing down the whole reading.
       */
      /**
       * Synchronizes the daily history with Enphase's again (the "Resync" button): the days that
       * are not complete are taken from Enphase — every day with `{ force: true }` —, today stays
       * measured here.
       */
      app.post('/history/sync', async (req, reply) => {
        if (!days || !ctx) return sendError(reply, 409, 'NEEDS_PAIRING', 'plugin not started')
        // `force`: every day again ("Take everything again"); otherwise only the incomplete days
        const force = z.object({ force: z.boolean().default(false) }).catch({ force: false }).parse(req.body ?? {}).force
        try { await syncHistory(force) }
        catch (err) {
          const e = err as PluginError
          return sendError(reply, e.code === 'NEEDS_PAIRING' ? 409 : 502, e.code ?? 'UPSTREAM_ERROR', e.message)
        }
        return status()
      })

      app.get('/ev/raw', async (_req, reply) => {
        if (!enlighten?.hasSession) return sendError(reply, 409, 'NEEDS_PAIRING', 'pair with the Enphase account first (a pasted gateway token is not enough)')
        return probeEvRaw(enlighten, enlighten.current?.siteId, ctx?.signal)
      })
    },

    /** The site's daily totals, as kept: never a new reading. */
    async energyDays(externalId: string) {
      if (externalId !== SITE_ID || !days) throw new PluginError('NOT_IMPLEMENTED', `no energy history for "${externalId}"`)
      const now = ctx!.clock.now()
      const inverters = invDays?.snapshot(now)
      return { ...days.snapshot(now), ...(inverters ? { inverters } : {}) }
    },

    health(): PluginHealth {
      const keys = ['ENPHASE_HOST', 'ENPHASE_TOKEN', 'ENPHASE_TOKEN_FILE', 'ENPHASE_CLOUD_FILE', 'ENPHASE_DAYS_FILE', 'ENPHASE_INVERTER_DAYS_FILE']
      if (pin?.changed) {
        return { status: 'error', detail: 'Le certificat de la passerelle IQ Gateway a changé : connexion refusée. Appairer de nouveau accepte le nouveau certificat.', keys }
      }
      if (!token) {
        return { status: 'needs_pairing', detail: lastError ?? 'no Enphase token: pair the gateway from Settings', keys }
      }
      if (token.stage === 'expiring') {
        // `degraded` and not `ok`: it is what turns the Settings badge orange BEFORE the failure.
        // An installer token (12 h) is born in this state, and that is intended.
        return { status: 'degraded', detail: `Enphase token expires in ${token.daysLeft} day(s): renew it`, keys, deviceCount: (inventory ? toDescriptors(inventory).length : 0) + (chargers?.length ?? 0) }
      }
      const chargerCount = chargers?.length ?? 0
      const deviceCount = (inventory ? toDescriptors(inventory).length : 0) + chargerCount
      if (lastError) return { status: 'degraded', detail: lastError, keys, deviceCount }
      const parc = inventory ? ` · ${inventory.inverters.length} onduleurs, ${inventory.batteries.length} batteries` : ''
      const borne = chargerCount ? ` · ${chargerCount} borne` : ''
      return { status: 'ok', detail: `IQ Gateway ${gateway?.software ?? ''}${parc}${borne}`.trim(), keys, deviceCount }
    },
  }
}
