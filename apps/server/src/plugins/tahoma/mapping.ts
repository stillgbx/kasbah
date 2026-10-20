import { type Capability, type Command, type CoverClass, type DeviceDescriptor, type StatePatch } from '@kasbah/shared'
import type { OverkizAction, OverkizDevice, OverkizState, OverkizValue } from './types'

// PURE translations: Overkiz resources ↔ descriptors / state patches / command bodies.
// Two conventions not to be confused:
//  - Overkiz measures a CLOSURE (`core:ClosureState`, `core:DeploymentState`): 0 = open /
//    retracted, 100 = closed / deployed.
//  - Kasbah measures an OPENING (`position`): 0 = closed, 100 = open.
// Hence the systematic `100 - v` in both directions.

/**
 * The box's uiClass → kind of cover. The rest of the device set (gateway, sensors, heating,
 * siren…) is ignored: this plugin only covers covers. The class travels in `meta.cover.deviceClass`
 * and decides the UI's vocabulary — a blind is raised, it is not opened (see
 * `../../../../../packages/shared/src/devices/kinds.ts`).
 */
export const COVER_UI_CLASSES: Record<string, CoverClass> = {
  RollerShutter: 'shutter',
  Shutter: 'shutter',
  SwingingShutter: 'shutter',
  Awning: 'awning',
  Pergola: 'awning',
  ExteriorVenetianBlind: 'blind',
  VenetianBlind: 'blind',
  ExteriorScreen: 'blind',
  Screen: 'blind',
  Curtain: 'curtain',
  Gate: 'gate',
  GarageDoor: 'garage',
  Window: 'window',
}

/** First command present among `names`, in order of preference. */
function pick(available: Set<string>, names: readonly string[]): string | undefined {
  return names.find((n) => available.has(n))
}

/**
 * The movement commands, resolved from what the box declares. The names vary by family:
 * `open`/`close` (io shutters), `up`/`down` (RTS blinds), `undeploy`/`deploy` (awnings and screens —
 * deployed = closed, so `close` deploys).
 */
export interface CoverCommands {
  open?: string
  close?: string
  stop?: string
  /** `setClosure` / `setDeployment`, parameter expressed as a CLOSURE (0 = open). */
  position?: string
  tilt?: string
  /** `my`: recall of the favorite position stored in the motor, without a parameter. */
  preset?: string
  /** `setMemorized1Position`: rewrites that memory, parameter as a CLOSURE like `setClosure`. */
  presetSet?: string
  /**
   * `setClosureAndLinearSpeed`: target a closure AT LOW SPEED (the app's "quiet mode"). Observed
   * signature `p1,*p2`: the closure, then the speed, optional.
   */
  quiet?: string
}

export function coverCommands(device: OverkizDevice): CoverCommands {
  const names = new Set((device.definition?.commands ?? []).map((c) => c.commandName))
  const out: CoverCommands = {}
  const open = pick(names, ['open', 'up', 'undeploy'])
  const close = pick(names, ['close', 'down', 'deploy'])
  const stop = pick(names, ['stop'])
  const position = pick(names, ['setClosure', 'setDeployment'])
  const tilt = pick(names, ['setOrientation'])
  const preset = pick(names, ['my'])
  const presetSet = pick(names, ['setMemorized1Position'])
  const quiet = pick(names, ['setClosureAndLinearSpeed'])
  if (open) out.open = open
  if (close) out.close = close
  if (stop) out.stop = stop
  if (position) out.position = position
  if (tilt) out.tilt = tilt
  if (preset) out.preset = preset
  if (presetSet) out.presetSet = presetSet
  if (quiet) out.quiet = quiet
  return out
}

/** Current closure states, in order of preference (`DeploymentState`: awnings). */
const CLOSURE_STATES = ['core:ClosureState', 'core:DeploymentState'] as const

/**
 * Does the device report a real position? We read the LIVE states and not `definition.states`: the
 * local API returns that list EMPTY for most devices (observed on firmware 2026.3.3-7; the solar
 * shutters are the exception), whereas the `states` array carries a dozen states for an
 * io-homecontrol motor and stays STRICTLY EMPTY for the one-way RTS radio. It is therefore what tells
 * the two apart, without having to enumerate models or read the deviceURL prefix.
 */
export function hasPositionFeedback(device: OverkizDevice): boolean {
  const present = new Set(device.states.map((st) => st.name))
  return CLOSURE_STATES.some((st) => present.has(st)) || present.has('core:OpenClosedState')
}

/** Kind of cover, `undefined` if the box announces an off-topic uiClass. */
export function coverClass(device: OverkizDevice): CoverClass | undefined {
  return COVER_UI_CLASSES[device.definition?.uiClass ?? '']
}

/** A usable cover: known uiClass AND at least open and close. */
export function isCover(device: OverkizDevice): boolean {
  if (!coverClass(device)) return false
  const cmd = coverCommands(device)
  return !!cmd.open && !!cmd.close
}

/**
 * `deviceURL` → `externalId`. A Kasbah device id is `<pluginId>:<externalId>` and the externalId is
 * used as a URL segment: no `:`, no `/`, no `#`. `io://1234-5678-9012/12345678#2` therefore becomes
 * `io.1234-5678-9012.12345678.2`. Stable (the box does not renumber), hence usable in `house.json`.
 * The reverse mapping lives in the plugin (Map built from discovery).
 */
export function deviceUrlToExternalId(deviceURL: string): string {
  return deviceURL.replace('://', '.').replaceAll('/', '.').replaceAll('#', '.')
}

/** `states` (setup or event) indexed by qualified name. */
export function readStates(states: OverkizState[]): Map<string, OverkizValue> {
  const out = new Map<string, OverkizValue>()
  for (const s of states) out.set(s.name, s.value ?? null)
  return out
}

/** Number 0–100 whatever the representation (`30`, `"30"`); nothing for everything else. */
function pct(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return undefined
  return Math.min(100, Math.max(0, Math.round(n)))
}

function bool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export function toDescriptor(device: OverkizDevice): DeviceDescriptor {
  const externalId = deviceUrlToExternalId(device.deviceURL)
  const cmd = coverCommands(device)
  const cls = coverClass(device)
  const capabilities: Capability[] = ['open_close']
  // `position` is only declared if the box can TARGET a position: without it, the UI shows no
  // slider (an RTS shutter could not honor it).
  if (cmd.position) capabilities.push('position')
  if (cmd.tilt) capabilities.push('tilt')
  if (cmd.stop) capabilities.push('stop')
  // `preset` = the box declares `my`. Independent of `position`: an RTS blind can reach its favorite
  // position without being able to target another one, or say which one it is.
  if (cmd.preset) capabilities.push('preset')
  // writing the memory is one more capability: RTS blinds can recall it without being able to read
  // or rewrite it (observed: 18 recalls, 16 reads, 16 writes out of 19 covers)
  if (cmd.presetSet) capabilities.push('preset_set')
  if (cmd.quiet) capabilities.push('quiet')
  // battery-powered motor (solar shutter): the state is published from `/setup` on, we read it there
  if (device.states.some((st) => st.name === 'core:BatteryLevelState')) capabilities.push('battery')
  return {
    id: `tahoma:${externalId}`,
    pluginId: 'tahoma',
    externalId,
    kind: 'cover',
    name: device.label ?? device.definition?.uiClass ?? externalId,
    capabilities,
    meta: {
      manufacturer: 'Somfy',
      ...(device.controllableName ? { model: device.controllableName } : {}),
      ...(cls ? { cover: { deviceClass: cls } } : {}),
    },
  }
}

/**
 * State patch from the box's states. `previous` is used to guess the direction of movement when
 * the box reports `core:MovingState` without giving a target.
 */
export function toCoverPatch(states: Map<string, OverkizValue>, previous?: number): StatePatch<'cover'> {
  const patch: StatePatch<'cover'> = {}

  let closure: number | undefined
  for (const key of CLOSURE_STATES) {
    const v = pct(states.get(key))
    if (v !== undefined) { closure = v; break }
  }
  const openClosed = states.get('core:OpenClosedState')
  const position = closure !== undefined ? 100 - closure
    : openClosed === 'open' ? 100
    : openClosed === 'closed' ? 0
    : undefined
  if (position !== undefined) patch.position = position

  const tilt = pct(states.get('core:SlateOrientationState'))
  if (tilt !== undefined) patch.tilt = tilt

  // solar shutter: `core:BatteryLevelState` in %, observed next to `core:BatteryState` ('full'…)
  const battery = pct(states.get('core:BatteryLevelState'))
  if (battery !== undefined) patch.batteryPct = battery

  // Favorite position stored in the motor ("my"). Expressed as a CLOSURE, of the same family as
  // `core:ClosureState`, hence the `100 - v`: observed on 16 io shutters, the only one that was not
  // closed sat exactly on its stored value (closure 80, memory 80).
  const memorized = pct(states.get('core:Memorized1PositionState'))
  if (memorized !== undefined) patch.presetPosition = 100 - memorized

  // `core:MovingState` says WHETHER it moves, never in which direction: the direction comes from the
  // announced target (`core:TargetClosureState`) or, failing that, from the previous position.
  const moving = bool(states.get('core:MovingState'))
  if (moving === false) patch.motion = 'stopped'
  else if (moving === true) {
    const targetClosure = pct(states.get('core:TargetClosureState'))
    const target = targetClosure !== undefined ? 100 - targetClosure : undefined
    const from = target !== undefined ? position ?? previous : previous
    const to = target ?? position
    if (from !== undefined && to !== undefined && from !== to) patch.motion = to > from ? 'opening' : 'closing'
    else if (target !== undefined || position !== undefined) patch.motion = 'stopped'
  }
  return patch
}

/** `core:StatusState` ('available' / 'unavailable') or the setup flags. */
export function toAvailability(device: OverkizDevice, states: Map<string, OverkizValue>): boolean {
  const status = states.get('core:StatusState')
  if (status === 'unavailable') return false
  if (status === 'available') return device.enabled !== false
  return device.available !== false && device.enabled !== false
}

/** Second parameter of `setClosureAndLinearSpeed`: the low speed. */
export const LOW_SPEED = 'lowspeed'

/**
 * Translates a Kasbah command into an Overkiz action. `undefined` = the box cannot do it.
 * `quiet`: quiet mode is on — every travel to a known closure (open = 0, close = 100, target a
 * position) then goes through `setClosureAndLinearSpeed` at low speed. The `my` recall has no slow
 * equivalent: it keeps its speed.
 */
export function toAction(deviceURL: string, cmd: Command, commands: CoverCommands, quiet = false): OverkizAction | undefined {
  const one = (name: string, parameters: (string | number)[] = []): OverkizAction =>
    ({ deviceURL, commands: [{ name, parameters }] })
  const slow = quiet ? commands.quiet : undefined
  if (slow) {
    const closure = cmd.type === 'cover.open' ? 0 : cmd.type === 'cover.close' ? 100
      : cmd.type === 'cover.set_position' ? 100 - cmd.position : undefined
    if (closure !== undefined) return one(slow, [closure, LOW_SPEED])
  }
  switch (cmd.type) {
    case 'cover.open': return commands.open ? one(commands.open) : undefined
    case 'cover.close': return commands.close ? one(commands.close) : undefined
    case 'cover.stop': return commands.stop ? one(commands.stop) : undefined
    case 'cover.set_position': return commands.position ? one(commands.position, [100 - cmd.position]) : undefined
    case 'cover.set_tilt': return commands.tilt ? one(commands.tilt, [cmd.tilt]) : undefined
    case 'cover.preset': return commands.preset ? one(commands.preset) : undefined
    // same inversion as `setClosure`: the box stores a closure (`paramsSig: p1`, observed)
    case 'cover.set_preset': return commands.presetSet ? one(commands.presetSet, [100 - cmd.position]) : undefined
    default: return undefined
  }
}

/** Position inferred from an all-or-nothing command, for devices without feedback (RTS). */
export function assumedPosition(cmd: Command): number | undefined {
  if (cmd.type === 'cover.open') return 100
  if (cmd.type === 'cover.close') return 0
  return undefined
}

// ── Light sensors ─────────────────────────────────────────────────────────────────────────────
// A SOLAR shutter declares itself twice: the motor (`…#1`) and its solar panel, presented as a light
// sensor (`io:SunEnergyActuatorSensor`, uiClass `LightSensor`, `…#2`), without any command. The
// sensor becomes a `sensor` device attached to the shutter through `meta.linkedTo`.

/** A usable light sensor: the box classes it `LightSensor` and publishes a luminance. */
export function isLightSensor(device: OverkizDevice): boolean {
  return device.definition?.uiClass === 'LightSensor' && device.states.some((st) => st.name === 'core:LuminanceState')
}

/** The device sharing the same `deviceURL` apart from the sub-device index (`io://…/612895#2` → `#1`). */
export function sameNode(a: string, b: string): boolean {
  return a !== b && a.split('#')[0] === b.split('#')[0]
}

export function toLightSensorDescriptor(device: OverkizDevice, linkedCover?: string): DeviceDescriptor {
  const externalId = deviceUrlToExternalId(device.deviceURL)
  const label = device.label ?? externalId
  return {
    id: `tahoma:${externalId}`,
    pluginId: 'tahoma',
    externalId,
    kind: 'sensor',
    // the box gives the sensor the shutter's label: two devices with the same name in a list
    name: `${label} · luminosité`,
    capabilities: ['measure'],
    meta: {
      manufacturer: 'Somfy',
      ...(device.controllableName ? { model: device.controllableName } : {}),
      // the Somfy app shows this value in lux (maximum on a September day: ~4,000 lx)
      sensor: { unit: 'lx', deviceClass: 'illuminance', precision: 0 },
      ...(linkedCover ? { linkedTo: linkedCover } : {}),
    },
  }
}

/** Luminance in lux, `undefined` if the state is missing or unreadable. */
export function luminance(states: Map<string, OverkizValue>): number | undefined {
  const v = states.get('core:LuminanceState')
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined
}
