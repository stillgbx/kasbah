import type { DeviceDescriptor, ReleaseNote, StatePatch, StateFor, VehicleFinish, VehicleGear, VehicleSeat, VehicleSleepState, VehicleUpdateStatus } from '@kasbah/shared'
import { VEHICLE_GEARS, VEHICLE_SLEEP_STATES } from '@kasbah/shared'
import { releaseNoteEntrySchema, type ReleaseNoteEntry, type VehicleData, type VehicleSummary } from './types'

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
export const READ_CAPABILITIES = ['soc', 'range', 'location', 'charge_power', 'release_notes'] as const

/**
 * Ce que le véhicule ACCEPTE qu'on change : la limite de charge (un réglage borné par le contrat), la
 * charge elle-même et le préconditionnement de l'habitacle — rien ne fait bouger ni ouvrir la voiture.
 * Verrouiller reste à faire.
 */
export const WRITE_CAPABILITIES = ['charge_limit', 'charging', 'climate_precondition', 'software_update'] as const

/**
 * Ce que la climatisation sait faire, pour l'UI commune des véhicules. Les bornes sont celles que la
 * voiture annonce (`min/max_avail_temp`, 15-28 °C), le pas celui de son appli (0,5 °C). Cinq places
 * chauffées à trois crans et le volant : ce que l'appli Tesla montre sur la Model S de référence, et
 * ce que sa `climate_state` rapporte (les cinq `seat_heater_*`, `steering_wheel_heater`). Une autre
 * Tesla sans sièges arrière chauffés refuserait la commande, et le refus remonterait tel quel.
 */
export const CLIMATE_FEATURES = {
  minC: 15, maxC: 28, stepC: 0.5,
  seats: ['fl', 'fr', 'rl', 'rc', 'rr'] as VehicleSeat[], seatLevels: 3, steeringWheelHeat: true,
}

/** Numéro de siège de `remote_seat_heater_request` (3 et 6 sont les dossiers arrière, absents ici). */
export const SEAT_HEATER_INDEX: Record<VehicleSeat, number> = { fl: 0, fr: 1, rl: 2, rc: 4, rr: 5 }

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
    meta: {
      manufacturer: 'Tesla', ...(model ? { model } : {}),
      vehicle: { ...(paint?.color ? { color: paint.color } : {}), ...(paint?.finish ? { finish: paint.finish } : {}), climate: CLIMATE_FEATURES },
    },
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
  if (defined(cl?.is_climate_on)) patch.climateOn = cl.is_climate_on
  if (defined(cl?.driver_temp_setting)) patch.climateTargetC = round(cl.driver_temp_setting, 1)
  const seats = { fl: cl?.seat_heater_left, fr: cl?.seat_heater_right, rl: cl?.seat_heater_rear_left, rc: cl?.seat_heater_rear_center, rr: cl?.seat_heater_rear_right }
  const heated = Object.entries(seats).filter(([, v]) => defined(v)) as [string, number][]
  if (heated.length) patch.seatHeat = Object.fromEntries(heated.map(([k, v]) => [k, Math.max(0, Math.min(3, Math.round(v)))]))
  if (defined(cl?.steering_wheel_heater)) patch.steeringWheelHeat = cl.steering_wheel_heater

  // le hash de build éventuel (« 2026.32.7 abc123 ») n'est pas la version qu'on montre
  const version = vs?.car_version?.trim().split(/\s+/)[0]
  if (version) patch.softwareVersion = version
  if (vs?.software_update !== undefined) patch.softwareUpdate = toSoftwareUpdate(vs.software_update)
  return patch
}

const UPDATE_STATUS: Record<string, VehicleUpdateStatus> = {
  available: 'available', scheduled: 'scheduled', downloading: 'downloading',
  downloading_wifi_wait: 'waiting_wifi', installing: 'installing',
}

type SoftwareUpdate = NonNullable<StateFor<'vehicle'>['softwareUpdate']>

/**
 * `software_update` → `softwareUpdate`. Statut vide (rien en attente) = `null`, qui EFFACE le champ.
 * Chaque nombre n'est publié que dans le statut où il veut dire quelque chose : Tesla laisse
 * `install_perc` à 10 sur une mise à jour seulement disponible (capture du 2026-10-02). Un statut
 * inconnu de Tesla compte pour un téléchargement tant qu'il n'est pas complet, sinon pour une mise
 * à jour prête : il y a en tout cas quelque chose en attente.
 */
export function toSoftwareUpdate(su: NonNullable<VehicleData['vehicle_state']>['software_update']): SoftwareUpdate | null {
  const raw = su?.status?.trim()
  if (!su || !raw) return null
  const status = UPDATE_STATUS[raw] ?? (defined(su.download_perc) && su.download_perc < 100 ? 'downloading' : 'available')
  const pct = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
  return {
    status,
    ...(su.version ? { version: su.version } : {}),
    ...(status === 'downloading' && defined(su.download_perc) ? { downloadPct: pct(su.download_perc) } : {}),
    ...(status === 'installing' && defined(su.install_perc) ? { installPct: pct(su.install_perc) } : {}),
    ...(status === 'scheduled' && defined(su.scheduled_time_ms) ? { scheduledAt: su.scheduled_time_ms } : {}),
    ...(defined(su.expected_duration_sec) && su.expected_duration_sec > 0 ? { expectedDurationS: su.expected_duration_sec } : {}),
  }
}

// ---- notes de version ------------------------------------------------------------------------

/** Les entrées lisibles d'une réponse `release_notes` ; une entrée de forme inattendue est écartée seule. */
export function parseReleaseNotes(raw: unknown[] | null | undefined): ReleaseNoteEntry[] {
  return (raw ?? []).flatMap((e) => {
    const parsed = releaseNoteEntrySchema.safeParse(e)
    return parsed.success && parsed.data.title.trim() ? [parsed.data] : []
  })
}

/** Une entrée Tesla → une note du contrat : titre rogné (« Apple Music  »), champs vides omis. */
export function toReleaseNote(e: ReleaseNoteEntry): ReleaseNote {
  const description = e.description?.trim()
  return {
    title: e.title.trim(),
    ...(description ? { description } : {}),
    ...(e.image_url ? { imageUrl: e.image_url } : {}),
    ...(e.light_image_url ? { lightImageUrl: e.light_image_url } : {}),
  }
}

/** Notes par version, dans l'ordre de la réponse. */
export function notesByVersion(entries: ReleaseNoteEntry[]): Record<string, ReleaseNote[]> {
  const out: Record<string, ReleaseNote[]> = {}
  for (const e of entries) {
    if (!e.customer_version) continue
    ;(out[e.customer_version] ??= []).push(toReleaseNote(e))
  }
  return out
}

/** Échéance (ms epoch) d'une URL signée de Tesla (`__gda__=exp=<secondes>~…`) ; `undefined` = pas d'échéance lisible. */
export function urlExpiresAt(url: string | undefined): number | undefined {
  const m = url ? /[?&]__gda__=exp=(\d+)/.exec(url) : null
  return m ? Number(m[1]) * 1000 : undefined
}

/** La plus proche échéance des illustrations de ces notes. */
export function imagesExpireAt(notes: ReleaseNote[]): number | undefined {
  const all = notes.flatMap((n) => [urlExpiresAt(n.imageUrl), urlExpiresAt(n.lightImageUrl)]).filter(defined)
  return all.length ? Math.min(...all) : undefined
}

/** Retire les illustrations périmées : un lien mort afficherait une image cassée. */
export function withoutExpiredImages(note: ReleaseNote, now: number): ReleaseNote {
  const { imageUrl, lightImageUrl, ...rest } = note
  const alive = (u: string | undefined) => u !== undefined && (urlExpiresAt(u) ?? Infinity) > now
  return { ...rest, ...(alive(imageUrl) ? { imageUrl } : {}), ...(alive(lightImageUrl) ? { lightImageUrl } : {}) }
}

/** Ordre des versions Tesla (`2026.32.7` > `2026.32` > `2026.26.6`), numérique segment par segment. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1)
    if (d !== 0 && Number.isFinite(d)) return d
  }
  return a.localeCompare(b)
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
