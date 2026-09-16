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

/** Sous ces seuils, l'arrondi du fabricant et l'effondrement du courant en fin de charge faussent tout. */
const MIN_POINTS_TO_ESTIMATE = 2
const MIN_MINUTES_TO_ESTIMATE = 5
const MIN_PLAUSIBLE_CHARGE_W = 200
const MAX_PLAUSIBLE_CHARGE_W = 150_000

/**
 * Puissance de charge ESTIMÉE, pour un véhicule qui ne la dit pas (la Renault 5 E-Tech ; Tesla, si).
 *
 * Elle ne se déduit PAS d'une pente de `soc` : un point de charge vaut un demi-kWh, le sondage est à
 * dix minutes, le bruit d'arrondi dépasserait le signal. Elle se déduit de ce que la VOITURE annonce
 * — l'énergie qu'il reste à mettre (cible − niveau, sur la capacité de la batterie) divisée par le
 * temps qu'elle se donne. C'est donc la voiture qui estime ; Kasbah ne fait qu'une règle de trois.
 *
 * `batteryKwh` vient de la maison (`HouseDevice.batteryKwh`), saisi par l'utilisateur : AUCUN
 * fabricant ne donne la capacité de la batterie — ni Tesla, ni Renault, pas même dans la fiche du
 * véhicule. Sans elle, pas d'estimation.
 *
 * `undefined` dès qu'un morceau manque, quand le véhicule donne déjà sa puissance (il n'y a rien à
 * estimer), quand la charge touche à sa fin, ou quand le résultat sort des puissances qu'une voiture
 * sait avaler — mieux vaut se taire qu'annoncer un chiffre absurde.
 */
export function estimateChargePowerW(state: StateFor<'vehicle'>, batteryKwh: number | undefined): number | undefined {
  if (!state.charging || state.chargePowerW || !batteryKwh || batteryKwh <= 0) return undefined
  const { soc, chargeLimit: target, chargeMinutesRemaining: minutes } = state
  if (target === undefined || !minutes) return undefined
  const points = target - soc
  if (points < MIN_POINTS_TO_ESTIMATE || minutes < MIN_MINUTES_TO_ESTIMATE) return undefined
  const watts = ((points / 100) * batteryKwh * 1000 * 60) / minutes
  if (watts < MIN_PLAUSIBLE_CHARGE_W || watts > MAX_PLAUSIBLE_CHARGE_W) return undefined
  return Math.round(watts / 100) * 100                   // à la centaine de watts : le calcul n'en dit pas plus
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
  // `null` demande l'EFFACEMENT du champ (voir `StatePatch`) : il ne change quelque chose que si
  // le champ était présent, sinon un plugin qui efface à chaque trame réveillerait le WebSocket.
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

/** État initial complet (indisponible) pour un kind : le client reçoit toujours un objet entier. */
export function defaultState(kind: DeviceKind, now = 0): DeviceState {
  const base = { updatedAt: now, available: false }
  switch (kind) {
    case 'light': return { kind, ...base, on: false }
    // sans `position` : un ouvrant dont on n'a rien reçu n'est pas « fermé », il est inconnu
    case 'cover': return { kind, ...base, motion: 'stopped' }
    case 'media_player': return { kind, ...base, playback: 'off', volume: 0, muted: false }
    case 'climate': return { kind, ...base, mode: 'off', targetTempC: 20, currentTempC: 20 }
    case 'vacuum': return { kind, ...base, activity: 'docked', battery: 0 }
    case 'mower': return { kind, ...base, activity: 'parked', battery: 0 }
    case 'sensor': return { kind, ...base, value: 0 }
    case 'energy': return { kind, ...base, productionW: 0, consumptionW: 0, gridW: 0 }
    case 'ev_charger': return { kind, ...base, status: 'disconnected', powerW: 0, sessionWh: 0 }
    // sans `locked` : tous les constructeurs ne le disent pas, inconnu n'est pas Â« verrouille Â»
    case 'vehicle': return { kind, ...base, soc: 0, rangeKm: 0, pluggedIn: false, charging: false }
    case 'camera': return { kind, ...base }
    // indisponible ET vide de sens : ces valeurs ne s'affichent jamais, `available: false` les grise
    case 'weather': return { kind, ...base, condition: 'clear', tempC: 0, humidity: 0, windKmh: 0, windDirDeg: 0, cloudCover: 0, isDay: true, sunrise: 0, sunset: 0, observedAt: 0 }
  }
}
