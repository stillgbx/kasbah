// `GET /status` of an HCPBridgeMqtt bridge (v1.0.2). Written from the firmware's serializer
// (`HCPBridgeESP32/src/main.cpp`, same keys, same order, same types), NOT yet captured on the real
// bridge: to replace with a capture from `GET /api/plugins/hormann/raw`, anonymised.

export const STATUS_CLOSED = {
  doorstate: 'closed',
  valid: true,
  targetPosition: 0,
  currentPosition: 0,
  light: false,
  state: 2,
  busResponseAge: 0,
  lastModbusRespone: 123456,
  swversion: '1.0.2',
  sensors: {},
  sensor_status: {},
  lastCommandTopic: '',
  lastCommandPayload: '',
}

export const STATUS_OPENING = {
  ...STATUS_CLOSED,
  doorstate: 'opening',
  targetPosition: 100,
  currentPosition: 12,
  state: 1,
}

export const STATUS_OPEN_LIT = {
  ...STATUS_CLOSED,
  doorstate: 'open',
  targetPosition: 100,
  currentPosition: 100,
  light: true,
  state: 0,
}

/** Bridge up, motor silent: never polled since boot (no bus scan, bus unplugged). */
export const STATUS_BUS_SILENT = {
  ...STATUS_CLOSED,
  valid: false,
  busResponseAge: -1,
  lastModbusRespone: 0,
}
