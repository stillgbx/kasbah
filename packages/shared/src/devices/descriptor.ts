import { z } from 'zod'
import { CAMERA_CLASSES, CAPABILITIES, CLIMATE_CLASSES, CLIMATE_MODES, COVER_CLASSES, DEVICE_KINDS, KIND_CAPABILITIES, MEDIA_PLAYER_CLASSES, SENSOR_CLASSES, STREAM_PROTOCOLS, VEHICLE_FINISHES, VEHICLE_SEATS } from './kinds'

// Identity of a device: `${pluginId}:${externalId}`. A single string serves as Map key,
// URL segment, WS field and 3D node name — never a pair to join on the client side.
export const PLUGIN_ID_RE = /^[a-z0-9_]+$/
export const DEVICE_ID_RE = /^[a-z0-9_]+:[^:\s]+$/

export const pluginIdSchema = z.string().regex(PLUGIN_ID_RE, 'pluginId: [a-z0-9_]+')
export const deviceIdSchema = z.string().regex(DEVICE_ID_RE, 'deviceId: <pluginId>:<externalId>')
export type DeviceId = z.infer<typeof deviceIdSchema>

/** `#rrggbb` color, the form that `rgbToHex` / `hexToRgb` produce and expect. */
export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'couleur: #rrggbb')

export const deviceMetaSchema = z.object({
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  /** Room on the vendor side (e.g. Hue room) — informative, the house JSON is authoritative. */
  room: z.string().optional(),
  isGroup: z.boolean().optional(),
  /** [min, max] range in mirek supported by the light. */
  colorTempMirek: z.tuple([z.number(), z.number()]).optional(),
  /** Effects offered by the vendor, `no_effect` first (`effect` capability). */
  effects: z.array(z.string()).optional(),
  /** [min, max] setpoint range in °C. */
  targetTempC: z.tuple([z.number(), z.number()]).optional(),
  /**
   * Modes the device DECLARES (`hvac_mode` capability): a thermostat that only heats must not
   * be offered "Cool". Absent = all the `CLIMATE_MODES` (the simulation's case).
   */
  climate: z.object({
    modes: z.array(z.enum(CLIMATE_MODES)),
    /**
     * WHAT the zone is regulated on, when it is not the room air. An air-to-water heat pump
     * drives some zones on the FLOW WATER temperature (weather compensation): the setpoint there is
     * 45 °C and the "measured" value is that of the circuit, not of a living room. Showing them under the vocabulary
     * of a room thermostat would make 45 °C read as a room setpoint.
     *
     * `room` (default, absent = this one): ambient, the case of any thermostat.
     * `flow`: flow temperature of the circuit.
     *
     * Changes NOTHING to the shape of the state — `currentTempC` and `targetTempC` remain the same two
     * fields; this field only says what they are about, hence how to name them.
     */
    control: z.enum(['room', 'flow']).optional(),
    /**
     * What the device physically IS: a wall thermostat, or a floor heat pump.
     * Decides the 3D marker and nothing else. Absent = `thermostat`.
     */
    deviceClass: z.enum(CLIMATE_CLASSES).optional(),
  }).optional(),
  sensor: z.object({
    unit: z.string(),
    deviceClass: z.enum(SENSOR_CLASSES),
    precision: z.number().int().min(0).max(6).optional(),
  }).optional(),
  /** Kind of cover (shutter, awning, gate…): decides the displayed vocabulary. */
  cover: z.object({ deviceClass: z.enum(COVER_CLASSES) }).optional(),
  /** Kind of camera and stream protocols declared by the vendor (`live_stream` capability). */
  camera: z.object({
    deviceClass: z.enum(CAMERA_CLASSES),
    protocols: z.array(z.enum(STREAM_PROTOCOLS)).optional(),
  }).optional(),
  /** Kind of player (speaker, television, connected display): decides the icon and the 3D marker. Absent = speaker. */
  mediaPlayer: z.object({ deviceClass: z.enum(MEDIA_PLAYER_CLASSES) }).optional(),
  /**
   * What the vendor lets one guess of the BODYWORK. `color`: the real tint of the vehicle,
   * when the reading allows deducing it — Renault encodes it in the reference of its configuration,
   * Tesla names it in `vehicle_config`. `finish`: the look of the paint, which Tesla lets one
   * choose from the dashboard screen. Absent = nothing was found, and that is not a fault: most
   * plugins say nothing about the paint.
   *
   * It is a DEFAULT, never a truth: the manual setting of the house (`HouseDevice.bodyColor`)
   * always wins, because a wrap, a repaint or simply a taste contradicts it.
   */
  vehicle: z.object({
    color: hexColorSchema.optional(), finish: z.enum(VEHICLE_FINISHES).optional(),
    /**
     * What the climate control of THIS vehicle can do (`climate_precondition` capability). The UI
     * always offers the maximum and grays out what is missing here: a seat absent from `seats`, the steering
     * wheel without `steeringWheelHeat`. `seatLevels`: 3 = three levels (Tesla), 1 = on / off.
     * Absent = on / off only, without a setpoint.
     */
    climate: z.object({
      minC: z.number(), maxC: z.number(), stepC: z.number().positive(),
      seats: z.array(z.enum(VEHICLE_SEATS)),
      seatLevels: z.number().int().min(1).max(3),
      steeringWheelHeat: z.boolean(),
      /**
       * Seats and steering wheel are adjusted with the CLIMATE OFF: they are options of the preconditioning (R5,
       * "common to all programs"), not heaters one turns on. Absent = the climate has to be
       * running (Tesla: "Requires preconditioning or climate keeper to be on").
       */
      heatWhileOff: z.boolean().optional(),
    }).optional(),
    /**
     * This vehicle cannot STOP its charge remotely: it is the charger that stops it (the R5,
     * "use charger to stop" at renault-api). The server then relays `vehicle.stop_charge` to the
     * charger it is plugged into. Absent = the vehicle stops by itself.
     */
    stopViaCharger: z.boolean().optional(),
  }).optional(),
  /**
   * The plugin REMEMBERS this device even when absent from the network (a Cast that is off no longer announces itself, and its
   * entry in the house would lose its name and state). The UI can therefore offer to forget it —
   * `DELETE /api/plugins/<plugin>/devices/<externalId>` by convention. Absent = the plugin's list
   * is authoritative, there is nothing to forget.
   */
  forgettable: z.boolean().optional(),
  /**
   * Charger (kind `ev_charger`). `stopUntilUnplug`: stopping the charger BLOCKS it until the next
   * unplugging, scheduled mode included (Enphase: a green charge no longer resumes with the
   * sun). The UI says so under the Stop button. Absent = an ordinary stop.
   */
  evCharger: z.object({ stopUntilUnplug: z.boolean().optional() }).optional(),
  /**
   * Where the weather comes from (kind `weather`). `attribution` is MANDATORY: open data
   * (Open-Meteo, CC BY 4.0) must be credited, and it is the UI that displays it — the plugin only
   * says it. `model`: the numerical model behind the figures ("AROME France HD").
   */
  weather: z.object({ attribution: z.string().min(1), model: z.string().optional() }).optional(),
  /**
   * What a feeder accepts as a portion, and in which unit it counts (`feed` capability).
   * It is not a range: a Fresh Element Solo only knows five values. A slider
   * would lie; the list tells the truth, and the server can refuse what is not in it instead of
   * letting the vendor round it silently.
   */
  petFeeder: z.object({
    /** Accepted portions, in `unit`. A Fresh Element Solo: 0.1 to 0.5 cup in tenths. */
    portions: z.array(z.number().positive()).min(1),
    /**
     * The unit in which THIS feeder counts. It is not the same from one model to another
     * in the same range: a Fresh Element Solo measures in CUPS, an Infinity in grams — and
     * the device declares it itself (`settings.factor`). Writing "30 g" for three tenths of a
     * cup, as was done for a while, is off by a factor of three.
     */
    unit: z.enum(['cup', 'g']),
  }).optional(),
  /**
   * Color temperatures REALLY applicable, in mirek, when the light only accepts a
   * list of them. A 3CCT module (a very common format) has only three steps: it ACCEPTS an intermediate
   * value then silently ignores it — measured on the CREATE. Declaring a range would make
   * a slider that lies be displayed. Same reasoning as `petFeeder.portions`.
   * Exclusive with `colorTempMirek`: if both are there, the list wins.
   */
  colorTempMirekSteps: z.array(z.number().positive()).min(2).optional(),
  /** Speeds accepted by the fan (`fan_speed` capability). List, not range. */
  fan: z.object({ speeds: z.array(z.number().int().positive()).min(1) }).optional(),
  /**
   * This device is physically part of the same device as the one designated. A ceiling
   * fan and its ceiling light are two devices of the contract (no shared command) but a
   * single object on the ceiling: the UI renders them together. The link goes from the accessory to the main one,
   * which leaves the accessory valid on its own.
   */
  linkedTo: deviceIdSchema.optional(),
})
export type DeviceMeta = z.infer<typeof deviceMetaSchema>

export const deviceDescriptorSchema = z.object({
  id: deviceIdSchema,
  pluginId: pluginIdSchema,
  externalId: z.string().min(1),
  kind: z.enum(DEVICE_KINDS),
  name: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITIES)),
  meta: deviceMetaSchema.default({}),
}).superRefine((d, ctx) => {
  if (d.id !== `${d.pluginId}:${d.externalId}`) {
    ctx.addIssue({ code: 'custom', path: ['id'], message: 'id must equal `${pluginId}:${externalId}`' })
  }
  const allowed = KIND_CAPABILITIES[d.kind]
  for (const c of d.capabilities) {
    if (!allowed.includes(c)) {
      ctx.addIssue({ code: 'custom', path: ['capabilities'], message: `capability "${c}" not allowed for kind "${d.kind}"` })
    }
  }
})
export type DeviceDescriptor = z.infer<typeof deviceDescriptorSchema>
