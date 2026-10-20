import type { DeviceDescriptor, StateFor, StatePatch } from '@kasbah/shared'
import type { DiscoveredRobot } from './discovery'
import type { RobotShadow } from './mqtt'
import type { StoredRobot } from './types'

// MQTT shadow of an iRobot robot → Kasbah contract. PURE functions, tested on the shadow CAPTURED
// on the device set's Roomba Combo (09/19/2026), never on documentation.
//
// One robot = one `vacuum` device, identified by its BLID (stable, no `:` or space: it's what
// `house.json` will bind, and it's already the MQTT identifier).
//
// WHAT THE CAPTURE TAUGHT US, and that we wouldn't have guessed:
//   - the shadow has 80 top-level keys, including some twenty lifetime counters (`bbrun`,
//     `bbmssn`, `bbchg`) — phase 1 publishes none of them, the `vacuum` contract has nowhere to put them;
//   - the mop has THREE distinct fields (`detectedPad`, `tankPresent`, `tankLvl`) and the captured
//     robot announced `detectedPad: "invalid"` with the pad removed — outside the contract in phase 1;
//   - `bin.type: "std"` exists alongside `present` and `full`: only `full` concerns us.

export const PLUGIN_ID = 'irobot'

/** What EVERY Roomba can do, in the contract's vocabulary. */
export const CAPABILITIES = ['clean', 'dock', 'battery', 'locate'] as const

/**
 * Value of `detectedPad` when NO pad is attached. Measured on the robot on 09/19: `"invalid"` with
 * the pad removed, `"reusableWet"` once the reusable pad is in place. The other values (dry pad,
 * disposable pad) have not been seen — hence the rule "anything that isn't `invalid` is a pad"
 * rather than an allowlist we would have to guess.
 */
const NO_PAD = 'invalid'

export type VacuumActivity = StateFor<'vacuum'>['activity']

/** Section of the shadow that carries the activity. Everything in it is optional: the robot speaks in deltas. */
export interface CleanMissionStatus {
  cycle?: string
  phase?: string
  error?: number
  notReady?: number
  initiator?: string
}

export function readMissionStatus(shadow: RobotShadow): CleanMissionStatus {
  const cms = shadow.cleanMissionStatus
  if (cms === null || typeof cms !== 'object' || Array.isArray(cms)) return {}
  const o = cms as Record<string, unknown>
  return {
    cycle: typeof o.cycle === 'string' ? o.cycle : undefined,
    phase: typeof o.phase === 'string' ? o.phase : undefined,
    error: typeof o.error === 'number' ? o.error : undefined,
    notReady: typeof o.notReady === 'number' ? o.notReady : undefined,
    initiator: typeof o.initiator === 'string' ? o.initiator : undefined,
  }
}

/**
 * The activity depends on TWO fields, never on just one — which is why the shadow must be
 * accumulated before being mapped (`mergeShadow`): a delta carrying only `phase` is not enough to
 * decide.
 *
 * `phase` observed on the real robot: `run` (cleaning), `stop` (stopped), `charge` (on the dock),
 * `hmMidMsn` / `hmPostMsn` / `hmUsrDock` (returning), `evac` (emptying into the dock), `stuck`.
 * `cycle`: `none` when idle, `clean` / `spot` / `dock` / `evac` during a mission.
 */
export function toActivity(cms: CleanMissionStatus): VacuumActivity {
  if ((cms.error ?? 0) > 0) return 'error'
  switch (cms.phase) {
    case 'stuck': return 'error'
    case 'run': case 'new': return 'cleaning'
    case 'hmMidMsn': case 'hmPostMsn': case 'hmUsrDock': case 'dock': return 'returning'
    // `evac` = the robot is ON its dock, emptying into it: so docked, not on a mission
    case 'charge': case 'evac': return 'docked'
    case 'pause': return 'paused'
    case 'stop': return stoppedActivity(cms)
    default: return 'docked'
  }
}

/**
 * The only case the shadow doesn't settle by itself. `phase: "stop"` means "still", and it's
 * `cycle` that says whether a mission remains to be resumed:
 *
 *   - `cycle` other than `none` → a mission is open and suspended: PAUSED. That's the state
 *     captured on 09/19 (`cycle: "clean"`, `phase: "stop"`, `lastCommand: {command: "pause"}`).
 *   - `cycle: "none"` → no mission. The robot is idle, and the `vacuum` contract has no "stopped
 *     where it is" state (the `mower` has one, not this kind): `docked` is the kind's default idle
 *     state, so that's what we return, for lack of anything better to say.
 */
function stoppedActivity(cms: CleanMissionStatus): VacuumActivity {
  return (cms.cycle ?? 'none') === 'none' ? 'docked' : 'paused'
}

function readNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

const asPercent = (n: number): number => Math.max(0, Math.min(100, Math.round(n)))

/**
 * Does the robot MOP, and not just vacuum? The vendor says so in its capability table,
 * `cap.scrub`, present both in the network announcement and in the shadow. Without it we would
 * declare `mop` for a dry Roomba, whose card would show a section it cannot fill.
 */
export function canMop(cap: Record<string, unknown> | undefined): boolean {
  const scrub = cap?.scrub
  return typeof scrub === 'number' ? scrub > 0 : scrub === true
}

/** `bin.full` of the real robot: `{present, full, type}`. Only `full` enters the contract. */
function readBinFull(shadow: RobotShadow): boolean | undefined {
  const bin = shadow.bin
  if (bin === null || typeof bin !== 'object' || Array.isArray(bin)) return undefined
  const full = (bin as Record<string, unknown>).full
  return typeof full === 'boolean' ? full : undefined
}

/**
 * The state published to the house. `battery` is CLAMPED: the contract wants it as a percentage,
 * and an incomplete shadow (the robot hasn't reported its battery yet) must not publish
 * `undefined` in a required field — hence the partial patch, which the registry knows how to merge.
 */
export function toStatePatch(shadow: RobotShadow): StatePatch<'vacuum'> {
  const cms = readMissionStatus(shadow)
  const patch: StatePatch<'vacuum'> = { activity: toActivity(cms) }
  const bat = readNumber(shadow.batPct)
  if (bat !== undefined) patch.battery = asPercent(bat)
  const binFull = readBinFull(shadow)
  if (binFull !== undefined) patch.binFull = binFull
  const code = cms.error ?? 0
  patch.errorMessage = code > 0 ? errorText(code) : null

  // mop — published even if the descriptor doesn't declare `mop`: the registry filters on the
  // kind's keys, not on capabilities, and a dry robot has none of these fields anyway
  const pad = shadow.detectedPad
  if (typeof pad === 'string') patch.mopAttached = pad !== NO_PAD
  const tank = readNumber(shadow.tankLvl)
  // tank removed: the level lingering in the shadow no longer means anything, we clear it
  if (shadow.tankPresent === false) patch.tankLevel = null
  else if (tank !== undefined) patch.tankLevel = asPercent(tank)
  return patch
}

/**
 * The descriptor. The name comes from the robot itself (`name` in the shadow) or, before any
 * connection, from what the account said about it — a switched-off robot must stay named in the
 * inventory.
 */
export function toDescriptor(
  robot: { blid: string; name?: string | null; sku?: string | null; cap?: Record<string, unknown> },
  shadow?: RobotShadow,
): DeviceDescriptor {
  const fromShadow = typeof shadow?.name === 'string' ? shadow.name.trim() : ''
  const name = fromShadow || robot.name?.trim() || 'Roomba'
  const model = (typeof shadow?.sku === 'string' ? shadow.sku : robot.sku ?? undefined)?.trim() || undefined
  // the capability table comes from the network announcement, or from the shadow once the robot is connected
  const cap = (shadow?.cap as Record<string, unknown> | undefined) ?? robot.cap
  return {
    id: `${PLUGIN_ID}:${robot.blid}`,
    pluginId: PLUGIN_ID,
    externalId: robot.blid,
    kind: 'vacuum',
    name,
    capabilities: canMop(cap) ? [...CAPABILITIES, 'mop'] : [...CAPABILITIES],
    meta: { manufacturer: 'iRobot', ...(model ? { model } : {}) },
  }
}

/** What the account knows about a robot, completed by what the network found about it. */
export function mergeRobotIdentity(stored: StoredRobot, found?: DiscoveredRobot): { blid: string; name: string | null; sku: string | null; ip: string | null } {
  return {
    blid: stored.blid,
    name: found?.name ?? stored.name,
    sku: found?.sku ?? stored.sku,
    ip: found?.ip ?? null,
  }
}

/**
 * Contract commands → SEQUENCE of verbs to publish on the `cmd` topic. A sequence, not a verb, for
 * two reasons learned on the real robot:
 *
 *  1. `vacuum.start` doesn't have a single verb. The robot distinguishes `start` (new mission) from
 *     `resume` (resume the paused one); the contract has only one button, so it's the current
 *     ACTIVITY that decides. VERIFIED on Robby: the robot answered `lastCommand:
 *     {command: "resume", initiator: "localApp"}` and set off again.
 *
 *  2. **`dock` is IGNORED while cleaning.** Measured on 09/19 at 14:58: the robot did record
 *     `lastCommand: {command: "dock"}` and did nothing — two and a half minutes later it was still
 *     in `phase: "run"`. No error, no refusal: the message is accepted and has no effect. It has to
 *     be stopped first — `pause` then `dock` brings it back (verified: paused at 15:03:10,
 *     returning at 15:03:18, docked at 15:04:08). That's what the vendor's app does, and that's
 *     why returning a plain `['dock']` here would give a button that lies.
 */
export function toRobotCommands(type: string, activity: VacuumActivity): string[] | null {
  switch (type) {
    case 'vacuum.start': return [activity === 'paused' ? 'resume' : 'start']
    case 'vacuum.pause': return ['pause']
    case 'vacuum.dock': return activity === 'cleaning' ? ['pause', 'dock'] : ['dock']
    case 'vacuum.locate': return ['find']
    default: return null
  }
}

/**
 * Vendor error texts. PARTIAL table, not verified on this robot: it takes the codes that
 * third-party implementations corroborate, and any unknown code comes out as `Error N` rather than
 * an invented label. Same stance as the Husqvarna table — except that the `vacuum` contract has no
 * `errorCode` field, so the number only appears in this fallback text. To be completed as the real
 * robot produces codes (`/raw` route).
 */
export const ERROR_TEXT: Record<number, string> = {
  1: 'Left wheel off floor', 2: 'Main brushes stuck', 3: 'Right wheel off floor',
  4: 'Left wheel stuck', 5: 'Right wheel stuck', 6: 'Stuck near a cliff',
  7: 'Left wheel error', 8: 'Brush stuck', 9: 'Stuck on a cliff',
  10: 'Left wheel stuck', 11: 'Internal error', 12: 'Cliff sensor error',
  13: 'Both wheels off floor', 14: 'Bin missing', 15: 'Reboot required',
  16: 'Bumped unexpectedly', 17: 'Path blocked', 18: 'Docking issue',
  19: 'Undocking issue', 20: 'Docking issue', 21: 'Navigation problem',
  23: 'Battery issue', 26: 'Vacuum problem', 29: 'Software update needed',
  36: 'Bin full', 38: 'Internal communication error', 46: 'Low battery',
}

export function errorText(code: number): string { return ERROR_TEXT[code] ?? `Error ${code}` }
