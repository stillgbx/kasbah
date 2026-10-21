import type { CameraClass, Capability, ClimateMode, Command, DeviceDescriptor, DeviceEventKind, StatePatch, StreamProtocol } from '@kasbah/shared'
import { readTrait, sdmEventSchema, type SdmDevice } from './types'

// PURE translations: SDM devices → Kasbah descriptors, state patches, commands, authorization URL.
// This plugin covers cameras (cameras, doorbells, displays with a camera) and thermostats; the rest
// of the API is ignored and counted.

/** SDM type → kind of camera. A type missing from this table is not a camera. */
export const CAMERA_TYPES: Record<string, CameraClass> = {
  'sdm.devices.types.CAMERA': 'camera',
  'sdm.devices.types.DOORBELL': 'doorbell',
  'sdm.devices.types.DISPLAY': 'display',
}
export const THERMOSTAT_TYPE = 'sdm.devices.types.THERMOSTAT'

/**
 * Fallback name by kind when the device has no name (see `toDescriptor`), as a PREFIX: "Caméra
 * Garage", the way devices are named in this house ("Volet Salon", "Plafonnier Cuisine"). In
 * French, for lack of better: a descriptor's name is a single string, and translating it according
 * to the display language would require the client to recognize a fallback name in the six places
 * where it reads `descriptor.name` — too much for what it brings, the user has decided.
 */
const CLASS_LABEL: Record<CameraClass, string> = { camera: 'Caméra', doorbell: 'Sonnette', display: 'Écran' }
const THERMOSTAT_LABEL = 'Thermostat'

const PROTOCOLS: Record<string, StreamProtocol> = { WEB_RTC: 'webrtc', RTSP: 'rtsp' }

export function isCamera(device: SdmDevice): boolean {
  return device.type !== undefined && device.type in CAMERA_TYPES
}

export function isThermostat(device: SdmDevice): boolean {
  return device.type === THERMOSTAT_TYPE
}

/** `enterprises/<project>/devices/<id>` → `<id>` (opaque, stable, without `:` or spaces). */
export function deviceNameToExternalId(name: string): string {
  const i = name.lastIndexOf('/')
  return i < 0 ? name : name.slice(i + 1)
}

/** Name of the Google Home room containing the device (first named parent relation). */
export function roomOf(device: SdmDevice): string | undefined {
  const named = device.parentRelations.find((r) => r.displayName && r.displayName.trim())
  return named?.displayName?.trim()
}

/** `Info.customName` if filled in, otherwise "<type> <room>" (see `CLASS_LABEL`). */
function nameOf(device: SdmDevice, label: string): string {
  const custom = readTrait(device, 'Info')?.customName
  return (typeof custom === 'string' && custom.trim()) || [label, roomOf(device)].filter(Boolean).join(' ')
}

function baseMeta(device: SdmDevice) {
  const room = roomOf(device)
  return {
    manufacturer: 'Google Nest',
    model: device.type?.replace('sdm.devices.types.', '') ?? 'unknown',
    ...(room ? { room } : {}),
  }
}

// ---- cameras ----------------------------------------------------------------------------------

/** Stream protocols declared by `CameraLiveStream.supportedProtocols`, in Google's order. */
export function streamProtocols(device: SdmDevice): StreamProtocol[] {
  const raw = readTrait(device, 'CameraLiveStream')?.supportedProtocols
  if (!Array.isArray(raw)) return []
  const out: StreamProtocol[] = []
  for (const p of raw) {
    const mapped = typeof p === 'string' ? PROTOCOLS[p] : undefined
    if (mapped && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

/**
 * A camera's descriptor. The name comes from `Info.customName`; Google often leaves it EMPTY (7
 * devices out of 10 on the real account — the Google Home app then shows "<room> <type>"), hence a
 * "<type> <room>" fallback here, in the order of this house's names. The room goes into
 * `meta.room`: it is the key to auto-placement in the house
 * (`packages/shared/src/house/autoplace.ts`), naming the house's room like the Google Home one is
 * enough to make the camera appear in the 3D scene.
 */
export function toDescriptor(device: SdmDevice): DeviceDescriptor {
  const deviceClass = CAMERA_TYPES[device.type ?? ''] ?? 'camera'
  const externalId = deviceNameToExternalId(device.name)
  const capabilities: Capability[] = []
  if (readTrait(device, 'CameraLiveStream')) capabilities.push('live_stream')
  if (readTrait(device, 'DoorbellChime')) capabilities.push('chime')
  const protocols = streamProtocols(device)
  return {
    id: `nest:${externalId}`,
    pluginId: 'nest',
    externalId,
    kind: 'camera',
    name: nameOf(device, CLASS_LABEL[deviceClass]),
    capabilities,
    meta: { ...baseMeta(device), camera: { deviceClass, ...(protocols.length ? { protocols } : {}) } },
  }
}

// ---- thermostats ------------------------------------------------------------------------------
// Traits read: `ThermostatMode` (HEAT / COOL / HEATCOOL / OFF and the available list),
// `ThermostatEco` (MANUAL_ECO / OFF, with its own setpoints), `ThermostatHvac` (what the device is
// doing RIGHT NOW), `ThermostatTemperatureSetpoint`, `Temperature`, `Humidity`, `Connectivity`.
// Eco is a separate mode at Google (it overlays the HVAC mode); Kasbah has only one `mode`, so eco
// active → `eco`, and leaving it restores the underlying HVAC mode.

const MODE_FROM_SDM: Record<string, ClimateMode> = { HEAT: 'heat', COOL: 'cool', HEATCOOL: 'auto', OFF: 'off' }
const MODE_TO_SDM: Partial<Record<ClimateMode, string>> = { heat: 'HEAT', cool: 'COOL', auto: 'HEATCOOL', off: 'OFF' }
/** Setpoint range accepted by Google (°C). */
export const SETPOINT_RANGE: [number, number] = [9, 32]
/** In HEATCOOL mode, Google requires a gap between the two setpoints; we keep at least this one. */
const RANGE_GAP_C = 2

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
/** Google publishes raw floats (24.23999): to the tenth, the state only changes when it matters. */
const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * Modes the thermostat declares, in Google's order, with eco (if offered) and off last: the user
 * wants "Heat / Eco / Off", from the most heating to none.
 */
export function thermostatModes(device: SdmDevice): ClimateMode[] {
  const raw = readTrait(device, 'ThermostatMode')?.availableModes
  const out: ClimateMode[] = []
  if (Array.isArray(raw)) for (const m of raw) { const k = typeof m === 'string' ? MODE_FROM_SDM[m] : undefined; if (k && k !== 'off' && !out.includes(k)) out.push(k) }
  const eco = readTrait(device, 'ThermostatEco')?.availableModes
  if (Array.isArray(eco) && eco.includes('MANUAL_ECO')) out.push('eco')
  if (Array.isArray(raw) && raw.includes('OFF')) out.push('off')
  return out
}

function ecoOn(device: SdmDevice): boolean {
  return readTrait(device, 'ThermostatEco')?.mode === 'MANUAL_ECO'
}

export function toThermostatDescriptor(device: SdmDevice): DeviceDescriptor {
  const externalId = deviceNameToExternalId(device.name)
  const capabilities: Capability[] = ['hvac_mode', 'target_temp', 'current_temp']
  if (readTrait(device, 'Humidity')) capabilities.push('humidity')
  return {
    id: `nest:${externalId}`,
    pluginId: 'nest',
    externalId,
    kind: 'climate',
    name: nameOf(device, THERMOSTAT_LABEL),
    capabilities,
    meta: { ...baseMeta(device), targetTempC: SETPOINT_RANGE, climate: { modes: thermostatModes(device) } },
  }
}

/** `Connectivity.status`: only `OFFLINE` makes the device unavailable (absent = we do not know, so available). */
export function thermostatAvailable(device: SdmDevice): boolean {
  return readTrait(device, 'Connectivity')?.status !== 'OFFLINE'
}

/**
 * A thermostat's full state, or `undefined` without an ambient temperature (the contract requires
 * it). The setpoint follows the mode: the eco one when it is active, otherwise the HVAC mode's; in
 * HEATCOOL Kasbah only shows the heating setpoint. When off, Google publishes NO setpoint (empty
 * trait): we return `lastSetpointC`, the last one seen while heating that the plugin kept,
 * otherwise the ambient rather than inventing a value (the contract requires a number).
 */
export function toClimatePatch(device: SdmDevice, lastSetpointC?: number): StatePatch<'climate'> | undefined {
  const current = num(readTrait(device, 'Temperature')?.ambientTemperatureCelsius)
  if (current === undefined) return undefined
  const sdmMode = str(readTrait(device, 'ThermostatMode')?.mode) ?? 'OFF'
  const eco = readTrait(device, 'ThermostatEco')
  const mode: ClimateMode = ecoOn(device) ? 'eco' : MODE_FROM_SDM[sdmMode] ?? 'off'
  const hvac = str(readTrait(device, 'ThermostatHvac')?.status)
  const action = hvac === 'HEATING' ? 'heating' : hvac === 'COOLING' ? 'cooling' : mode === 'off' ? 'off' : 'idle'
  const setpoint = readTrait(device, 'ThermostatTemperatureSetpoint')
  // The eco setpoints are stored in °F by Nest: 57 °F arrives as 13.91568 °C, which the device and
  // its app show as 14. To the half degree, the step of a Nest in Celsius.
  const ecoTarget = sdmMode === 'COOL' ? num(eco?.coolCelsius) : num(eco?.heatCelsius)
  const target = mode === 'eco'
    ? (ecoTarget !== undefined ? Math.round(ecoTarget * 2) / 2 : undefined)
    : sdmMode === 'COOL' ? num(setpoint?.coolCelsius) : num(setpoint?.heatCelsius) ?? num(setpoint?.coolCelsius)
  const humidity = num(readTrait(device, 'Humidity')?.ambientHumidityPercent)
  return {
    mode, action, currentTempC: round1(current), targetTempC: round1(target ?? lastSetpointC ?? current),
    ...(humidity !== undefined ? { humidity: Math.round(humidity) } : {}),
  }
}

export interface SdmCommand { command: string; params: Record<string, unknown> }

/**
 * SDM command(s) for a Kasbah command, or `undefined` if the device cannot honor it IN ITS CURRENT
 * STATE — Google refuses a setpoint in eco or when off, and a mode missing from the declared list.
 * Leaving eco for an HVAC mode takes two commands: Google does not do it on its own.
 */
export function toThermostatCommands(device: SdmDevice, cmd: Command): SdmCommand[] | undefined {
  const modes = thermostatModes(device)
  const sdmMode = str(readTrait(device, 'ThermostatMode')?.mode) ?? 'OFF'
  switch (cmd.type) {
    case 'climate.set_mode': {
      if (!modes.includes(cmd.mode)) return undefined
      if (cmd.mode === 'eco') return [{ command: 'sdm.devices.commands.ThermostatEco.SetMode', params: { mode: 'MANUAL_ECO' } }]
      const target = MODE_TO_SDM[cmd.mode]
      if (!target) return undefined
      const out: SdmCommand[] = []
      if (ecoOn(device)) out.push({ command: 'sdm.devices.commands.ThermostatEco.SetMode', params: { mode: 'OFF' } })
      out.push({ command: 'sdm.devices.commands.ThermostatMode.SetMode', params: { mode: target } })
      return out
    }
    case 'climate.set_target_temp': {
      if (ecoOn(device) || sdmMode === 'OFF') return undefined
      const [lo, hi] = SETPOINT_RANGE
      const v = round1(Math.min(hi, Math.max(lo, cmd.targetTempC)))
      if (sdmMode === 'COOL') return [{ command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool', params: { coolCelsius: v } }]
      if (sdmMode === 'HEATCOOL') {
        const cool = num(readTrait(device, 'ThermostatTemperatureSetpoint')?.coolCelsius)
        return [{ command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange', params: { heatCelsius: v, coolCelsius: Math.max(cool ?? 0, v + RANGE_GAP_C) } }]
      }
      return [{ command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat', params: { heatCelsius: v } }]
    }
    default: return undefined
  }
}

// ---- OAuth ------------------------------------------------------------------------------------

/**
 * OAuth scopes requested when linking the account. `pubsub` is not used yet (events — ring, motion
 * — will go through a Pub/Sub subscription pulled with the same account), but asking for it now
 * avoids redoing the linking later.
 */
export const OAUTH_SCOPES = ['https://www.googleapis.com/auth/sdm.service', 'https://www.googleapis.com/auth/pubsub']

/**
 * URL of Google's "Partner Connections Manager": it is where the user chooses the devices they share
 * with the Device Access project, THEN authenticates. `access_type=offline` and `prompt=consent` are
 * required to receive a refresh token.
 */
export function authorizationUrl(opts: { projectId: string; clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    redirect_uri: opts.redirectUri,
    access_type: 'offline',
    prompt: 'consent',
    client_id: opts.clientId,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    state: opts.state,
  })
  return `https://nestservices.google.com/partnerconnections/${encodeURIComponent(opts.projectId)}/auth?${q.toString()}`
}

/** SDM event name → our device event kind. The others are ignored. */
const EVENT_KIND: Record<string, DeviceEventKind> = {
  'sdm.devices.events.DoorbellChime.Chime': 'chime',
  'sdm.devices.events.CameraMotion.Motion': 'motion',
  'sdm.devices.events.CameraPerson.Person': 'person',
  'sdm.devices.events.CameraSound.Sound': 'sound',
}

/**
 * Decodes the base64 body of an SDM Pub/Sub message into (externalId, event kinds). Returns `undefined`
 * if the body is unreadable or carries no known event. Pure: no I/O.
 */
export function parseSdmEvent(dataBase64: string): { externalId: string; kinds: DeviceEventKind[] } | undefined {
  let json: unknown
  try { json = JSON.parse(Buffer.from(dataBase64, 'base64').toString('utf8')) } catch { return undefined }
  const r = sdmEventSchema.safeParse(json)
  const name = r.success ? r.data.resourceUpdate?.name : undefined
  if (!name) return undefined
  const events = (r.success && r.data.resourceUpdate?.events) || {}
  const kinds = [...new Set(Object.keys(events).map((k) => EVENT_KIND[k]).filter((v): v is DeviceEventKind => v !== undefined))]
  return kinds.length ? { externalId: deviceNameToExternalId(name), kinds } : undefined
}
