// DIRIGERA answers RECONSTRUCTED from the types of the `dirigera` npm library (2.0.2), NOT captured
// on a hub: no hub was on hand. Invented ids and names. To replace by an
// anonymised capture of `GET /v1/devices` and of the socket as soon as a hub is paired — a fixture
// deduced from documentation has already let bugs through here (wiki 3_2, TaHoma and COMAP).

const room = { id: 'room-0001', name: 'Salon', color: 'ikea_green_no_65', icon: 'rooms_sofa' }

export const COLOR_LIGHT = {
  id: '00000000-0000-4000-8000-000000000001_1',
  type: 'light', deviceType: 'light',
  createdAt: '2026-01-01T00:00:00.000Z', isReachable: true, lastSeen: '2026-01-01T00:00:00.000Z',
  attributes: {
    customName: 'Lampe 1', model: 'TRADFRI bulb E27 CWS 806lm', manufacturer: 'IKEA of Sweden',
    firmwareVersion: '1.0.021', hardwareVersion: '1', serialNumber: '0000000000000001', productCode: 'LED1924G9',
    isOn: true, startupOnOff: 'startPrevious', lightLevel: 80,
    colorHue: 120, colorSaturation: 1, colorTemperature: 2700,
    colorTemperatureMin: 4000, colorTemperatureMax: 2202, colorMode: 'color',
    identifyPeriod: 0, permittingJoin: false, otaStatus: 'upToDate', otaState: 'readyToCheck',
  },
  capabilities: { canSend: [], canReceive: ['customName', 'isOn', 'lightLevel', 'colorTemperature', 'colorHue', 'colorSaturation'] },
  room, deviceSet: [], remoteLinks: [], isHidden: false,
}

export const WHITE_LIGHT = {
  id: '00000000-0000-4000-8000-000000000002_1',
  type: 'light', deviceType: 'light', isReachable: true,
  attributes: {
    customName: 'Lampe 2', model: 'TRADFRI bulb GU10 WS 345lm', manufacturer: 'IKEA of Sweden',
    isOn: false, lightLevel: 30, colorTemperature: 2702, colorTemperatureMin: 4000, colorTemperatureMax: 2202,
    colorMode: 'temperature',
  },
  capabilities: { canSend: [], canReceive: ['customName', 'isOn', 'lightLevel', 'colorTemperature'] },
  room, isHidden: false,
}

export const OUTLET = {
  id: '00000000-0000-4000-8000-000000000003_1',
  type: 'outlet', deviceType: 'outlet', isReachable: true,
  attributes: {
    customName: 'Prise 1', model: 'INSPELNING Smart plug', manufacturer: 'IKEA of Sweden',
    isOn: true, currentActivePower: 12.5, currentVoltage: 230, currentAmps: 0.05,
    totalEnergyConsumed: 3.25, energyConsumedAtLastReset: 0, childLock: false, statusLight: true,
  },
  capabilities: { canSend: [], canReceive: ['customName', 'isOn', 'childLock', 'statusLight'] },
  room, isHidden: false,
}

export const BLINDS = {
  id: '00000000-0000-4000-8000-000000000004_1',
  type: 'blinds', deviceType: 'blinds', isReachable: true,
  attributes: {
    customName: 'Store 1', model: 'FYRTUR block-out roller blind', manufacturer: 'IKEA of Sweden',
    blindsCurrentLevel: 75, blindsTargetLevel: 75, blindsState: 'stopped', batteryPercentage: 88,
  },
  capabilities: { canSend: [], canReceive: ['customName', 'blindsCurrentLevel', 'blindsTargetLevel', 'blindsState'] },
  room: { id: 'room-0002', name: 'Chambre 2' }, isHidden: false,
}

export const AIR_SENSOR = {
  id: '00000000-0000-4000-8000-000000000005_1',
  type: 'sensor', deviceType: 'environmentSensor', isReachable: true,
  attributes: {
    customName: 'Air 1', model: 'VINDSTYRKA', manufacturer: 'IKEA of Sweden',
    currentTemperature: 21.3, currentRH: 48, currentPM25: 6, maxMeasuredPM25: 999, minMeasuredPM25: 0, vocIndex: 98,
  },
  capabilities: { canSend: [], canReceive: ['customName'] },
  room, isHidden: false,
}

export const REMOTE = {
  id: '00000000-0000-4000-8000-000000000006_1',
  type: 'controller', deviceType: 'lightController', isReachable: true,
  attributes: { customName: 'Télécommande 1', model: 'TRADFRI remote control', batteryPercentage: 70 },
  capabilities: { canSend: ['isOn', 'lightLevel'], canReceive: ['customName'] },
  room, isHidden: false,
}

export const SPEAKER = {
  id: '00000000-0000-4000-8000-000000000007_1',
  type: 'speaker', deviceType: 'speaker', isReachable: true,
  attributes: { customName: 'Enceinte 1', model: 'SYMFONISK Bookshelf', playback: 'playbackIdle', volume: 20 },
  capabilities: { canSend: [], canReceive: ['playback', 'volume'] },
  room, isHidden: false,
}

/** Shape the client must skip alone: no `deviceType`. */
export const MALFORMED = { id: 'broken', type: 'light', attributes: {} }

export const DEVICES = [COLOR_LIGHT, WHITE_LIGHT, OUTLET, BLINDS, AIR_SENSOR, REMOTE, SPEAKER, MALFORMED]

/** A socket frame: only the changed attributes travel. */
export const LIGHT_DIMMED_EVENT = {
  id: 'event-0001', time: '2026-01-01T00:01:00.000Z', specversion: '1.1.0', source: 'urn:com:ikea:homesmart:iotc:ws',
  type: 'deviceStateChanged',
  data: { id: COLOR_LIGHT.id, type: 'light', deviceType: 'light', attributes: { lightLevel: 40 } },
}
