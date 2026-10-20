import type { DeviceDescriptor, DeviceId } from './descriptor'
import { DEVICE_ID_RE } from './descriptor'
import { COMMAND_REQUIRES, commandKind, type Command } from './command'
import type { DeviceKind } from './kinds'
import type { DeviceState, StateFor, StatePatch } from './state'

// Pure rules shared server/client: identifiers, command authorization, state merging.

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

/** Checks that the command targets the right kind and a capability declared by the device. */
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

/** Below these thresholds, the vendor's rounding and the collapse of the current at the end of charge distort everything. */
const MIN_POINTS_TO_ESTIMATE = 2
const MIN_MINUTES_TO_ESTIMATE = 5
const MIN_PLAUSIBLE_CHARGE_W = 200
const MAX_PLAUSIBLE_CHARGE_W = 150_000

/**
 * ESTIMATED charge power, for a vehicle that does not say it (the Renault 5 E-Tech; Tesla does).
 *
 * It is NOT deduced from a slope of `soc`: one charge point is worth half a kWh, polling is at
 * ten minutes, the rounding noise would exceed the signal. It is deduced from what the CAR announces
 * — the energy left to put in (target − level, over the battery capacity) divided by the
 * time it gives itself. So it is the car that estimates; Kasbah only does a rule of three.
 *
 * `batteryKwh` comes from the house (`HouseDevice.batteryKwh`), entered by the user: NO
 * vendor gives the battery capacity — neither Tesla nor Renault, not even in the
 * vehicle's data sheet. Without it, no estimate.
 *
 * `undefined` as soon as a piece is missing, when the vehicle already gives its power (there is nothing to
 * estimate), when the charge is nearing its end, or when the result falls outside the powers a car
 * can swallow — better to stay silent than announce an absurd figure.
 */
export function estimateChargePowerW(state: StateFor<'vehicle'>, batteryKwh: number | undefined): number | undefined {
  if (!state.charging || state.chargePowerW || !batteryKwh || batteryKwh <= 0) return undefined
  const { soc, chargeLimit: target, chargeMinutesRemaining: minutes } = state
  if (target === undefined || !minutes) return undefined
  const points = target - soc
  if (points < MIN_POINTS_TO_ESTIMATE || minutes < MIN_MINUTES_TO_ESTIMATE) return undefined
  const watts = ((points / 100) * batteryKwh * 1000 * 60) / minutes
  if (watts < MIN_PLAUSIBLE_CHARGE_W || watts > MAX_PLAUSIBLE_CHARGE_W) return undefined
  return Math.round(watts / 100) * 100                   // to the nearest hundred watts: the computation says no more
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
 * Merges a patch into the state. Returns the SAME reference if nothing changes (dedup):
 * it is what keeps the mock's 1 Hz tick silent on the WebSocket.
 */
export function mergeState<K extends DeviceKind>(prev: StateFor<K>, patch: StatePatch<K>, now: number): StateFor<K> {
  let changed = false
  const prevRec = prev as Record<string, unknown>
  // `null` asks for the CLEARING of the field (see `StatePatch`): it only changes something if
  // the field was present, otherwise a plugin that clears on every frame would wake up the WebSocket.
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'kind' || k === 'updatedAt' || v === undefined) continue
    if (v === null ? k in prevRec : !shallowEqual(prevRec[k], v)) { changed = true; break }
  }
  if (!changed) return prev
  const next: Record<string, unknown> = { ...prevRec }
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'kind' || k === 'updatedAt' || v === undefined) continue
    if (v === null) delete next[k]
    else next[k] = v
  }
  next.updatedAt = now
  return next as StateFor<K>
}

/** Complete initial state (unavailable) for a kind: the client always receives a whole object. */
export function defaultState(kind: DeviceKind, now = 0): DeviceState {
  const base = { updatedAt: now, available: false }
  switch (kind) {
    case 'light': return { kind, ...base, on: false }
    // without `position`: a cover we have received nothing about is not "closed", it is unknown
    case 'cover': return { kind, ...base, motion: 'stopped' }
    case 'media_player': return { kind, ...base, playback: 'off', volume: 0, muted: false }
    case 'climate': return { kind, ...base, mode: 'off', targetTempC: 20, currentTempC: 20 }
    case 'vacuum': return { kind, ...base, activity: 'docked', battery: 0 }
    case 'mower': return { kind, ...base, activity: 'parked', battery: 0 }
    case 'sensor': return { kind, ...base, value: 0 }
    case 'energy': return { kind, ...base, productionW: 0, consumptionW: 0, gridW: 0 }
    case 'ev_charger': return { kind, ...base, status: 'disconnected', powerW: 0, sessionWh: 0 }
    // without `locked`: not all makers report it, unknown is not "locked"
    case 'vehicle': return { kind, ...base, soc: 0, rangeKm: 0, pluggedIn: false, charging: false }
    case 'camera': return { kind, ...base }
    // unavailable AND meaningless: these values are never displayed, `available: false` grays them out
    case 'weather': return { kind, ...base, condition: 'clear', tempC: 0, humidity: 0, windKmh: 0, windDirDeg: 0, cloudCover: 0, isDay: true, sunrise: 0, sunset: 0, observedAt: 0 }
    // no measurement: as long as the station has not answered, each quantity is unknown, not zero
    case 'water': return { kind, ...base }
    // nothing known as long as the cloud has not answered: neither lack of kibble nor portion served
    case 'pet_feeder': return { kind, ...base }
    // `on: false` because the switch must show something; `available: false` grays it out
    case 'pet_fountain': return { kind, ...base, on: false }
    case 'fan': return { kind, ...base, on: false }
  }
}
