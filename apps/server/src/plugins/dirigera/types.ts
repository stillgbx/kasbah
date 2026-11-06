import { z } from 'zod'

// Shapes of the IKEA DIRIGERA hub's local API (https://<hub>:8443/v1), checked against the types of
// the `dirigera` npm library 2.0.2 (no official documentation, no hub on hand when this was written): every field the
// plugin reads is optional and loosely typed, the others are not constrained at all. A device of an
// unexpected shape is skipped alone (`safeParse` per device in the client), never the whole house.

const num = z.number().optional()
const bool = z.boolean().optional()
const str = z.string().optional()

export const dirigeraAttributesSchema = z.looseObject({
  customName: str,
  model: str,
  manufacturer: str,
  productCode: str,
  // light, outlet
  isOn: bool,
  /** 1-100. */
  lightLevel: num,
  /** Kelvin. */
  colorTemperature: num,
  /** Kelvin bounds; the hub names the COLDEST one `Min` (4000) and the warmest `Max` (2202). */
  colorTemperatureMin: num,
  colorTemperatureMax: num,
  /** 0-360. */
  colorHue: num,
  /** 0-1. */
  colorSaturation: num,
  /** `temperature` | `color`: which of the two the light is showing. */
  colorMode: str,
  // outlet with metering (INSPELNING)
  /** W. */
  currentActivePower: num,
  /** kWh since the outlet was installed. */
  totalEnergyConsumed: num,
  // blinds — 0 = open, 100 = closed (to confirm on a real blind)
  blindsCurrentLevel: num,
  blindsTargetLevel: num,
  /** `up` | `down` | `stopped`. */
  blindsState: str,
  batteryPercentage: num,
  // environment sensors (VINDSTYRKA…), light sensor
  currentTemperature: num,
  currentRH: num,
  currentPM25: num,
  /** ppm (ALPSTUGA). */
  currentCO2: num,
  illuminance: num,
})
export type DirigeraAttributes = z.infer<typeof dirigeraAttributesSchema>

export const dirigeraDeviceSchema = z.looseObject({
  id: z.string().min(1),
  /** Family (`light`, `outlet`, `blinds`, `sensor`, `controller`, `speaker`, `gateway`…). */
  type: str,
  /** Precise type (`light`, `outlet`, `blinds`, `environmentSensor`, `motionSensor`, `lightController`…). */
  deviceType: z.string(),
  isReachable: bool,
  isHidden: bool,
  attributes: dirigeraAttributesSchema,
  capabilities: z.looseObject({ canReceive: z.array(z.string()).optional() }).optional(),
  room: z.looseObject({ id: str, name: str }).nullish(),
})
export type DirigeraDevice = z.infer<typeof dirigeraDeviceSchema>

/**
 * A message of the event socket (wss://<hub>:8443/v1): `deviceStateChanged` carries ONLY the
 * attributes that changed (a delta, to merge into the last full state); `deviceAdded`,
 * `deviceRemoved` and the room / name changes ask for a full read.
 */
export const dirigeraEventSchema = z.looseObject({
  type: z.string(),
  data: z.looseObject({
    id: z.string().optional(),
    isReachable: bool,
    isHidden: bool,
    attributes: z.record(z.string(), z.unknown()).optional(),
    capabilities: z.looseObject({ canReceive: z.array(z.string()).optional() }).optional(),
    room: z.looseObject({ id: str, name: str }).nullish(),
  }).nullish(),
})
export type DirigeraEvent = z.infer<typeof dirigeraEventSchema>

/** One write of `PATCH /v1/devices/<id>`: the body is an ARRAY of these. */
export interface DirigeraWrite {
  attributes: Record<string, unknown>
  /** ms. */
  transitionTime?: number
}

export const authorizeResponseSchema = z.looseObject({ code: z.string().min(1) })
export const tokenResponseSchema = z.looseObject({ access_token: z.string().min(1) })
