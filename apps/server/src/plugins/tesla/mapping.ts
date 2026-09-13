import type { DeviceDescriptor, StatePatch, VehicleGear, VehicleSleepState } from '@kasbah/shared'
import { VEHICLE_GEARS, VEHICLE_SLEEP_STATES } from '@kasbah/shared'
import type { VehicleData, VehicleSummary } from './types'

// Fleet API Tesla → contrat Kasbah. Fonctions PURES, testées sur les fixtures.
//
// Un véhicule = un appareil `vehicle`, identifié par son VIN (stable pour la vie du véhicule, sans
// `:` ni espace : c'est ce que house.json liera). Deux sortes de patchs, parce que deux sortes de
// lectures qui n'ont pas le même prix :
//   - `toSleepPatch` : la liste des véhicules donne la VEILLE sans réveiller ni facturer cher ;
//   - `toDataPatch` : `vehicle_data` est l'appel cher, et il ne répond que véhicule éveillé.

export const PLUGIN_ID = 'tesla'
const MILE_KM = 1.609344

/** Phase 1 : lecture seule. `soc` porte aussi la commande `vehicle.wake` (voir `COMMAND_REQUIRES`). */
export const READ_CAPABILITIES = ['soc', 'range', 'location'] as const

/** Le 4e caractère d'un VIN Tesla est la gamme : S, 3, X, Y (et C pour le Cybertruck). */
export function modelFromVin(vin: string): string | undefined {
  const code = vin.charAt(3).toUpperCase()
  const model = ({ S: 'Model S', '3': 'Model 3', X: 'Model X', Y: 'Model Y', C: 'Cybertruck' } as Record<string, string>)[code]
  return model
}

export function toDescriptor(v: VehicleSummary): DeviceDescriptor {
  const model = modelFromVin(v.vin)
  const name = v.display_name?.trim() || model || 'Tesla'
  return {
    id: `${PLUGIN_ID}:${v.vin}`, pluginId: PLUGIN_ID, externalId: v.vin, kind: 'vehicle', name,
    capabilities: [...READ_CAPABILITIES],
    meta: { manufacturer: 'Tesla', ...(model ? { model } : {}) },
  }
}

/** Veille normalisée ; une valeur inconnue de Tesla (`waking`…) est lue comme éveillé, sans erreur. */
export function toSleepState(state: string | null | undefined): VehicleSleepState {
  return (VEHICLE_SLEEP_STATES as readonly string[]).includes(state ?? '') ? (state as VehicleSleepState) : 'online'
}

export function toSleepPatch(v: { state: string | null | undefined }): StatePatch<'vehicle'> {
  return { sleepState: toSleepState(v.state) }
}

const round = (n: number, digits = 0) => { const f = 10 ** digits; return Math.round(n * f) / f }
const milesToKm = (mi: number) => round(mi * MILE_KM, 1)
const defined = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined

/**
 * Lecture complète d'un véhicule éveillé. Les `null` du fabricant deviennent des champs ABSENTS du
 * patch (« je ne parle pas de ce champ »), jamais des zéros : une vitesse `null` à l'arrêt vaut 0,
 * mais une pression de pneu `null` veut dire « pas mesurée ».
 */
export function toDataPatch(d: VehicleData): StatePatch<'vehicle'> {
  const c = d.charge_state, dr = d.drive_state, vs = d.vehicle_state, cl = d.climate_state
  const patch: StatePatch<'vehicle'> = { sleepState: toSleepState(d.state) }

  if (defined(c?.battery_level)) patch.soc = Math.max(0, Math.min(100, c.battery_level))
  if (defined(c?.battery_range)) patch.rangeKm = milesToKm(c.battery_range)
  if (defined(c?.charging_state)) {
    // `Disconnected` est la seule valeur qui dise « pas branché » ; tout le reste (Stopped,
    // Complete, NoPower, Charging, Starting) suppose un câble
    patch.pluggedIn = c.charging_state !== 'Disconnected'
    patch.charging = c.charging_state === 'Charging' || c.charging_state === 'Starting'
    // le fabricant donne des kW ENTIERS : c'est grossier, et c'est ce qu'on a
    patch.chargePowerW = patch.charging && defined(c.charger_power) ? Math.round(c.charger_power * 1000) : 0
  }
  if (defined(c?.charge_limit_soc)) patch.chargeLimit = Math.max(0, Math.min(100, c.charge_limit_soc))

  if (defined(vs?.locked)) patch.locked = vs.locked
  if (defined(vs?.odometer)) patch.odometerKm = milesToKm(vs.odometer)
  const tires = { fl: vs?.tpms_pressure_fl, fr: vs?.tpms_pressure_fr, rl: vs?.tpms_pressure_rl, rr: vs?.tpms_pressure_rr }
  const measured = Object.entries(tires).filter(([, v]) => defined(v)) as [string, number][]
  if (measured.length) patch.tirePressureBar = Object.fromEntries(measured.map(([k, v]) => [k, round(v, 2)]))

  if (defined(dr?.latitude) && defined(dr?.longitude)) {
    // `gps_as_of` est en secondes, `timestamp` en millisecondes : deux bases de temps dans la même
    // section, on normalise en ms et on préfère la date du GPS, qui est celle de la mesure
    const at = defined(dr.gps_as_of) ? dr.gps_as_of * 1000 : defined(dr.timestamp) ? dr.timestamp : undefined
    if (at !== undefined) patch.location = { lat: dr.latitude, lon: dr.longitude, at }
  }
  if (dr) {
    // vitesse `null` = à l'arrêt (le fabricant ne met un nombre que quand ça roule)
    patch.speedKmh = defined(dr.speed) ? milesToKm(dr.speed) : 0
    const gear = dr.shift_state?.toUpperCase()
    if (gear && (VEHICLE_GEARS as readonly string[]).includes(gear)) patch.gear = gear as VehicleGear
    // `null` moteur coupé : le véhicule est garé, et le dire vaut mieux qu'un rapport qui reste au `D` du dernier trajet
    else if (dr.shift_state === null) patch.gear = 'P'
  }

  if (defined(cl?.inside_temp)) patch.insideTempC = round(cl.inside_temp, 1)
  if (defined(cl?.outside_temp)) patch.outsideTempC = round(cl.outside_temp, 1)
  return patch
}

/**
 * Le véhicule est-il au REPOS : garé, personne à bord, pas en charge ? C'est le moment où il va
 * s'endormir de lui-même (un quart d'heure) — et où le laisser tranquille compte. Sur un Model S ou
 * X d'avant 2021, une lecture de `vehicle_data` peut retarder la veille ; sur les autres non, mais
 * relire toutes les dix minutes une voiture qui ne fait rien n'apprend rien non plus.
 */
export function isResting(d: VehicleData): boolean {
  const gear = d.drive_state?.shift_state
  const parked = gear === null || gear === undefined || gear.toUpperCase() === 'P'
  const charging = d.charge_state?.charging_state === 'Charging' || d.charge_state?.charging_state === 'Starting'
  return parked && !charging && d.vehicle_state?.is_user_present !== true
}
