import { mirekToRgb, rgbToHex, xyToRgb, type Capability, type CommandOf, type DeviceDescriptor, type PluginScene, type SceneActivation, type SceneGroupKind, type SceneRecall, type StatePatch } from '@kasbah/shared'
import type {
  HueDevice, HueGroupedLight, HueLight, HuePutBody, HueRef, HueRoom, HueScene, HueSceneCreateBody,
  HueSceneRecallBody, HueZigbeeConnectivity,
} from './types'

// PURE Hue ↔ Kasbah model mapping. No I/O: tested on fixtures.

export const HUE_PLUGIN_ID = 'hue'
const DEFAULT_MIREK_RANGE: [number, number] = [153, 500]
/** Hue value that stops the current effect. */
export const NO_EFFECT = 'no_effect'
/** A palette of fewer than 2 colors has nothing to animate. */
const MIN_PALETTE = 2
/** Preview swatches displayed (Hue palettes have up to 5). */
const MAX_SWATCHES = 6

export interface HueIndex {
  lights: Map<string, HueLight>
  devices: Map<string, HueDevice>
  rooms: Map<string, HueRoom>
  /** device rid → room */
  roomOfDevice: Map<string, HueRoom>
  /** service rid (light, zigbee_connectivity…) → device */
  deviceOfService: Map<string, HueDevice>
  /** device rid → ids of the lights it carries */
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
  if (lightEffects(light)) caps.push('effect')
  return caps
}

/** The model's effects, `no_effect` included (the bridge's order is kept), or nothing if it has none. */
export function lightEffects(light: HueLight): string[] | undefined {
  const values = light.effects_v2?.status?.effect_values ?? light.effects?.effect_values ?? light.effects?.status_values
  return values && values.length > 1 ? values : undefined
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
      ...(lightEffects(light) ? { effects: lightEffects(light) } : {}),
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

/** State patch from a full resource OR an event fragment (all fields optional). */
export function toLightPatch(data: Partial<HueLight> | Partial<HueGroupedLight>): StatePatch<'light'> {
  const patch: StatePatch<'light'> = {}
  if (data.on) patch.on = data.on.on
  if (data.dimming) patch.brightness = Math.round(data.dimming.brightness)
  const ct = (data as Partial<HueLight>).color_temperature
  if (ct && ct.mirek !== null && ct.mirek !== undefined && ct.mirek_valid !== false) patch.colorTempMirek = ct.mirek
  const color = (data as Partial<HueLight>).color
  if (color?.xy) patch.color = { x: color.xy.x, y: color.xy.y }
  const light = data as Partial<HueLight>
  const effect = light.effects_v2?.status?.effect ?? light.effects?.status
  if (effect) patch.effect = effect
  return patch
}

/**
 * PUT body for `light.set`. Hue rules: brightness 0 forbidden (→ off), mirek clamped to the light's
 * range, `color` and `color_temperature` incompatible in the same request (color wins).
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
  if (cmd.effect !== undefined) {
    if (descriptor.capabilities.includes('effect')) body.effects = { effect: cmd.effect }
    else warnings.push('effect ignored: capability not supported by this light')
  }
  // A running effect drives the color itself: we do not impose one on it in the same PUT.
  const effectTakesOver = body.effects !== undefined && cmd.effect !== NO_EFFECT
  if (effectTakesOver) {
    if (cmd.color !== undefined || cmd.colorTempMirek !== undefined) warnings.push('effect and color both given: effect wins')
  } else if (cmd.color !== undefined && descriptor.capabilities.includes('color')) {
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

/**
 * A scene's preview. The animated palette comes first (it is what you see cycling), otherwise the
 * actions' fixed values (faithful light by light), otherwise the palette of whites. Duplicates
 * removed: a scene of 3 lights at the same white must show ONE swatch, not three.
 */
export function sceneSwatches(scene: HueScene): string[] {
  const out: string[] = []
  const push = (hex: string) => { if (!out.includes(hex)) out.push(hex) }
  for (const p of scene.palette?.color ?? []) {
    if (p.color?.xy) push(rgbToHex(xyToRgb(p.color.xy.x, p.color.xy.y)))
  }
  if (out.length === 0) {
    for (const a of scene.actions) {
      const xy = a.action?.color?.xy
      const mirek = a.action?.color_temperature?.mirek
      if (xy) push(rgbToHex(xyToRgb(xy.x, xy.y)))
      else if (mirek !== null && mirek !== undefined) push(rgbToHex(mirekToRgb(mirek)))
    }
  }
  if (out.length === 0) {
    for (const p of scene.palette?.color_temperature ?? []) {
      const mirek = p.color_temperature?.mirek
      if (mirek !== null && mirek !== undefined) push(rgbToHex(mirekToRgb(mirek)))
    }
  }
  return out.slice(0, MAX_SWATCHES)
}

export function toSceneDescriptor(scene: HueScene, group?: { name: string; kind: SceneGroupKind }): PluginScene {
  return {
    id: `${HUE_PLUGIN_ID}:${scene.id}`,
    pluginId: HUE_PLUGIN_ID,
    externalId: scene.id,
    name: scene.metadata?.name ?? `Scène ${scene.id.slice(0, 8)}`,
    ...(group ? { group } : {}),
    dynamic: (scene.palette?.color?.length ?? 0) >= MIN_PALETTE,
    autoDynamic: scene.auto_dynamic === true,
    swatches: sceneSwatches(scene),
  }
}

/** The bridge's `status.active` → Kasbah activation (anything unknown counts as `inactive`). */
export function sceneStatusToActive(scene: Pick<HueScene, 'status'>): SceneActivation {
  switch (scene.status?.active) {
    case 'dynamic_palette': return 'dynamic'
    case 'static': return 'static'
    default: return 'inactive'
  }
}

/** Recall body. `off` has none: it switches off through the group (cf. `index.ts`). */
export function toSceneRecallBody(recall: SceneRecall): HueSceneRecallBody {
  return {
    recall: {
      action: recall.mode === 'dynamic' ? 'dynamic_palette' : 'static',
      ...(recall.brightness !== undefined ? { dimming: { brightness: recall.brightness } } : {}),
      ...(recall.transitionMs !== undefined ? { duration: Math.round(recall.transitionMs) } : {}),
    },
  }
}

/** Lights targeted by a scene's fixed actions (fallback when the group has no grouped_light). */
export function sceneTargetLights(scene: HueScene): string[] {
  const out: string[] = []
  for (const a of scene.actions) {
    if (a.target?.rtype === 'light' && !out.includes(a.target.rid)) out.push(a.target.rid)
  }
  return out
}

/**
 * Creation body of a copied light scene. The **palette is independent of the group**: it is taken
 * over as is, it is what carries the animation. The `actions`, for their part, target specific
 * lights: the source's are spread over the room's lights (looping if the room has more), falling
 * back on what each light can do — a light without color gets its temperature, a light with
 * nothing gets just on and brightness.
 */
export function toCreateSceneBody(source: HueScene, group: HueRef, lights: HueLight[]): HueSceneCreateBody {
  const sourceActions = source.actions.filter((a) => a.action)
  const actions: HueSceneCreateBody['actions'] = lights.map((light, i) => {
    const from = sourceActions.length ? sourceActions[i % sourceActions.length]!.action! : undefined
    const action: Record<string, unknown> = { on: { on: from?.on?.on ?? true } }
    const brightness = from?.dimming?.brightness
    if (light.dimming && brightness !== undefined) {
      action.dimming = { brightness: Math.min(100, Math.max(light.dimming.min_dim_level ?? 1, brightness)) }
    }
    const xy = from?.color?.xy
    const mirek = from?.color_temperature?.mirek
    if (xy && light.color) action.color = { xy: { x: xy.x, y: xy.y } }
    else if (mirek !== null && mirek !== undefined && light.color_temperature) {
      const range = light.color_temperature.mirek_schema
      const [min, max] = range ? [range.mirek_minimum, range.mirek_maximum] : DEFAULT_MIREK_RANGE
      action.color_temperature = { mirek: Math.round(Math.min(max, Math.max(min, mirek))) }
    }
    return { target: { rid: light.id, rtype: 'light' }, action }
  })
  return {
    metadata: { name: source.metadata?.name ?? 'Ambiance' },
    group,
    actions,
    ...(source.palette ? { palette: toCreatePalette(source.palette) } : {}),
  }
}

/**
 * Copyable palette. The bridge REFUSES a palette carrying both `effects` and `effects_v2`, **even
 * empty** ("Both effects and effects_v2 palettes are mutually exclusive", verified): yet that is
 * exactly what it returns when a scene is read. So only the non-empty effects list is kept, and
 * neither of them if both are empty.
 */
export function toCreatePalette(palette: NonNullable<HueScene['palette']>): Record<string, unknown> {
  const effects = palette.effects_v2.length ? { effects_v2: palette.effects_v2 }
    : palette.effects.length ? { effects: palette.effects }
    : {}
  return {
    color: palette.color,
    dimming: palette.dimming,
    color_temperature: palette.color_temperature,
    ...effects,
  }
}

/** Availability of the lights carried by each Zigbee device: `connected` ⇒ available. */
export function connectivityToAvailability(items: HueZigbeeConnectivity[], idx: HueIndex): Array<[lightId: string, available: boolean]> {
  const out: Array<[string, boolean]> = []
  for (const z of items) {
    const device = z.owner ? idx.devices.get(z.owner.rid) : undefined
    if (!device) continue
    for (const lightId of idx.lightsOfDevice.get(device.id) ?? []) out.push([lightId, z.status === 'connected'])
  }
  return out
}
