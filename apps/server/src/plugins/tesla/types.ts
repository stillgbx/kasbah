import { z } from 'zod'

// Shapes of the Tesla Fleet API responses. We only declare what we read, as `z.looseObject` and
// with LENIENT types on what we don't read (TaHoma lesson: constraining a useless field is enough
// to make the whole response fail). The fixtures in `__fixtures__/fleet.ts` are written from the
// documentation and the public captures of the owner API; they are to be REPLACED with a real
// capture (`GET /api/plugins/tesla/raw`) at the first linking of the account.

/** Sleep state as Tesla names it in `GET /api/1/vehicles`: it's what we read WITHOUT waking. */
export const TESLA_STATES = ['online', 'asleep', 'offline'] as const
export type TeslaState = (typeof TESLA_STATES)[number]

/** An entry of `GET /api/1/vehicles`. `state` is there even when the vehicle is asleep. */
export const vehicleSummarySchema = z.looseObject({
  vin: z.string().min(1),
  display_name: z.string().nullable().optional(),
  state: z.string(),
  in_service: z.boolean().optional(),
})
export type VehicleSummary = z.infer<typeof vehicleSummarySchema>

/** Common envelope: `{ response: ... }`, plus `count` on lists and `error` on refusals. */
export const vehiclesListSchema = z.looseObject({
  response: z.array(z.unknown()),
  count: z.number().optional(),
})

/**
 * `GET /api/1/vehicles/{vin}/vehicle_data`. The vendor's units: miles, mph, kW, bar, °C, and `null`s
 * here and there when the vehicle has no value (speed when parked, pressure of a tire that hasn't
 * rolled). Everything is optional and nullable: a missing section makes nothing fail.
 */
const num = z.number().nullable().optional()
const bool = z.boolean().nullable().optional()
const str = z.string().nullable().optional()

export const chargeStateSchema = z.looseObject({
  battery_level: num,
  battery_range: num,
  /** `Charging`, `Stopped`, `Complete`, `Disconnected`, `NoPower`, `Starting`. */
  charging_state: str,
  charger_power: num,
  charge_limit_soc: num,
  charge_port_latch: str,
  charge_port_door_open: bool,
  time_to_full_charge: num,
})
export const driveStateSchema = z.looseObject({
  latitude: num,
  longitude: num,
  speed: num,
  /** Heading, degrees, 0 = north. */
  heading: num,
  /** `P`, `R`, `N`, `D`, or `null` when parked and switched off. */
  shift_state: str,
  timestamp: num,
  gps_as_of: num,
})
export const vehicleStateSchema = z.looseObject({
  locked: bool,
  odometer: num,
  tpms_pressure_fl: num,
  tpms_pressure_fr: num,
  tpms_pressure_rl: num,
  tpms_pressure_rr: num,
  /** The car's own tire warnings: `soft` = under-inflated, `hard` = much lower. */
  tpms_soft_warning_fl: bool,
  tpms_soft_warning_fr: bool,
  tpms_soft_warning_rl: bool,
  tpms_soft_warning_rr: bool,
  tpms_hard_warning_fl: bool,
  tpms_hard_warning_fr: bool,
  tpms_hard_warning_rl: bool,
  tpms_hard_warning_rr: bool,
  is_user_present: bool,
  sentry_mode: bool,
  /** `2026.32.7`, sometimes followed by a space and a build hash. */
  car_version: str,
  vehicle_name: str,
  /**
   * Pending update. `status` is `''` when there is none; otherwise `available`, `scheduled` (with
   * `scheduled_time_ms`), `downloading`, `downloading_wifi_wait`, `installing`. `install_perc`
   * lingers at 10 outside installation (capture of 2026-10-02, status `available`).
   */
  software_update: z.looseObject({
    status: str,
    version: str,
    download_perc: num,
    install_perc: num,
    expected_duration_sec: num,
    scheduled_time_ms: num,
  }).nullable().optional(),
})
export const climateStateSchema = z.looseObject({
  inside_temp: num,
  outside_temp: num,
  is_climate_on: bool,
  /** Driver setpoint, °C (even when the car's display is in °F). */
  driver_temp_setting: num,
  /** Steps 0-3; `null` or absent = seat without heating. */
  seat_heater_left: num,
  seat_heater_right: num,
  seat_heater_rear_left: num,
  seat_heater_rear_center: num,
  seat_heater_rear_right: num,
  steering_wheel_heater: bool,
})

export const vehicleDataSchema = z.looseObject({
  response: z.looseObject({
    vin: z.string().min(1),
    display_name: str,
    state: str,
    charge_state: chargeStateSchema.optional(),
    drive_state: driveStateSchema.optional(),
    vehicle_state: vehicleStateSchema.optional(),
    climate_state: climateStateSchema.optional(),
    /**
     * Factory configuration. We only read the paint from it: `exterior_color` names the factory
     * paint ("SteelGrey", "PearlWhite"…), and `paint_color_override` carries the color the owner
     * chose IN THEIR CAR — "40,90,200,0.9,0.3": red, green, blue, then what looks very much like
     * the metalness / roughness pair of Tesla's rendering.
     */
    vehicle_config: z.looseObject({
      exterior_color: str,
      paint_color_override: str,
    }).optional(),
  }),
})
export type VehicleData = z.infer<typeof vehicleDataSchema>['response']

/**
 * A note of `GET /api/1/vehicles/{vin}/release_notes` (real capture of 2026-10-02). `title`
 * sometimes carries a trailing space; `image_url` (dark theme) and `light_image_url` are signed
 * URLs that expire (`__gda__=exp=<seconds>~…`, about two weeks). `show_in_history` excludes the
 * generic entry of a minor version ("Minor Fixes", `is_fallback`). Absent or empty elsewhere:
 * `subtitle`, `icon`, `control`.
 */
export const releaseNoteEntrySchema = z.looseObject({
  title: z.string(),
  description: str,
  customer_version: str,
  show_in_history: bool,
  image_url: str,
  light_image_url: str,
  is_fallback: bool,
})
export type ReleaseNoteEntry = z.infer<typeof releaseNoteEntrySchema>

/**
 * Without a parameter: the notes of the INSTALLED version and of a few previous ones, back to the
 * last major update. With `staged=true`: those of the PENDING version (`staged_version`), followed
 * by older ones. Entry by entry as `unknown`: a note of unexpected shape is dropped on its own.
 */
export const releaseNotesResponseSchema = z.looseObject({
  response: z.looseObject({
    release_notes: z.array(z.unknown()).nullable().optional(),
    deployed_version: str,
    staged_version: str,
  }),
})

/** Response to a REST command (`/command/...`): Tesla acknowledges with `result`, and explains with `reason`. */
export const commandResultSchema = z.looseObject({
  response: z.looseObject({ result: z.boolean(), reason: z.string().optional() }).nullable().optional(),
  error: z.string().optional(),
})

/** OAuth server response (code exchange, refresh, partner token). */
export const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

/** `GET /api/1/partner_accounts/public_key?domain=`: what Tesla read on the registered domain. */
export const partnerPublicKeySchema = z.looseObject({
  response: z.looseObject({ public_key: z.string().nullable().optional() }).nullable().optional(),
})
