import type { RobotShadow } from '../mqtt'

// Shadows of a REAL Roomba Combo (`sku c755840`, firmware `stingray+24.29.5`), captured on
// 09/19/2026 from the robot's local broker, then played by driving it from the vendor's app.
//
// WHAT IS KEPT AND WHAT IS NOT. The robot publishes 80 top-level keys; those that carry its
// network (`netinfo`: address, gateway, BSSID; `wlcfg`: SSID) and its hardware (`hwPartsRev`: MAC
// address and serial numbers, `batInfo`, `secureBoot`) are dropped — not because they get in the
// test's way, but because a fixture is a versioned file. The rest is the real value, quirks
// included: `detectedPad: "invalid"` (pad removed), `tankLvl: 10`, `bin.type: "std"`,
// `dock.state: 300`.
//
// THE FOUR STATES come from a sequence actually played, timestamped in the session log:
//   14:26:43  cycle=clean  phase=stop       paused for 14 min (see epochs)       → PAUSED
//   14:28:59  cycle=clean  phase=hmUsrDock  "go home", requested by the app      → RETURNING
//   14:30:33  cycle=clean  phase=charge     ARRIVED, mission still open          → DOCKED_MISSION_OPEN
//   14:30:37  cycle=none   phase=charge     mission closed, 4 s later            → DOCKED
//   14:34:04  cycle=clean  phase=run        set off again                        → CLEANING
//
// Those four seconds between `phase=charge` and `cycle=none` are the reason `DOCKED_MISSION_OPEN`
// exists: a mapping that read `cycle` before `phase` would publish "paused" there for a robot
// sitting on its dock.

/** The common trunk: what the robot says about itself whatever it is doing. */
const BASE: RobotShadow = {
  name: 'Robby',
  sku: 'c755840',
  softwareVer: 'stingray+24.29.5+2024-11-22-e0a36542cf4+Firmware-Production+246',
  connected: true,
  batPct: 100,
  bin: { present: true, full: false, type: 'std' },
  binPause: true,
  // the Combo's mop: three fields, none of them in the contract yet in phase 1
  tankLvl: 10,
  tankPresent: true,
  detectedPad: 'invalid',
  padWetness: { reusable: 2 },
  evacAllowed: true,
  schedHold: false,
  dock: { known: true, state: 300, cap: { evac: 1, fr: 0, pw: 0, pd: 0 } },
  // `scrub: 1` = this robot MOPS (it's a Combo); `pw: 0` = it no longer hands out its local password
  cap: { scrub: 1, pw: 0, pmaps: 9, maps: 3 },
  signal: { rssi: -41, snr: 55, noise: -96 },
}

const mission = (over: Record<string, unknown>): RobotShadow['cleanMissionStatus'] => ({
  cycle: 'none', phase: 'charge', expireM: 0, rechrgM: 0, error: 0, notReady: 0,
  mssnM: 0, operatingMode: 0, initiator: 'manual', nMssn: 100, ...over,
})

/**
 * 14:26:43 — mission open but robot still: PAUSED. `lastCommand` confirms it.
 *
 * The epochs are those of the capture and don't match its time of day: the mission started at
 * 14:11:37 (`mssnStrtTm`) and the pause was requested at 14:12:41 (`lastCommand.time`) — so what
 * was recorded is a robot that had been stopped for fourteen minutes.
 */
export const PAUSED: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'stop', mssnStrtTm: 1789819897, expireTm: 1789825305 }),
  lastCommand: { command: 'pause', initiator: 'manual', time: 1789819961 },
}

/** 14:28 — return requested from the vendor's app (`initiator: "rmtApp"`). */
export const RETURNING: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'hmUsrDock', operatingMode: 1 }),
  lastCommand: { command: 'dock', initiator: 'rmtApp', time: 1789820941 },
}

/** 14:30:33 — SITTING on its dock, but the mission is not closed yet. The tricky case. */
export const DOCKED_MISSION_OPEN: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'charge' }),
}

/** 14:30:37 — mission closed: idle on its dock. */
export const DOCKED: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'none', phase: 'charge' }),
}

/** 14:34 — set off cleaning again, started from the app. */
export const CLEANING: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'run', initiator: 'rmtApp' }),
  lastCommand: { command: 'start', initiator: 'rmtApp', time: 1789821244 },
}

/**
 * Bin full: the only alarm the `vacuum` contract can carry today.
 *
 * BUILT, not captured — the real robot's bin was empty throughout the session. The field itself is
 * indeed the one the robot publishes (`bin.full`, seen at `false`): only its value is set by hand.
 * To be replaced with a real capture the day the bin fills up.
 */
export const BIN_FULL: RobotShadow = {
  ...DOCKED,
  bin: { present: true, full: true, type: 'std' },
}

/**
 * Robot in fault.
 *
 * BUILT, not captured — the robot never failed at any point during the session, and we didn't want
 * to make it. So this is the least reliable fixture of the lot: code 17 and the pairing of a
 * non-zero `error` ↔ `phase: "stuck"` come from what third-party implementations report, not from
 * this robot. To be replaced with a `/raw` reading at the first real incident.
 */
export const STUCK: RobotShadow = {
  ...BASE,
  cleanMissionStatus: mission({ cycle: 'clean', phase: 'stuck', error: 17 }),
}

/**
 * Mop pad ATTACHED, recorded on 09/19 at 16:02: `detectedPad` goes from `"invalid"` to
 * `"reusableWet"` within the second after the pad is fitted. Those are the only two values seen on
 * this robot; others surely exist (dry pad, disposable pad), hence the reading rule "anything that
 * isn't `invalid` is a pad", rather than a guessed allowlist.
 *
 * The tank, for its part, stayed at 10 — and the vendor's app at the same moment showed its drop
 * almost empty with "Remplissez le réservoir de Robby": that is what establishes that `tankLvl` is
 * a PERCENTAGE and not a homemade scale.
 */
export const MOP_ATTACHED: RobotShadow = {
  ...DOCKED,
  detectedPad: 'reusableWet',
  tankLvl: 10,
  tankPresent: true,
}

/** Tank removed: the level lingering in the shadow no longer means anything. BUILT. */
export const TANK_REMOVED: RobotShadow = {
  ...MOP_ATTACHED,
  tankPresent: false,
}
