import type { DeviceDescriptor, DeviceKind, DeviceState, MediaPlayerClass, SensorClass } from '@kasbah/shared'
import { isMediaActive } from './deviceState'
import { isEnergySite } from './energy'
import type { IconName } from './strokeIcons'

// Icônes (jeu « trait », voir strokeIcons.ts) par kind et état, pour <v-icon> comme pour StrokeIcon.

const SENSOR_ICONS: Record<SensorClass, IconName> = {
  temperature: 'thermostat', humidity: 'droplet', power: 'bolt', energy: 'bolt', pressure: 'gauge',
  flow: 'waves', illuminance: 'sun', ph: 'flask', battery: 'battery', generic: 'sensor',
}

/** Un téléviseur et un écran connecté gardent la même icône en lecture : la couleur dit l'état. */
const MEDIA_ICONS: Record<MediaPlayerClass, IconName> = { speaker: 'speaker', tv: 'tv', display: 'tablet' }

export const KIND_ICONS: Record<DeviceKind, IconName> = {
  light: 'light', cover: 'shutter', media_player: 'speaker', climate: 'heatpump', vacuum: 'vacuum',
  mower: 'mower', sensor: 'thermostat', energy: 'solar', ev_charger: 'charger', vehicle: 'vehicle', camera: 'camera', weather: 'cloud', water: 'droplet',
}

/**
 * Catégorie d'un appareil telle que le rail la découpe (Lumières, Ouvrants, Caméras, Médias) : c'est
 * la teinte du disque d'icône de son marqueur 3D (`--cat-*` dans tokens.css). Les kinds sans vue
 * dédiée restent neutres.
 */
export type DeviceCategory = 'light' | 'cover' | 'camera' | 'media' | 'other'

const KIND_CATEGORY: Partial<Record<DeviceKind, DeviceCategory>> = { light: 'light', cover: 'cover', camera: 'camera', media_player: 'media' }

export function deviceCategory(kind: DeviceKind | undefined): DeviceCategory {
  return (kind && KIND_CATEGORY[kind]) ?? 'other'
}

/**
 * Catégories du filtre de la liste d'une pièce : les quatre teintes du rail, plus le chauffage
 * (thermostat, pompe à chaleur, sonde de température) qui sinon tomberait dans « Autre ».
 * L'ordre est celui des onglets.
 */
export type RoomFilterCat = 'light' | 'cover' | 'climate' | 'media' | 'camera' | 'other'
export const ROOM_FILTER_CATS: readonly RoomFilterCat[] = ['light', 'cover', 'climate', 'media', 'camera', 'other']

const KIND_FILTER: Partial<Record<DeviceKind, RoomFilterCat>> = {
  light: 'light', cover: 'cover', climate: 'climate', media_player: 'media', camera: 'camera',
}

export function roomFilterCategory(kind: DeviceKind | undefined, descriptor?: DeviceDescriptor): RoomFilterCat {
  const k = descriptor?.kind ?? kind
  if (k === 'sensor' && descriptor?.meta.sensor?.deviceClass === 'temperature') return 'climate'
  return (k && KIND_FILTER[k]) ?? 'other'
}

/** Catégories présentes dans une pièce, dans l'ordre des onglets — pas l'ordre d'apparition. */
export function presentRoomFilters(cats: Iterable<RoomFilterCat>): RoomFilterCat[] {
  const seen = new Set<RoomFilterCat>()
  for (const cat of cats) seen.add(cat)
  return ROOM_FILTER_CATS.filter((c) => seen.has(c))
}

/** Icônes du filtre de pièce : les mêmes que le rail, thermostat pour la température, `devices` pour Tout. */
export const ROOM_FILTER_ICONS: Record<'all' | RoomFilterCat, IconName> = {
  all: 'devices', light: 'light', cover: 'shutter', climate: 'thermostat', media: 'cast', camera: 'camera', other: 'dots',
}

export function deviceIcon(descriptor: DeviceDescriptor | undefined, state?: DeviceState): IconName {
  if (!descriptor) return 'devices'
  switch (descriptor.kind) {
    case 'camera': return descriptor.meta.camera?.deviceClass === 'doorbell' ? 'doorbell' : 'camera'
    case 'light': return state?.kind === 'light' && state.on ? 'lightOn' : 'light'
    case 'cover': return state?.kind === 'cover' && (state.position ?? 0) > 50 ? 'shutterOpen' : 'shutter'
    case 'media_player': {
      const cls = descriptor.meta.mediaPlayer?.deviceClass ?? 'speaker'
      return cls === 'speaker' && state?.kind === 'media_player' && state.playback === 'playing' ? 'speakerOn' : MEDIA_ICONS[cls]
    }
    case 'sensor': return SENSOR_ICONS[descriptor.meta.sensor?.deviceClass ?? 'generic']
    case 'vehicle': return state?.kind === 'vehicle' && state.charging ? 'charger' : 'vehicle'
    // une unité de stockage est un `energy` qui ne mesure pas le réseau (même règle que `strokeIcons`)
    case 'energy': return isEnergySite(descriptor) ? 'solar' : 'battery'
    default: return KIND_ICONS[descriptor.kind]
  }
}

/** Couleur sémantique (nom de token Vuetify) selon l'état. */
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
