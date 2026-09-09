// Réponses de l'API Smart Device Management. Appareils RELEVÉS sur le compte réel le 2026-09-09 via
// `GET /api/plugins/nest/devices/raw` (10 appareils : 8 caméras, 1 sonnette, 1 thermostat), puis
// anonymisés : UUID du projet, ids d'appareils, de structure et de pièces remplacés ; noms de pièces
// et noms personnalisés conservés tels quels. La forme est celle de Google, bizarreries comprises :
//  - `Info.customName` est VIDE sur 7 appareils sur 10 (l'appli Google Home affiche alors
//    « <pièce> <type> ») ; seuls la sonnette et deux caméras ont un nom ;
//  - `assignee` (non documenté dans ce qu'on lit) double `parentRelations[0].parent` ;
//  - TOUT le parc est en RTSP 640×480 H264/AAC (caméras et sonnette de 1re génération), avec
//    `CameraImage` + `CameraEventImage` — aucun `WEB_RTC` ni `CameraClipPreview`. La caméra WebRTC
//    ci-dessous est SYNTHÉTIQUE (d'après la doc), gardée pour exercer le mappage des protocoles.

const PROJECT = 'enterprises/PROJECT'
const STRUCT = `${PROJECT}/structures/STRUCT1`

const rtspLiveStream = {
  maxVideoResolution: { width: 640, height: 480 }, videoCodecs: ['H264'], audioCodecs: ['AAC'], supportedProtocols: ['RTSP'],
}
const legacyCameraTraits = {
  'sdm.devices.traits.CameraLiveStream': rtspLiveStream,
  'sdm.devices.traits.CameraImage': { maxImageResolution: { width: 1920, height: 1200 } },
  'sdm.devices.traits.CameraPerson': {},
  'sdm.devices.traits.CameraSound': {},
  'sdm.devices.traits.CameraMotion': {},
  'sdm.devices.traits.CameraEventImage': {},
}

/** Sonnette filaire 1re génération (Nest Hello) : nom personnalisé, RTSP, `DoorbellChime`. */
export const DOORBELL = {
  name: `${PROJECT}/devices/DEVICE2`,
  type: 'sdm.devices.types.DOORBELL',
  assignee: `${STRUCT}/rooms/ROOM10`,
  traits: {
    'sdm.devices.traits.Info': { customName: "Porte d'entrée" },
    ...legacyCameraTraits,
    'sdm.devices.traits.DoorbellChime': {},
  },
  parentRelations: [{ parent: `${STRUCT}/rooms/ROOM10`, displayName: 'Entrée' }],
}

/** Caméra 1re génération SANS nom personnalisé : le cas majoritaire du parc réel. */
export const UNNAMED_CAMERA = {
  name: `${PROJECT}/devices/DEVICE8`,
  type: 'sdm.devices.types.CAMERA',
  assignee: `${STRUCT}/rooms/ROOM3`,
  traits: {
    'sdm.devices.traits.Info': { customName: '' },
    ...legacyCameraTraits,
  },
  parentRelations: [{ parent: `${STRUCT}/rooms/ROOM3`, displayName: 'Garage' }],
}

/** Caméra 1re génération avec un nom personnalisé. */
export const NAMED_CAMERA = {
  name: `${PROJECT}/devices/DEVICE5`,
  type: 'sdm.devices.types.CAMERA',
  assignee: `${STRUCT}/rooms/ROOM7`,
  traits: {
    'sdm.devices.traits.Info': { customName: 'Caméra Salon' },
    ...legacyCameraTraits,
  },
  parentRelations: [{ parent: `${STRUCT}/rooms/ROOM7`, displayName: 'Salon' }],
}

/** SYNTHÉTIQUE (doc Google, pas relevée) : caméra à batterie, WebRTC, aperçu de clip. */
export const WEBRTC_CAMERA = {
  name: `${PROJECT}/devices/SYNTHETIC1`,
  type: 'sdm.devices.types.CAMERA',
  assignee: `${STRUCT}/rooms/ROOM11`,
  traits: {
    'sdm.devices.traits.Info': { customName: '' },
    'sdm.devices.traits.CameraLiveStream': {
      maxVideoResolution: { width: 640, height: 480 }, videoCodecs: ['H264'], audioCodecs: ['OPUS'], supportedProtocols: ['WEB_RTC'],
    },
    'sdm.devices.traits.CameraClipPreview': {},
    'sdm.devices.traits.CameraMotion': {},
    'sdm.devices.traits.CameraPerson': {},
  },
  parentRelations: [{ parent: `${STRUCT}/rooms/ROOM11`, displayName: 'Cuisine' }],
}

/** Thermostat relevé : même API, hors périmètre de ce plugin (ignoré, compté dans `health`). */
export const THERMOSTAT = {
  name: `${PROJECT}/devices/DEVICE3`,
  type: 'sdm.devices.types.THERMOSTAT',
  assignee: `${STRUCT}/rooms/ROOM1`,
  traits: {
    'sdm.devices.traits.Info': { customName: '' },
    'sdm.devices.traits.Humidity': { ambientHumidityPercent: 53 },
    'sdm.devices.traits.Connectivity': { status: 'ONLINE' },
    'sdm.devices.traits.Fan': {},
    'sdm.devices.traits.ThermostatMode': { mode: 'HEAT', availableModes: ['HEAT', 'OFF'] },
    'sdm.devices.traits.ThermostatEco': { availableModes: ['OFF', 'MANUAL_ECO'], mode: 'OFF', heatCelsius: 13.91568, coolCelsius: 24.444443 },
    'sdm.devices.traits.ThermostatHvac': { status: 'OFF' },
    'sdm.devices.traits.Settings': { temperatureScale: 'CELSIUS' },
    'sdm.devices.traits.ThermostatTemperatureSetpoint': { heatCelsius: 18.792511 },
    'sdm.devices.traits.Temperature': { ambientTemperatureCelsius: 24.23999 },
  },
  parentRelations: [{ parent: `${STRUCT}/rooms/ROOM1`, displayName: 'Palier' }],
}

/** Ordre de Google conservé : le thermostat arrive en premier. */
export const DEVICES_RESPONSE = { devices: [THERMOSTAT, UNNAMED_CAMERA, DOORBELL, NAMED_CAMERA, WEBRTC_CAMERA] }

export const TOKEN_OK = { access_token: 'ya29.access', expires_in: 3599, refresh_token: '1//refresh-token', scope: 'https://www.googleapis.com/auth/sdm.service https://www.googleapis.com/auth/pubsub', token_type: 'Bearer' }
/** Rafraîchissement : pas de `refresh_token` dans la réponse. */
export const TOKEN_REFRESHED = { access_token: 'ya29.access-2', expires_in: 3599, scope: 'https://www.googleapis.com/auth/sdm.service https://www.googleapis.com/auth/pubsub', token_type: 'Bearer' }
export const TOKEN_INVALID_GRANT = { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }
export const SDM_403 = { error: { code: 403, message: 'Smart Device Management API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED' } }
