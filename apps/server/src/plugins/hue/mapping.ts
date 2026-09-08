import { mirekToRgb, rgbToHex, xyToRgb, type Capability, type CommandOf, type DeviceDescriptor, type PluginScene, type SceneActivation, type SceneGroupKind, type SceneRecall, type StatePatch } from '@kasbah/shared'
import type {
  HueDevice, HueGroupedLight, HueLight, HuePutBody, HueRef, HueRoom, HueScene, HueSceneCreateBody,
  HueSceneRecallBody, HueZigbeeConnectivity,
} from './types'

// Mappage PUR Hue ↔ modèle Kasbah. Aucune I/O : testé sur fixtures.

export const HUE_PLUGIN_ID = 'hue'
const DEFAULT_MIREK_RANGE: [number, number] = [153, 500]
/** Valeur Hue qui arrête l'effet en cours. */
export const NO_EFFECT = 'no_effect'
/** Une palette de moins de 2 couleurs n'a rien à animer. */
const MIN_PALETTE = 2
/** Pastilles d'aperçu affichées (les palettes Hue en comptent jusqu'à 5). */
const MAX_SWATCHES = 6

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
  if (lightEffects(light)) caps.push('effect')
  return caps
}

/** Effets du modèle, `no_effect` compris (l'ordre du pont est conservé), ou rien s'il n'en a pas. */
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

/** Patch d'état depuis une ressource complète OU un fragment d'événement (tous les champs optionnels). */
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
  if (cmd.effect !== undefined) {
    if (descriptor.capabilities.includes('effect')) body.effects = { effect: cmd.effect }
    else warnings.push('effect ignored: capability not supported by this light')
  }
  // Un effet en cours pilote lui-même la couleur : on ne lui en impose pas une dans le même PUT.
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
 * Aperçu d'une scène. La palette animée passe en premier (c'est ce qu'on voit tourner), sinon les
 * valeurs fixes des actions (fidèles lampe par lampe), sinon la palette de blancs. Doublons ôtés :
 * une scène de 3 lampes au même blanc doit montrer UNE pastille, pas trois.
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

/** `status.active` du pont → activation Kasbah (tout ce qui n'est pas connu vaut `inactive`). */
export function sceneStatusToActive(scene: Pick<HueScene, 'status'>): SceneActivation {
  switch (scene.status?.active) {
    case 'dynamic_palette': return 'dynamic'
    case 'static': return 'static'
    default: return 'inactive'
  }
}

/** Corps du rappel. `off` n'en a pas : il s'éteint par le groupe (cf. `index.ts`). */
export function toSceneRecallBody(recall: SceneRecall): HueSceneRecallBody {
  return {
    recall: {
      action: recall.mode === 'dynamic' ? 'dynamic_palette' : 'static',
      ...(recall.brightness !== undefined ? { dimming: { brightness: recall.brightness } } : {}),
      ...(recall.transitionMs !== undefined ? { duration: Math.round(recall.transitionMs) } : {}),
    },
  }
}

/** Lampes visées par les actions fixes d'une scène (repli quand le groupe n'a pas de grouped_light). */
export function sceneTargetLights(scene: HueScene): string[] {
  const out: string[] = []
  for (const a of scene.actions) {
    if (a.target?.rtype === 'light' && !out.includes(a.target.rid)) out.push(a.target.rid)
  }
  return out
}

/**
 * Corps de création d'une ambiance recopiée. La **palette est indépendante du groupe** : on la
 * reprend telle quelle, c'est elle qui porte l'animation. Les `actions`, elles, visent des lampes
 * précises : on distribue celles de la source sur les lampes de la pièce (en boucle si la pièce en
 * a plus), en retombant sur ce que chaque lampe sait faire — une lampe sans couleur reçoit sa
 * température, une lampe sans rien reçoit juste allumage et intensité.
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
 * Palette recopiable. Le pont REFUSE une palette qui porte à la fois `effects` et `effects_v2`,
 * **même vides** (« Both effects and effects_v2 palettes are mutually exclusive », vérifié) : or
 * c'est exactement ce qu'il renvoie quand on lit une scène. On ne garde donc que la liste d'effets
 * non vide, et aucune des deux si elles le sont.
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
