import type { DeviceDescriptor, DeviceId } from './descriptor'
import { DEVICE_ID_RE } from './descriptor'
import { COMMAND_REQUIRES, commandKind, type Command } from './command'
import type { DeviceKind } from './kinds'
import type { DeviceState, StateFor, StatePatch } from './state'

// Règles pures partagées serveur/client : identifiants, autorisation de commande, fusion d'état.

export function makeDeviceId(pluginId: string, externalId: string): DeviceId {
  return `${pluginId}:${externalId}`
}

export function parseDeviceId(id: string): { pluginId: string; externalId: string } {
  if (!DEVICE_ID_RE.test(id)) throw new Error(`invalid device id "${id}"`)
  const i = id.indexOf(':')
  return { pluginId: id.slice(0, i), externalId: id.slice(i + 1) }
}

export type CommandRejectionCode = 'KIND_MISMATCH' | 'UNSUPPORTED_COMMAND'
export class CommandNotAllowedError extends Error {
  constructor(readonly code: CommandRejectionCode, message: string) {
    super(message)
    this.name = 'CommandNotAllowedError'
  }
}

/** Vérifie que la commande vise le bon kind et une capacité déclarée par l'appareil. */
export function assertCommandAllowed(descriptor: DeviceDescriptor, cmd: Command): void {
  const kind = commandKind(cmd)
  if (kind !== descriptor.kind) {
    throw new CommandNotAllowedError('KIND_MISMATCH', `command ${cmd.type} targets kind ${kind}, device is ${descriptor.kind}`)
  }
  const cap = COMMAND_REQUIRES[cmd.type]
  if (!descriptor.capabilities.includes(cap)) {
    throw new CommandNotAllowedError('UNSUPPORTED_COMMAND', `device ${descriptor.id} lacks capability "${cap}" for ${cmd.type}`)
  }
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>
  return ka.every((k) => shallowEqual(ra[k], rb[k]))
}

/**
 * Fusionne un patch dans l'état. Retourne la MÊME référence si rien ne change (dédup) :
 * c'est ce qui garde le tick 1 Hz du mock silencieux sur le WebSocket.
 */
export function mergeState<K extends DeviceKind>(prev: StateFor<K>, patch: StatePatch<K>, now: number): StateFor<K> {
  let changed = false
  const prevRec = prev as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'kind' || k === 'updatedAt' || v === undefined) continue
    if (!shallowEqual(prevRec[k], v)) { changed = true; break }
  }
  if (!changed) return prev
  const next: Record<string, unknown> = { ...prevRec }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'kind' || k === 'updatedAt' || v === undefined) continue
    next[k] = v
  }
  next.updatedAt = now
  return next as StateFor<K>
}

/** État initial complet (indisponible) pour un kind : le client reçoit toujours un objet entier. */
export function defaultState(kind: DeviceKind, now = 0): DeviceState {
  const base = { updatedAt: now, available: false }
  switch (kind) {
    case 'light': return { kind, ...base, on: false }
    case 'cover': return { kind, ...base, position: 0, motion: 'stopped' }
    case 'media_player': return { kind, ...base, playback: 'off', volume: 0, muted: false }
    case 'climate': return { kind, ...base, mode: 'off', targetTempC: 20, currentTempC: 20 }
    case 'vacuum': return { kind, ...base, activity: 'docked', battery: 0 }
    case 'mower': return { kind, ...base, activity: 'parked', battery: 0 }
    case 'sensor': return { kind, ...base, value: 0 }
    case 'energy': return { kind, ...base, productionW: 0, consumptionW: 0, gridW: 0 }
    case 'ev_charger': return { kind, ...base, status: 'disconnected', powerW: 0, sessionWh: 0 }
    case 'vehicle': return { kind, ...base, soc: 0, rangeKm: 0, pluggedIn: false, charging: false, locked: true }
  }
}
