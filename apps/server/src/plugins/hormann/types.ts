import { z } from 'zod'

// Schemas of the Hörmann plugin. One door = one HCPBridgeMqtt bridge (ESP32 on the motor's RS485
// bus), reached over HTTP on the LAN. Fields read from the firmware source (v1.0.2,
// `HCPBridgeESP32/src/main.cpp`, `/status` handler), not from a third-party description.

/** A door declared in `HORMANN_DOORS`. */
export const hormannDoorConfigSchema = z.object({
  /** Stable identifier chosen by the user (`garage1`): becomes the externalId. */
  id: z.string().trim().regex(/^[a-z0-9_-]+$/i, 'id: letters, digits, "_" or "-" only'),
  /** IP address or host name of the bridge. */
  host: z.string().trim().min(1),
  /** Password of the bridge's web interface (user `admin`). Empty = interface without password. */
  password: z.string().default(''),
  name: z.string().trim().min(1),
})
export type HormannDoorConfig = z.infer<typeof hormannDoorConfigSchema>

/** Parses `HORMANN_DOORS` (JSON array). Empty string → no door. */
export function parseHormannDoors(raw: string): HormannDoorConfig[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch {
    throw new Error('HORMANN_DOORS must be a JSON array')
  }
  const doors = z.array(hormannDoorConfigSchema).parse(parsed)
  const ids = new Set<string>()
  for (const d of doors) {
    if (ids.has(d.id)) throw new Error(`HORMANN_DOORS: duplicate id "${d.id}"`)
    ids.add(d.id)
  }
  return doors
}

/**
 * `GET /status`. Only the read fields are typed; the rest (sensors, I/O, last MQTT command) is
 * left loose, and every read field is optional: a firmware that drops one must not reject the
 * whole answer.
 */
export const hormannStatusSchema = z.looseObject({
  /** "open", "closed", "opening", "closing", "open h", "opening h", "opening v", "venting", "stopped". */
  doorstate: z.string().optional(),
  /** 0-100, `currentPosition × 100` truncated by the firmware. */
  currentPosition: z.number().optional(),
  targetPosition: z.number().optional(),
  light: z.boolean().optional(),
  /**
   * Seconds since the motor last polled the bridge; -1 = never since boot. The motor polls the
   * bus continuously, so this is the proof that the door is really connected.
   */
  busResponseAge: z.number().optional(),
  swversion: z.string().optional(),
})
export type HormannStatus = z.infer<typeof hormannStatusSchema>
