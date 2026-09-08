// Vocabulaire commun à tous les plugins et à l'UI : un appareil a exactement un `kind`
// (forme de l'état + famille de commandes) et un sous-ensemble de `capabilities`
// (traits fins qui décident des contrôles affichés). Indépendant de tout fabricant.

export const DEVICE_KINDS = [
  'light', 'cover', 'media_player', 'climate', 'vacuum', 'mower',
  'sensor', 'energy', 'ev_charger', 'vehicle',
] as const
export type DeviceKind = (typeof DEVICE_KINDS)[number]

export const CAPABILITIES = [
  // light
  'on_off', 'brightness', 'color_temp', 'color', 'effect',
  // cover
  'position', 'tilt', 'stop',
  // media_player
  'playback', 'volume', 'mute', 'now_playing', 'track_skip',
  // climate
  'hvac_mode', 'target_temp', 'current_temp', 'humidity', 'fan_mode',
  // vacuum / mower
  'clean', 'dock', 'battery', 'locate', 'mow', 'park', 'schedule',
  // sensor
  'measure',
  // energy
  'production', 'consumption', 'grid', 'storage',
  // ev_charger
  'charge_control', 'charge_current',
  // vehicle
  'soc', 'range', 'location', 'lock', 'charging', 'charge_limit', 'climate_precondition',
] as const
export type Capability = (typeof CAPABILITIES)[number]

/** Capacités légales par kind — un descripteur qui en déclare d'autres est rejeté. */
export const KIND_CAPABILITIES: Record<DeviceKind, readonly Capability[]> = {
  light: ['on_off', 'brightness', 'color_temp', 'color', 'effect'],
  cover: ['position', 'tilt', 'stop'],
  media_player: ['playback', 'volume', 'mute', 'now_playing', 'track_skip'],
  climate: ['hvac_mode', 'target_temp', 'current_temp', 'humidity', 'fan_mode'],
  vacuum: ['clean', 'dock', 'battery', 'locate'],
  mower: ['mow', 'park', 'battery', 'schedule'],
  sensor: ['measure'],
  energy: ['production', 'consumption', 'grid', 'storage'],
  ev_charger: ['charge_control', 'charge_current'],
  vehicle: ['soc', 'range', 'location', 'lock', 'charging', 'charge_limit', 'climate_precondition'],
}

export const CLIMATE_MODES = ['off', 'heat', 'cool', 'auto', 'eco', 'fan_only'] as const
export type ClimateMode = (typeof CLIMATE_MODES)[number]

export const SENSOR_CLASSES = [
  'temperature', 'humidity', 'power', 'energy', 'pressure', 'flow', 'illuminance', 'ph', 'battery', 'generic',
] as const
export type SensorClass = (typeof SENSOR_CLASSES)[number]
