import { hsvToXy, kelvinToMirek, mirekToKelvin, xyToHsv } from '@kasbah/shared'
import type { Capability, Command, DeviceDescriptor, SensorClass, StatePatch } from '@kasbah/shared'
import { PluginError } from '../../core/plugin'
import type { DirigeraAttributes, DirigeraDevice, DirigeraEvent, DirigeraWrite } from './types'

// Pure translation DIRIGERA ↔ Kasbah. A hub device gives zero, one or several Kasbah devices:
//  - `light` → a light; `outlet` → a light with only on/off (as the Hue bridge does with its plugs),
//    plus its power and energy as sensors when it meters them (INSPELNING);
//  - `blinds` → a cover (`blind`);
//  - any device carrying a measurement (temperature, humidity, PM2.5, CO₂, illuminance) → one sensor per
//    measurement, `<hub id>.<measure>`.
// Left out for now: remotes and shortcut buttons (nothing to drive), motion / door / leak sensors
// (the contract has no on/off sensor yet), the air purifier, and the SYMFONISK speakers, which the
// Sonos plugin already provides.

export const PLUGIN_ID = 'dirigera'

interface SensorSpec {
  attr: keyof DirigeraAttributes
  suffix: string
  label: string
  deviceClass: SensorClass
  unit: string
  precision: number
}

const SENSORS: readonly SensorSpec[] = [
  { attr: 'currentTemperature', suffix: 'temperature', label: 'température', deviceClass: 'temperature', unit: '°C', precision: 1 },
  { attr: 'currentRH', suffix: 'humidity', label: 'humidité', deviceClass: 'humidity', unit: '%', precision: 0 },
  { attr: 'currentPM25', suffix: 'pm25', label: 'PM2.5', deviceClass: 'generic', unit: 'µg/m³', precision: 0 },
  { attr: 'currentCO2', suffix: 'co2', label: 'CO₂', deviceClass: 'generic', unit: 'ppm', precision: 0 },
  { attr: 'illuminance', suffix: 'illuminance', label: 'luminosité', deviceClass: 'illuminance', unit: 'lx', precision: 0 },
  { attr: 'currentActivePower', suffix: 'power', label: 'puissance', deviceClass: 'power', unit: 'W', precision: 1 },
  { attr: 'totalEnergyConsumed', suffix: 'energy', label: 'énergie', deviceClass: 'energy', unit: 'kWh', precision: 2 },
]

const nameOf = (d: DirigeraDevice) => d.attributes.customName?.trim() || d.attributes.model || d.deviceType

/** Can the device take this attribute: its declared capabilities, or failing that the attribute's presence. */
function accepts(d: DirigeraDevice, attr: keyof DirigeraAttributes): boolean {
  const declared = d.capabilities?.canReceive
  return declared ? declared.includes(attr) : d.attributes[attr] !== undefined
}

const isLight = (d: DirigeraDevice) => d.deviceType === 'light' || d.deviceType === 'outlet'
const isCover = (d: DirigeraDevice) => d.deviceType === 'blinds'
const sensorsOf = (d: DirigeraDevice) => SENSORS.filter((s) => typeof d.attributes[s.attr] === 'number')

function baseMeta(d: DirigeraDevice) {
  return {
    ...(d.attributes.manufacturer ? { manufacturer: d.attributes.manufacturer } : {}),
    ...(d.attributes.model ? { model: d.attributes.model } : {}),
    ...(d.room?.name ? { room: d.room.name } : {}),
  }
}

/** Mirek range of a white-tunable light; the hub's Min / Max are not reliably cold / warm, so sorted. */
function mirekRange(a: DirigeraAttributes): [number, number] | undefined {
  if (a.colorTemperatureMin === undefined || a.colorTemperatureMax === undefined) return undefined
  const m = [kelvinToMirek(a.colorTemperatureMin), kelvinToMirek(a.colorTemperatureMax)].sort((x, y) => x - y)
  return [m[0]!, m[1]!]
}

export function toDescriptors(d: DirigeraDevice): DeviceDescriptor[] {
  if (d.isHidden) return []
  const out: DeviceDescriptor[] = []
  const name = nameOf(d)
  const main = (externalId: string) => ({ id: `${PLUGIN_ID}:${externalId}`, pluginId: PLUGIN_ID, externalId })

  if (isLight(d)) {
    const caps: Capability[] = ['on_off']
    const range = mirekRange(d.attributes)
    if (d.deviceType === 'light') {
      if (accepts(d, 'lightLevel')) caps.push('brightness')
      if (accepts(d, 'colorTemperature') && range) caps.push('color_temp')
      if (accepts(d, 'colorHue')) caps.push('color')
    }
    out.push({
      ...main(d.id), kind: 'light', name, capabilities: caps,
      meta: { ...baseMeta(d), ...(caps.includes('color_temp') ? { colorTempMirek: range! } : {}) },
    })
  } else if (isCover(d)) {
    const caps: Capability[] = ['open_close', 'position', 'stop']
    if (d.attributes.batteryPercentage !== undefined) caps.push('battery')
    out.push({ ...main(d.id), kind: 'cover', name, capabilities: caps, meta: { ...baseMeta(d), cover: { deviceClass: 'blind' } } })
  }

  // the measurements of an outlet belong to it; those of a sensor stand alone
  const linkedTo = out.length ? { linkedTo: `${PLUGIN_ID}:${d.id}` } : {}
  for (const s of sensorsOf(d)) {
    out.push({
      ...main(`${d.id}.${s.suffix}`), kind: 'sensor', name: `${name} · ${s.label}`, capabilities: ['measure'],
      meta: { ...baseMeta(d), sensor: { unit: s.unit, deviceClass: s.deviceClass, precision: s.precision }, ...linkedTo },
    })
  }
  return out
}

/** Every Kasbah externalId a hub device gives (for its availability). */
export function externalIdsOf(d: DirigeraDevice): string[] {
  return toDescriptors(d).map((x) => x.externalId)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** States of every Kasbah device of a hub device, from its FULL state (the events are merged first). */
export function toPatches(d: DirigeraDevice): Array<[string, StatePatch]> {
  if (d.isHidden) return []
  const a = d.attributes
  const out: Array<[string, StatePatch]> = []
  if (isLight(d) && a.isOn !== undefined) {
    const patch: StatePatch<'light'> = { on: a.isOn }
    if (d.deviceType === 'light') {
      if (a.lightLevel !== undefined) patch.brightness = clamp(a.lightLevel, 0, 100)
      if (a.colorMode === 'color' && a.colorHue !== undefined && a.colorSaturation !== undefined) {
        patch.color = hsvToXy({ h: a.colorHue, s: clamp(a.colorSaturation, 0, 1), v: 1 })
      } else if (a.colorTemperature !== undefined && a.colorTemperature > 0) {
        patch.colorTempMirek = kelvinToMirek(a.colorTemperature)
      }
    }
    out.push([d.id, patch])
  } else if (isCover(d)) {
    const patch: StatePatch<'cover'> = {
      motion: a.blindsState === 'up' ? 'opening' : a.blindsState === 'down' ? 'closing' : 'stopped',
    }
    // hub level = share CLOSED (0 open, 100 closed); Kasbah position = share open
    if (a.blindsCurrentLevel !== undefined) patch.position = clamp(100 - a.blindsCurrentLevel, 0, 100)
    if (a.batteryPercentage !== undefined) patch.batteryPct = clamp(a.batteryPercentage, 0, 100)
    out.push([d.id, patch])
  }
  for (const s of sensorsOf(d)) out.push([`${d.id}.${s.suffix}`, { value: a[s.attr] as number }])
  return out
}

/**
 * A `deviceStateChanged` folded into the last full state: the event only carries what changed —
 * some attributes, and sometimes the room, the hidden flag or the capabilities.
 */
export function mergeEvent(d: DirigeraDevice, data: NonNullable<DirigeraEvent['data']>): DirigeraDevice {
  return {
    ...d,
    ...(data.isReachable !== undefined ? { isReachable: data.isReachable } : {}),
    ...(data.isHidden !== undefined ? { isHidden: data.isHidden } : {}),
    ...(data.capabilities ? { capabilities: data.capabilities } : {}),
    ...(data.room !== undefined ? { room: data.room } : {}),
    attributes: { ...d.attributes, ...(data.attributes ?? {}) },
  }
}

/**
 * The PATCHes a command becomes, sent one after the other. Each one carries a single attribute
 * family: the libraries never combine them, and whether the hub accepts a mixed write is unknown.
 */
export function toWrites(d: DirigeraDevice, command: Command): DirigeraWrite[] {
  const transition = (cmd: { transitionMs?: number | undefined }) => (cmd.transitionMs !== undefined ? { transitionTime: cmd.transitionMs } : {})

  if (isLight(d) && command.type === 'light.set') {
    if (command.on === false) return [{ attributes: { isOn: false } }]
    const writes: DirigeraWrite[] = []
    if (command.on === true) writes.push({ attributes: { isOn: true } })
    if (d.deviceType !== 'light') return writes
    if (command.brightness !== undefined) {
      writes.push({ attributes: { lightLevel: clamp(Math.round(command.brightness), 1, 100) }, ...transition(command) })
    }
    if (command.colorTempMirek !== undefined) {
      const range = mirekRange(d.attributes)
      const mirek = range ? clamp(command.colorTempMirek, range[0], range[1]) : command.colorTempMirek
      writes.push({ attributes: { colorTemperature: mirekToKelvin(mirek) }, ...transition(command) })
    }
    if (command.color) {
      const hsv = xyToHsv(command.color.x, command.color.y)
      writes.push({ attributes: { colorHue: Math.round(hsv.h) % 360, colorSaturation: Math.round(hsv.s * 100) / 100 }, ...transition(command) })
    }
    return writes
  }

  if (isCover(d)) {
    switch (command.type) {
      case 'cover.open': return [{ attributes: { blindsTargetLevel: 0 } }]
      case 'cover.close': return [{ attributes: { blindsTargetLevel: 100 } }]
      case 'cover.set_position': return [{ attributes: { blindsTargetLevel: clamp(Math.round(100 - command.position), 0, 100) } }]
      case 'cover.stop': return [{ attributes: { blindsState: 'stopped' } }]
      default: break
    }
  }
  throw new PluginError('UNSUPPORTED_COMMAND', `${command.type} on DIRIGERA ${d.deviceType}`)
}
