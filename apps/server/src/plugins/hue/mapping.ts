import type { Capability, CommandOf, DeviceDescriptor, StatePatch } from '@kasbah/shared'
import type { HueDevice, HueGroupedLight, HueLight, HuePutBody, HueRoom, HueZigbeeConnectivity } from './types'

// Mappage PUR Hue ↔ modèle Kasbah. Aucune I/O : testé sur fixtures.

export const HUE_PLUGIN_ID = 'hue'
const DEFAULT_MIREK_RANGE: [number, number] = [153, 500]

export interface HueIndex {
  lights: Map<string, HueLight>
  devices: Map<string, HueDevice>
  rooms: Map<string, HueRoom>
  /** device rid → room */
  roomOfDevice: Map<string, HueRoom>
  /** service rid (light, zigbee_connectivity…) → device */
  deviceOfService: Map<string, HueDevice>
  /** device rid → ids des lights qu'il porte */
  lightsOfDevice: Map<string, string[]>
}

export function indexResources(lights: HueLight[], devices: HueDevice[], rooms: HueRoom[]): HueIndex {
  const idx: HueIndex = {
    lights: new Map(lights.map((l) => [l.id, l])),
    devices: new Map(devices.map((d) => [d.id, d])),
    rooms: new Map(rooms.map((r) => [r.id, r])),
    roomOfDevice: new Map(), deviceOfService: new Map(), lightsOfDevice: new Map(),
  }
  for (const d of devices) {
    for (const s of d.services) {
      idx.deviceOfService.set(s.rid, d)
      if (s.rtype === 'light') {
        const arr = idx.lightsOfDevice.get(d.id) ?? []
        arr.push(s.rid)
        idx.lightsOfDevice.set(d.id, arr)
      }
    }
  }
  for (const r of rooms) for (const c of r.children) if (c.rtype === 'device') idx.roomOfDevice.set(c.rid, r)
  return idx
}

export function lightCapabilities(light: HueLight): Capability[] {
  const caps: Capability[] = ['on_off']
  if (light.dimming) caps.push('brightness')
  if (light.color_temperature) caps.push('color_temp')
  if (light.color) caps.push('color')
  return caps
}

export function toDescriptor(light: HueLight, device?: HueDevice, room?: HueRoom): DeviceDescriptor {
  const range = light.color_temperature?.mirek_schema
  return {
    id: `${HUE_PLUGIN_ID}:${light.id}`,
    pluginId: HUE_PLUGIN_ID,
    externalId: light.id,
    kind: 'light',
    name: light.metadata?.name ?? device?.metadata?.name ?? `Hue ${light.id.slice(0, 8)}`,
    capabilities: lightCapabilities(light),
    meta: {
      manufacturer: device?.product_data?.manufacturer_name ?? 'Signify',
      ...(device?.product_data?.product_name ? { model: device.product_data.product_name } : {}),
      ...(room?.metadata?.name ? { room: room.metadata.name } : {}),
      ...(light.color_temperature ? { colorTempMirek: range ? [range.mirek_minimum, range.mirek_maximum] as [number, number] : DEFAULT_MIREK_RANGE } : {}),
    },
  }
}

export function toGroupDescriptor(group: HueGroupedLight, room: HueRoom | undefined): DeviceDescriptor {
  const caps: Capability[] = ['on_off']
  if (group.dimming) caps.push('brightness')
  return {
    id: `${HUE_PLUGIN_ID}:${group.id}`,
    pluginId: HUE_PLUGIN_ID,
    externalId: group.id,
    kind: 'light',
    name: room?.metadata?.name ?? `Groupe ${group.id.slice(0, 8)}`,
    capabilities: caps,
    meta: { manufacturer: 'Signify', model: 'Room', isGroup: true, ...(room?.metadata?.name ? { room: room.metadata.name } : {}) },
  }
}

/** Patch d'état depuis une ressource complète OU un fragment d'événement (tous les champs optionnels). */
export function toLightPatch(data: Partial<HueLight> | Partial<HueGroupedLight>): StatePatch<'light'> {
  const patch: StatePatch<'light'> = {}
  if (data.on) patch.on = data.on.on
  if (data.dimming) patch.brightness = Math.round(data.dimming.brightness)
  const ct = (data as Partial<HueLight>).color_temperature
  if (ct && ct.mirek !== null && ct.mirek !== undefined && ct.mirek_valid !== false) patch.colorTempMirek = ct.mirek
  const color = (data as Partial<HueLight>).color
  if (color?.xy) patch.color = { x: color.xy.x, y: color.xy.y }
  return patch
}

/**
 * Corps du PUT pour `light.set`. Règles Hue : brightness 0 interdit (→ off), mirek borné à la plage
 * de la lampe, `color` et `color_temperature` incompatibles dans une même requête (color prime).
 */
export function toPutBody(cmd: CommandOf<'light.set'>, descriptor: DeviceDescriptor, minDimLevel = 1): { body: HuePutBody; warnings: string[] } {
  const body: HuePutBody = {}
  const warnings: string[] = []
  if (cmd.on !== undefined) body.on = { on: cmd.on }
  if (cmd.brightness !== undefined) {
    if (cmd.brightness <= 0) body.on = { on: false }
    else {
      body.dimming = { brightness: Math.min(100, Math.max(minDimLevel, cmd.brightness)) }
      if (cmd.on === undefined) body.on = { on: true }
    }
  }
  if (cmd.color !== undefined && descriptor.capabilities.includes('color')) {
    body.color = { xy: { x: cmd.color.x, y: cmd.color.y } }
    if (cmd.colorTempMirek !== undefined) warnings.push('color and colorTempMirek both given: color wins')
  } else if (cmd.colorTempMirek !== undefined && descriptor.capabilities.includes('color_temp')) {
    const [min, max] = descriptor.meta.colorTempMirek ?? DEFAULT_MIREK_RANGE
    body.color_temperature = { mirek: Math.round(Math.min(max, Math.max(min, cmd.colorTempMirek))) }
  } else if (cmd.color !== undefined || cmd.colorTempMirek !== undefined) {
    warnings.push('color/colorTempMirek ignored: capability not supported by this light')
  }
  if (cmd.transitionMs !== undefined) body.dynamics = { duration: Math.round(cmd.transitionMs) }
  return { body, warnings }
}

/** Disponibilité des lights portées par chaque appareil Zigbee : `connected` ⇒ disponible. */
export function connectivityToAvailability(items: HueZigbeeConnectivity[], idx: HueIndex): Array<[lightId: string, available: boolean]> {
  const out: Array<[string, boolean]> = []
  for (const z of items) {
    const device = z.owner ? idx.devices.get(z.owner.rid) : undefined
    if (!device) continue
    for (const lightId of idx.lightsOfDevice.get(device.id) ?? []) out.push([lightId, z.status === 'connected'])
  }
  return out
}
