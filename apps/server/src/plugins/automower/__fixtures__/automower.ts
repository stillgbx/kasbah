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

// ---- Un `Start` de 60 min sur un robot dont le signal de boucle est en panne (CAPTURÉ, même soir) ----
//
// Le robot annonce « en route » (`LEAVING`) sans bouger — le GPS dérive d'un mètre ou deux, une
// position toutes les 30 s — puis déclare l'erreur au bout de trois minutes. Appris :
//  - en tonte forcée le planificateur porte `nextStartTimestamp: 0` et `override: FORCE_MOW` ;
//  - l'erreur arrive en TROIS deltas : le code seul, puis `state: ERROR`, puis `errorCodeTimestamp`
//    à part — en SECONDES par le flux (millisecondes dans la liste) ;
//  - un `message-event-v2` l'accompagne : code, gravité, position, `time` en secondes.

/** Tonte forcée : le prochain départ du planning n'a plus cours. */
export const WS_PLANNER_FORCE_MOW = { id: MOWER_ID, type: 'planner-event-v2', attributes: { planner: { nextStartTimestamp: 0, override: { action: 'FORCE_MOW' }, restrictedReason: 'NONE' } } }
export const WS_MOWER_IN_OPERATION = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { state: 'IN_OPERATION' } } }
export const WS_MOWER_LEAVING = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'MAIN_AREA', activity: 'LEAVING', state: 'IN_OPERATION', errorCode: 0, isErrorConfirmable: false } },
}
export const WS_POSITION = { id: MOWER_ID, type: 'position-event-v2', attributes: { position: { latitude: 47.3092845, longitude: 5.0459418 } } }
export const WS_POSITION_2 = { id: MOWER_ID, type: 'position-event-v2', attributes: { position: { latitude: 47.3092954, longitude: 5.0459351 } } }
/** L'erreur, premier delta : le code seul, l'état dit encore `IN_OPERATION`. */
export const WS_MOWER_ERROR_CODE = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { errorCode: 2, isErrorConfirmable: false } } }
export const WS_MOWER_ERROR_STATE = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { activity: 'NOT_APPLICABLE', state: 'ERROR' } } }
export const WS_MOWER_ERROR_FULL = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'MAIN_AREA', activity: 'NOT_APPLICABLE', state: 'ERROR', errorCode: 2, isErrorConfirmable: false } },
}
/** `time` en SECONDES, heure locale écrite comme UTC : 2026-09-16 18:22:15 à Paris. */
export const WS_MESSAGE_ERROR = { id: MOWER_ID, type: 'message-event-v2', attributes: { message: { time: 1789582935, code: 2, severity: 'ERROR', latitude: 47.309301, longitude: 5.0459219 } } }
/** La date de l'erreur, seule, trois secondes après le code — en secondes. */
export const WS_MOWER_ERROR_AT = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { errorCodeTimestamp: 1789582935 } } }

// d'après la bibliothèque de référence, pas encore capturé (le robot était plein)
export const WS_BATTERY = { id: MOWER_ID, type: 'battery-event-v2', attributes: { battery: { batteryPercent: 77 } } }
export const WS_UNKNOWN_MOWER = { id: '00000000-0000-0000-0000-000000000000', type: 'battery-event-v2', attributes: { battery: { batteryPercent: 10 } } }

// ---- `GET /mowers/{id}/messages` — CAPTURÉ le 2026-09-16 (22 lignes, positions décalées comme la liste) ----
//
// Du plus récent au plus ancien. `time` en secondes (heure locale écrite comme UTC), `severity` en
// majuscules — `ERROR`, `FATAL` (code 1, hors zone) et `WARNING` vus —, et des positions QUASI NULLES
// (`2e-7 ; 6.2e-6`) sur plusieurs lignes : le robot a consigné sans fix GPS. Gardées telles quelles.
export const MESSAGES = {
  data: {
    type: 'messages',
    id: 'messages',
    attributes: {
      messages: [
        {"time": 1789582935, "code": 2, "severity": "ERROR", "latitude": 47.309301, "longitude": 5.0459219},
        {"time": 1787589749, "code": 2, "severity": "ERROR", "latitude": 47.3092032, "longitude": 5.0458427},
        {"time": 1787580847, "code": 2, "severity": "ERROR", "latitude": 47.3092395, "longitude": 5.0457526},
        {"time": 1786715411, "code": 1, "severity": "FATAL", "latitude": 47.3093416, "longitude": 5.0458487},
        {"time": 1786637513, "code": 62, "severity": "ERROR", "latitude": 47.3092251, "longitude": 5.0457936},
        {"time": 1786631647, "code": 62, "severity": "ERROR", "latitude": 2e-07, "longitude": 6.2e-06},
        {"time": 1786546022, "code": 62, "severity": "ERROR", "latitude": 2e-07, "longitude": 6.2e-06},
        {"time": 1786458998, "code": 62, "severity": "ERROR", "latitude": 2e-07, "longitude": 6.2e-06},
        {"time": 1786365016, "code": 19, "severity": "FATAL", "latitude": 47.3092273, "longitude": 5.0456309},
        {"time": 1786206626, "code": 51, "severity": "WARNING", "latitude": 47.3092851, "longitude": 5.0458548},
        {"time": 1785944902, "code": 12, "severity": "ERROR", "latitude": 47.3093209, "longitude": 5.0459323},
        {"time": 1785677639, "code": 17, "severity": "ERROR", "latitude": 47.3092968, "longitude": 5.0458332},
        {"time": 1785356161, "code": 2, "severity": "ERROR", "latitude": 47.3092927, "longitude": 5.0458245},
        {"time": 1785335697, "code": 62, "severity": "ERROR", "latitude": 47.3092522, "longitude": 5.0459458},
        {"time": 1785250008, "code": 1, "severity": "FATAL", "latitude": 47.3093582, "longitude": 5.0458965},
        {"time": 1785083886, "code": 9, "severity": "ERROR", "latitude": 47.3093115, "longitude": 5.045876},
        {"time": 1784552771, "code": 18, "severity": "FATAL", "latitude": 47.3096861, "longitude": 5.0454237},
        {"time": 1784298847, "code": 9, "severity": "ERROR", "latitude": 47.3093822, "longitude": 5.0459006},
        {"time": 1784129232, "code": 12, "severity": "ERROR", "latitude": 47.3095779, "longitude": 5.0457182},
        {"time": 1783691828, "code": 62, "severity": "ERROR", "latitude": 47.3093458, "longitude": 5.0458659},
        {"time": 1783444897, "code": 62, "severity": "ERROR", "latitude": 47.3092664, "longitude": 5.0459133},
        {"time": 1782404012, "code": 78, "severity": "ERROR", "latitude": 47.3096825, "longitude": 5.045402},
      ],
    },
  },
}

// ---- Zones et cartes — INVENTÉES d'après le relevé du 2026-10-12 ------------------------------------
//
// La vraie carte n'est PAS reprise ici (le dépôt est public, et c'est le plan du terrain) : seule sa
// FORME l'est. Ce que le relevé a appris : `GET /maps/generated` rend un SVG (`image/svg+xml`) en
// millimètres, `x` vers l'est, `y` vers le nord ; le terrain relevé est un polygone vert
// (`main_area_0`), les obstacles des polygones rouges (`island_*`), les câbles guides des lignes
// bleues (`guide_*`) qui partent du premier point de la ligne jaune (`lona_cs`, la station) ;
// `GET /maps/zone` répond 404 (`map.zone.not_found`) tant qu'aucune zone n'est tracée, et la liste
// n'a alors PAS de section `stayOutZones`. Une zone de travail tracée y apparaît ensuite en VERT, avec
// un UUID pour id et son nom pour `title` ; la liste porte alors `stayOutZones: { zones: [], dirty }`.

export const MAP_GENERATED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" map-version="2.1">'
  + '<polyline stroke="yellow" id="lona_cs" points="2000,-500 4000,-900"/>'
  + '<polygon stroke="green" fill="green" id="main_area_0" title="Working area 0" points="-20000,-10000 10000,-10000 10000,30000 -20000,30000"/>'
  + '<polygon stroke="red" fill="red" id="island_1" title="Island 1" points="-5000,5000 -1000,5000 -1000,9000 -5000,9000"/>'
  + '<polyline stroke="blue" id="guide_1" points="2000,-500 -15000,-8000"/>'
  + '</svg>'

export const STAY_OUT_ID = '81c6eea2-d139-4fea-b134-f22a6b3ea403'
export const MAP_ZONE_SVG = '<svg>'
  // une zone de travail tracée : id UUID (pas son workAreaId), `title` = son nom, espaces compris
  + '<polygon stroke="green" fill="green" id="6f1c2a90-3b8e-4d57-9a41-0c2e7b5d8f13" title="Fond du jardin " points="-15000,15000 -5000,15000 -5000,25000 -15000,25000"/>'
  + `<polygon fill="red" stroke="red" id="${STAY_OUT_ID}" points="0,10000 3000,10000 3000,13000" title="Massif"/>`
  // une zone de réensauvagement, DÉSACTIVÉE : rouge marqué `rewildingzone`, masquée ; la liste ne la connaît pas
  + '<polygon stroke="red" fill="red" id="0b9e4c2d-6a71-4f38-8d5e-2c7f1a9b3e60" title="Prairie" points="5000,5000 8000,5000 8000,8000" display="none" rewildingzone="true"/>'
  + '<polyline stroke="blue" stroke-width="2500" id="d319f479-1d8d-4659-b2ef-56fb44099909" points="-2000,0 -2000,20000" title="Transport 1"/>'
  + '</svg>'

/** DÉRIVÉ : le robot capturé, avec deux zones de travail tracées et une zone d'exclusion. */
export const MOWERS_ZONES = {
  data: [
    {
      ...CAPTURED,
      attributes: {
        ...CAPTURED.attributes,
        workAreas: [
          { workAreaId: 0, name: '', type: 'RANDOM', cuttingHeight: 100, enabled: true, schedulable: true },
          { workAreaId: 123456, name: 'Fond du jardin', type: 'RANDOM', cuttingHeight: 50, enabled: false, schedulable: true },
        ],
        stayOutZones: { dirty: false, zones: [{ id: STAY_OUT_ID, name: 'Massif', enabled: true }] },
      },
    },
  ],
}
