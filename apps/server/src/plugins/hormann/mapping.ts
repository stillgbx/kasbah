import type { Command, COVER_MOTIONS, DeviceDescriptor, DeviceId, StatePatch } from '@kasbah/shared'
import { PluginError } from '../../core/plugin'
import { ACTIONS } from './client'
import type { HormannDoorConfig, HormannStatus } from './types'

// HCPBridgeMqtt `/status` ↔ Kasbah contract. One door yields TWO devices: the door (`cover`,
// garage class) and the motor's light (`light`, on/off), linked by the light's `meta.linkedTo`.
//
// The light only TOGGLES over HTTP (action 5): an on/off command is turned into a toggle only when
// the current state differs, otherwise a "switch on" would switch a lit lamp off.

export const PLUGIN_ID = 'hormann'

/**
 * Beyond this age of the last bus exchange, the door is unavailable: the bridge answers but the
 * motor no longer talks to it (bus unplugged, motor off, bridge removed without a bus scan). The
 * motor polls the bus continuously, so the age stays near 0 when all is well; 30 s leaves room for
 * a missed exchange. Not yet measured on a disconnected bus.
 */
export const BUS_MAX_AGE_S = 30

/**
 * The firmware itself sends a target at or below 5 % to a full close and at or above 95 % to a full
 * open (`setPosition`, "first and last movement segments seem a bit inconsistent").
 */
const POSITION_EDGE = 5

export function doorExternalId(doorId: string): string {
  return `${doorId}_door`
}

export function lightExternalId(doorId: string): string {
  return `${doorId}_light`
}

/** Door identifier from a `…_door` / `…_light` externalId. */
export function doorIdOf(externalId: string): string | null {
  for (const suffix of ['_door', '_light']) {
    if (externalId.endsWith(suffix)) return externalId.slice(0, -suffix.length) || null
  }
  return null
}

export function isLightExternalId(externalId: string): boolean {
  return externalId.endsWith('_light')
}

export function toDescriptors(cfg: HormannDoorConfig): DeviceDescriptor[] {
  const doorId = doorExternalId(cfg.id)
  const doorDeviceId = `${PLUGIN_ID}:${doorId}` as DeviceId
  const lightId = lightExternalId(cfg.id)
  const meta = { manufacturer: 'Hörmann', model: 'SupraMatic 4 (HCPBridge)' }
  return [
    {
      id: doorDeviceId,
      pluginId: PLUGIN_ID,
      externalId: doorId,
      kind: 'cover',
      name: cfg.name,
      capabilities: ['open_close', 'stop', 'position'],
      meta: { ...meta, cover: { deviceClass: 'garage' } },
    },
    {
      id: `${PLUGIN_ID}:${lightId}` as DeviceId,
      pluginId: PLUGIN_ID,
      externalId: lightId,
      kind: 'light',
      name: `Éclairage ${cfg.name}`,
      capabilities: ['on_off'],
      meta: { ...meta, linkedTo: doorDeviceId },
    },
  ]
}

export function motionOf(status: HormannStatus): (typeof COVER_MOTIONS)[number] {
  const s = status.doorstate ?? ''
  if (s.startsWith('opening')) return 'opening'
  if (s === 'closing') return 'closing'
  return 'stopped'
}

export function isBusAlive(status: HormannStatus): boolean {
  const age = status.busResponseAge
  return typeof age === 'number' && age >= 0 && age <= BUS_MAX_AGE_S
}

export function toDoorPatch(status: HormannStatus): StatePatch {
  const patch: Record<string, unknown> = { motion: motionOf(status) }
  if (typeof status.currentPosition === 'number') {
    patch.position = Math.min(100, Math.max(0, Math.round(status.currentPosition)))
  }
  return patch as StatePatch
}

export function toLightPatch(status: HormannStatus): StatePatch {
  return (typeof status.light === 'boolean' ? { on: status.light } : {}) as StatePatch
}

/** A firmware request: action code and its parameters, or nothing to send. */
export interface DoorRequest {
  action: number
  params?: Record<string, number>
}

/**
 * Request for a command, given the current state. `null` = nothing to send (the light is already
 * in the asked state, `light.set` without `on`).
 */
export function toRequest(externalId: string, command: Command, current: HormannStatus | undefined): DoorRequest | null {
  if (isLightExternalId(externalId)) {
    if (command.type !== 'light.set') throw new PluginError('UNSUPPORTED_COMMAND', `hormann light cannot do ${command.type}`)
    if (command.on === undefined || command.on === current?.light) return null
    return { action: ACTIONS.toggleLight }
  }
  switch (command.type) {
    case 'cover.open': return { action: ACTIONS.open }
    case 'cover.close': return { action: ACTIONS.close }
    case 'cover.stop': return { action: ACTIONS.stop }
    case 'cover.set_position': return { action: ACTIONS.setPosition, params: { position: Math.round(command.position) } }
    default: throw new PluginError('UNSUPPORTED_COMMAND', `hormann door cannot do ${command.type}`)
  }
}

/**
 * Has the door started doing what was asked? The proof is the published state, never the
 * firmware's "OK". A movement counts as soon as it starts: a full course takes longer than the
 * server lets a command last.
 */
export function effectReached(externalId: string, command: Command, status: HormannStatus): boolean {
  if (isLightExternalId(externalId)) {
    return command.type === 'light.set' && (command.on === undefined || status.light === command.on)
  }
  const motion = motionOf(status)
  const position = status.currentPosition
  switch (command.type) {
    case 'cover.open': return motion === 'opening' || status.doorstate === 'open'
    case 'cover.close': return motion === 'closing' || status.doorstate === 'closed'
    case 'cover.stop': return motion === 'stopped'
    case 'cover.set_position': {
      if (command.position <= POSITION_EDGE) return motion === 'closing' || status.doorstate === 'closed'
      if (command.position >= 100 - POSITION_EDGE) return motion === 'opening' || status.doorstate === 'open'
      return motion !== 'stopped' || (typeof position === 'number' && Math.abs(position - command.position) <= POSITION_EDGE)
    }
    default: return false
  }
}
