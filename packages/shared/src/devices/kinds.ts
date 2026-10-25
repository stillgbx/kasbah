// Vocabulary common to all plugins and to the UI: a device has exactly one `kind`
// (shape of the state + family of commands) and a subset of `capabilities`
// (fine traits that decide the displayed controls). Independent of any vendor.

export const DEVICE_KINDS = [
  'light', 'cover', 'media_player', 'climate', 'vacuum', 'mower',
  'sensor', 'energy', 'ev_charger', 'vehicle', 'camera', 'weather', 'water',
  'pet_feeder', 'pet_fountain', 'fan',
] as const
export type DeviceKind = (typeof DEVICE_KINDS)[number]

export const CAPABILITIES = [
  // light
  'on_off', 'brightness', 'color_temp', 'color', 'effect',
  // cover — `open_close` = open/close all or nothing (one-way RTS radio),
  // `position` = arbitrary position, known and settable (io-homecontrol, Hue motor…),
  // `preset` = favorite position stored IN the motor, which can only be recalled
  // (Somfy's "my"); its value is not always readable, see `presetPosition`.
  // `preset_set` = this memory is REWRITABLE — three distinct levels, and the same
  // device can have one without the following ones (an RTS recalls without reading or writing)
  // `quiet` = quiet mode: the motor can run at slow speed (Somfy `LinearSpeed`). The box
  // does not store it, it is an option of each maneuver: the plugin holds the switch
  // (`CoverState.quiet`) and applies it to all the travels made through Kasbah
  'open_close', 'position', 'tilt', 'stop', 'preset', 'preset_set', 'quiet',
  // media_player — `play_url`: load an HTTP(S) stream (MP3, HLS…); distinct from `playback`
  // (play / pause / stop on the session already there). Cast and Sonos declare it; a player that
  // can only be remote-controlled (native app without LOAD) does not declare it.
  //
  // `mute`: deliberate DOUBLE MEANING. On a `media_player`, mutes the playback sound. On a `fan`,
  // mutes the acknowledgment BEEP of the remote control (not an audio stream). Same capability, two
  // different gestures — documented here so that a later reading does not confuse them.
  'playback', 'volume', 'mute', 'now_playing', 'track_skip', 'seek', 'play_url',
  // fan — fan (ceiling, tower, etc.). `fan_speed` / `fan_direction` / `fan_timer`: lists
  // and directions declared in `meta.fan`, not free ranges. `mute` = acknowledgment beep (see above).
  'fan_speed', 'fan_direction', 'fan_timer',
  // climate
  'hvac_mode', 'target_temp', 'current_temp', 'humidity', 'fan_mode',
  // vacuum / mower — `journal`: the device keeps a log of what happens to it (errors,
  // warnings), served on demand by `GET /api/devices/:id/journal`; without it, nothing to read.
  // `mop`: the device MOPS in addition to vacuuming, and says what is needed to know whether it can —
  // is its pad on, does it have water left. A dry vacuum does not declare it, and the
  // section does not appear rather than showing up empty.
  // `work_areas`: the mower knows WORK ZONES (drawn in the vendor's app) and
  // can go and mow one of them. `stay_out_zones`: EXCLUSION zones that can be activated or
  // deactivated. `site_map`: it publishes the map of its terrain (zones, obstacles, guide wires),
  // served on demand by `GET /api/devices/:id/map`. `confirm_error`: some errors can be cleared
  // remotely (the state says which ones, `errorConfirmable`), without going through the robot's keypad.
  'clean', 'dock', 'battery', 'locate', 'mop', 'mow', 'park', 'schedule', 'journal', 'work_areas', 'stay_out_zones', 'site_map', 'confirm_error',
  // sensor
  'measure',
  // energy — `energy_history`: the site keeps DAILY totals, served on demand
  // (`GET /api/devices/:id/energy-days`) for the week, month, year and lifetime views
  'production', 'consumption', 'grid', 'storage', 'energy_history',
  // ev_charger — `charge_mode`: the charger's mode is chosen (green charging, manual), as in
  // the vendor's app; the state says the current mode (`chargeMode`)
  'charge_control', 'charge_current', 'charge_mode',
  // vehicle — `charge_power` is a READ capability, like `soc`: the vehicle SAYS its instantaneous
  // charge power (Tesla). Without it, nobody knows it (the Renault 5 E-Tech, verified
  // with the car charging) and the UI estimates it, which requires a battery capacity entered by hand.
  // `release_notes`: the vehicle publishes the notes of its software versions, served on demand
  // (`GET /api/devices/:id/release-notes`); `software_update`: it accepts that the installation of an
  // already downloaded update be scheduled or canceled (Tesla), two distinct things
  'soc', 'range', 'location', 'lock', 'charging', 'charge_limit', 'charge_power', 'climate_precondition',
  'release_notes', 'software_update',
  // camera — `live_stream`: an on-demand video stream (protocols in `meta.camera.protocols`),
  // `chime`: the device rings (doorbell). No `on_off`: the Google Nest API does not allow
  // turning a camera off, and declaring a capability that no command can honor would be lying.
  'live_stream', 'chime',
  // weather — the CURRENT conditions are implicit (every weather device publishes them); these three say what the
  // view can ask for in addition: forecasts (`GET /api/devices/:id/forecast`), air
  // quality, pollens. A provider that does not have pollens does not declare `pollen`, and the view
  // does not display an empty section. No command: the weather is read, not driven.
  'forecast', 'air_quality', 'pollen',
  // water — what a treatment station CAN say, and which changes from one model to another in the
  // same range (not all have a UVc lamp): without the capability, the card omits the section instead of
  // showing an empty one. No command — the settings stay on the station's screen, a
  // wrong remote maneuver on drinking water would cost more than the comfort gained.
  'consumables', 'water_flow', 'water_usage', 'uv_lamp',
  // pet_feeder / pet_fountain — two pet devices that share NO command, hence
  // two kinds. `feed` = serve a portion right away, outside the meal plan; the accepted
  // portions are not free and vary from one model to another — not even the UNIT —, so they are
  // declared in `meta.petFeeder`. `call_pet` = play the recorded sound to call
  // the animal: a gesture, not a state. `pump_mode` = the pump can alternate a continuous flow and an
  // intermittent cycle; a fountain that only has continuous does not declare it.
  // Reused as is: `battery` (both have a backup battery), `consumables`
  // (feeder desiccant, fountain filter) and `water_usage` — which does not mean
  // "a volume": an Eversweet Max counts the animal's VISITS, not milliliters.
  'feed', 'call_pet', 'pump_mode',
] as const
export type Capability = (typeof CAPABILITIES)[number]

/** Legal capabilities per kind — a descriptor that declares others is rejected. */
export const KIND_CAPABILITIES: Record<DeviceKind, readonly Capability[]> = {
  light: ['on_off', 'brightness', 'color_temp', 'color', 'effect'],
  cover: ['open_close', 'position', 'tilt', 'stop', 'preset', 'preset_set', 'quiet', 'battery'],
  media_player: ['playback', 'volume', 'mute', 'now_playing', 'track_skip', 'seek', 'play_url'],
  climate: ['hvac_mode', 'target_temp', 'current_temp', 'humidity', 'fan_mode'],
  vacuum: ['clean', 'dock', 'battery', 'locate', 'mop'],
  mower: ['mow', 'park', 'battery', 'schedule', 'journal', 'work_areas', 'stay_out_zones', 'site_map', 'confirm_error'],
  sensor: ['measure'],
  energy: ['production', 'consumption', 'grid', 'storage', 'energy_history'],
  ev_charger: ['charge_control', 'charge_current', 'charge_mode'],
  vehicle: ['soc', 'range', 'location', 'lock', 'charging', 'charge_limit', 'charge_power', 'climate_precondition', 'release_notes', 'software_update'],
  camera: ['live_stream', 'chime'],
  weather: ['forecast', 'air_quality', 'pollen'],
  water: ['consumables', 'water_flow', 'water_usage', 'uv_lamp'],
  pet_feeder: ['feed', 'call_pet', 'consumables', 'battery'],
  pet_fountain: ['on_off', 'pump_mode', 'consumables', 'battery', 'water_usage'],
  // `mute` = acknowledgment beep, not a player's sound — see the comment on the capability.
  fan: ['on_off', 'fan_speed', 'fan_direction', 'fan_timer', 'mute'],
}

/**
 * Pump regime of a fountain (`pump_mode` capability). `continuous`: it flows without
 * stopping. `intermittent`: it alternates cycles of run and rest (3 min / 3 min on the
 * real machine), which makes the battery last.
 *
 * FIXED on 2026-09-21: these two were called `normal` and `smart`, and `smart` was translated
 * "on approach" — a misreading. The vendor's app says "Intermittent" and displays the cycle
 * in minutes: it is a TIMER, not a presence detection.
 */
export const PET_PUMP_MODES = ['continuous', 'intermittent'] as const
export type PetPumpMode = (typeof PET_PUMP_MODES)[number]

/**
 * Mode of a charger, the one the vendor's app calls that (Enphase: `GREEN_CHARGING`,
 * `MANUAL_CHARGING`, `SCHEDULED_CHARGING`, `SMART_CHARGING`). `green`: on the solar surplus
 * alone. `manual`: as soon as it is plugged in, on the grid if need be. A manual override (a
 * start / stop) does not change it: it is the mode the charger goes back to.
 */
export const CHARGE_MODES = ['green', 'manual', 'scheduled', 'smart'] as const
export type ChargeMode = (typeof CHARGE_MODES)[number]
/**
 * Those that can be CHOSEN (`ev_charger.set_mode`): the two tried on the real charger. Scheduled
 * and smart depend on app settings (schedules, profile) that Kasbah does not read.
 */
export const SETTABLE_CHARGE_MODES = ['green', 'manual'] as const satisfies readonly ChargeMode[]
export type SettableChargeMode = (typeof SETTABLE_CHARGE_MODES)[number]

/** Rotation direction of a fan (`fan_direction` capability). Tuya / CREATE values. */
export const FAN_DIRECTIONS = ['forward', 'reverse'] as const
export type FanDirection = (typeof FAN_DIRECTIONS)[number]

export const CLIMATE_MODES = ['off', 'heat', 'cool', 'auto', 'eco', 'fan_only'] as const
export type ClimateMode = (typeof CLIMATE_MODES)[number]

/**
 * Kind of cover. Same role as `SENSOR_CLASSES` for a sensor: the kind says the SHAPE of
 * the state and of the commands, the class says what the thing IS — hence how to name and announce it.
 * A shutter opens and closes, an awning rolls up and lowers: it is the same `cover.open`
 * command, not the same word in the interface.
 */
export const COVER_CLASSES = [
  'shutter', 'awning', 'blind', 'curtain', 'gate', 'garage', 'window',
] as const
export type CoverClass = (typeof COVER_CLASSES)[number]

/**
 * Kind of camera: a doorbell is a camera that rings, a display (Nest Hub Max) a camera
 * placed on a piece of furniture. Same stream command for the three, not the same word or the same icon.
 */
export const CAMERA_CLASSES = ['camera', 'doorbell', 'display'] as const
export type CameraClass = (typeof CAMERA_CLASSES)[number]

/**
 * Kind of player (kind `media_player`): speaker (audio only), `tv` (television or box
 * plugged into a television: Chromecast, Android TV), `display` (connected display: Nest Hub). Same
 * command contract; only decides the icon and the 3D marker.
 */
export const MEDIA_PLAYER_CLASSES = ['speaker', 'tv', 'display'] as const
export type MediaPlayerClass = (typeof MEDIA_PLAYER_CLASSES)[number]

/**
 * Kind of heating device. Same role as `MEDIA_PLAYER_CLASSES` for a player: the kind
 * says the SHAPE of the state, the class says what the thing IS — hence what it looks like in the
 * house. A thermostat is a disc on the wall; a heat pump is a machine on the ground, and
 * drawing it as a disc made a whole installation pass for a living-room box.
 *
 * Absent = `thermostat`, the case of all the `climate` devices that existed before.
 */
export const CLIMATE_CLASSES = ['thermostat', 'heat_pump'] as const
export type ClimateClass = (typeof CLIMATE_CLASSES)[number]

/**
 * Look of a body's paint, in the vocabulary the vendor itself uses:
 * a Tesla's dashboard screen offers "Solid / Metallic / Matte". It is not a frill —
 * it is what decides whether the car reflects the sky or absorbs it, and the difference shows at first
 * glance in the scene.
 */
/** Seats of a vehicle, for seat heating: front left / right, rear left / center / right. */
export const VEHICLE_SEATS = ['fl', 'fr', 'rl', 'rc', 'rr'] as const
export type VehicleSeat = (typeof VEHICLE_SEATS)[number]

export const VEHICLE_FINISHES = ['solid', 'metallic', 'matte'] as const
export type VehicleFinish = (typeof VEHICLE_FINISHES)[number]

/** Video stream protocols that a camera can serve (decides how to display it). */
export const STREAM_PROTOCOLS = ['webrtc', 'rtsp'] as const
export type StreamProtocol = (typeof STREAM_PROTOCOLS)[number]

export const SENSOR_CLASSES = [
  'temperature', 'humidity', 'power', 'energy', 'pressure', 'flow', 'illuminance', 'ph', 'battery', 'generic',
] as const
export type SensorClass = (typeof SENSOR_CLASSES)[number]

/**
 * What it does, in a word: the SUMMARIZED condition of a `weather` device, independent of the
 * provider (Open-Meteo speaks in WMO codes, Google in labels; the plugin translates). It is what
 * the widget shows as an icon, and what the 3D scene reads to rain or snow. `sleet` =
 * rain and snow mixed, or sleet; `fog` also covers mist.
 */
export const WEATHER_CONDITIONS = [
  'clear', 'partly_cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'sleet', 'thunderstorm',
] as const
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number]

/** Levels of the EUROPEAN air quality index (EAQI, six steps), as the provider names them. */
export const AQI_LEVELS = ['good', 'fair', 'moderate', 'poor', 'very_poor', 'extremely_poor'] as const
export type AqiLevel = (typeof AQI_LEVELS)[number]

/** Step of a European index: steps of 20 up to 100, beyond that it is "extremely poor". */
export function aqiLevelOf(aqi: number): AqiLevel {
  return AQI_LEVELS[Math.min(5, Math.max(0, Math.floor(aqi / 20)))]!
}

/** Pollens tracked in Europe (CAMS): alder, birch, grasses, mugwort, olive, ragweed. */
export const POLLEN_TYPES = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'] as const
export type PollenType = (typeof POLLEN_TYPES)[number]
