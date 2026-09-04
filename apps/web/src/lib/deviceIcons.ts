import {
  mdiBatteryCharging, mdiBrightness6, mdiCar, mdiCarElectric, mdiDevices, mdiEvStation, mdiFlash, mdiGauge, mdiHeatPump,
  mdiLightbulbOn, mdiLightbulbOutline, mdiRobotMower, mdiRobotVacuum, mdiSolarPower, mdiSpeaker, mdiSpeakerWireless,
  mdiThermometer, mdiWaterPercent, mdiWaves, mdiWindowShutter, mdiWindowShutterOpen, mdiFlaskOutline, mdiPulse,
} from '@mdi/js'
import type { DeviceDescriptor, DeviceKind, DeviceState, SensorClass } from '@kasbah/shared'

// Icônes (chemins SVG @mdi/js) par kind et état. Partagées par l'UI Vuetify et l'atlas de sprites 3D.

const SENSOR_ICONS: Record<SensorClass, string> = {
  temperature: mdiThermometer, humidity: mdiWaterPercent, power: mdiFlash, energy: mdiFlash, pressure: mdiGauge,
  flow: mdiWaves, illuminance: mdiBrightness6, ph: mdiFlaskOutline, battery: mdiBatteryCharging, generic: mdiPulse,
}

export const KIND_ICONS: Record<DeviceKind, string> = {
  light: mdiLightbulbOutline, cover: mdiWindowShutter, media_player: mdiSpeaker, climate: mdiHeatPump, vacuum: mdiRobotVacuum,
  mower: mdiRobotMower, sensor: mdiThermometer, energy: mdiSolarPower, ev_charger: mdiEvStation, vehicle: mdiCar,
}

export function deviceIcon(descriptor: DeviceDescriptor | undefined, state?: DeviceState): string {
  if (!descriptor) return mdiDevices
  switch (descriptor.kind) {
    case 'light': return state?.kind === 'light' && state.on ? mdiLightbulbOn : mdiLightbulbOutline
    case 'cover': return state?.kind === 'cover' && state.position > 50 ? mdiWindowShutterOpen : mdiWindowShutter
    case 'media_player': return state?.kind === 'media_player' && state.playback === 'playing' ? mdiSpeakerWireless : mdiSpeaker
    case 'sensor': return SENSOR_ICONS[descriptor.meta.sensor?.deviceClass ?? 'generic']
    case 'vehicle': return state?.kind === 'vehicle' && state.charging ? mdiCarElectric : mdiCar
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
