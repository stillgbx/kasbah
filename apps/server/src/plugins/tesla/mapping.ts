import type { DeviceDescriptor, ReleaseNote, StatePatch, StateFor, VehicleFinish, VehicleGear, VehicleSeat, VehicleSleepState, VehicleUpdateStatus } from '@kasbah/shared'
import { VEHICLE_GEARS, VEHICLE_SLEEP_STATES } from '@kasbah/shared'
import { releaseNoteEntrySchema, type ReleaseNoteEntry, type VehicleData, type VehicleSummary } from './types'

// Tesla Fleet API → Kasbah contract. PURE functions, tested on the fixtures.
//
// One vehicle = one `vehicle` device, identified by its VIN (stable for the vehicle's lifetime, no
// `:` or space: it's what house.json will bind). Two kinds of patches, because two kinds of
// readings that don't cost the same:
//   - `toSleepPatch`: the vehicle list gives the SLEEP STATE without waking or costly billing;
//   - `toDataPatch`: `vehicle_data` is the expensive call, and it only answers when the vehicle is awake.

export const PLUGIN_ID = 'tesla'
const MILE_KM = 1.609344

/**
 * What the vehicle REPORTS. `soc` also carries the `vehicle.wake` and `vehicle.refresh` commands (see
 * `COMMAND_REQUIRES`). `charge_power` says the car GIVES its charging power (`charger_power`): so
 * the UI neither has to estimate it nor ask for the battery capacity.
 */
export const READ_CAPABILITIES = ['soc', 'range', 'location', 'charge_power', 'release_notes'] as const

/**
 * What the vehicle ACCEPTS being changed: the charge limit (a setting bounded by the contract), the
 * charge itself, cabin preconditioning and the door locks — nothing makes the car move.
 */
export const WRITE_CAPABILITIES = ['charge_limit', 'charging', 'climate_precondition', 'software_update', 'lock'] as const

/**
 * What the climate control can do, for the vehicles' shared UI. The bounds are those the car
 * announces (`min/max_avail_temp`, 15-28 °C), the step that of its app (0.5 °C). Five heated seats
 * with three steps and the steering wheel: what the Tesla app shows on the reference Model S, and
 * what its `climate_state` reports (the five `seat_heater_*`, `steering_wheel_heater`). Another
 * Tesla without heated rear seats would refuse the command, and the refusal would surface as is.
 */
export const CLIMATE_FEATURES = {
  minC: 15, maxC: 28, stepC: 0.5,
  seats: ['fl', 'fr', 'rl', 'rc', 'rr'] as VehicleSeat[], seatLevels: 3, steeringWheelHeat: true,
}

/** Seat number of `remote_seat_heater_request` (3 and 6 are the rear backrests, absent here). */
export const SEAT_HEATER_INDEX: Record<VehicleSeat, number> = { fl: 0, fr: 1, rl: 2, rc: 4, rr: 5 }

/** The 4th character of a Tesla VIN is the model line: S, 3, X, Y (and C for the Cybertruck). */
export function modelFromVin(vin: string): string | undefined {
  const code = vin.charAt(3).toUpperCase()
  const model = ({ S: 'Model S', '3': 'Model 3', X: 'Model X', Y: 'Model Y', C: 'Cybertruck' } as Record<string, string>)[code]
  return model
}

export function toDescriptor(v: VehicleSummary, paint?: { color?: string; finish?: VehicleFinish }): DeviceDescriptor {
  const model = modelFromVin(v.vin)
  const name = v.display_name?.trim() || model || 'Tesla'
  return {
    id: `${PLUGIN_ID}:${v.vin}`, pluginId: PLUGIN_ID, externalId: v.vin, kind: 'vehicle', name,
    capabilities: [...READ_CAPABILITIES, ...WRITE_CAPABILITIES],
    meta: {
      manufacturer: 'Tesla', ...(model ? { model } : {}),
      vehicle: { ...(paint?.color ? { color: paint.color } : {}), ...(paint?.finish ? { finish: paint.finish } : {}), climate: CLIMATE_FEATURES },
    },
  }
}

/**
 * Tesla factory paints. APPROXIMATIONS: the vendor names its colors but doesn't publish their
 * values. That's acceptable here — a readable name tells which color it is, where an opaque code
 * (Renault's case) would say nothing —, and the user corrects it with one click if the eye objects.
 */
const PAINT: Record<string, string> = {
  solidblack: '#171a1c',
  obsidianblack: '#1b1c1e',
  midnightsilver: '#35383c',
  steelgrey: '#5c6063',
  stealthgrey: '#4a4c4f',
  titaniummetallic: '#4a4d52',
  silvermetallic: '#b6b8ba',
  quicksilver: '#a9adb2',
  pearlwhite: '#f2f3f5',
  white: '#f2f3f5',
  deepblue: '#1f3a63',
  deepbluemetallic: '#1f3a63',
  redmulti: '#a81c24',
  ultrared: '#b5121b',
  red: '#a81c24',
  metallicbrown: '#5b4436',
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/**
 * The paint's FINISH, taken from the two numbers that follow the RGB of `paint_color_override`.
 *
 * MEASURED, finish by finish: the same vehicle, switched on its dashboard screen between three
 * readings on 2026-09-15.
 *
 *     Matte       40,90,200,0.9,0.30
 *     Metallic    40,90,200,0.9,0.01
 *     Solid       40,90,200,0.7,0.04
 *
 * Two axes, and it took all three readings to see them. The FIFTH behaves like a ROUGHNESS: it
 * collapses when the paint shines, it rises for matte. The FOURTH like a METALNESS: identical (0.9)
 * for the two flake paints, lower (0.7) for the solid color, which has none. With only the first
 * two readings, the fourth seemed constant and meaningless — it was the third that disproved it.
 *
 * The thresholds are set BETWEEN measured values, not read to the hundredth: none of the three
 * finishes is invented, and a vehicle that fell outside these ranges falls back on the nearest one.
 */
const ROUGHNESS = 4
const METALNESS = 3
/** Between 0.04 (solid, measured) and 0.30 (matte, measured): above it, the paint is diffuse. */
const MATTE_ABOVE = 0.15
/** Between 0.7 (solid, measured) and 0.9 (flake, measured). */
const METALLIC_FROM = 0.8

export function bodyFinish(data: Pick<VehicleData, 'vehicle_config'>): VehicleFinish | undefined {
  const parts = data.vehicle_config?.paint_color_override?.split(',').map(Number)
  const roughness = parts?.[ROUGHNESS]
  const metalness = parts?.[METALNESS]
  if (roughness === undefined || !Number.isFinite(roughness)) return undefined
  if (roughness > MATTE_ABOVE) return 'matte'
  return Number.isFinite(metalness!) && metalness! >= METALLIC_FROM ? 'metallic' : 'solid'
}

/**
 * The body color, from the most accurate to the most approximate:
 *  1. `paint_color_override` — the color the owner chose IN THEIR CAR, as exact RGB. It wins: it's
 *     the one their dashboard screen displays, hence the one they have in mind.
 *  2. `exterior_color` — the factory paint name, approximated by the table above.
 *  3. nothing, if the name is unknown: better the theme color than an invented color.
 */
export function bodyColor(data: Pick<VehicleData, 'vehicle_config'>): string | undefined {
  const cfg = data.vehicle_config
  if (!cfg) return undefined
  const rgb = cfg.paint_color_override?.split(',').slice(0, 3).map(Number)
  if (rgb?.length === 3 && rgb.every((n) => Number.isFinite(n))) return `#${rgb.map(hex2).join('')}`
  const name = cfg.exterior_color?.trim().toLowerCase()
  return name ? PAINT[name] : undefined
}

/** Normalized sleep state; a value unknown from Tesla (`waking`…) is read as awake, without error. */
export function toSleepState(state: string | null | undefined): VehicleSleepState {
  return (VEHICLE_SLEEP_STATES as readonly string[]).includes(state ?? '') ? (state as VehicleSleepState) : 'online'
}

export function toSleepPatch(v: { state: string | null | undefined }): StatePatch<'vehicle'> {
  return { sleepState: toSleepState(v.state) }
}

const round = (n: number, digits = 0) => { const f = 10 ** digits; return Math.round(n * f) / f }
const milesToKm = (mi: number) => round(mi * MILE_KM, 1)
const defined = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined

/**
 * Full reading of an awake vehicle. The vendor's `null`s become fields ABSENT from the patch ("I'm
 * not talking about this field"), never zeros: a `null` speed when parked is 0, but a `null` tire
 * pressure means "not measured".
 */
export function toDataPatch(d: VehicleData): StatePatch<'vehicle'> {
  const c = d.charge_state, dr = d.drive_state, vs = d.vehicle_state, cl = d.climate_state
  const patch: StatePatch<'vehicle'> = { sleepState: toSleepState(d.state) }

  if (defined(c?.battery_level)) patch.soc = Math.max(0, Math.min(100, c.battery_level))
  if (defined(c?.battery_range)) patch.rangeKm = milesToKm(c.battery_range)
  if (defined(c?.charging_state)) {
    // `Disconnected` is the only value that says "not plugged in"; everything else (Stopped,
    // Complete, NoPower, Charging, Starting) implies a cable
    patch.pluggedIn = c.charging_state !== 'Disconnected'
    patch.charging = c.charging_state === 'Charging' || c.charging_state === 'Starting'
    // the vendor gives WHOLE kW: it's coarse, and it's what we have
    patch.chargePowerW = patch.charging && defined(c.charger_power) ? Math.round(c.charger_power * 1000) : 0
    // `time_to_full_charge` is in decimal HOURS, and stays at its last value once the charge is
    // finished: outside charging we CLEAR it (`null`), otherwise the card would announce an end of
    // charge for an unplugged car
    patch.chargeMinutesRemaining = patch.charging && defined(c.time_to_full_charge) && c.time_to_full_charge > 0
      ? Math.round(c.time_to_full_charge * 60)
      : null
  }
  if (defined(c?.charge_limit_soc)) patch.chargeLimit = Math.max(0, Math.min(100, c.charge_limit_soc))

  if (defined(vs?.locked)) patch.locked = vs.locked
  if (defined(vs?.odometer)) patch.odometerKm = milesToKm(vs.odometer)
  const tires = { fl: vs?.tpms_pressure_fl, fr: vs?.tpms_pressure_fr, rl: vs?.tpms_pressure_rl, rr: vs?.tpms_pressure_rr }
  const measured = Object.entries(tires).filter(([, v]) => defined(v)) as [string, number][]
  if (measured.length) patch.tirePressureBar = Object.fromEntries(measured.map(([k, v]) => [k, round(v, 2)]))
  // the warnings the car shows (2.8 bar for 3.1 recommended, verified on the real car): published
  // as soon as one flag is read, `{}` included, so that a re-inflated tire clears its warning
  const warning = (k: 'fl' | 'fr' | 'rl' | 'rr') => vs?.[`tpms_hard_warning_${k}`] ? 'hard' as const : vs?.[`tpms_soft_warning_${k}`] ? 'soft' as const : undefined
  if ((['fl', 'fr', 'rl', 'rr'] as const).some((k) => defined(vs?.[`tpms_soft_warning_${k}`]) || defined(vs?.[`tpms_hard_warning_${k}`]))) {
    patch.tireWarning = Object.fromEntries((['fl', 'fr', 'rl', 'rr'] as const).flatMap((k) => { const w = warning(k); return w ? [[k, w]] : [] }))
  }

  if (defined(dr?.latitude) && defined(dr?.longitude)) {
    // `gps_as_of` is in seconds, `timestamp` in milliseconds: two time bases in the same section,
    // we normalize to ms and prefer the GPS date, which is the measurement's
    const at = defined(dr.gps_as_of) ? dr.gps_as_of * 1000 : defined(dr.timestamp) ? dr.timestamp : undefined
    if (at !== undefined) patch.location = { lat: dr.latitude, lon: dr.longitude, at }
  }
  if (defined(dr?.heading)) patch.headingDeg = ((dr.heading % 360) + 360) % 360
  if (dr) {
    // `null` speed = stationary (the vendor only puts a number when moving)
    patch.speedKmh = defined(dr.speed) ? milesToKm(dr.speed) : 0
    const gear = dr.shift_state?.toUpperCase()
    if (gear && (VEHICLE_GEARS as readonly string[]).includes(gear)) patch.gear = gear as VehicleGear
    // `null` when switched off: the vehicle is parked, and saying so beats a gear stuck on the last trip's `D`
    else if (dr.shift_state === null) patch.gear = 'P'
  }

  if (defined(cl?.inside_temp)) patch.insideTempC = round(cl.inside_temp, 1)
  if (defined(cl?.outside_temp)) patch.outsideTempC = round(cl.outside_temp, 1)
  if (defined(cl?.is_climate_on)) patch.climateOn = cl.is_climate_on
  if (defined(cl?.driver_temp_setting)) patch.climateTargetC = round(cl.driver_temp_setting, 1)
  const seats = { fl: cl?.seat_heater_left, fr: cl?.seat_heater_right, rl: cl?.seat_heater_rear_left, rc: cl?.seat_heater_rear_center, rr: cl?.seat_heater_rear_right }
  const heated = Object.entries(seats).filter(([, v]) => defined(v)) as [string, number][]
  if (heated.length) patch.seatHeat = Object.fromEntries(heated.map(([k, v]) => [k, Math.max(0, Math.min(3, Math.round(v)))]))
  if (defined(cl?.steering_wheel_heater)) patch.steeringWheelHeat = cl.steering_wheel_heater

  // the optional build hash ("2026.32.7 abc123") is not the version we show
  const version = vs?.car_version?.trim().split(/\s+/)[0]
  if (version) patch.softwareVersion = version
  if (vs?.software_update !== undefined) patch.softwareUpdate = toSoftwareUpdate(vs.software_update)
  return patch
}

const UPDATE_STATUS: Record<string, VehicleUpdateStatus> = {
  available: 'available', scheduled: 'scheduled', downloading: 'downloading',
  downloading_wifi_wait: 'waiting_wifi', installing: 'installing',
}

type SoftwareUpdate = NonNullable<StateFor<'vehicle'>['softwareUpdate']>

/**
 * `software_update` → `softwareUpdate`. Empty status (nothing pending) = `null`, which CLEARS the
 * field. Each number is only published in the status where it means something: Tesla leaves
 * `install_perc` at 10 on an update that is merely available (capture of 2026-10-02). A status
 * unknown from Tesla counts as a download while it isn't complete, otherwise as a ready update:
 * either way there's something pending.
 */
export function toSoftwareUpdate(su: NonNullable<VehicleData['vehicle_state']>['software_update']): SoftwareUpdate | null {
  const raw = su?.status?.trim()
  if (!su || !raw) return null
  const status = UPDATE_STATUS[raw] ?? (defined(su.download_perc) && su.download_perc < 100 ? 'downloading' : 'available')
  const pct = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
  return {
    status,
    ...(su.version ? { version: su.version } : {}),
    ...(status === 'downloading' && defined(su.download_perc) ? { downloadPct: pct(su.download_perc) } : {}),
    ...(status === 'installing' && defined(su.install_perc) ? { installPct: pct(su.install_perc) } : {}),
    ...(status === 'scheduled' && defined(su.scheduled_time_ms) ? { scheduledAt: su.scheduled_time_ms } : {}),
    ...(defined(su.expected_duration_sec) && su.expected_duration_sec > 0 ? { expectedDurationS: su.expected_duration_sec } : {}),
  }
}

// ---- release notes ---------------------------------------------------------------------------

/** The readable entries of a `release_notes` response; an entry of unexpected shape is dropped on its own. */
export function parseReleaseNotes(raw: unknown[] | null | undefined): ReleaseNoteEntry[] {
  return (raw ?? []).flatMap((e) => {
    const parsed = releaseNoteEntrySchema.safeParse(e)
    return parsed.success && parsed.data.title.trim() ? [parsed.data] : []
  })
}

/** A Tesla entry → a contract note: title trimmed ("Apple Music  "), empty fields omitted. */
export function toReleaseNote(e: ReleaseNoteEntry): ReleaseNote {
  const description = e.description?.trim()
  return {
    title: e.title.trim(),
    ...(description ? { description } : {}),
    ...(e.image_url ? { imageUrl: e.image_url } : {}),
    ...(e.light_image_url ? { lightImageUrl: e.light_image_url } : {}),
  }
}

/** Notes per version, in the response's order. */
export function notesByVersion(entries: ReleaseNoteEntry[]): Record<string, ReleaseNote[]> {
  const out: Record<string, ReleaseNote[]> = {}
  for (const e of entries) {
    if (!e.customer_version) continue
    ;(out[e.customer_version] ??= []).push(toReleaseNote(e))
  }
  return out
}

/** Expiry (epoch ms) of a signed Tesla URL (`__gda__=exp=<seconds>~…`); `undefined` = no readable expiry. */
export function urlExpiresAt(url: string | undefined): number | undefined {
  const m = url ? /[?&]__gda__=exp=(\d+)/.exec(url) : null
  return m ? Number(m[1]) * 1000 : undefined
}

/** The nearest expiry of these notes' illustrations. */
export function imagesExpireAt(notes: ReleaseNote[]): number | undefined {
  const all = notes.flatMap((n) => [urlExpiresAt(n.imageUrl), urlExpiresAt(n.lightImageUrl)]).filter(defined)
  return all.length ? Math.min(...all) : undefined
}

/** Removes expired illustrations: a dead link would display a broken image. */
export function withoutExpiredImages(note: ReleaseNote, now: number): ReleaseNote {
  const { imageUrl, lightImageUrl, ...rest } = note
  const alive = (u: string | undefined) => u !== undefined && (urlExpiresAt(u) ?? Infinity) > now
  return { ...rest, ...(alive(imageUrl) ? { imageUrl } : {}), ...(alive(lightImageUrl) ? { lightImageUrl } : {}) }
}

/** Order of Tesla versions (`2026.32.7` > `2026.32` > `2026.26.6`), numeric segment by segment. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1)
    if (d !== 0 && Number.isFinite(d)) return d
  }
  return a.localeCompare(b)
}

/**
 * Is the vehicle at REST: parked, nobody on board, not charging? It's the moment it will fall asleep
 * on its own (a quarter of an hour) — and when leaving it alone matters. On a pre-2021 Model S or X,
 * a `vehicle_data` read can delay sleep; on the others it can't, but re-reading every ten minutes a
 * car that does nothing teaches nothing either.
 */
export function isResting(d: VehicleData): boolean {
  const gear = d.drive_state?.shift_state
  const parked = gear === null || gear === undefined || gear.toUpperCase() === 'P'
  const charging = d.charge_state?.charging_state === 'Charging' || d.charge_state?.charging_state === 'Starting'
  // an INSTALLATION in progress is not rest: we want to see its progress, then the new version
  const installing = d.vehicle_state?.software_update?.status === 'installing'
  return parked && !charging && !installing && d.vehicle_state?.is_user_present !== true
}
