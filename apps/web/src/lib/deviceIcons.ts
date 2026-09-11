import type { DeviceDescriptor, DeviceKind, DeviceState, MediaPlayerClass, SensorClass } from '@kasbah/shared'
import { isMediaActive } from './deviceState'
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
  mower: 'mower', sensor: 'thermostat', energy: 'solar', ev_charger: 'charger', vehicle: 'vehicle', camera: 'camera',
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
