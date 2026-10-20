// ANONYMIZED excerpts of `GET /setup` from a TaHoma Switch: a positionable io shutter, an io
// exterior venetian blind with slats, an io awning (closure expressed as deployment), an RTS
// shutter and an RTS gate (no state feedback), plus a gateway and a thermostat that must be ignored.
// Shapes CAPTURED from a real TaHoma Switch (firmware 2026.3.3-7), hence two traits that look like
// mistakes but are not: `definition.states` is ALWAYS empty (the usable states are in `states`), and
// an RTS device has a STRICTLY empty `states` array.
// The local API returns neither rooms nor `placeOID`: it is `house.json` that attaches a device.
// Real deviceURLs often carry a sub-device index (`#1`).

const PID = '1234-5678-9012'


/** Positionable io: `setClosure`, position and movement reported. */
export const IO_SHUTTER = {
  deviceURL: `io://${PID}/11110001`,
  label: 'Volet salon',
  controllableName: 'io:RollerShutterGenericIOComponent',
  available: true,
  enabled: true,
  definition: {
    uiClass: 'RollerShutter',
    widgetName: 'PositionableRollerShutter',
    commands: [
      { commandName: 'open' }, { commandName: 'close' }, { commandName: 'stop' },
      { commandName: 'my' }, { commandName: 'setClosure' }, { commandName: 'identify' },
      // the "my" memory can be rewritten on an io motor: parameter as a CLOSURE (paramsSig p1)
      { commandName: 'setMemorized1Position' }, { commandName: 'refreshMemorized1Position' },
    ],
  },
  states: [
    { name: 'core:ClosureState', type: 1, value: 30 },
    // favorite position stored IN the motor (the "my"): a CLOSURE, like `ClosureState`
    { name: 'core:Memorized1PositionState', type: 1, value: 73 },
    { name: 'core:MovingState', type: 6, value: false },
    { name: 'core:OpenClosedState', type: 3, value: 'open' },
    { name: 'core:StatusState', type: 3, value: 'available' },
    // ARRAY value: a schema that constrains `value` fails the parse of the whole setup
    { name: 'core:CommandLockLevelsState', type: 10, value: [] },
    { name: 'core:BatteryState', type: 3, value: 'full' },
  ],
}

/** io exterior venetian blind: tiltable slats (`setOrientation`). */
export const IO_VENETIAN = {
  deviceURL: `io://${PID}/11110002`,
  label: 'BSO chambre',
  controllableName: 'io:ExteriorVenetianBlindIOComponent',
  available: true,
  enabled: true,
  definition: {
    uiClass: 'ExteriorVenetianBlind',
    commands: [
      { commandName: 'open' }, { commandName: 'close' }, { commandName: 'stop' },
      { commandName: 'setClosure' }, { commandName: 'setOrientation' }, { commandName: 'setClosureAndOrientation' },
    ],
  },
  states: [
    { name: 'core:ClosureState', type: 1, value: 100 },
    { name: 'core:SlateOrientationState', type: 1, value: 40 },
    { name: 'core:MovingState', type: 6, value: false },
  ],
}

/** io awning: `deploy`/`undeploy` and closure as `core:DeploymentState`. */
export const IO_AWNING = {
  deviceURL: `io://${PID}/11110003#1`,
  label: 'Store terrasse',
  controllableName: 'io:HorizontalAwningIOComponent',
  available: true,
  enabled: true,
  definition: {
    uiClass: 'Awning',
    commands: [
      { commandName: 'deploy' }, { commandName: 'undeploy' }, { commandName: 'stop' }, { commandName: 'setDeployment' },
    ],
  },
  states: [
    { name: 'core:DeploymentState', type: 1, value: 0 },
    { name: 'core:MovingState', type: 6, value: false },
  ],
}

/** RTS: `up`/`down`/`my`/`stop`, no position state. */
export const RTS_SHUTTER = {
  deviceURL: `rts://${PID}/22220001`,
  label: 'Volet cuisine',
  controllableName: 'rts:RollerShutterRTSComponent',
  available: true,
  enabled: true,
  definition: {
    uiClass: 'RollerShutter',
    widgetName: 'RollerShutter',
    commands: [{ commandName: 'up' }, { commandName: 'down' }, { commandName: 'my' }, { commandName: 'stop' }],
  },
  states: [],
}

/** RTS without a stop command: `stop` must then not be announced. */
export const RTS_GATE = {
  deviceURL: `rts://${PID}/22220002`,
  label: 'Portail',
  controllableName: 'rts:SlidingGateOpenerRTSComponent',
  available: true,
  enabled: true,
  definition: {
    uiClass: 'Gate',
    commands: [{ commandName: 'open' }, { commandName: 'close' }],
  },
  states: [],
}

/**
 * SOLAR shutter (captured 2026-09-24, 11 out of 16 io shutters): battery, and slow speed
 * (`setClosureAndLinearSpeed`, signature `p1,*p2`) — the app's "quiet mode".
 */
export const SOLAR_SHUTTER = {
  deviceURL: `io://${PID}/44440001#1`,
  label: 'Volet bureau',
  controllableName: 'io:DynamicRollerShutterIOComponent',
  available: true,
  enabled: true,
  definition: {
    uiClass: 'RollerShutter',
    commands: [
      { commandName: 'open' }, { commandName: 'close' }, { commandName: 'stop' }, { commandName: 'my' },
      { commandName: 'setClosure' }, { commandName: 'setMemorized1Position' },
      { commandName: 'setClosureAndLinearSpeed', nparams: 1, paramsSig: 'p1,*p2' },
      { commandName: 'setPositionAndLinearSpeed', nparams: 1, paramsSig: 'p1,*p2' },
    ],
  },
  states: [
    { name: 'core:ClosureState', type: 1, value: 100 },
    { name: 'core:MovingState', type: 6, value: false },
    { name: 'core:BatteryLevelState', type: 1, value: 100 },
    { name: 'core:StatusState', type: 3, value: 'available' },
  ],
}

/**
 * Its solar panel, which the box presents as a light sensor: same radio node (`#2`), SAME label as
 * the shutter, no command.
 */
export const SUN_SENSOR = {
  deviceURL: `io://${PID}/44440001#2`,
  label: 'Volet bureau',
  controllableName: 'io:SunEnergyActuatorSensor',
  available: true,
  enabled: true,
  definition: { uiClass: 'LightSensor', widgetName: 'LuminanceSensor', type: 'SENSOR', commands: [] },
  states: [
    { name: 'core:StatusState', type: 3, value: 'available' },
    { name: 'core:LuminanceState', type: 1, value: 1200 },
    { name: 'core:SunEnergyState', type: 1, value: 0 },
  ],
}

export const GATEWAY = {
  deviceURL: `internal://${PID}/#1`,
  label: 'TaHoma switch',
  controllableName: 'internal:PodV3Component',
  definition: { uiClass: 'Pod', commands: [{ commandName: 'refreshUpdateStatus' }] },
  states: [],
}

export const THERMOSTAT = {
  deviceURL: `io://${PID}/33330001`,
  label: 'Thermostat',
  controllableName: 'io:SomfyThermostatIOComponent',
  definition: {
    uiClass: 'HeatingSystem',
    commands: [{ commandName: 'setDerogation' }],
  },
  states: [{ name: 'core:TemperatureState', type: 2, value: 20.5 }],
}

export const DEVICES = [IO_SHUTTER, IO_VENETIAN, IO_AWNING, RTS_SHUTTER, RTS_GATE, SOLAR_SHUTTER, SUN_SENSOR, GATEWAY, THERMOSTAT]

export const SETUP = { devices: DEVICES }

/**
 * Sequence CAPTURED on the box at the start of a closing. The key point: the box sends DELTAS of a
 * single key per frame — the target arrives alone, then `core:MovingState` arrives alone, and no
 * position is emitted during the travel. A frame taken on its own therefore never says which way
 * the cover is going: they must be merged into the device's known state.
 */
export const EVENTS = [
  {
    name: 'DeviceStateChangedEvent',
    deviceURL: IO_SHUTTER.deviceURL,
    deviceStates: [{ name: 'core:TargetClosureState', type: 1, value: 100 }],
  },
  {
    name: 'DeviceStateChangedEvent',
    deviceURL: IO_SHUTTER.deviceURL,
    deviceStates: [{ name: 'core:MovingState', type: 6, value: 'true' }],
  },
  { name: 'DeviceUnavailableEvent', deviceURL: IO_VENETIAN.deviceURL },
  { name: 'ExecutionRegisteredEvent' },
  { name: 'ExecutionStateChangedEvent', newState: 'IN_PROGRESS' },
]

/** End of travel after a `stop`: the real position only arrives at that moment. */
export const EVENTS_STOPPED = [
  {
    name: 'DeviceStateChangedEvent',
    deviceURL: IO_SHUTTER.deviceURL,
    deviceStates: [
      { name: 'core:ClosureState', type: 1, value: 72 },
      { name: 'core:TargetClosureState', type: 1, value: 72 },
    ],
  },
  {
    name: 'DeviceStateChangedEvent',
    deviceURL: IO_SHUTTER.deviceURL,
    deviceStates: [{ name: 'core:MovingState', type: 6, value: 'false' }],
  },
]
