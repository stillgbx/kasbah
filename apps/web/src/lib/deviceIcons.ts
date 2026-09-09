import type { DeviceDescriptor, DeviceKind, DeviceState, SensorClass } from '@kasbah/shared'
import type { IconName } from './strokeIcons'

// Icônes (jeu « trait », voir strokeIcons.ts) par kind et état, pour <v-icon> comme pour StrokeIcon.

const SENSOR_ICONS: Record<SensorClass, IconName> = {
  temperature: 'thermostat', humidity: 'droplet', power: 'bolt', energy: 'bolt', pressure: 'gauge',
  flow: 'waves', illuminance: 'sun', ph: 'flask', battery: 'battery', generic: 'sensor',
}

export const KIND_ICONS: Record<DeviceKind, IconName> = {
  light: 'light', cover: 'shutter', media_player: 'speaker', climate: 'heatpump', vacuum: 'vacuum',
  mower: 'mower', sensor: 'thermostat', energy: 'solar', ev_charger: 'charger', vehicle: 'vehicle', camera: 'camera',
}

export function deviceIcon(descriptor: DeviceDescriptor | undefined, state?: DeviceState): IconName {
  if (!descriptor) return 'devices'
  switch (descriptor.kind) {
    case 'camera': return descriptor.meta.camera?.deviceClass === 'doorbell' ? 'doorbell' : 'camera'
    case 'light': return state?.kind === 'light' && state.on ? 'lightOn' : 'light'
    case 'cover': return state?.kind === 'cover' && (state.position ?? 0) > 50 ? 'shutterOpen' : 'shutter'
    case 'media_player': return state?.kind === 'media_player' && state.playback === 'playing' ? 'speakerOn' : 'speaker'
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
    case 'media_player': return state.playback === 'playing' ? 'primary' : undefined
    case 'climate': return state.action === 'heating' ? 'error' : state.action === 'cooling' ? 'info' : undefined
    case 'vacuum': return state.activity === 'cleaning' ? 'primary' : state.activity === 'error' ? 'error' : undefined
    case 'mower': return state.activity === 'mowing' ? 'success' : state.activity === 'error' ? 'error' : undefined
    case 'ev_charger': return state.status === 'charging' ? 'success' : state.status === 'error' ? 'error' : undefined
    case 'vehicle': return state.charging ? 'success' : undefined
    case 'energy': return state.productionW > state.consumptionW ? 'success' : undefined
    default: return undefined
  }
}
