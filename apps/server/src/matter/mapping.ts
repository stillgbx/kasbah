import type { Command, DeviceDescriptor, DeviceState, MatterDeviceType } from '@kasbah/shared'

// Pure translation between the Kasbah contract and the Matter device types the bridge publishes.
// No matter.js import here: the library is only loaded when the bridge is enabled.

export type MatterKind = MatterDeviceType

/** What a Kasbah device becomes on the Matter side, or null when the bridge cannot publish it. */
export function matterKindOf(d: DeviceDescriptor): MatterKind | null {
  const caps = d.capabilities as readonly string[]
  switch (d.kind) {
    case 'light':
      if (!caps.includes('on_off')) return null
      return caps.includes('brightness') ? 'dimmable_light' : 'on_off_light'
    case 'cover':
      // a garage door is a cover too: no voice assistant knows the Matter garage door yet
      return caps.includes('position') || caps.includes('open_close') ? 'window_covering' : null
    case 'vehicle':
      return caps.includes('lock') ? 'door_lock' : null
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

/** Attribute values for `endpoint.set()`, by cluster. Absent Kasbah values are not written. */
export function matterStateOf(kind: MatterKind, state: DeviceState): Record<string, Record<string, unknown>> {
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
    case 'door_lock': {
      if (state.kind !== 'vehicle') return {}
      const lockState = state.locked === undefined ? null : state.locked ? LOCK_STATE.locked : LOCK_STATE.unlocked
      return { doorLock: { lockState } }
    }
  }
}
