import { makeDeviceId, type Capability, type CommandOf, type DeviceDescriptor, type StatePatch } from '@kasbah/shared'
import { personAccountSchema, vehicleContractSchema, vehicleLinkSchema, vehiclesSchema, type PersonAccount, type VehicleLink } from './types'

// PURE mapping: Renault resources ↔ Kasbah contract. No network access, no state.
//
// Two halves: from the ACCOUNT to the DESCRIPTOR, and from the READINGS to the STATE. The second is
// written from the capture of 2026-09-14 (`__fixtures__/kamereon.ts`), not from the documentation —
// which would have been wrong on at least three points (`cockpit` version, meaning of the
// temperature, nature of `chargingStatus`).

/**
 * What the R5 reports, and what it lets you change: its charge TARGET (`ev/soc-levels`), the
 * climate, and STARTING the charge (`chargeStartPayload`). Locking, pressure: the car answers 404;
 * charge pause/resume: 403. STOPPING the charge is also declared by `charging`, but it's the
 * charger that carries it out (`meta.vehicle.stopViaCharger`, see `toDescriptor`).
 */
export const CAPABILITIES: readonly Capability[] = ['soc', 'range', 'location', 'charge_limit', 'charging', 'climate_precondition']

/**
 * The R5's climate control, as its app shows it (user's screenshots, 2026-10-01): "air-condition"
 * now, 10 min at most; a ± setpoint and three options — driver seat, steering wheel, passenger
 * seat — "shared by all programs". These are PRECONDITIONING settings (`ev/settings`:
 * `preconditioningTemperature`, `preconditioningHeated*`), on / off, set while the climate is off.
 * 16-26 °C bounds in 1-degree steps: ASSUMPTION, the app doesn't show them, to be corrected at the
 * first refusal.
 */
export const CLIMATE_FEATURES = {
  minC: 16, maxC: 26, stepC: 1, seats: ['fl', 'fr'] as ('fl' | 'fr')[], seatLevels: 1, steeringWheelHeat: true, heatWhileOff: true,
}

/**
 * The person's readable Kamereon accounts. A household often has several (`MYRENAULT`, `MYDACIA`,
 * sometimes a closed account): validated one by one, an odd account doesn't push the others aside.
 */
export function toAccounts(body: unknown): PersonAccount[] {
  const parsed = personAccountsOf(body)
  return parsed.filter((a) => a.accountStatus === undefined || a.accountStatus.toUpperCase() === 'ACTIVE')
}

function personAccountsOf(body: unknown): PersonAccount[] {
  const outer = (body as { accounts?: unknown })?.accounts
  if (!Array.isArray(outer)) return []
  const out: PersonAccount[] = []
  for (const raw of outer) {
    const parsed = personAccountSchema.safeParse(raw)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/** An account's vehicles, validated one by one: an unreadable vehicle doesn't hide the others. */
export function toVehicleLinks(body: unknown): VehicleLink[] {
  const parsed = vehiclesSchema.safeParse(body)
  if (!parsed.success) return []
  const out: VehicleLink[] = []
  for (const raw of parsed.data.vehicleLinks) {
    const link = vehicleLinkSchema.safeParse(raw)
    if (link.success) out.push(link.data)
  }
  return out
}

/** A maintenance contract capped in km: what, at Renault, looks most like a lease-purchase (LOA). */
export interface MileageContract {
  description: string
  /** `YYYY-MM-DD`, or `null` when Renault doesn't give it. */
  start: string | null
  end: string | null
  maxKm: number
}

/**
 * The MAINTENANCE contracts capped in kilometers, active or not. Warranties are left out even when
 * capped (the battery carries a cap that has nothing of a lease allowance), and an unreadable
 * contract doesn't hide the others. It's only a suggestion: Renault exposes NO financing contract —
 * an Easypack is sold aligned with the lease-purchase, but nothing guarantees it.
 */
export function toMileageContracts(body: unknown): MileageContract[] {
  if (!Array.isArray(body)) return []
  const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
  const out: MileageContract[] = []
  for (const raw of body) {
    const c = vehicleContractSchema.safeParse(raw)
    if (!c.success || c.data.type !== 'WARRANTY_MAINTENANCE_CONTRACTS') continue
    const cap = c.data.conditions?.find((k) => k.unlimitedMileage === false && (k.maximumMileage ?? 0) > 0)
    if (!cap || (cap.mileageUnit && cap.mileageUnit.toLowerCase() !== 'km')) continue
    out.push({ description: c.data.description?.trim() ?? '', start: day(c.data.startDate), end: day(c.data.endDate), maxKm: cap.maximumMileage! })
  }
  return out
}

/**
 * One vehicle = one `vehicle` device identified by its VIN — stable, no `:` or space, hence a valid
 * `externalId`. The name follows what the account knows about it, from the most telling to the
 * rawest: the plate, then the model, then the VIN.
 */
export function toDescriptor(link: VehicleLink, capabilities: readonly Capability[] = CAPABILITIES): DeviceDescriptor {
  const color = bodyColor(link)
  return {
    id: makeDeviceId('renault', link.vin),
    pluginId: 'renault',
    externalId: link.vin,
    kind: 'vehicle',
    name: vehicleName(link),
    capabilities: [...capabilities],
    // the vendor, spelled the way it's spelled: otherwise the UI shows the plugin id ("renault"), and
    // the carmaker SHOUTS its labels (`brand.label` = "RENAULT")
    // the R5 doesn't stop its charge remotely ("use charger to stop", renault-api): the server stops
    // the charger in its place
    meta: { manufacturer: 'Renault', vehicle: { ...(color ? { color } : {}), climate: CLIMATE_FEATURES, stopViaCharger: true } },
  }
}

/**
 * The vehicle's actual paint color, derived from its factory configuration.
 *
 * Renault publishes the color's name NOWHERE: not in `vehicleDetails`, not in `/details` — which
 * nonetheless labels the battery, the radio or the gearbox in plain text. What we have is the
 * configuration reference passed to its image rendering engine (`3dv.renault.com/ImageFromBookmark`,
 * `configuration` parameter), a sequence of codes in which `TE<paint>` carries the body paint
 * (recorded on 2026-09-15: `TEGNE`, doubled by `TPGNE` for the bumpers and `TSGNE` for the
 * mirrors — same code, so indeed the paint color).
 *
 * The table contains ONLY codes verified on a real car. An unknown code returns nothing: the scene
 * falls back on its theme color and the user decides by hand, which is better than displaying an
 * invented color.
 */
const PAINT: Record<string, string> = {
  // Noir Étoilé, verified on Renault's render of the R5 E-Tech of 2026-09-15.
  GNE: '#14171a',
}

export function bodyColor(link: VehicleLink): string | undefined {
  const url = link.vehicleDetails?.assets?.find((a) => a?.assetType === 'PICTURE')?.renditions?.find((r) => r?.url)?.url
  if (!url) return undefined
  const raw = /[?&]configuration=([^&]+)/.exec(url)?.[1]
  if (!raw) return undefined
  // The codes are separated by `/`, encoded as `%2F` in the URL — we decode before splitting.
  const code = decodeURIComponent(raw).split('/').find((c) => /^TE[A-Z0-9]{2,4}$/i.test(c))?.slice(2)
  return code ? PAINT[code.toUpperCase()] : undefined
}

/** "ZE-123-AB", otherwise "Renault 5 E-Tech", otherwise the VIN. Never empty: the contract requires it. */
export function vehicleName(link: VehicleLink): string {
  const d = link.vehicleDetails
  const plate = d?.registrationNumber?.trim()
  if (plate) return plate
  const model = [d?.brand?.label, d?.model?.label].map((s) => s?.trim()).filter(Boolean).join(' ')
  return model || link.vin
}

// ---- Charge wake-up ----------------------------------------------------------------------------

/**
 * The wake-up payload: the settings AS THEY ARE, with a new timestamp. Nothing else changes — it's
 * the write that wakes the car, not its content. Replaying hard-coded values (what other tools do)
 * would overwrite the start time, duration and temperature the user chose in their car.
 *
 * `null` if the settings read are not an object: better to send nothing than anything.
 */
export function wakePayload(settings: unknown, now: number): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return { ...(settings as Record<string, unknown>), lastSettingsUpdateTimestamp: new Date(now).toISOString() }
}

/**
 * What Renault returns to a settings write is NOT a save: it's a COMMAND filed for the car —
 * `{ commandId, type: 'HVAC_CHARGE_SYNCH', status: 'CREATED' }` — that its telematics unit will
 * apply at its next connection, or never if it's asleep. We used to throw it away; yet it's the
 * only thing that tells what became of a wake-up. Returned as one readable line, never thrown.
 */
export function commandSummary(res: unknown): string | null {
  if (!res || typeof res !== 'object') return null
  const r = res as Record<string, unknown>
  const parts = [r.type, r.status, r.commandId].filter((v) => typeof v === 'string' && v !== '')
  return parts.length ? parts.join(' ') : null
}

/**
 * The EV levels with a new charge TARGET. Same rule as `wakePayload`: we replay what the car just
 * gave — the `socMin` floor is ITS setting, not ours — and change only the target, timestamp
 * refreshed as the vendor's app does.
 */
export function socTargetPayload(levels: unknown, percent: number, now: number): Record<string, unknown> | null {
  if (!levels || typeof levels !== 'object' || Array.isArray(levels)) return null
  return {
    ...(levels as Record<string, unknown>),
    socTarget: percent,
    lastEnergyUpdateTimestamp: new Date(now).toISOString(),
  }
}

/**
 * Start charging NOW. What the MY Renault app does, as recorded by renault-api for the R5
 * (`actions/charge-start-via-settings`, issue no. 1348): rewrite the EV settings with all charge
 * programs DISABLED — it's the scheduled charge that makes the car wait. Same rule as
 * `wakePayload` for the rest: replayed as is. The disabled programs are NOT restored (the user's
 * choice of 2026-10-01: turning them back on would cut the ongoing charge); `deactivated` says how
 * many were on, for the log.
 *
 * Not yet tried on the real car. `chargeModeRq` (`SCHEDULED` at capture) is not touched:
 * renault-api doesn't touch it, and its other values are unknown.
 */
export function chargeStartPayload(settings: unknown, now: number): { body: Record<string, unknown>; deactivated: number } | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const s = settings as Record<string, unknown>
  let deactivated = 0
  const programs = Array.isArray(s.programs)
    ? s.programs.map((p: unknown) => {
      if (!p || typeof p !== 'object') return p
      const program = p as Record<string, unknown>
      if (program.programActivationStatus === true) deactivated++
      return { ...program, programActivationStatus: false }
    })
    : undefined
  return {
    body: { ...s, ...(programs ? { programs } : {}), lastSettingsUpdateTimestamp: new Date(now).toISOString() },
    deactivated,
  }
}

/** The body of `actions/hvac-start`: start at a setpoint, or cancel. */
export function hvacStartPayload(action: 'start' | 'cancel', targetTemperature?: number): Record<string, unknown> {
  return { data: { type: 'HvacStart', attributes: { action, ...(action === 'start' && targetTemperature !== undefined ? { targetTemperature } : {}) } } }
}

/** The battery threshold below which the R5 refuses to precondition (`hvac-status.socThreshold`, 15 % at capture). */
export function hvacSocThreshold(hvac: unknown): number | undefined {
  return num(attributes(hvac)?.socThreshold)
}

/**
 * The EV settings with the requested setpoint, seats and steering wheel. Same rule as `wakePayload`:
 * we replay what the car just gave (start time, programs: ITS settings) and change only the
 * preconditioning fields the command names.
 */
export function climateSettingsPayload(settings: unknown, cmd: CommandOf<'vehicle.climate_set'>, now: number): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return {
    ...(settings as Record<string, unknown>),
    ...(cmd.targetTempC !== undefined ? { preconditioningTemperature: cmd.targetTempC } : {}),
    ...(cmd.seatHeat?.fl !== undefined ? { preconditioningHeatedLeftSeat: cmd.seatHeat.fl > 0 } : {}),
    ...(cmd.seatHeat?.fr !== undefined ? { preconditioningHeatedRightSeat: cmd.seatHeat.fr > 0 } : {}),
    ...(cmd.steeringWheelHeat !== undefined ? { preconditioningHeatedStrgWheel: cmd.steeringWheelHeat } : {}),
    lastSettingsUpdateTimestamp: new Date(now).toISOString(),
  }
}

/**
 * Does the local time fall within the `HH:MM`–`HH:MM` window? The wake-up only makes sense during
 * the day: at night, a plugged-in car that isn't charging is often waiting for ITS scheduled charge,
 * and shaking it would mean fighting the user's setting.
 *
 * A window that crosses midnight (`22:00`–`06:00`) is accepted: it then spans the two days.
 * Equal bounds = empty window (never), which is the way to turn the feature off through configuration.
 */
export function inWindow(date: Date, from: string, to: string): boolean {
  const min = (hhmm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
    if (!m) return null
    const h = Number(m[1]), mm = Number(m[2])
    return h < 24 && mm < 60 ? h * 60 + mm : null
  }
  const a = min(from), b = min(to)
  if (a === null || b === null || a === b) return false
  const t = date.getHours() * 60 + date.getMinutes()
  return a < b ? t >= a && t < b : t >= a || t < b
}

// ---- From readings to state --------------------------------------------------------------------

/**
 * `chargingStatus` is an ENUMERATED FLOAT, not a boolean. The values that concern us: `0.0` not
 * charging, `0.1` waiting for a scheduled charge, `0.2` charge finished, `0.3` waiting for the
 * current charge, `1.0` charge in progress. Only `1.0` is "charging".
 *
 * `0.3` with a cable plugged in is the state the R5 gets stuck in when the charger cuts its current
 * (solar-surplus charging): it doesn't start again on its own. It's this state that a future wake-up
 * mode will have to recognize.
 *
 * **And `chargingStatus` LIES (2026-09-19).** Car charging, 5.5 kW measured at the charger and by
 * the inverter, it served a `0.3` for hours in frames that were otherwise FRESH and accurate: same
 * frame, `batteryLevel` climbing (63 → 71 → 73) and 52 minutes of remaining charge dated from the
 * instant. The MY Renault app showed the same error — it's the field that is wrong, not the link.
 * Hence `isCharging()` below, which no longer takes it at its word.
 */
export const CHARGE_IN_PROGRESS = 1
/** `plugStatus`: `1` plugged in, `0` unplugged, `-1` error, `-2147483648` unknown. */
export const PLUGGED = 1

/**
 * "Is this car charging?" — two witnesses are better than one liar.
 *
 * `chargingStatus === 1.0` remains the plain yes. Failing that, we believe the **remaining charge
 * time dated from the frame itself**: the capture of 2026-09-14 established that this field LINGERS
 * outside charging (returned dated from two days before on a stationary car) and is only refreshed
 * during a charge. A remaining time stamped with the frame's time is therefore a charge in
 * progress, whatever `chargingStatus` says.
 *
 * What this rule did NOT cover eventually happened (2026-10-02): a car really waiting for current
 * (green charging with no sun, 0 W at the charger) while still refreshing its estimate. So the
 * second witness no longer counts on its own: the LEVEL must also RISE (`levelRising`, tracked
 * frame after frame by the plugin), which the liar of 09/19 did (63 → 71 → 73) and the wait of
 * 10/02 did not (51 % at 11:44, 52 % at 14:00).
 */
export function isCharging(battery: Record<string, unknown>, levelRising = false): boolean | undefined {
  const status = num(battery.chargingStatus)
  if (status === CHARGE_IN_PROGRESS) return true
  const eta = num(battery.chargingRemainingTime)
  const fresh = eta !== undefined && eta > 0
    && at(battery.chargingRemainingTimeLastUpdateDateTime) === at(battery.timestamp)
  if (fresh && levelRising) return true
  // neither: we can only say "no" if the car has reported its state
  return status === undefined ? undefined : false
}

/**
 * A level rise only counts if it happens within less than an hour between two frames, and it holds
 * for one more hour: at 5.5 kW (three-phase charger), 1 % goes by in ~6 min; at 8 A in safe mode,
 * in ~20 min. The 51 → 52 % of 2026-10-02 stretched over 2 h 16 with no current: not a charge.
 */
export const LEVEL_RISE_WINDOW_MS = 60 * 60_000

/** What to remember from one frame to the next to tell whether the level is rising. */
export interface LevelTrack {
  /** The frame's timestamp (`timestamp` of `battery-status`), not our call's. */
  at: number
  soc: number
  /** Frame where a rise was last seen. */
  lastRiseAt?: number
}

/** Track the level frame after frame. The same frame re-read (car asleep) changes nothing. */
export function trackLevel(prev: LevelTrack | undefined, at: number, soc: number): LevelTrack {
  if (!prev || at <= prev.at) return prev && at === prev.at ? prev : { at, soc }
  const rose = soc > prev.soc && at - prev.at <= LEVEL_RISE_WINDOW_MS
  const lastRiseAt = rose ? at : prev.lastRiseAt
  return { at, soc, ...(lastRiseAt !== undefined ? { lastRiseAt } : {}) }
}

export function levelRising(track: LevelTrack | undefined): boolean {
  return track?.lastRiseAt !== undefined && track.at - track.lastRiseAt <= LEVEL_RISE_WINDOW_MS
}

/** Level and timestamp of the `battery-status` frame, for `trackLevel`. */
export function batteryFrame(battery: unknown): { at: number; soc: number } | undefined {
  const a = attributes(battery)
  const when = at(a?.timestamp)
  const soc = num(a?.batteryLevel)
  return when !== undefined && soc !== undefined ? { at: when, soc } : undefined
}

/** A round's readings, each optional: the R5 refuses several, and one may fail. */
export interface VehicleReadings {
  battery?: unknown
  cockpit?: unknown
  location?: unknown
  hvac?: unknown
  socLevels?: unknown
  /** `ev/settings` (kcm): the preconditioning settings — setpoint, seats, steering wheel. */
  settings?: unknown
}

/**
 * The `attributes` of a `kca` response, or `undefined`. Handles the case where Renault returns an
 * HTTP 200 WITHOUT `data` — what `cockpit` does in v2, with a witticism instead of the data.
 */
function attributes(body: unknown): Record<string, unknown> | undefined {
  const data = (body as { data?: unknown } | null | undefined)?.data
  const attrs = (data as { attributes?: unknown } | null | undefined)?.attributes
  return attrs && typeof attrs === 'object' ? attrs as Record<string, unknown> : undefined
}

/** A finite number, or `undefined`: `null`, string or absent must never become a zero. */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** An ISO date as epoch ms, or `undefined`. */
function at(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * A vehicle's state from the round's readings. Any field missing from the response is missing from
 * the patch — NEVER a zero: on this contract, `soc: 0` would read as "battery empty" and
 * `rangeKm: 0` as "no range left". `readAt` dates the VALUES and not our call (see below).
 *
 * What the R5 does NOT give, and which therefore stays absent: locking, heading, tire pressure,
 * speed and gear, outside temperature, and the charging POWER (rechecked with the car charging,
 * see `BATTERY_CHARGING`) — the UI estimates it at display time, from the capacity entered in the
 * house; nothing estimated goes into the state.
 */
export function toStatePatch(r: VehicleReadings, now: number, opts: { levelRising?: boolean } = {}): StatePatch<'vehicle'> {
  const patch: StatePatch<'vehicle'> = { readAt: now }

  const battery = attributes(r.battery)
  if (battery) {
    // Kamereon doesn't go and fetch the car: it returns the LAST state the car reported, and its
    // telematics unit goes silent as soon as it sleeps. Dating the state from our call would thus
    // be lying — on 2026-09-19 it served figures from 11:42 for six hours while the UI announced
    // "read 4 min ago". Unlike Tesla, the R5 has no notion of sleep: this timestamp is the only sign
    // it has dropped off, and it's what `readAt` must carry.
    patch.readAt = at(battery.timestamp) ?? now
    const soc = num(battery.batteryLevel)
    if (soc !== undefined) patch.soc = soc
    const range = num(battery.batteryAutonomy)
    if (range !== undefined) patch.rangeKm = range
    const plug = num(battery.plugStatus)
    if (plug !== undefined) patch.pluggedIn = plug === PLUGGED
    const charge = isCharging(battery, opts.levelRising)
    if (charge !== undefined) patch.charging = charge
    // `chargingRemainingTime` (minutes) LINGERS: the real capture gives it dated from two days
    // before on an unplugged car. It's only valid while charging; otherwise we clear it.
    if (patch.charging) {
      const eta = num(battery.chargingRemainingTime)
      patch.chargeMinutesRemaining = eta !== undefined && eta > 0 ? eta : null
    } else if (charge !== undefined) patch.chargeMinutesRemaining = null
  }

  const odometer = num(attributes(r.cockpit)?.totalMileage)
  if (odometer !== undefined) patch.odometerKm = odometer

  const location = attributes(r.location)
  const lat = num(location?.gpsLatitude)
  const lon = num(location?.gpsLongitude)
  if (lat !== undefined && lon !== undefined) {
    patch.location = { lat, lon, at: at(location?.lastUpdateTime) ?? now }
  }

  // the R5 gives the INSIDE of the cabin; it says nothing about the outside temperature
  const inside = num(attributes(r.hvac)?.internalTemperature)
  if (inside !== undefined) patch.insideTempC = inside
  // `hvacStatus` is `off` at capture; `on` while preconditioning
  const hvacStatus = attributes(r.hvac)?.hvacStatus
  if (typeof hvacStatus === 'string') patch.climateOn = hvacStatus.toLowerCase() === 'on'

  // `ev/settings` (kcm), no envelope: left-hand drive makes the LEFT seat the driver's
  const settings = r.settings as Record<string, unknown> | null | undefined
  const preTemp = num(settings?.preconditioningTemperature)
  if (preTemp !== undefined) patch.climateTargetC = preTemp
  const left = settings?.preconditioningHeatedLeftSeat, right = settings?.preconditioningHeatedRightSeat
  if (typeof left === 'boolean' && typeof right === 'boolean') patch.seatHeat = { fl: left ? 1 : 0, fr: right ? 1 : 0 }
  const wheel = settings?.preconditioningHeatedStrgWheel
  if (typeof wheel === 'boolean') patch.steeringWheelHeat = wheel

  // `ev/soc-levels` (kcm) has no `data` envelope: the fields are at the root
  const levels = r.socLevels as { socTarget?: unknown; socMin?: unknown } | null | undefined
  const target = num(levels?.socTarget)
  if (target !== undefined) patch.chargeLimit = target
  // the floor the user set in their car: Tesla has no such notion, the R5 does
  const floor = num(levels?.socMin)
  if (floor !== undefined) patch.socMin = floor

  return patch
}
