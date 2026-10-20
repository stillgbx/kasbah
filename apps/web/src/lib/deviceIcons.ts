import type { DeviceDescriptor, DeviceKind, DeviceState, MediaPlayerClass, SensorClass } from '@kasbah/shared'
import { isMediaActive } from './deviceState'
import { isEnergySite } from './energy'
import type { IconName } from './strokeIcons'

// Icons ("stroke" set, see strokeIcons.ts) by kind and state, for <v-icon> as well as for StrokeIcon.

const SENSOR_ICONS: Record<SensorClass, IconName> = {
  temperature: 'thermostat', humidity: 'droplet', power: 'bolt', energy: 'bolt', pressure: 'gauge',
  flow: 'waves', illuminance: 'sun', ph: 'flask', battery: 'battery', generic: 'sensor',
}

/** A TV and a connected screen keep the same icon when playing: the color says the state. */
const MEDIA_ICONS: Record<MediaPlayerClass, IconName> = { speaker: 'speaker', tv: 'tv', display: 'tablet' }

export const KIND_ICONS: Record<DeviceKind, IconName> = {
  light: 'light', cover: 'shutter', media_player: 'speaker', climate: 'heatpump', vacuum: 'vacuum',
  mower: 'mower', sensor: 'thermostat', energy: 'solar', ev_charger: 'charger', vehicle: 'vehicle', camera: 'camera', weather: 'cloud', water: 'droplet',
  pet_feeder: 'feeder', pet_fountain: 'fountain', fan: 'wind',
}

/**
 * Category of a device as the rail cuts it up (Lights, Covers, Cameras, Media): it is
 * the tint of its 3D marker's icon disc (`--cat-*` in tokens.css). Kinds without a dedicated
 * view stay neutral.
 */
export type DeviceCategory = 'light' | 'cover' | 'camera' | 'media' | 'other'

const KIND_CATEGORY: Partial<Record<DeviceKind, DeviceCategory>> = { light: 'light', fan: 'light', cover: 'cover', camera: 'camera', media_player: 'media' }

export function deviceCategory(kind: DeviceKind | undefined): DeviceCategory {
  return (kind && KIND_CATEGORY[kind]) ?? 'other'
}

/**
 * Categories of a room's list filter: the rail's four tints, plus heating
 * (thermostat, heat pump, temperature probe) which would otherwise fall into "Other".
 * The order is that of the tabs.
 */
export type RoomFilterCat = 'light' | 'cover' | 'climate' | 'media' | 'camera' | 'other'
export const ROOM_FILTER_CATS: readonly RoomFilterCat[] = ['light', 'cover', 'climate', 'media', 'camera', 'other']

const KIND_FILTER: Partial<Record<DeviceKind, RoomFilterCat>> = {
  light: 'light', fan: 'light', cover: 'cover', climate: 'climate', media_player: 'media', camera: 'camera',
}

export function roomFilterCategory(kind: DeviceKind | undefined, descriptor?: DeviceDescriptor): RoomFilterCat {
  const k = descriptor?.kind ?? kind
  if (k === 'sensor' && descriptor?.meta.sensor?.deviceClass === 'temperature') return 'climate'
  return (k && KIND_FILTER[k]) ?? 'other'
}

/** Categories present in a room, in tab order — not in order of appearance. */
export function presentRoomFilters(cats: Iterable<RoomFilterCat>): RoomFilterCat[] {
  const seen = new Set<RoomFilterCat>()
  for (const cat of cats) seen.add(cat)
  return ROOM_FILTER_CATS.filter((c) => seen.has(c))
}

/** Icons of the room filter: the same as the rail, thermostat for temperature, `devices` for All. */
export const ROOM_FILTER_ICONS: Record<'all' | RoomFilterCat, IconName> = {
  all: 'devices', light: 'light', cover: 'shutter', climate: 'thermostat', media: 'cast', camera: 'camera', other: 'dots',
}

export function deviceIcon(
  descriptor: DeviceDescriptor | undefined,
  state?: DeviceState,
  opts?: { linkedFan?: boolean },
): IconName {
  if (!descriptor) return 'devices'
  switch (descriptor.kind) {
    case 'camera': return descriptor.meta.camera?.deviceClass === 'doorbell' ? 'doorbell' : 'camera'
    case 'light': {
      if (opts?.linkedFan) return state?.kind === 'light' && state.on ? 'lightFanOn' : 'lightFan'
      return state?.kind === 'light' && state.on ? 'lightOn' : 'light'
    }
    case 'cover': return state?.kind === 'cover' && (state.position ?? 0) > 50 ? 'shutterOpen' : 'shutter'
    case 'media_player': {
      const cls = descriptor.meta.mediaPlayer?.deviceClass ?? 'speaker'
      return cls === 'speaker' && state?.kind === 'media_player' && state.playback === 'playing' ? 'speakerOn' : MEDIA_ICONS[cls]
    }
    case 'sensor': return SENSOR_ICONS[descriptor.meta.sensor?.deviceClass ?? 'generic']
    case 'vehicle': return state?.kind === 'vehicle' && state.charging ? 'charger' : 'vehicle'
    // a storage unit is an `energy` that does not measure the grid (same rule as `strokeIcons`)
    case 'energy': return isEnergySite(descriptor) ? 'solar' : 'battery'
    default: return KIND_ICONS[descriptor.kind]
  }
}

/** Semantic color (Vuetify token name) by state. */
export function deviceColor(state?: DeviceState): string | undefined {
  if (!state) return undefined
  if (!state.available) return 'on-surface-variant'
  switch (state.kind) {
    case 'light': return state.on ? 'warning' : undefined
    case 'media_player': return isMediaActive(state) ? 'primary' : undefined
    case 'climate': return state.action === 'heating' ? 'error' : state.action === 'cooling' ? 'info' : undefined
    case 'vacuum': return state.activity === 'cleaning' ? 'primary' : state.activity === 'error' ? 'error' : undefined
    case 'mower': return state.activity === 'mowing' ? 'success' : state.activity === 'error' ? 'error' : undefined
    case 'ev_charger': return state.status === 'charging' ? 'success' : state.status === 'error' ? 'error' : undefined
    case 'vehicle': return state.charging ? 'success' : undefined
    case 'energy': return state.productionW > state.consumptionW ? 'success' : undefined
    default: return undefined
  }
}
