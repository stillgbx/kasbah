// Fixtures de l'Automower Connect API — CAPTURE du vrai compte (`GET /api/plugins/automower/raw`,
// 2026-09-16 vers 17 h, heure de Paris), ANONYMISÉE : identifiant, numéro de série et positions
// changés (les positions sont décalées d'un vecteur constant vers la maison de démo : la forme du
// relevé — un couloir de 70 m le long de la parcelle — est gardée). Tout le reste est tel que le
// fabricant l'a rendu, y compris ce qu'on ne lit pas (`calendar`, `workAreas`, `remainingChargingTime`,
// `downTime`, `upTime`) : c'est ainsi qu'une forme inattendue se remarque dans les tests.
//
// Ce que la capture a CONFIRMÉ : énumérations en MAJUSCULES, `serialNumber` en nombre, `positions`
// du plus récent au plus ancien (le premier point est à la station), `nextStartTimestamp` en heure
// LOCALE écrite comme UTC (10:00 « UTC » pour un créneau à 600 min = 10 h locales) et
// `statusTimestamp` en vrai UTC (six minutes avant la capture). Le robot n'était plus en erreur : son
// signal de boucle était revenu, il attendait son créneau (`RESTRICTED` / `WEEK_SCHEDULE`). La
// variante EN ERREUR (« No loop signal », le cas du matin) est donc DÉRIVÉE, pas capturée.

export const MOWER_ID = 'c7233734-b219-4287-a173-08e3643f89f0'

export const TOKEN_RESPONSE = {
  access_token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.test-token-1',
  scope: 'iam:read amc:api',
  expires_in: 86399,
  provider: 'husqvarna',
  user_id: 'a3b0f7ec-2d0e-4a7e-9f4c-2f1c1e0d9b11',
  token_type: 'Bearer',
}

export const TOKEN_RESPONSE_2 = { ...TOKEN_RESPONSE, access_token: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.test-token-2' }

/** Ce que le fabricant répond quand la clé ou le secret sont faux. */
export const TOKEN_INVALID_CLIENT = { error: 'invalid_client', error_description: 'Invalid client credentials' }

/** `GET /v1/mowers`, CAPTURÉ : garé sur sa base, connecté, retenu par son planning jusqu'à demain 10 h. */
export const MOWERS_PARKED = {
  data: [
    {
      type: 'mower',
      id: MOWER_ID,
      attributes: {
        system: { name: 'Tondeuse', model: 'Husqvarna Automower® 435X AWD', serialNumber: 191300001 },
        battery: { batteryPercent: 100, remainingChargingTime: 0 },
        capabilities: { headlights: true, workAreas: true, position: true, canConfirmError: true, stayOutZones: true },
        mower: { mode: 'MAIN_AREA', activity: 'PARKED_IN_CS', inactiveReason: 'NONE', state: 'RESTRICTED', workAreaId: 0, errorCode: 0, errorCodeTimestamp: 0, isErrorConfirmable: false },
        calendar: { tasks: [{ start: 600, duration: 360, monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true, workAreaId: 0 }] },
        // 2026-09-17 10:00 en heure LOCALE, écrit comme si c'était de l'UTC
        planner: { nextStartTimestamp: 1789639200000, override: { action: 'NOT_ACTIVE' }, restrictedReason: 'WEEK_SCHEDULE' },
        // vrai UTC : 2026-09-16 14:56:33
        metadata: { connected: true, statusTimestamp: 1789570593758 },
        // la hauteur de coupe d'une ZONE est en pour cent ; celle de `settings` sur l'échelle 1-9
        workAreas: [{ workAreaId: 0, name: '', type: 'RANDOM', cuttingHeight: 100, enabled: true, schedulable: true, lastTimeAbandoned: 0, useGlobalCuttingHeight: true }],
        positions: [
          {"latitude": 47.3092765, "longitude": 5.0458869},
          {"latitude": 47.3092809, "longitude": 5.0458405},
          {"latitude": 47.3092592, "longitude": 5.0458206},
          {"latitude": 47.3092148, "longitude": 5.0458614},
          {"latitude": 47.309236, "longitude": 5.0457505},
          {"latitude": 47.3092291, "longitude": 5.0457474},
          {"latitude": 47.3092428, "longitude": 5.0458232},
          {"latitude": 47.3092792, "longitude": 5.0458042},
          {"latitude": 47.3092289, "longitude": 5.0458529},
          {"latitude": 47.3092914, "longitude": 5.0458086},
          {"latitude": 47.3092526, "longitude": 5.0458436},
          {"latitude": 47.3091988, "longitude": 5.045762},
          {"latitude": 47.3092698, "longitude": 5.0457871},
          {"latitude": 47.3091893, "longitude": 5.0457651},
          {"latitude": 47.3091891, "longitude": 5.0458029},
          {"latitude": 47.309163, "longitude": 5.0457708},
          {"latitude": 47.3092548, "longitude": 5.0458721},
          {"latitude": 47.3092226, "longitude": 5.0458573},
          {"latitude": 47.3092549, "longitude": 5.0459045},
          {"latitude": 47.3092635, "longitude": 5.0458937},
          {"latitude": 47.3092966, "longitude": 5.0458139},
          {"latitude": 47.3092901, "longitude": 5.0458294},
          {"latitude": 47.3092362, "longitude": 5.0457894},
          {"latitude": 47.3092429, "longitude": 5.0457005},
          {"latitude": 47.3092689, "longitude": 5.0456145},
          {"latitude": 47.3092687, "longitude": 5.0455079},
          {"latitude": 47.3092963, "longitude": 5.0454655},
          {"latitude": 47.3094246, "longitude": 5.0454477},
          {"latitude": 47.3094616, "longitude": 5.045442},
          {"latitude": 47.3094256, "longitude": 5.0455004},
          {"latitude": 47.3093812, "longitude": 5.0454975},
          {"latitude": 47.3094442, "longitude": 5.0454592},
          {"latitude": 47.3094678, "longitude": 5.0454469},
          {"latitude": 47.3093898, "longitude": 5.0454908},
          {"latitude": 47.3093647, "longitude": 5.0454998},
          {"latitude": 47.3094553, "longitude": 5.0454412},
          {"latitude": 47.3095482, "longitude": 5.0454873},
          {"latitude": 47.3096212, "longitude": 5.0455269},
          {"latitude": 47.309585, "longitude": 5.0454554},
          {"latitude": 47.3095665, "longitude": 5.0454349},
          {"latitude": 47.3096428, "longitude": 5.0455228},
          {"latitude": 47.3096638, "longitude": 5.0454791},
          {"latitude": 47.3096474, "longitude": 5.0455268},
          {"latitude": 47.309693, "longitude": 5.0454561},
          {"latitude": 47.3097387, "longitude": 5.0455168},
          {"latitude": 47.3097528, "longitude": 5.0454676},
          {"latitude": 47.309741, "longitude": 5.0455449},
          {"latitude": 47.3097749, "longitude": 5.0454656},
          {"latitude": 47.3096828, "longitude": 5.0455231},
          {"latitude": 47.3097016, "longitude": 5.0454928},
        ],
        settings: { cuttingHeight: 7, headlight: { mode: 'EVENING_AND_NIGHT' } },
        statistics: {
          cuttingBladeUsageTime: 800000,
          downTime: 20000,
          numberOfChargingCycles: 45,
          numberOfCollisions: 9500,
          totalChargingTime: 3000000,
          totalCuttingTime: 14000000,
          totalDriveDistance: 9000000,
          totalRunningTime: 15500000,
          totalSearchingTime: 900000,
          upTime: 4500000,
        },
      },
    },
  ],
}

const CAPTURED = MOWERS_PARKED.data[0]!

/** DÉRIVÉ : le même robot arrêté sur « No loop signal » (code 2), garé, connecté — le cas du matin du 2026-09-16. */
export const MOWERS_ERROR = {
  data: [
    {
      ...CAPTURED,
      attributes: {
        ...CAPTURED.attributes,
        // heure LOCALE du robot écrite comme si elle était UTC : 2026-09-15 18:42:10 à Paris
        mower: { mode: 'MAIN_AREA', activity: 'PARKED_IN_CS', inactiveReason: 'NONE', state: 'ERROR', workAreaId: 0, errorCode: 2, errorCodeTimestamp: 1789497730000, isErrorConfirmable: true },
        planner: { nextStartTimestamp: 0, override: { action: 'NOT_ACTIVE' }, restrictedReason: 'NOT_APPLICABLE' },
        metadata: { connected: true, statusTimestamp: 1789452130000 },
      },
    },
  ],
}

/** DÉRIVÉ : le même robot en tonte, sans erreur. */
export const MOWERS_MOWING = {
  data: [
    {
      ...CAPTURED,
      attributes: {
        ...CAPTURED.attributes,
        battery: { batteryPercent: 83, remainingChargingTime: 0 },
        mower: { mode: 'MAIN_AREA', activity: 'MOWING', inactiveReason: 'NONE', state: 'IN_OPERATION', workAreaId: 0, errorCode: 0, errorCodeTimestamp: 0, isErrorConfirmable: false },
        planner: { nextStartTimestamp: 1789639200000, override: { action: 'NOT_ACTIVE' }, restrictedReason: 'NONE' },
      },
    },
  ],
}

/** DÉRIVÉ : garé sur planning, hors ligne (module Connect éteint) : la liste le rend quand même. */
export const MOWERS_OFFLINE = {
  data: [
    {
      ...CAPTURED,
      attributes: { ...CAPTURED.attributes, metadata: { connected: false, statusTimestamp: 1789400000000 } },
    },
  ],
}

// ---- WebSocket (format V2) — CAPTURÉS le 2026-09-16 (`GET /api/plugins/automower/raw/events`) ------
//
// Provoqués sans faire bouger le robot : un `ParkUntilFurtherNotice` puis un `ResumeSchedule`, robot à
// la station. Ce que la capture a appris, et que la documentation ne disait pas :
//  - les événements sont des DELTAS : `mower` peut ne porter QU'un champ (`state`, `activity`,
//    `inactiveReason`), et `planner` ne redit jamais `nextStartTimestamp` ;
//  - « garé jusqu'à nouvel ordre » = `mode: HOME` (le planificateur reste sur `WEEK_SCHEDULE`) ;
//  - `WAIT_POWER_UP` / `NOT_APPLICABLE` passent quelques secondes au changement de mode ;
//  - `ready.connectionId` est un base64, pas un UUID ; aucun événement ne porte d'horodatage.
// Position et batterie n'ont PAS été capturés (robot immobile, plein) : formes d'après la référence.

export const WS_READY = { ready: true, connectionId: 'gapGVu7XmHQIKEhUIA==' }

/** Le premier événement après `ParkUntilFurtherNotice` : UN champ, rien d'autre. */
export const WS_MOWER_INACTIVE = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { inactiveReason: 'PLANNING' } } }
export const WS_MOWER_STOPPED = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { state: 'STOPPED' } } }
export const WS_MOWER_NOT_APPLICABLE = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { activity: 'NOT_APPLICABLE' } } }
/** La forme la plus complète vue : ni `errorCodeTimestamp`, ni `workAreaId`, ni `inactiveReason`. */
export const WS_MOWER_STOPPED_FULL = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'MAIN_AREA', activity: 'NOT_APPLICABLE', state: 'STOPPED', errorCode: 0, isErrorConfirmable: false } },
}
/** Garé jusqu'à nouvel ordre : c'est le MODE qui le dit. */
export const WS_MOWER_HOME = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { mode: 'HOME', state: 'WAIT_POWER_UP' } } }
export const WS_MOWER_HOME_PARKED = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'HOME', activity: 'PARKED_IN_CS', state: 'RESTRICTED', errorCode: 0, isErrorConfirmable: false } },
}
/** Retour au planning (`ResumeSchedule`). */
export const WS_MOWER_MAIN_PARKED = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'MAIN_AREA', activity: 'PARKED_IN_CS', state: 'RESTRICTED', errorCode: 0, isErrorConfirmable: false } },
}
/** Le planificateur, tel qu'il arrive TOUJOURS : sans `nextStartTimestamp`. */
export const WS_PLANNER = { id: MOWER_ID, type: 'planner-event-v2', attributes: { planner: { override: { action: 'NOT_ACTIVE' }, restrictedReason: 'WEEK_SCHEDULE' } } }
export const WS_CUTTING_HEIGHT = { id: MOWER_ID, type: 'cuttingHeight-event-v2', attributes: { cuttingHeight: { height: 7 } } }

// d'après la bibliothèque de référence, pas encore capturés
export const WS_POSITION = { id: MOWER_ID, type: 'position-event-v2', attributes: { position: { latitude: 47.309601, longitude: 5.045802 } } }
export const WS_BATTERY = { id: MOWER_ID, type: 'battery-event-v2', attributes: { battery: { batteryPercent: 77 } } }
export const WS_UNKNOWN_MOWER = { id: '00000000-0000-0000-0000-000000000000', type: 'battery-event-v2', attributes: { battery: { batteryPercent: 10 } } }
