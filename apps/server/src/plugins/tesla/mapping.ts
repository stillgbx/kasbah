import type { DeviceDescriptor, StatePatch, VehicleFinish, VehicleGear, VehicleSleepState } from '@kasbah/shared'
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

/**
 * Ce que le véhicule DIT. `soc` porte aussi les commandes `vehicle.wake` et `vehicle.refresh` (voir
 * `COMMAND_REQUIRES`). `charge_power` dit que la voiture DONNE sa puissance de charge
 * (`charger_power`) : l'UI n'a donc ni à l'estimer, ni à demander la capacité de la batterie.
 */
export const READ_CAPABILITIES = ['soc', 'range', 'location', 'charge_power'] as const

/**
 * Ce que le véhicule ACCEPTE qu'on change. Seule la limite de charge pour l'instant : c'est un
 * réglage, pas un geste — la voiture ne bouge pas, ne s'ouvre pas, et la valeur est bornée par le
 * contrat (50-100 %). Verrouiller et lancer la charge restent à faire.
 */
export const WRITE_CAPABILITIES = ['charge_limit'] as const

/** Le 4e caractère d'un VIN Tesla est la gamme : S, 3, X, Y (et C pour le Cybertruck). */
export function modelFromVin(vin: string): string | undefined {
  const code = vin.charAt(3).toUpperCase()
  const model = ({ S: 'Model S', '3': 'Model 3', X: 'Model X', Y: 'Model Y', C: 'Cybertruck' } as Record<string, string>)[code]
  return model
}

export function toDescriptor(v: VehicleSummary, paint?: { color?: string; finish?: VehicleFinish }): DeviceDescriptor {
  const model = modelFromVin(v.vin)
  const name = v.display_name?.trim() || model || 'Tesla'
  return {
    id: `${PLUGIN_ID}:${v.vin}`, pluginId: PLUGIN_ID, externalId: v.vin, kind: 'vehicle', name,
    capabilities: [...READ_CAPABILITIES, ...WRITE_CAPABILITIES],
    meta: { manufacturer: 'Tesla', ...(model ? { model } : {}), ...(paint?.color || paint?.finish ? { vehicle: paint } : {}) },
  }
}

/**
 * Teintes d'usine de Tesla. APPROXIMATIONS : le fabricant nomme ses couleurs mais n'en publie pas
 * les valeurs. C'est acceptable ici — un nom lisible dit de quelle couleur il s'agit, là où un code
 * opaque (le cas de Renault) ne dirait rien —, et l'utilisateur corrige d'un clic si l'œil proteste.
 */
const PAINT: Record<string, string> = {
  solidblack: '#171a1c',
  obsidianblack: '#1b1c1e',
  midnightsilver: '#35383c',
  steelgrey: '#5c6063',
  stealthgrey: '#4a4c4f',
  titaniummetallic: '#4a4d52',
  silvermetallic: '#b6b8ba',
  quicksilver: '#a9adb2',
  pearlwhite: '#f2f3f5',
  white: '#f2f3f5',
  deepblue: '#1f3a63',
  deepbluemetallic: '#1f3a63',
  redmulti: '#a81c24',
  ultrared: '#b5121b',
  red: '#a81c24',
  metallicbrown: '#5b4436',
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

/**
 * L'ASPECT de la peinture, tiré des deux nombres qui suivent le RGB de `paint_color_override`.
 *
 * MESURÉ, aspect par aspect : le même véhicule, basculé sur son écran de bord entre trois relevés
 * du 2026-09-15.
 *
 *     Mate        40,90,200,0.9,0.30
 *     Métallique  40,90,200,0.9,0.01
 *     Unie        40,90,200,0.7,0.04
 *
 * Deux axes, et il a fallu les trois relevés pour les voir. Le CINQUIÈME se comporte comme une
 * RUGOSITÉ : il s'effondre quand la peinture brille, il monte pour le mat. Le QUATRIÈME comme une
 * MÉTALLICITÉ : identique (0,9) pour les deux peintures à paillettes, plus bas (0,7) pour la teinte
 * unie, qui n'en a pas. Avec les deux premiers relevés seulement, le quatrième semblait constant et
 * ne rien dire — c'est le troisième qui l'a démenti.
 *
 * Les seuils sont posés ENTRE des valeurs mesurées, pas lus au centième : aucun des trois aspects
 * n'est inventé, et un véhicule qui sortirait de ces plages retombe sur le plus proche.
 */
const ROUGHNESS = 4
const METALNESS = 3
/** Entre 0,04 (unie, mesuré) et 0,30 (mate, mesuré) : au-dessus, la peinture diffuse. */
const MATTE_ABOVE = 0.15
/** Entre 0,7 (unie, mesuré) et 0,9 (à paillettes, mesuré). */
const METALLIC_FROM = 0.8

export function bodyFinish(data: Pick<VehicleData, 'vehicle_config'>): VehicleFinish | undefined {
  const parts = data.vehicle_config?.paint_color_override?.split(',').map(Number)
  const roughness = parts?.[ROUGHNESS]
  const metalness = parts?.[METALNESS]
  if (roughness === undefined || !Number.isFinite(roughness)) return undefined
  if (roughness > MATTE_ABOVE) return 'matte'
  return Number.isFinite(metalness!) && metalness! >= METALLIC_FROM ? 'metallic' : 'solid'
}

/**
 * La couleur de la carrosserie, du plus vrai au plus approché :
 *  1. `paint_color_override` — la teinte que le propriétaire a choisie DANS SA VOITURE, en RGB
 *     exact. Elle prime : c'est celle que son écran de bord affiche, donc celle qu'il a en tête.
 *  2. `exterior_color` — le nom de la peinture d'usine, approché par la table ci-dessus.
 *  3. rien, si le nom est inconnu : mieux vaut la couleur de thème qu'une couleur inventée.
 */
export function bodyColor(data: Pick<VehicleData, 'vehicle_config'>): string | undefined {
  const cfg = data.vehicle_config
  if (!cfg) return undefined
  const rgb = cfg.paint_color_override?.split(',').slice(0, 3).map(Number)
  if (rgb?.length === 3 && rgb.every((n) => Number.isFinite(n))) return `#${rgb.map(hex2).join('')}`
  const name = cfg.exterior_color?.trim().toLowerCase()
  return name ? PAINT[name] : undefined
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
    // `time_to_full_charge` est en HEURES décimales, et reste à sa dernière valeur une fois la
    // charge finie : hors charge on EFFACE (`null`), sans quoi la carte annoncerait une fin de
    // charge pour une voiture débranchée
    patch.chargeMinutesRemaining = patch.charging && defined(c.time_to_full_charge) && c.time_to_full_charge > 0
      ? Math.round(c.time_to_full_charge * 60)
      : null
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
  if (defined(dr?.heading)) patch.headingDeg = ((dr.heading % 360) + 360) % 360
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
