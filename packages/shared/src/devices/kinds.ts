// Vocabulaire commun à tous les plugins et à l'UI : un appareil a exactement un `kind`
// (forme de l'état + famille de commandes) et un sous-ensemble de `capabilities`
// (traits fins qui décident des contrôles affichés). Indépendant de tout fabricant.

export const DEVICE_KINDS = [
  'light', 'cover', 'media_player', 'climate', 'vacuum', 'mower',
  'sensor', 'energy', 'ev_charger', 'vehicle', 'camera', 'weather', 'water',
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
  'playback', 'volume', 'mute', 'now_playing', 'track_skip', 'seek',
  // climate
  'hvac_mode', 'target_temp', 'current_temp', 'humidity', 'fan_mode',
  // vacuum / mower — `journal` : l'appareil tient un journal de ce qui lui arrive (erreurs,
  // avertissements), servi à la demande par `GET /api/devices/:id/journal` ; sans lui, rien à lire
  'clean', 'dock', 'battery', 'locate', 'mow', 'park', 'schedule', 'journal',
  // sensor
  'measure',
  // energy
  'production', 'consumption', 'grid', 'storage',
  // ev_charger
  'charge_control', 'charge_current',
  // vehicle — `charge_power` est une capacité de LECTURE, comme `soc` : le véhicule DIT sa puissance
  // de charge instantanée (Tesla). Sans elle, personne ne la connaît (la Renault 5 E-Tech, vérifié
  // voiture en charge) et l'UI l'estime, ce qui lui demande une capacité de batterie saisie à la main.
  'soc', 'range', 'location', 'lock', 'charging', 'charge_limit', 'charge_power', 'climate_precondition',
  // camera — `live_stream` : un flux vidéo à la demande (protocoles dans `meta.camera.protocols`),
  // `chime` : l'appareil sonne (sonnette). Pas de `on_off` : l'API Google Nest ne permet pas
  // d'éteindre une caméra, et déclarer une capacité qu'aucune commande ne peut honorer serait mentir.
  'live_stream', 'chime',
  // weather — l'ACTUEL est implicite (tout appareil météo le publie) ; ces trois-là disent ce que la
  // vue peut demander en plus : des prévisions (`GET /api/devices/:id/forecast`), la qualité de
  // l'air, les pollens. Un fournisseur qui n'a pas les pollens ne déclare pas `pollen`, et la vue
  // n'affiche pas une section vide. Aucune commande : la météo se lit, elle ne se pilote pas.
  'forecast', 'air_quality', 'pollen',
  // water — ce qu'une station de traitement SAIT dire, et qui change d'un modèle à l'autre dans une
  // même gamme (toutes n'ont pas de lampe UVc) : sans la capacité, la carte omet la section au lieu
  // d'en afficher une vide. Aucune commande — les réglages restent sur l'écran de la station, une
  // fausse manœuvre à distance sur de l'eau potable coûterait plus cher que le confort gagné.
  'consumables', 'water_flow', 'water_usage', 'uv_lamp',
] as const
export type Capability = (typeof CAPABILITIES)[number]

/** Capacités légales par kind — un descripteur qui en déclare d'autres est rejeté. */
export const KIND_CAPABILITIES: Record<DeviceKind, readonly Capability[]> = {
  light: ['on_off', 'brightness', 'color_temp', 'color', 'effect'],
  cover: ['open_close', 'position', 'tilt', 'stop', 'preset', 'preset_set'],
  media_player: ['playback', 'volume', 'mute', 'now_playing', 'track_skip', 'seek'],
  climate: ['hvac_mode', 'target_temp', 'current_temp', 'humidity', 'fan_mode'],
  vacuum: ['clean', 'dock', 'battery', 'locate'],
  mower: ['mow', 'park', 'battery', 'schedule', 'journal'],
  sensor: ['measure'],
  energy: ['production', 'consumption', 'grid', 'storage'],
  ev_charger: ['charge_control', 'charge_current'],
  vehicle: ['soc', 'range', 'location', 'lock', 'charging', 'charge_limit', 'charge_power', 'climate_precondition'],
  camera: ['live_stream', 'chime'],
  weather: ['forecast', 'air_quality', 'pollen'],
  water: ['consumables', 'water_flow', 'water_usage', 'uv_lamp'],
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

/**
 * Nature d'un lecteur (kind `media_player`) : enceinte (audio seul), `tv` (téléviseur ou boîtier
 * branché sur un téléviseur : Chromecast, TV Android), `display` (écran connecté : Nest Hub). Même
 * contrat de commandes ; ne décide que l'icône et le marqueur 3D.
 */
export const MEDIA_PLAYER_CLASSES = ['speaker', 'tv', 'display'] as const
export type MediaPlayerClass = (typeof MEDIA_PLAYER_CLASSES)[number]

/**
 * Aspect de la peinture d'une carrosserie, dans le vocabulaire que le fabricant emploie lui-même :
 * l'écran de bord d'une Tesla propose « Unie / Métallique / Mate ». Ce n'est pas une coquetterie —
 * c'est ce qui décide si la voiture renvoie le ciel ou l'absorbe, et l'écart se voit au premier
 * coup d'œil dans la scène.
 */
export const VEHICLE_FINISHES = ['solid', 'metallic', 'matte'] as const
export type VehicleFinish = (typeof VEHICLE_FINISHES)[number]

/** Protocoles de flux vidéo qu'une caméra sait servir (décide de la façon de l'afficher). */
export const STREAM_PROTOCOLS = ['webrtc', 'rtsp'] as const
export type StreamProtocol = (typeof STREAM_PROTOCOLS)[number]

export const SENSOR_CLASSES = [
  'temperature', 'humidity', 'power', 'energy', 'pressure', 'flow', 'illuminance', 'ph', 'battery', 'generic',
] as const
export type SensorClass = (typeof SENSOR_CLASSES)[number]

/**
 * Ce qu'il fait, en un mot : la condition RÉSUMÉE d'un appareil `weather`, indépendante du
 * fournisseur (Open-Meteo parle en codes WMO, Google en libellés ; le plugin traduit). C'est ce
 * que le widget montre en icône, et ce que la scène 3D lit pour pleuvoir ou neiger. `sleet` =
 * pluie et neige mêlées, ou grésil ; `fog` couvre aussi la brume.
 */
export const WEATHER_CONDITIONS = [
  'clear', 'partly_cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'sleet', 'thunderstorm',
] as const
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number]

/** Niveaux de l'indice de qualité de l'air EUROPÉEN (EAQI, six paliers), tels que le fournisseur les nomme. */
export const AQI_LEVELS = ['good', 'fair', 'moderate', 'poor', 'very_poor', 'extremely_poor'] as const
export type AqiLevel = (typeof AQI_LEVELS)[number]

/** Palier d'un indice européen : paliers de 20 jusqu'à 100, au-delà c'est « extrêmement mauvais ». */
export function aqiLevelOf(aqi: number): AqiLevel {
  return AQI_LEVELS[Math.min(5, Math.max(0, Math.floor(aqi / 20)))]!
}

/** Pollens suivis en Europe (CAMS) : aulne, bouleau, graminées, armoise, olivier, ambroisie. */
export const POLLEN_TYPES = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'] as const
export type PollenType = (typeof POLLEN_TYPES)[number]
