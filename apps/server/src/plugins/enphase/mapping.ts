import type { Capability, ChargeMode, DeviceDescriptor, SettableChargeMode, StatePatch } from '@kasbah/shared'
import {
  ENCHARGE, type EnsembleDevice, type EnsemblePower, type Inverter, type Livedata, type ProductionEntry, type ProductionReport,
} from './types'

// IQ Gateway → Kasbah contract. PURE functions, tested on captured responses.
//
// Three kinds of devices, decided by what the installation really contains:
//   - ONE `energy` site: production, consumption, grid, and the overall storage if there are
//     batteries. It is what the Energy view shows;
//   - ONE power `sensor` per microinverter, so one per solar panel: it is what house.json's panel
//     arrays link, and what colors each module in the 3D scene;
//   - ONE `energy` per IQ battery, with the `storage` capability only: the UI already gives them
//     the battery icon (`strokeIcons.ts`), and each one is placed in a room.
//
// The IQ EV Charger 2 talks to the cloud, not the gateway: `chargersOf` / `toChargerPatch` are here
// because the contract is the same file, but their fixtures come from `__fixtures__/evse.ts`
// (Enlighten capture), not from `gateway.ts`.

export const PLUGIN_ID = 'enphase'
/** Site id: one per gateway, a stable name so that house.json can link it. */
export const SITE_ID = 'site'

const id = (externalId: string) => `${PLUGIN_ID}:${externalId}`
/**
 * A full serial number is unreadable in a list: we keep the end, which is enough to tell them apart.
 * FIVE characters, the same length as shown in the cells of a panel array
 * (`apps/web/src/components/home/PanelArraysCard.vue`) — a list and a grid that do not cut at the
 * same place cannot be matched by eye.
 */
const SHORT_SERIAL = 5
const shortSerial = (serial: string) => serial.slice(-SHORT_SERIAL)

function descriptor(externalId: string, kind: DeviceDescriptor['kind'], name: string, capabilities: Capability[], meta: DeviceDescriptor['meta'] = {}): DeviceDescriptor {
  return { id: id(externalId), pluginId: PLUGIN_ID, externalId, kind, name, capabilities, meta }
}

/** Measurement entry of a family, by `type` then by `measurementType`. */
function pick(entries: ProductionEntry[], type: string, measurementType?: string): ProductionEntry | undefined {
  return entries.find((e) => e.type === type && (measurementType === undefined || e.measurementType === measurementType))
}

/**
 * Produced power: the CT (`eim`) when present, because it measures in REAL TIME. The inverters' sum
 * (`inverters`) lags by several minutes — 4952 W versus 6456 W on the capture — and so is only a
 * fallback, for a gateway without a meter.
 *
 * CLAMPED TO ZERO when it goes below zero: at night, the production clamp reads a few watts
 * backwards (−7 W observed on the real gateway), the inverters' standby current flowing back up the
 * string. The contract counts production as positive; "−7 W · Production" makes no sense, and that
 * standby is already counted in consumption.
 */
export function productionW(report: ProductionReport): number {
  const entry = pick(report.production, 'eim', 'production') ?? pick(report.production, 'inverters')
  return Math.max(0, Math.round(entry?.wNow ?? 0))
}

/** IQ batteries of the inventory (families other than `ENCHARGE` ignored: Enpower, relays…). */
export function batteriesOf(inventory: { type: string; devices: EnsembleDevice[] }[]): EnsembleDevice[] {
  return inventory.filter((g) => g.type === ENCHARGE).flatMap((g) => g.devices)
}

/** A battery's power in watts, CONTRACT SIGN (positive = charging). */
function batteryW(realPowerMw: number): number {
  // the vendor counts POSITIVE when discharging: the balance `load = pv + storage + grid` only closes
  // with that convention, verified to the milliwatt on the real gateway and on its technical note's
  // example. The Kasbah contract, however, wants positive = charging.
  // `|| 0`: without it a zero power becomes `-0`, which crosses JSON as `0` but does not compare the
  // same way depending on the tool. A battery at rest is 0, not less than nothing.
  return Math.round(-realPowerMw / 1000) || 0
}

export interface Inventory {
  report: ProductionReport
  inverters: Inverter[]
  batteries: EnsembleDevice[]
}

/** The descriptors the plugin publishes, based on what the installation contains. */
export function toDescriptors(inv: Inventory): DeviceDescriptor[] {
  const hasStorage = inv.batteries.length > 0
  const site = descriptor(
    SITE_ID, 'energy', 'Installation solaire',
    ['production', 'consumption', 'grid', ...(hasStorage ? (['storage'] as const) : [])],
    { manufacturer: 'Enphase', model: 'IQ Gateway' },
  )
  const panels = inv.inverters.map((i) => descriptor(
    i.serialNumber, 'sensor', `Onduleur ${shortSerial(i.serialNumber)}`, ['measure'],
    { manufacturer: 'Enphase', sensor: { unit: 'W', deviceClass: 'power', precision: 0 } },
  ))
  const batteries = inv.batteries.map((b) => descriptor(
    b.serial_num, 'energy', `Batterie ${shortSerial(b.serial_num)}`, ['storage'],
    { manufacturer: 'Enphase', ...(b.part_num ? { model: b.part_num } : {}) },
  ))
  return [site, ...panels, ...batteries]
}

/** Milliwatts → watts. `livedata` counts in mW, `production.json` in W. */
const mw = (v: number) => Math.round(v / 1000) || 0

/**
 * Site snapshot: production, consumption, grid, battery.
 *
 * The source is `livedata`, and it is a PERFORMANCE decision measured on the real gateway: it
 * answers in 0.2 s, where `production.json` took up to 10.8 s for the same meters. The latter is
 * the fallback, for a gateway that would not serve `livedata`.
 *
 * Signs: `grid` is already the contract's, negative when exporting; `storage` is the OPPOSITE, the
 * vendor counting it positive when discharging.
 */
export function toSitePatch(live: Livedata | undefined, report?: ProductionReport): StatePatch {
  const m = live?.meters
  const total = report && pick(report.consumption, 'eim', 'total-consumption')
  const net = report && pick(report.consumption, 'eim', 'net-consumption')
  // `Math.max(0, …)` for the same reason as in `productionW`: the clamp goes below zero at night
  const production = m?.pv ? Math.max(0, mw(m.pv.agg_p_mw)) : report ? productionW(report) : undefined
  const consumption = m?.load ? mw(m.load.agg_p_mw) : total ? Math.round(total.wNow) : undefined
  const grid = m?.grid ? mw(m.grid.agg_p_mw) : net ? Math.round(net.wNow) : undefined
  return {
    kind: 'energy',
    ...(production !== undefined ? { productionW: production } : {}),
    ...(consumption !== undefined ? { consumptionW: consumption } : {}),
    ...(grid !== undefined ? { gridW: grid } : {}),
    ...(m?.storage ? { batteryW: batteryW(m.storage.agg_p_mw) } : {}),
    ...(m?.enc_agg_soc !== undefined ? { batterySoc: Math.round(m.enc_agg_soc) } : {}),
  } as StatePatch
}

/**
 * The day's totals: only `production.json` carries them, and it is slow — hence reading it at the
 * slow rate. `net-consumption` publishes a `whToday` of zero: it is the TOTAL consumption that must
 * be read, or else a day with no consumption would be shown.
 */
export function toDailyPatch(report: ProductionReport): StatePatch {
  const eim = pick(report.production, 'eim', 'production')
  const total = pick(report.consumption, 'eim', 'total-consumption')
  return {
    kind: 'energy',
    ...(eim?.whToday !== undefined ? { todayProductionWh: Math.round(eim.whToday) } : {}),
    ...(total?.whToday !== undefined ? { todayConsumptionWh: Math.round(total.whToday) } : {}),
  } as StatePatch
}

/**
 * Beyond this, an inverter is considered silent. They report every ~5 min; at night they go quiet,
 * so half an hour without a report means nightfall or a real failure.
 */
export const PANEL_STALE_MS = 30 * 60_000

/**
 * A solar panel's state: the power of its last report, as is, and the record the gateway keeps for
 * it (`maxReportWatts`). That record is NOT the inverter's maximum output power: observed on a real
 * installation, it ranges from 418 to 440 W from one inverter to another, with no plateau — it is
 * the best moment of the year, not the datasheet.
 */
export function toPanelPatch(inverter: Inverter): StatePatch {
  const patch = { kind: 'sensor', value: Math.round(inverter.lastReportWatts) } as StatePatch & { maxValue?: number }
  // `maxReportWatts` is optional in the response: without it, no invented record
  if (inverter.maxReportWatts !== undefined) patch.maxValue = Math.round(inverter.maxReportWatts)
  return patch
}

/**
 * True if the inverter has not reported for `PANEL_STALE_MS`. It then becomes UNAVAILABLE and keeps
 * its last value, grayed out: inventing a zero would claim a measurement we do not have.
 */
export function isPanelStale(inverter: Inverter, now: number, staleAfterMs = PANEL_STALE_MS): boolean {
  return now - inverter.lastReportDate * 1000 > staleAfterMs
}

/**
 * A battery's state: its charge and its power. The inventory's `percentFull` and
 * `/ivp/ensemble/power`'s `soc` say the same thing; we take the inventory, which also carries the
 * temperature. The other three fields of the `energy` state are zero: a battery neither produces
 * nor draws.
 */
export function toBatteryPatch(battery: EnsembleDevice, power: EnsemblePower | undefined): StatePatch {
  const entry = power?.['devices:']?.find((d) => d.serial_num === battery.serial_num)
  const soc = battery.percentFull ?? entry?.soc
  return {
    kind: 'energy',
    productionW: 0,
    consumptionW: 0,
    gridW: 0,
    ...(entry ? { batteryW: batteryW(entry.real_power_mw) } : {}),
    ...(soc !== undefined ? { batterySoc: Math.round(soc) } : {}),
  } as StatePatch
}

/** A battery that no longer communicates keeps its last values, grayed out in the UI. */
export function isBatteryAvailable(battery: EnsembleDevice): boolean {
  return battery.communicating !== false
}

/** A charger row, taken from `/ev_chargers/status` (v1). Missing fields = unknown, not zeros. */
export interface EvCharger {
  sn: string
  name?: string
  connected: boolean
  charging: boolean
  pluggedIn: boolean
  faulted: boolean
  sessionWh: number
  chargeLevel?: number
  /** `connectors[0].safeLimitState`: 1 = fallen back to the safety current (the app's "safe mode"). */
  safeLimit?: boolean
  /**
   * `mode` at 0: the charger obeys a manual cancellation (a start / stop), not the app's preference,
   * which does not change. 1 in green charging (captures of 09/20 and 10/02).
   */
  manualOverride?: boolean
}

export interface EvChargerSummary {
  serialNumber: string
  displayName?: string
  modelName?: string
  maxCurrent?: number
  defaultChargeLevel?: number
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/**
 * A site's chargers, from the v1 body. `error: {}` appears even on success (capture of 09/20): it is
 * not a failure. An unknown envelope returns an empty list, never an exception.
 */
export function chargersOf(json: unknown): EvCharger[] {
  if (!json || typeof json !== 'object') return []
  const data = (json as { data?: { chargers?: unknown } }).data
  if (!data || !Array.isArray(data.chargers)) return []
  const out: EvCharger[] = []
  for (const raw of data.chargers) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const sn = typeof o.sn === 'string' && o.sn.trim() ? o.sn : undefined
    if (!sn) continue
    const session = o.session_d && typeof o.session_d === 'object' ? o.session_d as Record<string, unknown> : undefined
    const chargeLevel = num(session?.charge_level)
    const connector = Array.isArray(o.connectors) && o.connectors[0] && typeof o.connectors[0] === 'object'
      ? o.connectors[0] as Record<string, unknown> : undefined
    const safeLimitState = num(connector?.safeLimitState)
    const mode = num(o.mode)
    out.push({
      sn,
      ...(typeof o.name === 'string' && o.name.trim() ? { name: o.name.trim() } : {}),
      connected: o.connected === true,
      charging: o.charging === true,
      pluggedIn: o.pluggedIn === true,
      faulted: o.faulted === true,
      sessionWh: Math.round(num(session?.e_c) ?? 0),
      ...(chargeLevel !== undefined ? { chargeLevel } : {}),
      ...(safeLimitState !== undefined ? { safeLimit: safeLimitState === 1 } : {}),
      ...(mode !== undefined ? { manualOverride: mode === 0 } : {}),
    })
  }
  return out
}

/** The app's mode, in the contract's vocabulary (`chargeMode`). */
const CHARGE_MODE_OF: Record<string, ChargeMode> = {
  GREEN_CHARGING: 'green', MANUAL_CHARGING: 'manual', SCHEDULED_CHARGING: 'scheduled', SMART_CHARGING: 'smart',
}
/** And back, for the modes we can choose (`ev_charger.set_mode`). */
export const ENPHASE_CHARGE_MODE: Record<SettableChargeMode, string> = { green: 'GREEN_CHARGING', manual: 'MANUAL_CHARGING' }

/**
 * The mode chosen in the app, from `…/charging-mode/{site}/{sn}/preference`: the one among `modes`
 * marked `enabled` (`GREEN_CHARGING`, `SCHEDULED_CHARGING`, `MANUAL_CHARGING`, `SMART_CHARGING`).
 * Forcing does not touch it: it is the mode from before the forcing.
 */
export function enabledChargingMode(json: unknown): string | undefined {
  const modes = (json as { data?: { modes?: unknown } } | null)?.data?.modes
  if (!modes || typeof modes !== 'object') return undefined
  for (const m of Object.values(modes as Record<string, unknown>)) {
    const o = m as { chargingMode?: unknown; enabled?: unknown } | null
    if (o?.enabled === true && typeof o.chargingMode === 'string') return o.chargingMode
  }
  return undefined
}

export function chargerSummariesOf(json: unknown): EvChargerSummary[] {
  if (!json || typeof json !== 'object') return []
  const data = (json as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const out: EvChargerSummary[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const serialNumber = typeof o.serialNumber === 'string' && o.serialNumber.trim() ? o.serialNumber : undefined
    if (!serialNumber) continue
    const details = o.chargeLevelDetails && typeof o.chargeLevelDetails === 'object'
      ? o.chargeLevelDetails as Record<string, unknown> : undefined
    const maxCurrent = num(o.maxCurrent)
    const defaultChargeLevel = num(details?.defaultChargeLevel)
    out.push({
      serialNumber,
      ...(typeof o.displayName === 'string' ? { displayName: o.displayName } : {}),
      ...(typeof o.modelName === 'string' ? { modelName: o.modelName } : {}),
      ...(maxCurrent !== undefined ? { maxCurrent } : {}),
      ...(defaultChargeLevel !== undefined ? { defaultChargeLevel } : {}),
    })
  }
  return out
}

export function toChargerDescriptors(chargers: EvCharger[], summaries: EvChargerSummary[] = []): DeviceDescriptor[] {
  return chargers.map((c) => {
    const sum = summaries.find((s) => s.serialNumber === c.sn)
    return descriptor(
      c.sn, 'ev_charger', c.name || `Borne ${shortSerial(c.sn)}`,
      // start / stop, tried on the real charger on 2026-10-01; the current cannot be set yet
      // (`charge_current`): Start takes the app's default one. The mode (green, manual) is chosen as
      // in the app: both PUTs tried on the real charger on 2026-10-02
      ['charge_control', 'charge_mode'],
      // stopping sets a manual cancellation "until the next unplug": no more green charging
      { manufacturer: 'Enphase', ...(sum?.modelName ? { model: sum.modelName } : {}), evCharger: { stopUntilUnplug: true } },
    )
  })
}

/**
 * A charger's state. Capture of 09/20: plugged in, not charging, `SUSPENDED_EVSE` /
 * `INSUFFICIENT_SOLAR` (green charging paused for lack of sun). That stays `connected`, not a
 * failure. No watts in this frame: `powerW` is 0 when not charging, and 0 too WHILE charging until
 * a capture taken during a charge has shown the field — we do not invent 7 kW.
 *
 * `preference`: the app's mode (`enabledChargingMode`), read separately. In MANUAL mode, `mode` 0 is
 * not a cancellation to lift: there is no other mode to give back (`resumeMode` does nothing there).
 */
export function toChargerPatch(charger: EvCharger, summary?: EvChargerSummary, preference?: string): StatePatch {
  const status = charger.faulted ? 'error'
    : charger.charging ? 'charging'
    : charger.pluggedIn ? 'connected'
    : 'disconnected'
  const maxCurrentA = charger.chargeLevel ?? summary?.defaultChargeLevel ?? summary?.maxCurrent
  return {
    kind: 'ev_charger',
    status,
    powerW: 0,
    sessionWh: charger.sessionWh,
    ...(maxCurrentA !== undefined ? { maxCurrentA: Math.round(maxCurrentA) } : {}),
    ...(charger.safeLimit !== undefined ? { safeLimit: charger.safeLimit } : {}),
    ...(charger.manualOverride !== undefined
      ? { manualOverride: charger.manualOverride && preference !== 'MANUAL_CHARGING' } : {}),
    ...(preference && CHARGE_MODE_OF[preference] ? { chargeMode: CHARGE_MODE_OF[preference] } : {}),
  } as StatePatch
}
