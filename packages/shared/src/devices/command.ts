import { z } from 'zod'
import { CLIMATE_MODES, FAN_DIRECTIONS, PET_PUMP_MODES, SETTABLE_CHARGE_MODES, type Capability, type DeviceKind } from './kinds'
import { xySchema } from './state'

// Commands named `<kind>.<verb>`: the prefix gives the kind for free and
// `COMMAND_REQUIRES` lets the server refuse a command not supported by the device.

const pct = z.number().min(0).max(100)
const seatLevel = z.number().int().min(0).max(3)

export const commandSchema = z.discriminatedUnion('type', [
  // light — a single merged command (mirror of the Hue PUT, avoids 4 round trips per picker movement)
  z.object({
    type: z.literal('light.set'),
    on: z.boolean().optional(),
    brightness: pct.optional(),
    colorTempMirek: z.number().optional(),
    color: xySchema.optional(),
    /** Effect name taken from `meta.effects`; `no_effect` stops it. */
    effect: z.string().optional(),
    transitionMs: z.number().int().min(0).optional(),
  }),
  // cover
  z.object({ type: z.literal('cover.open') }),
  z.object({ type: z.literal('cover.close') }),
  z.object({ type: z.literal('cover.stop') }),
  z.object({ type: z.literal('cover.set_position'), position: pct }),
  z.object({ type: z.literal('cover.set_tilt'), tilt: pct }),
  // recall of the motor's favorite position: no parameter, the value lives in the device
  z.object({ type: z.literal('cover.preset') }),
  // rewrite of this memory: the position to engrave is explicit, not deduced from the device,
  // so that the caller engraves what it SHOWS and not what a motor in the middle of its travel returns
  z.object({ type: z.literal('cover.set_preset'), position: pct }),
  // quiet mode: a switch held by the plugin, applied to the following travels — it moves nothing
  z.object({ type: z.literal('cover.set_quiet'), on: z.boolean() }),
  // media_player
  z.object({ type: z.literal('media_player.play') }),
  z.object({ type: z.literal('media_player.pause') }),
  /** Stop what occupies the player: close the app on screen (Cast: session `STOP`), not just pause. */
  z.object({ type: z.literal('media_player.stop') }),
  z.object({ type: z.literal('media_player.next') }),
  z.object({ type: z.literal('media_player.previous') }),
  z.object({ type: z.literal('media_player.set_volume'), volume: pct }),
  z.object({ type: z.literal('media_player.set_mute'), muted: z.boolean() }),
  /** Seek within the track (`seek` capability); no effect on a live stream, which has no duration. */
  z.object({ type: z.literal('media_player.seek'), positionS: z.number().min(0) }),
  /** Load and play an HTTP(S) stream (`play_url` capability): MP3, AAC, HLS… not a web page. */
  z.object({
    type: z.literal('media_player.play_url'),
    url: z.string().url().max(2048).refine((u) => /^https?:\/\//i.test(u), 'http or https only'),
    /** Displayed title (Sonos DIDL / Cast metadata); otherwise the hostname of the URL. */
    title: z.string().trim().min(1).max(512).optional(),
    /** Optional artist / subtitle. */
    artist: z.string().trim().min(1).max(512).optional(),
    /** Absolute HTTP(S) cover art that the speaker can download (e.g. `i.ytimg.com`). */
    artUrl: z.string().url().max(2048).refine((u) => /^https?:\/\//i.test(u), 'http or https only').optional(),
    /**
     * The catalog marks this title EXPLICIT. No speaker publishes it: it is the service that
     * starts the playback that knows it, and it says so here so that the state carries it afterwards everywhere the
     * track is displayed.
     */
    explicit: z.boolean().optional(),
    /**
     * The service knows it is a LIVE stream (a radio): the URL does not always say so — an Icecast
     * `.aac` looks like a file. The speaker then publishes it as `nowPlaying.live`.
     */
    live: z.boolean().optional(),
  }),
  // climate
  z.object({ type: z.literal('climate.set_mode'), mode: z.enum(CLIMATE_MODES) }),
  z.object({ type: z.literal('climate.set_target_temp'), targetTempC: z.number() }),
  // vacuum
  z.object({ type: z.literal('vacuum.start') }),
  z.object({ type: z.literal('vacuum.pause') }),
  z.object({ type: z.literal('vacuum.dock') }),
  z.object({ type: z.literal('vacuum.locate') }),
  // mower
  z.object({ type: z.literal('mower.start'), durationMin: z.number().int().positive().optional() }),
  z.object({ type: z.literal('mower.pause') }),
  z.object({ type: z.literal('mower.park'), untilNextSchedule: z.boolean().default(true) }),
  /** Mow ONE work zone, for that duration (Husqvarna requires the duration), then return home. */
  z.object({ type: z.literal('mower.start_in_area'), workAreaId: z.number().int().min(0), durationMin: z.number().int().positive() }),
  z.object({ type: z.literal('mower.set_stay_out_zone'), zoneId: z.string().min(1), enabled: z.boolean() }),
  // clears the current error, when the vendor says it is confirmable (`errorConfirmable`)
  z.object({ type: z.literal('mower.confirm_error') }),
  // ev_charger
  z.object({ type: z.literal('ev_charger.start') }),
  z.object({ type: z.literal('ev_charger.stop') }),
  z.object({ type: z.literal('ev_charger.set_current'), amps: z.number().positive() }),
  /**
   * End of an override: the charger resumes the mode chosen in the vendor's app (green charging,
   * scheduled…), instead of obeying the last start / stop. Nothing if it has already gone back.
   */
  z.object({ type: z.literal('ev_charger.resume_mode') }),
  /**
   * Choose the mode of the charger. The same mode while a manual override holds goes back to
   * `resume_mode`; the same mode without an override does nothing.
   */
  z.object({ type: z.literal('ev_charger.set_mode'), mode: z.enum(SETTABLE_CHARGE_MODES) }),
  // vehicle
  z.object({ type: z.literal('vehicle.lock') }),
  z.object({ type: z.literal('vehicle.unlock') }),
  z.object({ type: z.literal('vehicle.start_charge') }),
  z.object({ type: z.literal('vehicle.stop_charge') }),
  z.object({ type: z.literal('vehicle.set_charge_limit'), percent: pct }),
  z.object({ type: z.literal('vehicle.wake') }),
  /**
   * Precondition the cabin (heat or cool before leaving). `targetTempC` absent = the
   * setpoint the car already keeps; bounds = those of Tesla (`min/max_avail_temp`, 15-28 °C).
   * The plugin WAKES the car if needed: that is the very purpose of the command, on a morning when it sleeps.
   * Battery too low (Tesla: below 20 %), the plugin refuses with `LOW_BATTERY`: the Tesla app can
   * force it, the REST API cannot (user's choice of 2026-10-01: do not look for a workaround).
   */
  z.object({ type: z.literal('vehicle.climate_start'), targetTempC: z.number().min(15).max(28).optional() }),
  z.object({ type: z.literal('vehicle.climate_stop') }),
  /**
   * Adjust without starting: setpoint, seat levels (0-3), steering wheel. NEVER WAKES the
   * car, unlike `climate_start`. Absent field = untouched.
   */
  z.object({
    type: z.literal('vehicle.climate_set'),
    targetTempC: z.number().min(15).max(28).optional(),
    seatHeat: z.object({
      fl: seatLevel.optional(), fr: seatLevel.optional(), rl: seatLevel.optional(), rc: seatLevel.optional(), rr: seatLevel.optional(),
    }).optional(),
    steeringWheelHeat: z.boolean().optional(),
  }),
  /** Re-read the vehicle NOW (billed read); polling restarts from that moment. */
  z.object({ type: z.literal('vehicle.refresh') }),
  /**
   * Install the ALREADY DOWNLOADED software update (`softwareUpdate.status` `available` or
   * `scheduled`), in `delayS` seconds — 0 = now. Rescheduling moves the time. The car
   * is unusable during the installation (Tesla: about twenty minutes): a confirmed gesture.
   */
  z.object({ type: z.literal('vehicle.schedule_update'), delayS: z.number().int().min(0).max(86_400) }),
  /** Cancel a scheduled installation; the update stays available. */
  z.object({ type: z.literal('vehicle.cancel_update') }),
  // pet_feeder
  /**
   * Serve a portion RIGHT NOW, in addition to the meal plan (which is not touched). `amount` is
   * in the unit the device declares (`meta.petFeeder.unit`): CUPS on a Fresh Element
   * Solo, grams elsewhere. The portion is not free either — each model only accepts a
   * list of values (`meta.petFeeder.portions`), and the server refuses what is not in it rather
   * than letting the vendor round it silently.
   */
  z.object({ type: z.literal('pet_feeder.feed'), amount: z.number().positive().max(1000) }),
  /** Play the recorded sound to call the animal. No state changes. */
  z.object({ type: z.literal('pet_feeder.call_pet') }),
  // pet_fountain
  z.object({ type: z.literal('pet_fountain.set_power'), on: z.boolean() }),
  z.object({ type: z.literal('pet_fountain.set_mode'), mode: z.enum(PET_PUMP_MODES) }),
  // fan — a single merged command, like `light.set` (not four verbs)
  z.object({
    type: z.literal('fan.set'),
    on: z.boolean().optional(),
    speed: z.number().int().positive().optional(),
    direction: z.enum(FAN_DIRECTIONS).optional(),
    timerMin: z.number().int().min(0).optional(),
    muted: z.boolean().optional(),
  }),
])
export type Command = z.infer<typeof commandSchema>
export type CommandInput = z.input<typeof commandSchema>
export type CommandType = Command['type']
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>

/** Capability required to accept each command. */
export const COMMAND_REQUIRES: Record<CommandType, Capability> = {
  'light.set': 'on_off',
  'cover.open': 'open_close', 'cover.close': 'open_close', 'cover.stop': 'stop',
  'cover.set_position': 'position', 'cover.set_tilt': 'tilt', 'cover.preset': 'preset',
  'cover.set_preset': 'preset_set', 'cover.set_quiet': 'quiet',
  'media_player.play': 'playback', 'media_player.pause': 'playback', 'media_player.stop': 'playback',
  'media_player.next': 'track_skip', 'media_player.previous': 'track_skip',
  'media_player.set_volume': 'volume', 'media_player.set_mute': 'mute', 'media_player.seek': 'seek',
  'media_player.play_url': 'play_url',
  'climate.set_mode': 'hvac_mode', 'climate.set_target_temp': 'target_temp',
  'vacuum.start': 'clean', 'vacuum.pause': 'clean', 'vacuum.dock': 'dock', 'vacuum.locate': 'locate',
  'mower.start': 'mow', 'mower.pause': 'mow', 'mower.park': 'park',
  'mower.start_in_area': 'work_areas', 'mower.set_stay_out_zone': 'stay_out_zones', 'mower.confirm_error': 'confirm_error',
  'ev_charger.start': 'charge_control', 'ev_charger.stop': 'charge_control', 'ev_charger.set_current': 'charge_current',
  'ev_charger.resume_mode': 'charge_control', 'ev_charger.set_mode': 'charge_mode',
  'vehicle.lock': 'lock', 'vehicle.unlock': 'lock',
  'vehicle.start_charge': 'charging', 'vehicle.stop_charge': 'charging',
  'vehicle.set_charge_limit': 'charge_limit', 'vehicle.wake': 'soc', 'vehicle.refresh': 'soc',
  'vehicle.climate_start': 'climate_precondition', 'vehicle.climate_stop': 'climate_precondition', 'vehicle.climate_set': 'climate_precondition',
  'vehicle.schedule_update': 'software_update', 'vehicle.cancel_update': 'software_update',
  'pet_feeder.feed': 'feed', 'pet_feeder.call_pet': 'call_pet',
  'pet_fountain.set_power': 'on_off', 'pet_fountain.set_mode': 'pump_mode',
  'fan.set': 'on_off',
}

export function commandKind(cmd: Command | CommandType): DeviceKind {
  const type = typeof cmd === 'string' ? cmd : cmd.type
  return type.slice(0, type.indexOf('.')) as DeviceKind
}
