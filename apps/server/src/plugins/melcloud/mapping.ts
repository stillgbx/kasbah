import type { DeviceDescriptor, StatePatch } from '@kasbah/shared'
import { DEVICE_TYPES, listedDeviceSchema, type DeviceLink, type SystemReading, type ZoneReading } from './types'

// MELCloud mapping — PURE: no input/output, everything is testable on the captured response.
//
// Written AFTER the capture of the real account (`__fixtures__/melcloud.ts`), never from the
// vendor's documentation — the mistake this project has already made three times (TaHoma,
// Renault, COMAP). Four traps come straight from this capture and are handled here:
//
//  1. `RoomTemperatureZone2` is **-39** when the zone has no room sensor. MELCloud returns a
//     sentinel, not a `null`: the field that TELLS the truth is `Zone2InRoomMode`.
//  2. `ErrorCode` is **8000** when all is well. Only `HasError` is read.
//  3. The setpoint bounds are not the same from one zone to the other: room temperature for a zone
//     controlled on the room, flow water (30-60 °C) for a zone on the weather curve.
//  4. `CanCool: false`: never offer "Cool" to this machine.

/** Beyond this, we are in a structure we no longer understand: better to stop than to loop. */
const MAX_DEPTH = 12

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * An account's devices, looked up by their SHAPE and not by their path.
 *
 * MELCloud files devices at depths that depend on the installation: directly under
 * `Structure.Devices` (the reference house's case), or under an area (`Structure.Areas[]`), or
 * under a floor, or under an area of a floor. Rather than betting on a path another installation
 * would contradict, we walk down the tree and keep every node carrying a `DeviceID`.
 *
 * A node recognized as a device is NOT walked any further: its `Device` sub-object carries ids that
 * would count the same machine twice.
 */
export function toDeviceLinks(payload: unknown): DeviceLink[] {
  const out = new Map<string, DeviceLink>()
  walk(payload, null, out, 0)
  return [...out.values()]
}

function walk(node: unknown, buildingName: string | null, out: Map<string, DeviceLink>, depth: number): void {
  if (depth > MAX_DEPTH) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, buildingName, out, depth + 1)
    return
  }
  if (!isRecord(node)) return

  // a building: its name dresses the devices it contains
  const here = isRecord(node.Structure) && typeof node.Name === 'string' ? node.Name : buildingName

  if ('DeviceID' in node) {
    // validate DEVICE BY DEVICE: a machine with an unexpected shape must not deprive the house of
    // the others (`3_2_ecrire-un-plugin.md`)
    const parsed = listedDeviceSchema.safeParse(node)
    if (parsed.success) {
      const link = toLink(parsed.data, here)
      if (!out.has(link.deviceId)) out.set(link.deviceId, link)
    }
    return
  }

  for (const child of Object.values(node)) walk(child, here, out, depth + 1)
}

/**
 * Plausible range for a temperature read from this vendor. Used NOT to publish the `-39` sentinel
 * of a missing sensor: a house is never at -39 °C, and neither is heating water.
 */
function plausible(t: number | null): t is number {
  return t !== null && t > -30 && t < 100
}

/** A listed device → what is needed to address it, name it, and read it. */
function toLink(d: { DeviceID: number | string; BuildingID?: number | string | undefined; DeviceName?: unknown; Device?: unknown }, buildingName: string | null): DeviceLink {
  const deviceId = String(d.DeviceID)
  const inner = isRecord(d.Device) ? d.Device : undefined
  // the envelope AND the sub-object carry useful fields, and neither is enough alone: the setpoint
  // bounds are in the envelope, the machine's state in `Device`, which wins in case of conflict
  const fields: Record<string, unknown> = { ...(d as Record<string, unknown>), ...(inner ?? {}) }
  const raw = pickNumber(d as Record<string, unknown>, 'DeviceType') ?? (inner ? pickNumber(inner, 'DeviceType') : undefined)
  const deviceType = raw ?? null
  return {
    deviceId,
    buildingId: String(d.BuildingID ?? (inner ? (inner.BuildingID ?? '') : '')),
    buildingName,
    name: typeof d.DeviceName === 'string' && d.DeviceName.trim() !== '' ? d.DeviceName.trim() : `MELCloud ${deviceId}`,
    family: deviceType !== null ? (DEVICE_TYPES[deviceType] ?? null) : null,
    deviceType,
    fields,
  }
}

function pickNumber(o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function num(o: Record<string, unknown>, key: string): number | null {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function bool(o: Record<string, unknown>, key: string): boolean {
  return o[key] === true
}
function str(o: Record<string, unknown>, key: string): string | null {
  const v = o[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * A machine's zones, as it REALLY controls them.
 *
 * The `room` / `flow` choice cannot be guessed from the values: it is read in `Zone1InRoomMode` /
 * `Zone2InRoomMode`. On the reference installation, zone 1 (the house) is on room temperature with
 * a 19.5 °C setpoint, and zone 2 (the exchanger) on the weather curve at 45 °C flow — two
 * different pairs of fields, under the same kind.
 *
 * A room-temperature zone whose measurement is absurd falls back on the flow: it would be an
 * unplugged sensor, and publishing -39 °C would be worth less than publishing the circuit's
 * temperature.
 */
export function toZones(fields: Record<string, unknown>): ZoneReading[] {
  const zones: ZoneReading[] = [zone(fields, 1)]
  if (bool(fields, 'HasZone2')) zones.push(zone(fields, 2))
  return zones
}

function zone(f: Record<string, unknown>, z: 1 | 2): ZoneReading {
  const roomMode = bool(f, `Zone${z}InRoomMode`)
  const room = num(f, `RoomTemperatureZone${z}`)
  const flow = num(f, `FlowTemperatureZone${z}`)
  const cooling = bool(f, `Zone${z}InCoolMode`)
  // room temperature only wins if the zone is CONTROLLED on it AND the sensor answers something
  // sensible — both conditions come from the capture, not from a precaution on principle
  const control: 'room' | 'flow' = roomMode && plausible(room) ? 'room' : 'flow'
  const current = control === 'room' ? room : flow
  const target = control === 'room'
    ? num(f, `SetTemperatureZone${z}`)
    : num(f, `Set${cooling ? 'Cool' : 'Heat'}FlowTemperatureZone${z}`)
  return {
    zone: z,
    control,
    currentTempC: plausible(current) ? current : null,
    targetTempC: plausible(target) ? target : null,
    idle: bool(f, `IdleZone${z}`),
    heating: bool(f, `Zone${z}InHeatMode`),
    cooling,
    bounds: control === 'room'
      ? pair(num(f, 'MinTemperature'), num(f, 'MaxTemperature'))
      : pair(num(f, 'MinSetTemperature'), num(f, 'MaxSetTemperature')),
    name: str(f, `Zone${z}Name`),
  }
}

function pair(min: number | null, max: number | null): [number, number] | null {
  return min !== null && max !== null && max > min ? [min, max] : null
}

/**
 * Beyond this silence, the machine is no longer followed. Fifteen times the observed reporting
 * pace (one minute): enough to absorb a stuttering Wi-Fi module, short enough for the house not to
 * show yesterday's figures as if they were today's.
 */
export const DEFAULT_STALE_MS = 15 * 60_000

/**
 * When the machine last talked, in ms epoch — and this is where the trap of the two time bases is
 * resolved:
 *
 *  - `LastTimeStamp` (in `ListDevices`, the one we poll) is in **LOCAL** time, written without a
 *    time zone: `Date.parse` therefore reads it right, since it treats a date-time without a time
 *    zone as local;
 *  - `LastCommunication` (in `Device/Get`) is the SAME instant in **UTC**, also written without a
 *    time zone — checked on the capture: 17:58:00 UTC against 19:58:00 local. Reading it the same
 *    way would shift the display by the whole time-zone offset. Hence the `Z` added by hand.
 */
export function lastSeenAt(f: Record<string, unknown>): number | null {
  const local = str(f, 'LastTimeStamp')
  if (local) { const t = Date.parse(local); if (Number.isFinite(t)) return t }
  const utc = str(f, 'LastCommunication')
  if (utc) { const t = Date.parse(utc.endsWith('Z') ? utc : `${utc}Z`); if (Number.isFinite(t)) return t }
  return null
}

/**
 * Is the machine reachable? **Not `Offline`** — that flag lies.
 *
 * Observed on the real installation: `Offline: true` while `LastTimeStamp` moved forward every
 * minute, `NextCommunication` announced the next report in sixty seconds, `WifiAdapterStatus` was
 * `NORMAL` and `HasError` was false. Trusting it made the house's two zones disappear — greyed
 * out, with perfectly fresh data underneath.
 *
 * What we measure instead is the only verifiable thing: the FRESHNESS of the last report. Without
 * any timestamp at all, we fall back, for want of anything better, on what the vendor says.
 */
export function unitAvailable(f: Record<string, unknown>, now: number, maxAgeMs = DEFAULT_STALE_MS): boolean {
  const seen = lastSeenAt(f)
  if (seen === null) return !bool(f, 'Offline')
  return now - seen < maxAgeMs
}

/** A zone's `externalId`: the MELCloud id with a suffix. Stable, no `:` and no space. */
export const zoneExternalId = (deviceId: string, zone: 1 | 2): string => `${deviceId}-z${zone}`

/**
 * The devices published to the house: ONE `climate` per heating zone.
 *
 * Read-only, the only declared capability is `current_temp`. `target_temp` and `hvac_mode` would
 * announce commands that `execute` refuses, and offering a button that fails would be lying — the
 * reasoning that deprived the `camera` kind of `on_off`. The SETPOINT stays readable, it is part of
 * the state: it is the button that is missing, not the value.
 */
export function toDescriptors(link: DeviceLink): DeviceDescriptor[] {
  const f = link.fields
  const modes = bool(f, 'CanCool')
    ? (['off', 'heat', 'cool', 'eco'] as const)
    : (['off', 'heat', 'eco'] as const)
  const model = str(f, 'ModelCode')
  return toZones(f).map((z) => {
    const externalId = zoneExternalId(link.deviceId, z.zone)
    return {
      id: `melcloud:${externalId}`,
      pluginId: 'melcloud',
      externalId,
      kind: 'climate' as const,
      name: z.name ?? (z.zone === 1 ? link.name : `${link.name} zone 2`),
      capabilities: ['current_temp' as const],
      meta: {
        manufacturer: 'Mitsubishi Electric',
        ...(model ? { model: `Ecodan ${model}` } : {}),
        ...(z.bounds ? { targetTempC: z.bounds } : {}),
        // a heat pump zone is not a thermostat: it is a machine on the ground, and the 3D house
        // must draw it as such
        climate: { modes: [...modes], control: z.control, deviceClass: 'heat_pump' as const },
      },
    }
  })
}

/**
 * Ecodan `OperationMode` 2: the machine is heating its circuit. 0 on the September capture (at
 * rest), 2 while the house was heating on 2026-10-21. The other activity fields (`IdleZoneN`,
 * `HeatPumpFrequency`, `WaterPumpNStatus`) describe the controller, not the units in cascade
 * behind it: they stayed at rest while a unit and the circulator ran.
 */
export const machineHeating = (f: Record<string, unknown>): boolean => num(f, 'OperationMode') === 2

/**
 * A zone's state. `action` separates what many integrations mix up: the machine is ON
 * (`mode: 'heat'`) almost all year round, but it only HEATS (`action: 'heating'`) by moments — on
 * the September capture, both zones are idle while `Power` is true. A zone heats when it is not
 * idle OR when the machine heats and the zone is in heat mode: MELCloud does not say WHICH zone
 * the cascade serves, so both zones in heat mode show it.
 */
export function toStatePatch(fields: Record<string, unknown>, z: ZoneReading, now: number): StatePatch<'climate'> {
  const prohibited = bool(fields, `Prohibit${z.cooling ? 'Cooling' : 'Heating'}Zone${z.zone}`)
  const on = bool(fields, 'Power') && !prohibited
  const idle = z.idle && !(z.heating && machineHeating(fields))
  return {
    available: unitAvailable(fields, now),
    mode: !on ? 'off' : bool(fields, 'HolidayMode') ? 'eco' : z.cooling ? 'cool' : 'heat',
    action: !on ? 'off' : idle ? 'idle' : z.cooling ? 'cooling' : 'heating',
    ...(z.currentTempC !== null ? { currentTempC: z.currentTempC } : {}),
    ...(z.targetTempC !== null ? { targetTempC: z.targetTempC } : {}),
  }
}

/** The machine's state, for the Heating view. Never published as a device (see `SystemReading`). */
export function toSystem(link: DeviceLink, now: number): SystemReading {
  const f = link.fields
  return {
    deviceId: link.deviceId,
    name: link.name,
    power: bool(f, 'Power'),
    heating: bool(f, 'Power') && machineHeating(f),
    offline: bool(f, 'Offline'),
    stale: !unitAvailable(f, now),
    outdoorTempC: num(f, 'OutdoorTemperature'),
    flowTempC: num(f, 'FlowTemperature'),
    returnTempC: num(f, 'ReturnTemperature'),
    condensingTempC: num(f, 'CondensingTemperature'),
    demandPercent: num(f, 'DemandPercentage'),
    defrosting: (num(f, 'DefrostMode') ?? 0) > 0,
    boosterHeater: bool(f, 'BoosterHeater1Status') || bool(f, 'BoosterHeater2Status') || bool(f, 'BoosterHeater2PlusStatus'),
    immersionHeater: bool(f, 'ImmersionHeaterStatus'),
    pumps: [1, 2, 3, 4].map((n) => bool(f, `WaterPump${n}Status`)),
    valve3Way: bool(f, 'ValveStatus3Way'),
    // `HasError` first: `ErrorCode` is 8000 when all is well, and reading it as a boolean would
    // declare the house failed permanently
    error: { hasError: bool(f, 'HasError'), code: num(f, 'ErrorCode'), message: str(f, 'ErrorMessage') },
    lastSeen: lastSeenAt(f),
    wifi: str(f, 'WifiAdapterStatus'),
    energyMeter: bool(f, 'HasEnergyConsumedMeter'),
  }
}
