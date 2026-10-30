import type { Command, DeviceDescriptor, DeviceState, MatterDeviceType } from '@kasbah/shared'

// Pure translation between the Kasbah contract and the Matter device types the bridge publishes.
// No matter.js import here: the library is only loaded when the bridge is enabled.

export type MatterKind = MatterDeviceType

/** What a Kasbah device becomes on the Matter side, or null when the bridge cannot publish it. */
export function matterKindOf(d: DeviceDescriptor, opts: { closures?: boolean } = {}): MatterKind | null {
  const caps = d.capabilities as readonly string[]
  switch (d.kind) {
    case 'light':
      if (!caps.includes('on_off')) return null
      return caps.includes('brightness') ? 'dimmable_light' : 'on_off_light'
    case 'cover': {
      if (!caps.includes('position') && !caps.includes('open_close')) return null
      // garage doors and gates: a Matter 1.5 closure when the house asks for it, otherwise a blind
      // (the only form every assistant knows today)
      const cls = d.meta?.cover?.deviceClass
      return opts.closures && (cls === 'garage' || cls === 'gate') ? 'closure' : 'window_covering'
    }
    case 'vehicle':
      return caps.includes('lock') ? 'door_lock' : null
    case 'fan':
      return caps.includes('on_off') ? 'fan' : null
    default:
      return null
  }
}

// Matter level: 1-254 (0 is reserved for "off" on some controllers). Kasbah brightness: 0-100.
export const levelFromBrightness = (b: number): number => Math.min(254, Math.max(1, Math.round((b * 254) / 100)))
export const brightnessFromLevel = (level: number): number => Math.min(100, Math.max(0, Math.round((level * 100) / 254)))

// Matter lift: hundredths of a percent CLOSED (0 = fully open). Kasbah position: 0 = closed, 100 = open.
export const liftFromPosition = (position: number): number => Math.round((100 - position) * 100)
export const positionFromLift = (lift100ths: number): number => Math.min(100, Math.max(0, 100 - Math.round(lift100ths / 100)))

/**
 * Command for a lift target. A cover without `position` (a one-way radio) only goes to its ends:
 * the nearest one, as a controller slider would suggest.
 */
export function coverCommandForLift(d: DeviceDescriptor, lift100ths: number): Command {
  const position = positionFromLift(lift100ths)
  if ((d.capabilities as readonly string[]).includes('position')) return { type: 'cover.set_position', position }
  return position >= 50 ? { type: 'cover.open' } : { type: 'cover.close' }
}

// DoorLock.LockState values (Matter spec): kept as numbers so that this module stays matter.js-free.
export const LOCK_STATE = { locked: 1, unlocked: 2 } as const

// FanControl.FanMode values (Matter spec), same reason as LOCK_STATE.
export const FAN_MODE = { off: 0, low: 1, medium: 2, high: 3, on: 4, auto: 5, smart: 6 } as const

/** Number of speeds a fan offers (`meta.fan.speeds`), 0 when it only turns on and off. */
export function fanSpeedMax(d: DeviceDescriptor): number {
  if (!(d.capabilities as readonly string[]).includes('fan_speed')) return 0
  return Math.max(0, ...(d.meta?.fan?.speeds ?? []))
}

// The three Matter modes split the speeds in thirds: 6 speeds → low 1-2, medium 3-4, high 5-6.
const modeOfSpeed = (speed: number, max: number): number =>
  speed * 3 <= max ? FAN_MODE.low : speed * 3 <= max * 2 ? FAN_MODE.medium : FAN_MODE.high
const speedOfMode = (mode: number, max: number): number =>
  Math.max(1, Math.round((max * (mode === FAN_MODE.low ? 1 : mode === FAN_MODE.medium ? 2 : 3)) / 3))

/**
 * The Kasbah command for ONE attribute a controller wrote on a fan. Matter leaves it to the device
 * to keep mode, percent and speed consistent: the bridge sends the command, and the state Kasbah
 * reports back writes all of them at once.
 */
export function fanCommandOf(
  attribute: 'fanMode' | 'percentSetting' | 'speedSetting' | 'airflowDirection' | 'onOff',
  value: number | boolean | null,
  speedMax: number,
): Command | null {
  if (value === null) return null
  switch (attribute) {
    case 'onOff':
      return { type: 'fan.set', on: value === true }
    case 'airflowDirection':
      return { type: 'fan.set', direction: value === 1 ? 'reverse' : 'forward' }
    case 'fanMode': {
      if (value === FAN_MODE.off) return { type: 'fan.set', on: false }
      const banded = value === FAN_MODE.low || value === FAN_MODE.medium || value === FAN_MODE.high
      return banded && speedMax ? { type: 'fan.set', on: true, speed: speedOfMode(Number(value), speedMax) } : { type: 'fan.set', on: true }
    }
    case 'percentSetting': {
      const pct = Number(value)
      if (pct <= 0) return { type: 'fan.set', on: false }
      return speedMax ? { type: 'fan.set', on: true, speed: Math.min(speedMax, Math.ceil((pct * speedMax) / 100)) } : { type: 'fan.set', on: true }
    }
    case 'speedSetting': {
      const speed = Number(value)
      if (speed <= 0) return { type: 'fan.set', on: false }
      return { type: 'fan.set', on: true, speed: Math.min(speedMax || speed, speed) }
    }
  }
}

// ClosureControl values (Matter 1.5), same reason as LOCK_STATE.
export const CLOSURE = {
  main: { stopped: 0, moving: 1 },
  current: { fullyClosed: 0, fullyOpened: 1, partiallyOpened: 2 },
  target: { moveToFullyClosed: 0, moveToFullyOpen: 1 },
} as const

/** The Kasbah command for a closure's `moveTo`: open or close, the other target positions are not offered. */
export function closureCommandOf(position: number | undefined): Command | null {
  if (position === CLOSURE.target.moveToFullyOpen) return { type: 'cover.open' }
  if (position === CLOSURE.target.moveToFullyClosed) return { type: 'cover.close' }
  return null
}

/** Attribute values for `endpoint.set()`, by cluster. Absent Kasbah values are not written. */
export function matterStateOf(kind: MatterKind, state: DeviceState, speedMax = 0): Record<string, Record<string, unknown>> {
  switch (kind) {
    case 'on_off_light':
    case 'dimmable_light': {
      if (state.kind !== 'light') return {}
      const out: Record<string, Record<string, unknown>> = { onOff: { onOff: state.on } }
      if (kind === 'dimmable_light' && state.brightness !== undefined) out.levelControl = { currentLevel: levelFromBrightness(state.brightness) }
      return out
    }
    case 'window_covering': {
      if (state.kind !== 'cover') return {}
      // unknown position (one-way radio): null, the Matter way to say it
      const lift = state.position === undefined ? null : liftFromPosition(state.position)
      return { windowCovering: { currentPositionLiftPercent100ths: lift, targetPositionLiftPercent100ths: lift } }
    }
    case 'closure': {
      if (state.kind !== 'cover') return {}
      const position = state.position === undefined ? null
        : state.position <= 0 ? CLOSURE.current.fullyClosed
          : state.position >= 100 ? CLOSURE.current.fullyOpened : CLOSURE.current.partiallyOpened
      const target = state.motion === 'opening' ? CLOSURE.target.moveToFullyOpen
        : state.motion === 'closing' ? CLOSURE.target.moveToFullyClosed : null
      return {
        closureControl: {
          mainState: state.motion === 'stopped' ? CLOSURE.main.stopped : CLOSURE.main.moving,
          // unknown position (one-way radio): null, as for a blind. `secureState` is mandatory in
          // the struct (matter.js refuses the read without it): secure = fully closed.
          overallCurrentState: position === null ? null : { position, secureState: position === CLOSURE.current.fullyClosed },
          overallTargetState: target === null ? null : { position: target },
        },
      }
    }
    case 'fan': {
      if (state.kind !== 'fan') return {}
      // a fan whose speed is unknown runs at its top speed, the Matter "on" with no detail
      const speed = state.on ? Math.min(speedMax, state.speed ?? speedMax) : 0
      const percent = state.on ? (speedMax ? Math.round((speed * 100) / speedMax) : 100) : 0
      const fanControl: Record<string, unknown> = {
        fanMode: !state.on ? FAN_MODE.off : speedMax ? modeOfSpeed(speed, speedMax) : FAN_MODE.on,
        percentSetting: percent, percentCurrent: percent,
      }
      if (speedMax) Object.assign(fanControl, { speedSetting: speed, speedCurrent: speed })
      if (state.direction) fanControl.airflowDirection = state.direction === 'reverse' ? 1 : 0
      return { onOff: { onOff: state.on }, fanControl }
    }
    case 'door_lock': {
      if (state.kind !== 'vehicle') return {}
      const lockState = state.locked === undefined ? null : state.locked ? LOCK_STATE.locked : LOCK_STATE.unlocked
      return { doorLock: { lockState } }
    }
  }
}
