import { z } from 'zod'

// MELCloud response schemas. Deliberately BROAD: nothing we do not read is constrained
// (`z.unknown()`), because one useless, badly typed field is enough to make a whole response fail
// — the costly lesson of the TaHoma plugin (`doc/3_plugins/3_2_ecrire-un-plugin.md`).
//
// Trap checked here (zod 4.5): `z.unknown()` does NOT make the key optional. A field we do not read
// but that the vendor does not always send (`Expiry`, `Device`) then makes the whole response fail
// — the exact symptom that the "Écrire un plugin" wiki page attributes to schemas that are too
// tight, and that you get here precisely while believing you loosened them. Hence `.optional()`
// everywhere.
//
// These schemas were written BEFORE the capture, from the community documentation, and that is
// why they validate almost nothing: they only have to recognize one thing, what is needed to
// ADDRESS a device. The capture has arrived since (`__fixtures__/melcloud.ts`) and it is what
// carries the mapping (`mapping.ts`); these schemas did not have to tighten for all that — a broad
// schema on what we do not read stays the right answer, another installation will not answer the
// same way.

/**
 * Response of `Login/ClientLogin`. Central trap, the same as Gigya at Renault: **MELCloud always
 * answers HTTP 200**. A wrong password arrives as a 200 with a non-zero `ErrorId`, and a client
 * that only looks at the status believes it succeeded every time.
 */
export const melcloudLoginSchema = z.looseObject({
  /** `null` = success. A number = refusal (1: invalid credentials). */
  ErrorId: z.unknown().optional(),
  LoginData: z.looseObject({
    /** The session key, to pass in the `X-MitsContextKey` header on every following call. */
    ContextKey: z.string().min(1),
    /** Account name, only to display it in Settings. */
    Name: z.unknown().optional(),
    Expiry: z.unknown().optional(),
  }).nullish(),
})

/**
 * A device, as it appears in a building's structure in `User/ListDevices`.
 *
 * Only three fields are constrained, the ones needed to ADDRESS the device: MELCloud files devices
 * at four different depths depending on the installation (`Structure.Devices`,
 * `Structure.Areas[].Devices`, `Structure.Floors[].Devices`, `Structure.Floors[].Areas[].Devices`),
 * and we do not know yet which one your machines take. `mapping.ts` therefore looks them up by
 * their shape rather than by their path.
 */
export const listedDeviceSchema = z.looseObject({
  DeviceID: z.union([z.number(), z.string()]),
  BuildingID: z.union([z.number(), z.string()]).optional(),
  DeviceName: z.unknown().optional(),
  /**
   * `Device` carries the WHOLE state: 210 fields on the captured machine, against 42 for
   * `Device/Get`. That is why polling reads `ListDevices` and never `Device/Get` — the detailed
   * read is the POORER of the two, contrary to what its name suggests, and it costs one call per
   * machine where this one returns them all at once.
   */
  Device: z.unknown().optional(),
})
export type ListedDevice = z.infer<typeof listedDeviceSchema>

/**
 * MELCloud device families. An Ecodan Zubadan is an **ATW** (air-to-water): heating zones, tank,
 * flow and return temperatures — and not a split, which would be an ATA.
 */
export const DEVICE_TYPES: Record<number, 'ata' | 'atw' | 'erv'> = { 0: 'ata', 1: 'atw', 3: 'erv' }

/** What we keep of a device to address and name it. The rest waits for the capture. */
export interface DeviceLink {
  /** `DeviceID` as a string: it is the `externalId`, stable, no `:` and no space. */
  deviceId: string
  /** Required as a parameter by `Device/Get`: without it, no read. */
  buildingId: string
  /** Name of the building that holds it, to find one's way when there are several machines. */
  buildingName: string | null
  name: string
  /** `'atw'` for an Ecodan. `null` = MELCloud did not say. */
  family: 'ata' | 'atw' | 'erv' | null
  deviceType: number | null
  /**
   * Everything `ListDevices` says about this machine, FLATTENED: the envelope then the `Device`
   * sub-object, which wins in case of conflict. Both levels carry useful fields and neither is
   * enough alone — the setpoint bounds (`MinTemperature`, `MaxTemperature`) are in the envelope,
   * the machine's state in `Device` —, and joining them here spares the rest of the plugin from
   * knowing which of the two to consult.
   */
  fields: Record<string, unknown>
}

/**
 * The state of a heating ZONE, once it is decided what it regulates on. An air-to-water Ecodan
 * controls each zone either on the room's air or on the flow water temperature — and the two
 * pairs of MELCloud fields have nothing to do with each other.
 */
export interface ZoneReading {
  zone: 1 | 2
  /** `room`: room setpoint and measurement. `flow`: flow water setpoint and measurement. */
  control: 'room' | 'flow'
  currentTempC: number | null
  targetTempC: number | null
  /** Is the zone heating right now, or waiting? */
  idle: boolean
  heating: boolean
  cooling: boolean
  /** Setpoint bounds, which are NOT the same depending on `control` (room vs flow). */
  bounds: [number, number] | null
  name: string | null
}

/**
 * The MACHINE's state, as opposed to the zones': what we look at to know whether it is running,
 * what it is doing, and whether it is unwell. Served to the Heating view, not published as a device
 * — a dozen sensors for values only looked at in one place would clutter the inventory, the search
 * and the 3D scene for nothing.
 */
export interface SystemReading {
  deviceId: string
  name: string
  power: boolean
  /**
   * What the VENDOR claims. Not to be confused with reachable: observed on the real machine,
   * `Offline` turns true while the timestamp moves forward every minute, `WifiAdapterStatus` says
   * `NORMAL` and no error is reported. Kept for diagnosis, never for deciding.
   */
  offline: boolean
  /** The real question: is the last report still fresh? `stale` is what decides. */
  stale: boolean
  outdoorTempC: number | null
  flowTempC: number | null
  returnTempC: number | null
  condensingTempC: number | null
  /** What the controller asks of the machine, in percent. */
  demandPercent: number | null
  defrosting: boolean
  /** Electric backup heaters: they cost a lot, seeing them run is the kind of thing one wants to know. */
  boosterHeater: boolean
  immersionHeater: boolean
  /** The four circulators, in the order MELCloud numbers them. */
  pumps: boolean[]
  valve3Way: boolean
  /** `ErrorCode` IS 8000 WHEN ALL IS WELL: `hasError` is the only reliable reading. */
  error: { hasError: boolean; code: number | null; message: string | null }
  /**
   * When the machine last talked to the cloud, in EPOCH MILLISECONDS and not as a string. Two
   * reasons, both measured on the real machine:
   *
   *  - the field is not the same depending on the read: `LastTimeStamp` in `ListDevices` (the one
   *    we poll), `LastCommunication` in `Device/Get`;
   *  - and they do NOT have the same time base. `LastTimeStamp` is in LOCAL time, written without
   *    a time zone; `LastCommunication` is in UTC, also written without a time zone. Returning them
   *    as is would let the display be two hours off depending on the route used — the trap already
   *    met at Husqvarna. Resolved here, once, rather than in each reader.
   */
  lastSeen: number | null
  /** `NORMAL` when the Wi-Fi module is fine: that is what tells a silent machine from a silent network. */
  wifi: string | null
  /**
   * Does the machine have an energy meter? `false` on the reference installation, and that is what
   * allows the view not to display an empty consumption section rather than one full of zeros (the
   * reports of a whole winter came back at zero).
   */
  energyMeter: boolean
}
