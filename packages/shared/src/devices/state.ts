import { z } from 'zod'
import { AQI_LEVELS, CHARGE_MODES, CLIMATE_MODES, FAN_DIRECTIONS, PET_PUMP_MODES, POLLEN_TYPES, WEATHER_CONDITIONS, type DeviceKind } from './kinds'

// Current state of a device, discriminated by `kind`. `updatedAt` is set by the server
// (never by a plugin); `available:false` keeps the last known values
// (the UI grays them out instead of losing them).

const pct = z.number().min(0).max(100)
export const xySchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
export type ColorXY = z.infer<typeof xySchema>

const base = { updatedAt: z.number().int(), available: z.boolean() }

export const lightStateSchema = z.object({
  kind: z.literal('light'), ...base,
  on: z.boolean(),
  brightness: pct.optional(),
  colorTempMirek: z.number().optional(),
  color: xySchema.optional(),
  /** Vendor effect in progress (`no_effect` when none) — see `meta.effects`. */
  effect: z.string().optional(),
})

export const COVER_MOTIONS = ['opening', 'closing', 'stopped'] as const
export const coverStateSchema = z.object({
  kind: z.literal('cover'), ...base,
  /**
   * 0 = closed, 100 = open. **Absent = unknown position**, and it is a common case: a one-way
   * radio (RTS at Somfy) never reports where it stands. As long as no command has gone
   * through Kasbah, there is nothing to display — a default value would read as a
   * fact ("Lowered" for an awning that is actually raised, and a wrong summary counter with it).
   */
  position: pct.optional(),
  tilt: pct.optional(),
  motion: z.enum(COVER_MOTIONS),
  /**
   * Favorite position STORED IN THE MOTOR (Somfy's "my"), same scale as `position`.
   * Absent = the device knows how to go there but does not say where it is — the case of a one-way
   * radio. The `preset` capability says it can be recalled; this value, only
   * that it can be shown. Kasbah does not program it, it reads it.
   */
  presetPosition: pct.optional(),
  /**
   * Quiet mode (`quiet` capability): the maneuvers made through Kasbah run at slow speed.
   * It is a KASBAH setting, not the motor's — the wall remote keeps its normal speed.
   * Absent = the device cannot run slowly.
   */
  quiet: z.boolean().optional(),
  /**
   * Battery charge of a standalone motor (`battery` capability): a SOLAR shutter lives on its
   * battery, recharged by its panel. Absent = the motor does not publish it.
   */
  batteryPct: pct.optional(),
})

/** `on`: an app is on screen but does not say what it is doing (native Netflix on a Chromecast) — neither playback nor pause known. */
export const PLAYBACKS = ['playing', 'paused', 'idle', 'on', 'off'] as const
export const mediaPlayerStateSchema = z.object({
  kind: z.literal('media_player'), ...base,
  playback: z.enum(PLAYBACKS),
  volume: pct,
  muted: z.boolean(),
  nowPlaying: z.object({
    title: z.string(),
    artist: z.string().optional(),
    album: z.string().optional(),
    artUrl: z.string().optional(),
    durationS: z.number().optional(),
    positionS: z.number().optional(),
    source: z.string().optional(),
    /**
     * LIVE stream (radio, news channel): it has no start to go back to, no end, no neighboring track.
     * Absent = unknown, and an ordinary track is assumed. Distinct from an absent duration,
     * which only says "unknown": a native TV app does not announce a duration without being
     * a live stream. What the UI does with it: previous / next / seek are refused.
     */
    live: z.boolean().optional(),
    /**
     * Title marked EXPLICIT by the service that started it (`media_player.play_url`): speakers
     * never publish it. Absent = unknown, and the UI marks nothing.
     */
    explicit: z.boolean().optional(),
  }).optional(),
  /**
   * Where the device's sound COMES OUT, when it can say so (a Sony TV through its local API): `internal`
   * (its speakers), `external` (a connected audio system — HDMI ARC, optical — it is THAT one you
   * hear), `both`. `name`: the name the device gives to that system (CEC name, "Flexus 300").
   * Absent = unknown. The UI uses it to put the sound wave on the right device, with the
   * `meta.audioOutput` link declared in house.json.
   */
  audioOutput: z.object({ terminal: z.enum(['internal', 'external', 'both']), name: z.string().optional() }).optional(),
})

export const CLIMATE_ACTIONS = ['heating', 'cooling', 'idle', 'off'] as const
export const climateStateSchema = z.object({
  kind: z.literal('climate'), ...base,
  mode: z.enum(CLIMATE_MODES),
  action: z.enum(CLIMATE_ACTIONS).optional(),
  /**
   * The MACHINE behind this zone is heating, without saying whether it serves this zone: a heat
   * pump cascade (MELCloud) tells that the machine heats, not which of its zones. `action` is then
   * left out rather than guessed. Absent = not known, or not a zone of a shared machine.
   */
  unitHeating: z.boolean().optional(),
  targetTempC: z.number(),
  currentTempC: z.number(),
  humidity: pct.optional(),
  fanMode: z.string().optional(),
})

export const VACUUM_ACTIVITIES = ['docked', 'cleaning', 'paused', 'returning', 'error'] as const
export const vacuumStateSchema = z.object({
  kind: z.literal('vacuum'), ...base,
  activity: z.enum(VACUUM_ACTIVITIES),
  battery: pct,
  binFull: z.boolean().optional(),
  errorMessage: z.string().optional(),
  /**
   * Is the mop pad on (`mop` capability). Without it the robot vacuums but does not mop,
   * and its app says so before offering a mopping. Absent = the robot does not report it.
   */
  mopAttached: z.boolean().optional(),
  /**
   * Remaining water, in percent (`mop` capability). Also absent when the TANK is not in
   * place: the two are deliberately conflated here, because a removed tank and an unknown level
   * call for the same gesture — go and look at the machine. Not to be confused with `binFull`, which
   * is about the dust bin.
   */
  tankLevel: pct.optional(),
})

/** `stopped`: stopped where it is (STOP button, stop in the garden, robot off) — neither parked nor paused. */
export const MOWER_ACTIVITIES = ['parked', 'mowing', 'charging', 'returning', 'paused', 'stopped', 'error'] as const
/**
 * Why the mower does not mow when it could (Husqvarna `restrictedReason`): the
 * schedule, an order to park, a sensor (rain), the daily limit, an update, the
 * frost, all zones done, an external order. Absent = the vendor does not say.
 */
export const MOWER_RESTRICTIONS = [
  'none', 'week_schedule', 'park_override', 'sensor', 'daily_limit', 'fota', 'frost', 'all_work_areas_completed', 'external', 'not_applicable',
] as const
export type MowerRestriction = (typeof MOWER_RESTRICTIONS)[number]
export const mowerStateSchema = z.object({
  kind: z.literal('mower'), ...base,
  activity: z.enum(MOWER_ACTIVITIES),
  battery: pct,
  nextStartAt: z.number().optional(),
  errorMessage: z.string().optional(),
  /** Vendor error code (Husqvarna has 160): what support asks for, next to the text. */
  errorCode: z.number().int().optional(),
  /** When the error occurred. */
  errorAt: z.number().optional(),
  /** The current error can be cleared remotely (`mower.confirm_error` command); otherwise, on the robot's keypad. */
  errorConfirmable: z.boolean().optional(),
  restrictedReason: z.enum(MOWER_RESTRICTIONS).optional(),
  /** Local position (house reference frame, meters) if the robot publishes it. */
  position: z.tuple([z.number(), z.number()]).optional(),
  /**
   * GPS position, for a robot that publishes it that way (Husqvarna): it is the scene that projects it onto
   * the terrain, as for a vehicle — the plugin does not know the house's reference frame. `position`
   * (local) takes precedence if both are there.
   */
  location: z.object({ lat: z.number(), lon: z.number(), at: z.number() }).optional(),
  /** Cutting height in centimeters (1 to 9 at Husqvarna: that is how its app names it). */
  cuttingHeight: z.number().int().min(1).max(9).optional(),
  /** Last status RECEIVED from the robot by the vendor: older than `updatedAt` when the robot no longer talks. */
  statusAt: z.number().optional(),
  /**
   * Work zones (`work_areas` capability), drawn in the vendor's app. An empty name is
   * possible: Husqvarna publishes a nameless zone `0`, the whole terrain, as long as none has been drawn.
   */
  workAreas: z.array(z.object({ id: z.number().int().min(0), name: z.string(), enabled: z.boolean() })).optional(),
  /**
   * The work zone where the robot mows, or toward which it is heading (`workAreas[].id`; `0` = the whole
   * terrain). Husqvarna publishes it in the full read, not in its real-time events.
   */
  workAreaId: z.number().int().min(0).optional(),
  /** On its way to its zone (Husqvarna `LEAVING`): the activity already says `mowing`, this specifies that it is not there yet. */
  leaving: z.boolean().optional(),
  /** Exclusion zones (`stay_out_zones` capability): `enabled` = the robot does not enter them. */
  stayOutZones: z.array(z.object({ id: z.string().min(1), name: z.string(), enabled: z.boolean() })).optional(),
  /** Life counters of the robot, as the vendor keeps them (seconds, meters, counts). */
  statistics: z.object({
    cuttingTimeS: z.number().optional(),
    chargingTimeS: z.number().optional(),
    runningTimeS: z.number().optional(),
    searchingTimeS: z.number().optional(),
    bladeUsageTimeS: z.number().optional(),
    chargingCycles: z.number().optional(),
    collisions: z.number().optional(),
    driveDistanceM: z.number().optional(),
  }).optional(),
})

export const sensorStateSchema = z.object({
  kind: z.literal('sensor'), ...base,
  value: z.number(),
  /**
   * The device's record: the highest value known, kept by the device or by its plugin (an Enphase
   * microinverter: the best daily peak of the plugin's history). A record, not a characteristic:
   * it says what has happened, never what the device can do. Absent = no record known.
   */
  maxValue: z.number().optional(),
})

export const energyStateSchema = z.object({
  kind: z.literal('energy'), ...base,
  /** Never negative: a photovoltaic field produces or does not produce, it does not consume. */
  productionW: z.number(),
  consumptionW: z.number(),
  /** >0 grid import, <0 export. */
  gridW: z.number(),
  /** >0 charge, <0 discharge. */
  batteryW: z.number().optional(),
  batterySoc: pct.optional(),
  todayProductionWh: z.number().optional(),
  todayConsumptionWh: z.number().optional(),
})

export const CHARGER_STATUSES = ['disconnected', 'connected', 'charging', 'finished', 'error'] as const
export const evChargerStateSchema = z.object({
  kind: z.literal('ev_charger'), ...base,
  status: z.enum(CHARGER_STATUSES),
  powerW: z.number(),
  sessionWh: z.number(),
  maxCurrentA: z.number().optional(),
  /**
   * The charger has fallen back on its SAFETY current (Enphase `safeLimitState: 1`, "safe
   * mode", 8 A on the reference charger): its dynamic load balancing has no
   * measurement anymore, typically when it lost the gateway. `maxCurrentA` is then no longer valid. Absent = unknown.
   */
  safeLimit: z.boolean().optional(),
  /**
   * The charger obeys a MANUAL OVERRIDE (a start / stop, Enphase `mode: 0`), no longer its
   * usual mode (green charging, scheduled), until unplugging. Its displayed preference does not
   * change: without this field, a charger plugged in under the sun that delivers nothing is inexplicable.
   * `ev_charger.resume_mode` lifts it. Absent = the charger does not say.
   */
  manualOverride: z.boolean().optional(),
  /** The chosen mode (`charge_mode` capability). Absent = unknown. */
  chargeMode: z.enum(CHARGE_MODES).optional(),
})

/**
 * Sleep of a connected vehicle. `asleep` is a NORMAL state, not a fault: a parked Tesla
 * shuts down its computer after a quarter of an hour so as not to drain its battery, and no longer answers
 * anything until it is woken up. The other values of the state are then the LAST
 * known ones, still displayed; `available` stays true. `offline` = unreachable by the vendor
 * (underground parking, no network).
 */
export const VEHICLE_SLEEP_STATES = ['online', 'asleep', 'offline'] as const
export type VehicleSleepState = (typeof VEHICLE_SLEEP_STATES)[number]
/** Engaged gear: `P` = stopped. Absent = unknown (vehicle asleep, never read). */
export const VEHICLE_GEARS = ['P', 'R', 'N', 'D'] as const
export type VehicleGear = (typeof VEHICLE_GEARS)[number]
/** A tire pressure warning raised by the vehicle: under-inflated, then much lower. */
export const TIRE_WARNINGS = ['soft', 'hard'] as const

/**
 * Where a software update of the vehicle stands. `available` = downloaded, ready to install;
 * `scheduled` = installation scheduled (`scheduledAt`); `waiting_wifi` = the download is waiting for
 * a Wi-Fi (Tesla `downloading_wifi_wait`). Nothing pending = no `softwareUpdate` at all.
 */
export const VEHICLE_UPDATE_STATUSES = ['available', 'scheduled', 'downloading', 'waiting_wifi', 'installing'] as const
export type VehicleUpdateStatus = (typeof VEHICLE_UPDATE_STATUSES)[number]

const seatLevel = z.number().int().min(0).max(3)

export const vehicleStateSchema = z.object({
  kind: z.literal('vehicle'), ...base,
  soc: pct,
  rangeKm: z.number(),
  pluggedIn: z.boolean(),
  charging: z.boolean(),
  chargePowerW: z.number().optional(),
  /**
   * Charge power AS THE VEHICLE SAYS IT. Absent = it does not say it (the Renault 5
   * E-Tech, verified with the car charging): Kasbah then ESTIMATES it at display time (`estimateChargePowerW`)
   * from the capacity entered in the house, and announces it as an estimate. Nothing deduced
   * enters here: this state is what the vendor answered.
   */
  /**
   * Charge floor wanted by the user (%): the level below which they do not want the
   * car to go (Renault's `socMin`, V2L discharge threshold included). Tesla has no such
   * notion — the field stays absent, and the gauge then only shows a mark.
   */
  socMin: pct.optional(),
  /**
   * Minutes remaining before the end of the charge, as the VEHICLE estimates them (Tesla
   * `time_to_full_charge`, Renault `chargingRemainingTime`) — never a Kasbah computation, which
   * knows neither the charge curve nor the battery heating. Absent = no estimate; only
   * valid during the charge (a stopped vehicle sometimes keeps the last value, stale).
   */
  chargeMinutesRemaining: z.number().min(0).optional(),
  chargeLimit: pct.optional(),
  /**
   * Lock. **Optional = unknown**: not all makers report it (the R5 E-Tech
   * answers 403 on its `lock-status` endpoint). Same trade-off as the `position` of a cover:
   * display "—" rather than a padlock that would lie.
   */
  locked: z.boolean().optional(),
  location: z.object({ lat: z.number(), lon: z.number(), at: z.number() }).optional(),
  /** Heading of the vehicle (degrees, 0 = north, clockwise): orients its marker on the map. Absent = unknown. */
  headingDeg: z.number().min(0).max(360).optional(),
  odometerKm: z.number().optional(),
  sleepState: z.enum(VEHICLE_SLEEP_STATES).optional(),
  /** Instantaneous speed; 0 when stopped. Absent = unknown. */
  speedKmh: z.number().min(0).optional(),
  gear: z.enum(VEHICLE_GEARS).optional(),
  /**
   * Pressure of the four tires (front left, front right, rear left, rear right), in bar.
   * Each wheel is optional: the sensors only report while driving, a vehicle that has not
   * moved for a long time gives none.
   */
  tirePressureBar: z.object({
    fl: z.number().optional(), fr: z.number().optional(), rl: z.number().optional(), rr: z.number().optional(),
  }).optional(),
  /**
   * The tire pressure warnings the vehicle itself raises, per wheel: `soft` = under-inflated,
   * `hard` = much lower (puncture). A wheel without a warning is absent; `{}` = none; the field
   * absent = unknown.
   */
  tireWarning: z.object({
    fl: z.enum(TIRE_WARNINGS).optional(), fr: z.enum(TIRE_WARNINGS).optional(),
    rl: z.enum(TIRE_WARNINGS).optional(), rr: z.enum(TIRE_WARNINGS).optional(),
  }).optional(),
  insideTempC: z.number().optional(),
  outsideTempC: z.number().optional(),
  /** Cabin climate control running (preconditioning included). Absent = unknown. */
  climateOn: z.boolean().optional(),
  /** Cabin setpoint, °C, as the car keeps it. Absent = unknown. */
  climateTargetC: z.number().optional(),
  /** Heating of each seat, level 0 (off) to 3. An absent seat = unknown or without heating. */
  seatHeat: z.object({
    fl: seatLevel.optional(), fr: seatLevel.optional(), rl: seatLevel.optional(), rc: seatLevel.optional(), rr: seatLevel.optional(),
  }).optional(),
  steeringWheelHeat: z.boolean().optional(),
  /** INSTALLED software version, as the vendor names it (`2026.32.7`). Absent = unknown. */
  softwareVersion: z.string().optional(),
  /**
   * PENDING update; absent = none (or unknown). Each number is optional and only valid
   * in its status: Tesla lets `install_perc` linger outside of installation, the plugin only
   * publishes it during `installing`.
   */
  softwareUpdate: z.object({
    status: z.enum(VEHICLE_UPDATE_STATUSES),
    version: z.string().optional(),
    downloadPct: pct.optional(),
    installPct: pct.optional(),
    /** Scheduled installation time (ms epoch), in `scheduled` only. */
    scheduledAt: z.number().optional(),
    /** Announced duration of the installation, seconds: the car is unusable during that time. */
    expectedDurationS: z.number().min(0).optional(),
  }).optional(),
  /**
   * Date (ms epoch) of the last FULL READ of the vehicle — not `updatedAt`, which sleep alone
   * moves. It is what the UI displays ("Read 12 min ago"): on a billed API and a
   * sleeping vehicle, the values have an age, and the user must see it. Absent = never read.
   */
  readAt: z.number().int().optional(),
})

/**
 * A camera currently has no state of its own: the Google Nest API says neither whether it is filming nor whether
 * it is "on" (that setting is not exposed there). Only `available` carries information.
 * Events (ring, motion) will be added here when the Pub/Sub stream is hooked up.
 */
export const cameraStateSchema = z.object({
  kind: z.literal('camera'), ...base,
})

/**
 * The weather ABOVE the house, right now. A single device per plugin (its position is
 * `house.origin`), read-only like a camera. What is here is what the widget, the 3D scene
 * and a future routine need to know WITHOUT asking anything: the forecasts, heavier and
 * changing at every poll, are read on demand (`GET /api/devices/:id/forecast`).
 *
 * The OPTIONAL fields are those a provider may not have; absent = it does not say,
 * never a zero. Percentages are out of 100 as everywhere else in the contract
 * (`climate.humidity`) — the 3D scene, which thinks in 0-1, converts.
 */
export const VIGILANCE_LEVELS = ['yellow', 'orange', 'red'] as const
export type VigilanceLevel = (typeof VIGILANCE_LEVELS)[number]

export const weatherStateSchema = z.object({
  kind: z.literal('weather'), ...base,
  condition: z.enum(WEATHER_CONDITIONS),
  tempC: z.number(),
  feelsLikeC: z.number().optional(),
  dewPointC: z.number().optional(),
  humidity: pct,
  pressureHpa: z.number().optional(),
  windKmh: z.number().min(0),
  windGustKmh: z.number().min(0).optional(),
  /** Where the wind comes from (degrees, 0 = north, clockwise). */
  windDirDeg: z.number().min(0).max(360),
  cloudCover: pct,
  /** Precipitation of the past hour (mm). */
  precipMm: z.number().min(0).optional(),
  precipProbability: pct.optional(),
  visibilityM: z.number().min(0).optional(),
  uvIndex: z.number().min(0).optional(),
  isDay: z.boolean(),
  /** Sunrise and sunset of the CURRENT DAY (ms epoch): what a "before sunset" routine waits for. */
  sunrise: z.number().int(),
  sunset: z.number().int(),
  /** European air quality index (0-20 good … >100 extremely poor) and its step. */
  aqi: z.number().min(0).optional(),
  aqiLevel: z.enum(AQI_LEVELS).optional(),
  /** Level per pollen, 0 (none) to 4 (very high). Absent = this provider does not track pollens. */
  pollen: z.partialRecord(z.enum(POLLEN_TYPES), z.number().int().min(0).max(4)).optional(),
  /** Time of the observation or of the model step (ms epoch), distinct from `updatedAt` (time of the poll). */
  observedAt: z.number().int(),
  /**
   * Météo-France warnings IN PROGRESS on the department of the house (at least yellow), the
   * strongest first: what an alert or a routine reads without asking anything. `[]` = none; absent =
   * unknown (outside metropolitan France, or feed not yet read). Upcoming warnings and those
   * of another place are read on demand (`/api/plugins/open_meteo/alerts`).
   */
  vigilance: z.array(z.object({
    /** Phenomenon (`thunderstorm`, `wind`…), `other` for an unknown phenomenon. */
    type: z.string(),
    level: z.enum(VIGILANCE_LEVELS),
    onset: z.number().int(),
    expires: z.number().int(),
  })).optional(),
})

/**
 * A station that treats the water of the whole house (COMAP Proteo): it filters, passes it through
 * ultraviolet, and keeps the counters of what it let through. Read-only like the
 * weather — its settings (water hardness, lamp time slots, clock) are done on its touch
 * screen. Its protocol can nevertheless write: it is a choice, not a limit, because a wrong
 * remote maneuver on drinking water would cost more than the comfort gained.
 *
 * ALL the measurement fields are optional, and that is deliberate: before the first successful read,
 * "absent" reads "unknown". A `0 %` of wear or a `0 L` of consumption would assert a
 * measurement we do not have — same rule as `cover.position`.
 */
export const waterStateSchema = z.object({
  kind: z.literal('water'), ...base,
  /**
   * What REMAINS of each consumable, 100 = new. The prefilter holds back sediments (it is
   * washed, once a year), the two activated carbon cartridges the taste of chlorine and
   * pesticides, the UVc lamp bacteria and viruses.
   */
  prefilterPct: pct.optional(),
  carbon1Pct: pct.optional(),
  carbon2Pct: pct.optional(),
  uvLampPct: pct.optional(),
  /**
   * The UVc lamp is lit RIGHT NOW. It saves itself: the station accepts three daily
   * "economy mode" time slots during which it turns off after an hour
   * without water draw — a lamp that is off at night is therefore not a fault.
   */
  uvOn: z.boolean().optional(),
  /**
   * Instantaneous flow, in liters per hour — CONFIRMED at the tap on 2026-09-16: a mixer tap
   * opened fully made the station climb to 900, i.e. 15 L/min, the exact order of magnitude of a
   * tap (in liters per minute, one would have had to believe in 54 m³/h).
   *
   * The flowmeter counts in steps of 36 L/h — all the values read are multiples of it —
   * so the measurement is MUCH coarser than its three digits suggest: to
   * be shown as an order of magnitude, never as liter-level precision.
   */
  flowLph: z.number().min(0).optional(),
  /** Water consumed (liters), over the windows the station counts itself. */
  todayL: z.number().min(0).optional(),
  weekL: z.number().min(0).optional(),
  monthL: z.number().min(0).optional(),
  /**
   * The station reports a warning, or a fault. It also keeps a history of
   * coded alerts that its manual does not document (it refers to the after-sales service): Kasbah therefore publishes
   * only these two summaries, the only ones whose meaning is established.
   */
  warning: z.boolean().optional(),
  defect: z.boolean().optional(),
})

export const petFeederStateSchema = z.object({
  kind: z.literal('pet_feeder'), ...base,
  /**
   * The vendor announces a LACK of kibble, not a level: the feeder only has an empty-hopper
   * detector, no gauge. Publishing a percentage would be inventing a precision that does not
   * exist. Absent = the machine has not spoken.
   */
  foodLow: z.boolean().optional(),
  /** A portion is falling RIGHT NOW. Lasts a few seconds; used to acknowledge the gesture. */
  feeding: z.boolean().optional(),
  /**
   * Served since midnight and what the day's plan provides IN TOTAL, **in the unit the device
   * declares** (`meta.petFeeder.unit`). It is not always a mass: a Fresh Element Solo
   * counts in CUPS (0.3 cup), a Fresh Element Infinity in grams. The gap between served and
   * planned says whether meals remain to come.
   */
  servedToday: z.number().min(0).optional(),
  plannedToday: z.number().min(0).optional(),
  /**
   * Eaten since midnight. Absent on models WITHOUT weighing: a Fresh Element Solo says what it
   * poured, not what the animal took (verified on the real machine on Sep 21) — only
   * models with a weighing tray report it.
   */
  eatenToday: z.number().min(0).optional(),
  /** When the next scheduled meal falls, and how much. Absent = nothing more until midnight. */
  nextMealAt: z.number().int().optional(),
  nextMealAmount: z.number().min(0).optional(),
  /** Days left in the desiccant pouch (`consumables` capability). */
  desiccantDays: z.number().int().min(0).optional(),
  /**
   * BACKUP battery (`battery` capability): the feeder runs on mains and only survives
   * an outage on battery. Absent = no battery in place, which is not a fault.
   */
  batteryPct: pct.optional(),
  errorMessage: z.string().optional(),
})

export const petFountainStateSchema = z.object({
  kind: z.literal('pet_fountain'), ...base,
  /** The pump is running. Only mandatory field: it is what the switch shows. */
  on: z.boolean(),
  mode: z.enum(PET_PUMP_MODES).optional(),
  /** What remains of the filter (`consumables` capability), and in days when the vendor estimates it. */
  filterPct: pct.optional(),
  filterDays: z.number().int().min(0).optional(),
  /** The tank is empty, or nearly — the alert the vendor raises, not a measured level. */
  waterLow: z.boolean().optional(),
  batteryPct: pct.optional(),
  /**
   * What the fountain knows about the day (`water_usage` capability). An Eversweet Max does NOT
   * measure a volume — it counts the VISITS and their duration. The volume stays there for the models
   * that measure it; one or the other may be missing, never both together on the same machine.
   */
  drinksToday: z.number().int().min(0).optional(),
  /** Average duration of a visit, in seconds. */
  drinkAvgS: z.number().min(0).optional(),
  todayMl: z.number().min(0).optional(),
  errorMessage: z.string().optional(),
  /**
   * When these values were read ON the fountain. Essential here and nowhere else:
   * an Eversweet has no Wi-Fi, it is read through a Bluetooth relay via a neighboring
   * device. Between two relays, the cloud returns the last sync — sometimes several hours
   * old if the relay was out of range. Showing the age beats letting people believe it is live
   * (same reason as `readAt` of a sleeping vehicle). Absent = the reading cannot be dated.
   */
  syncedAt: z.number().int().optional(),
})

export const fanStateSchema = z.object({
  kind: z.literal('fan'), ...base,
  on: z.boolean(),
  /** Current speed (`fan_speed` capability) — accepted values in `meta.fan.speeds`. */
  speed: z.number().int().positive().optional(),
  direction: z.enum(FAN_DIRECTIONS).optional(),
  /**
   * Minutes remaining on the timer. 0 / absent = none. Cleared when the fan
   * turns off (measured on the CREATE: turning off resets `dp 64` to 0).
   */
  timerMin: z.number().int().min(0).optional(),
  /**
   * Acknowledgment beep muted (`true` = silent). `mute` capability — not the sound of a
   * media player; see the comment on the capability in `kinds.ts`.
   */
  muted: z.boolean().optional(),
})

export const deviceStateSchema = z.discriminatedUnion('kind', [
  lightStateSchema, coverStateSchema, mediaPlayerStateSchema, climateStateSchema, vacuumStateSchema,
  mowerStateSchema, sensorStateSchema, energyStateSchema, evChargerStateSchema, vehicleStateSchema,
  cameraStateSchema, weatherStateSchema, waterStateSchema, petFeederStateSchema, petFountainStateSchema,
  fanStateSchema,
])
export type DeviceState = z.infer<typeof deviceStateSchema>
export type StateFor<K extends DeviceKind> = Extract<DeviceState, { kind: K }>
/** Patch emitted by a plugin: everything is optional; `kind`/`updatedAt` cannot be patched (distributive over K). */
/**
 * Partial modification of a state, server side only (the client always receives the
 * whole state). `undefined` = "I am not talking about this field"; **`null` = "clear this field"**, and
 * is only accepted on a field that is already optional — it is the only way to bring a value back to
 * "unknown". A plugin needs it: recalling the favorite position of a one-way motor
 * moves it to a position that is not known, so the one that was displayed becomes wrong.
 */
export type StatePatch<K extends DeviceKind = DeviceKind> = K extends DeviceKind
  ? { [P in keyof Omit<StateFor<K>, 'kind' | 'updatedAt'>]?: undefined extends StateFor<K>[P] ? StateFor<K>[P] | null : StateFor<K>[P] }
  : never

const STATE_KEYS = new Map<DeviceKind, ReadonlySet<string>>(
  deviceStateSchema.options.map((o) => [o.shape.kind.value as DeviceKind, new Set(Object.keys(o.shape))]),
)
/** Legal keys of the state of a kind (to reject a patch that does not concern it). */
export function stateKeys(kind: DeviceKind): ReadonlySet<string> {
  return STATE_KEYS.get(kind) ?? new Set()
}
