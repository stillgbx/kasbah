// Vocabulaire commun à tous les plugins et à l'UI : un appareil a exactement un `kind`
// (forme de l'état + famille de commandes) et un sous-ensemble de `capabilities`
// (traits fins qui décident des contrôles affichés). Indépendant de tout fabricant.

export const DEVICE_KINDS = [
  'light', 'cover', 'media_player', 'climate', 'vacuum', 'mower',
  'sensor', 'energy', 'ev_charger', 'vehicle', 'camera',
] as const
export type DeviceKind = (typeof DEVICE_KINDS)[number]

export const CAPABILITIES = [
  // light
  'on_off', 'brightness', 'color_temp', 'color', 'effect',
  // cover — `open_close` = ouvrir/fermer en tout ou rien (radio RTS unidirectionnelle),
  // `position` = position arbitraire connue et réglable (io-homecontrol, moteur Hue…),
  // `preset` = position favorite mémorisée DANS le moteur, qu'on ne peut que rappeler
  // (le « my » de Somfy) ; sa valeur n'est pas toujours lisible, voir `presetPosition`.
  // `preset_set` = cette mémoire est RÉINSCRIPTIBLE — trois niveaux distincts, et un même
  // appareil peut en avoir un sans les suivants (un RTS rappelle sans lire ni écrire)
  'open_close', 'position', 'tilt', 'stop', 'preset', 'preset_set',
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
  // camera — `live_stream` : un flux vidéo à la demande (protocoles dans `meta.camera.protocols`),
  // `chime` : l'appareil sonne (sonnette). Pas de `on_off` : l'API Google Nest ne permet pas
  // d'éteindre une caméra, et déclarer une capacité qu'aucune commande ne peut honorer serait mentir.
  'live_stream', 'chime',
] as const
export type Capability = (typeof CAPABILITIES)[number]

/** Capacités légales par kind — un descripteur qui en déclare d'autres est rejeté. */
export const KIND_CAPABILITIES: Record<DeviceKind, readonly Capability[]> = {
  light: ['on_off', 'brightness', 'color_temp', 'color', 'effect'],
  cover: ['open_close', 'position', 'tilt', 'stop', 'preset', 'preset_set'],
  media_player: ['playback', 'volume', 'mute', 'now_playing', 'track_skip'],
  climate: ['hvac_mode', 'target_temp', 'current_temp', 'humidity', 'fan_mode'],
  vacuum: ['clean', 'dock', 'battery', 'locate'],
  mower: ['mow', 'park', 'battery', 'schedule'],
  sensor: ['measure'],
  energy: ['production', 'consumption', 'grid', 'storage'],
  ev_charger: ['charge_control', 'charge_current'],
  vehicle: ['soc', 'range', 'location', 'lock', 'charging', 'charge_limit', 'climate_precondition'],
  camera: ['live_stream', 'chime'],
}

export const CLIMATE_MODES = ['off', 'heat', 'cool', 'auto', 'eco', 'fan_only'] as const
export type ClimateMode = (typeof CLIMATE_MODES)[number]

/**
 * Nature d'un ouvrant. Même rôle que `SENSOR_CLASSES` pour un capteur : le kind dit la FORME de
 * l'état et des commandes, la classe dit ce que la chose EST — donc comment la nommer et l'annoncer.
 * Un volet s'ouvre et se ferme, un store se remonte et se baisse : c'est la même commande
 * `cover.open`, pas le même mot dans l'interface.
 */
export const COVER_CLASSES = [
  'shutter', 'awning', 'blind', 'curtain', 'gate', 'garage', 'window',
] as const
export type CoverClass = (typeof COVER_CLASSES)[number]

/**
 * Nature d'une caméra : une sonnette est une caméra qui sonne, un écran (Nest Hub Max) une caméra
 * posée sur un meuble. Même commande de flux pour les trois, pas le même mot ni la même icône.
 */
export const CAMERA_CLASSES = ['camera', 'doorbell', 'display'] as const
export type CameraClass = (typeof CAMERA_CLASSES)[number]

/** Protocoles de flux vidéo qu'une caméra sait servir (décide de la façon de l'afficher). */
export const STREAM_PROTOCOLS = ['webrtc', 'rtsp'] as const
export type StreamProtocol = (typeof STREAM_PROTOCOLS)[number]

export const SENSOR_CLASSES = [
  'temperature', 'humidity', 'power', 'energy', 'pressure', 'flow', 'illuminance', 'ph', 'battery', 'generic',
] as const
export type SensorClass = (typeof SENSOR_CLASSES)[number]
