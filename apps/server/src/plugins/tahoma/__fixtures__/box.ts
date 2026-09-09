// Extraits ANONYMISÉS de `GET /setup` d'une TaHoma Switch : un volet io positionnable, un BSO io
// avec lames, un store banne io (fermeture exprimée en déploiement), un volet RTS et un portail RTS
// (aucun retour d'état), plus une passerelle et un thermostat qui doivent être ignorés.
// Formes RELEVÉES sur une vraie TaHoma Switch (firmware 2026.3.3-7), d'où deux traits qui ont
// l'air d'erreurs mais n'en sont pas : `definition.states` est TOUJOURS vide (les états
// exploitables sont dans `states`), et un appareil RTS a un tableau `states` STRICTEMENT vide.
// L'API locale ne renvoie ni pièces ni `placeOID` : c'est `house.json` qui rattache un appareil.
// Les vrais deviceURL portent souvent un index de sous-appareil (`#1`).

const PID = '1234-5678-9012'


/** io positionnable : `setClosure`, position et mouvement remontés. */
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
      // la memoire du « my » est reinscriptible sur un moteur io : parametre en FERMETURE (paramsSig p1)
      { commandName: 'setMemorized1Position' }, { commandName: 'refreshMemorized1Position' },
    ],
  },
  states: [
    { name: 'core:ClosureState', type: 1, value: 30 },
    // position favorite mémorisée DANS le moteur (le « my ») : une FERMETURE, comme `ClosureState`
    { name: 'core:Memorized1PositionState', type: 1, value: 73 },
    { name: 'core:MovingState', type: 6, value: false },
    { name: 'core:OpenClosedState', type: 3, value: 'open' },
    { name: 'core:StatusState', type: 3, value: 'available' },
    // valeur TABLEAU : un schema qui contraint `value` fait echouer le parse de tout le setup
    { name: 'core:CommandLockLevelsState', type: 10, value: [] },
    { name: 'core:BatteryState', type: 3, value: 'full' },
  ],
}

/** BSO io : lames orientables (`setOrientation`). */
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

/** Store banne io : `deploy`/`undeploy` et fermeture en `core:DeploymentState`. */
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

/** RTS : `up`/`down`/`my`/`stop`, aucun état de position. */
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

/** RTS sans commande d'arrêt : `stop` ne doit alors pas être annoncé. */
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

export const DEVICES = [IO_SHUTTER, IO_VENETIAN, IO_AWNING, RTS_SHUTTER, RTS_GATE, GATEWAY, THERMOSTAT]

export const SETUP = { devices: DEVICES }

/**
 * Séquence RELEVÉE sur la box au début d'une fermeture. Le point important : la box envoie des
 * DELTAS d'une seule clé par trame — la cible arrive seule, puis `core:MovingState` arrive seul,
 * et aucune position n'est émise pendant la course. Une trame prise isolément ne dit donc jamais
 * dans quel sens l'ouvrant part : il faut les fusionner dans l'état connu de l'appareil.
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

/** Fin de course après un `stop` : la position réelle n'arrive qu'à ce moment. */
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
