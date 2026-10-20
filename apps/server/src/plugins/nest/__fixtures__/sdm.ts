// Smart Device Management API responses. Devices CAPTURED from the real account on 2026-09-09 via
// `GET /api/plugins/nest/devices/raw` (10 devices: 8 cameras, 1 doorbell, 1 thermostat), then
// anonymized: project UUID, device, structure and room ids replaced; room names and custom names
// kept as they are. The shape is Google's, quirks included:
//  - `Info.customName` is EMPTY on 7 devices out of 10 (the Google Home app then shows
//    "<room> <type>", Kasbah "<type> <room>"); only the doorbell and two cameras have a name;
//  - `assignee` (undocumented in what we read) duplicates `parentRelations[0].parent`;
//  - the WHOLE device set is RTSP 640×480 H264/AAC (1st-generation cameras and doorbell), with
//    `CameraImage` + `CameraEventImage` — no `WEB_RTC` nor `CameraClipPreview`. The WebRTC camera
//    below is SYNTHETIC (from the docs), kept to exercise the protocol mapping.

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

/** 1st-generation wired doorbell (Nest Hello): custom name, RTSP, `DoorbellChime`. */
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

/** 1st-generation camera WITHOUT a custom name: the majority case of the real device set. */
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

/** 1st-generation camera with a custom name. */
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

/** SYNTHETIC (Google docs, not captured): battery camera, WebRTC, clip preview. */
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

/** Captured thermostat: same API, outside this plugin's scope (ignored, counted in `health`). */
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

/** Google's order kept: the thermostat comes first. */
export const DEVICES_RESPONSE = { devices: [THERMOSTAT, UNNAMED_CAMERA, DOORBELL, NAMED_CAMERA, WEBRTC_CAMERA] }

export const TOKEN_OK = { access_token: 'ya29.access', expires_in: 3599, refresh_token: '1//refresh-token', scope: 'https://www.googleapis.com/auth/sdm.service https://www.googleapis.com/auth/pubsub', token_type: 'Bearer' }
/** Refresh: no `refresh_token` in the response. */
export const TOKEN_REFRESHED = { access_token: 'ya29.access-2', expires_in: 3599, scope: 'https://www.googleapis.com/auth/sdm.service https://www.googleapis.com/auth/pubsub', token_type: 'Bearer' }
export const TOKEN_INVALID_GRANT = { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }
export const SDM_403 = { error: { code: 403, message: 'Smart Device Management API has not been used in project 123 before or it is disabled.', status: 'PERMISSION_DENIED' } }
