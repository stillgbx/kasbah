// Automower Connect API fixtures — CAPTURED from the real account (`GET /api/plugins/automower/raw`,
// 2026-09-16 around 5 pm, Paris time), ANONYMIZED: id, serial number and positions changed (the
// positions are shifted by a constant vector towards the demo house: the shape of the survey — a
// 70 m corridor along the plot — is kept). Everything else is as the vendor returned it,
// including what we do not read (`calendar`, `workAreas`, `remainingChargingTime`, `downTime`,
// `upTime`): that is how an unexpected shape gets noticed in the tests.
//
// What the capture CONFIRMED: enums in CAPITALS, `serialNumber` as a number, `positions` from most
// recent to oldest (the first point is at the station), `nextStartTimestamp` in LOCAL time written
// as UTC (10:00 "UTC" for a slot at 600 min = 10 am local) and `statusTimestamp` in real UTC (six
// minutes before the capture). The robot was no longer in error: its loop signal had come back,
// it was waiting for its slot (`RESTRICTED` / `WEEK_SCHEDULE`). The IN ERROR variant ("No loop
// signal", the morning's case) is therefore DERIVED, not captured.

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

/** What the vendor answers when the key or the secret is wrong. */
export const TOKEN_INVALID_CLIENT = { error: 'invalid_client', error_description: 'Invalid client credentials' }

/** `GET /v1/mowers`, CAPTURED: parked on its base, connected, held by its schedule until 10 am tomorrow. */
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
        // 2026-09-17 10:00 in LOCAL time, written as if it were UTC
        planner: { nextStartTimestamp: 1789639200000, override: { action: 'NOT_ACTIVE' }, restrictedReason: 'WEEK_SCHEDULE' },
        // real UTC: 2026-09-16 14:56:33
        metadata: { connected: true, statusTimestamp: 1789570593758 },
        // a ZONE's cutting height is in percent; the one in `settings` is on the 1-9 scale
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

/** DERIVED: the same robot stopped on "No loop signal" (code 2), parked, connected — the morning of 2026-09-16. */
export const MOWERS_ERROR = {
  data: [
    {
      ...CAPTURED,
      attributes: {
        ...CAPTURED.attributes,
        // the robot's LOCAL time written as if it were UTC: 2026-09-15 18:42:10 in Paris
        mower: { mode: 'MAIN_AREA', activity: 'PARKED_IN_CS', inactiveReason: 'NONE', state: 'ERROR', workAreaId: 0, errorCode: 2, errorCodeTimestamp: 1789497730000, isErrorConfirmable: true },
        planner: { nextStartTimestamp: 0, override: { action: 'NOT_ACTIVE' }, restrictedReason: 'NOT_APPLICABLE' },
        metadata: { connected: true, statusTimestamp: 1789452130000 },
      },
    },
  ],
}

/** DERIVED: the same robot mowing, without error. */
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

/** DERIVED: parked by schedule, offline (Connect module off): the list returns it anyway. */
export const MOWERS_OFFLINE = {
  data: [
    {
      ...CAPTURED,
      attributes: { ...CAPTURED.attributes, metadata: { connected: false, statusTimestamp: 1789400000000 } },
    },
  ],
}

// ---- WebSocket (V2 format) — CAPTURED on 2026-09-16 (`GET /api/plugins/automower/raw/events`) ------
//
// Triggered without moving the robot: a `ParkUntilFurtherNotice` then a `ResumeSchedule`, robot at
// the station. What the capture taught, and the documentation did not say:
//  - events are DELTAS: `mower` may carry ONLY one field (`state`, `activity`,
//    `inactiveReason`), and `planner` never repeats `nextStartTimestamp`;
//  - "parked until further notice" = `mode: HOME` (the planner stays on `WEEK_SCHEDULE`);
//  - `WAIT_POWER_UP` / `NOT_APPLICABLE` show up for a few seconds on a mode change;
//  - `ready.connectionId` is base64, not a UUID; no event carries a timestamp.
// Position and battery were NOT captured (robot still, full): shapes taken from the reference.

export const WS_READY = { ready: true, connectionId: 'gapGVu7XmHQIKEhUIA==' }

/** The first event after `ParkUntilFurtherNotice`: ONE field, nothing else. */
export const WS_MOWER_INACTIVE = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { inactiveReason: 'PLANNING' } } }
export const WS_MOWER_STOPPED = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { state: 'STOPPED' } } }
export const WS_MOWER_NOT_APPLICABLE = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { activity: 'NOT_APPLICABLE' } } }
/** The most complete shape seen: no `errorCodeTimestamp`, no `workAreaId`, no `inactiveReason`. */
export const WS_MOWER_STOPPED_FULL = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'MAIN_AREA', activity: 'NOT_APPLICABLE', state: 'STOPPED', errorCode: 0, isErrorConfirmable: false } },
}
/** Parked until further notice: it is the MODE that says so. */
export const WS_MOWER_HOME = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { mode: 'HOME', state: 'WAIT_POWER_UP' } } }
export const WS_MOWER_HOME_PARKED = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'HOME', activity: 'PARKED_IN_CS', state: 'RESTRICTED', errorCode: 0, isErrorConfirmable: false } },
}
/** Back to the schedule (`ResumeSchedule`). */
export const WS_MOWER_MAIN_PARKED = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'MAIN_AREA', activity: 'PARKED_IN_CS', state: 'RESTRICTED', errorCode: 0, isErrorConfirmable: false } },
}
/** The planner, as it ALWAYS arrives: without `nextStartTimestamp`. */
export const WS_PLANNER = { id: MOWER_ID, type: 'planner-event-v2', attributes: { planner: { override: { action: 'NOT_ACTIVE' }, restrictedReason: 'WEEK_SCHEDULE' } } }
export const WS_CUTTING_HEIGHT = { id: MOWER_ID, type: 'cuttingHeight-event-v2', attributes: { cuttingHeight: { height: 7 } } }

// ---- A 60 min `Start` on a robot whose loop signal is broken (CAPTURED, same evening) ----
//
// The robot announces "on its way" (`LEAVING`) without moving — the GPS drifts by a meter or two,
// one position every 30 s — then declares the error after three minutes. Learned:
//  - in forced mowing the planner carries `nextStartTimestamp: 0` and `override: FORCE_MOW`;
//  - the error arrives in THREE deltas: the code alone, then `state: ERROR`, then
//    `errorCodeTimestamp` separately — in SECONDS from the stream (milliseconds in the list);
//  - a `message-event-v2` comes with it: code, severity, position, `time` in seconds.

/** Forced mowing: the schedule's next start no longer applies. */
export const WS_PLANNER_FORCE_MOW = { id: MOWER_ID, type: 'planner-event-v2', attributes: { planner: { nextStartTimestamp: 0, override: { action: 'FORCE_MOW' }, restrictedReason: 'NONE' } } }
export const WS_MOWER_IN_OPERATION = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { state: 'IN_OPERATION' } } }
export const WS_MOWER_LEAVING = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'MAIN_AREA', activity: 'LEAVING', state: 'IN_OPERATION', errorCode: 0, isErrorConfirmable: false } },
}
export const WS_POSITION = { id: MOWER_ID, type: 'position-event-v2', attributes: { position: { latitude: 47.3092845, longitude: 5.0459418 } } }
export const WS_POSITION_2 = { id: MOWER_ID, type: 'position-event-v2', attributes: { position: { latitude: 47.3092954, longitude: 5.0459351 } } }
/** The error, first delta: the code alone, the state still says `IN_OPERATION`. */
export const WS_MOWER_ERROR_CODE = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { errorCode: 2, isErrorConfirmable: false } } }
export const WS_MOWER_ERROR_STATE = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { activity: 'NOT_APPLICABLE', state: 'ERROR' } } }
export const WS_MOWER_ERROR_FULL = {
  id: MOWER_ID, type: 'mower-event-v2',
  attributes: { mower: { mode: 'MAIN_AREA', activity: 'NOT_APPLICABLE', state: 'ERROR', errorCode: 2, isErrorConfirmable: false } },
}
/** `time` in SECONDS, local time written as UTC: 2026-09-16 18:22:15 in Paris. */
export const WS_MESSAGE_ERROR = { id: MOWER_ID, type: 'message-event-v2', attributes: { message: { time: 1789582935, code: 2, severity: 'ERROR', latitude: 47.309301, longitude: 5.0459219 } } }
/** The error's date, alone, three seconds after the code — in seconds. */
export const WS_MOWER_ERROR_AT = { id: MOWER_ID, type: 'mower-event-v2', attributes: { mower: { errorCodeTimestamp: 1789582935 } } }

// taken from the reference library, not captured yet (the robot was full)
export const WS_BATTERY = { id: MOWER_ID, type: 'battery-event-v2', attributes: { battery: { batteryPercent: 77 } } }
export const WS_UNKNOWN_MOWER = { id: '00000000-0000-0000-0000-000000000000', type: 'battery-event-v2', attributes: { battery: { batteryPercent: 10 } } }

// ---- `GET /mowers/{id}/messages` — CAPTURED on 2026-09-16 (22 rows, positions shifted like the list) ----
//
// From most recent to oldest. `time` in seconds (local time written as UTC), `severity` in
// capitals — `ERROR`, `FATAL` (code 1, outside area) and `WARNING` seen —, and NEAR-ZERO positions
// (`2e-7 ; 6.2e-6`) on several rows: the robot logged without a GPS fix. Kept as they are.
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

// ---- Zones and maps — INVENTED from the survey of 2026-10-12 ------------------------------------
//
// The real map is NOT reproduced here (the repo is public, and it is the plan of the grounds): only
// its SHAPE is. What the survey taught: `GET /maps/generated` returns an SVG (`image/svg+xml`) in
// millimeters, `x` towards the east, `y` towards the north; the surveyed grounds are a green polygon
// (`main_area_0`), obstacles are red polygons (`island_*`), guide wires are blue lines
// (`guide_*`) starting from the first point of the yellow line (`lona_cs`, the station);
// `GET /maps/zone` answers 404 (`map.zone.not_found`) as long as no zone is drawn, and the list then
// has NO `stayOutZones` section. A drawn work area then shows up there in GREEN, with a UUID as id
// and its name as `title`; the list then carries `stayOutZones: { zones: [], dirty }`.

export const MAP_GENERATED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" map-version="2.1">'
  + '<polyline stroke="yellow" id="lona_cs" points="2000,-500 4000,-900"/>'
  + '<polygon stroke="green" fill="green" id="main_area_0" title="Working area 0" points="-20000,-10000 10000,-10000 10000,30000 -20000,30000"/>'
  + '<polygon stroke="red" fill="red" id="island_1" title="Island 1" points="-5000,5000 -1000,5000 -1000,9000 -5000,9000"/>'
  + '<polyline stroke="blue" id="guide_1" points="2000,-500 -15000,-8000"/>'
  + '</svg>'

export const STAY_OUT_ID = '81c6eea2-d139-4fea-b134-f22a6b3ea403'
export const MAP_ZONE_SVG = '<svg>'
  // a drawn work area: UUID id (not its workAreaId), `title` = its name, spaces included
  + '<polygon stroke="green" fill="green" id="6f1c2a90-3b8e-4d57-9a41-0c2e7b5d8f13" title="Fond du jardin " points="-15000,15000 -5000,15000 -5000,25000 -15000,25000"/>'
  + `<polygon fill="red" stroke="red" id="${STAY_OUT_ID}" points="0,10000 3000,10000 3000,13000" title="Massif"/>`
  // a rewilding zone, DISABLED: red marked `rewildingzone`, hidden; the list does not know it
  + '<polygon stroke="red" fill="red" id="0b9e4c2d-6a71-4f38-8d5e-2c7f1a9b3e60" title="Prairie" points="5000,5000 8000,5000 8000,8000" display="none" rewildingzone="true"/>'
  + '<polyline stroke="blue" stroke-width="2500" id="d319f479-1d8d-4659-b2ef-56fb44099909" points="-2000,0 -2000,20000" title="Transport 1"/>'
  + '</svg>'

/** DERIVED: the captured robot, with two drawn work areas and a stay-out zone. */
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
