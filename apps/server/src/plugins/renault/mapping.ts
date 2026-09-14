import { makeDeviceId, type Capability, type DeviceDescriptor, type StatePatch } from '@kasbah/shared'
import { personAccountSchema, vehicleLinkSchema, vehiclesSchema, type PersonAccount, type VehicleLink } from './types'

// Mappage PUR : ressources Renault ↔ contrat Kasbah. Aucun accès réseau, aucun état.
//
// Deux moitiés : du COMPTE au DESCRIPTEUR, et des LECTURES à l'ÉTAT. La seconde est écrite
// d'après la capture du 2026-09-14 (`__fixtures__/kamereon.ts`), pas d'après la documentation —
// qui se serait trompée sur au moins trois points (version de `cockpit`, sens de la température,
// nature de `chargingStatus`).

/**
 * Ce que la R5 dit, et la seule chose qu'elle laisse changer : sa CIBLE de charge (`ev/soc-levels`).
 * Verrouillage, pression, démarrage à distance : la voiture répond 404 ; charge en pause/reprise :
 * 403. Rien d'autre n'est donc déclaré, et l'UI ne propose que ce que le plugin honore.
 */
export const CAPABILITIES: readonly Capability[] = ['soc', 'range', 'location', 'charge_limit']

/**
 * Comptes Kamereon lisibles de la personne. Un foyer en a souvent plusieurs (`MYRENAULT`,
 * `MYDACIA`, parfois un compte résilié) : validés un par un, un compte biscornu n'écarte pas les
 * autres.
 */
export function toAccounts(body: unknown): PersonAccount[] {
  const parsed = personAccountsOf(body)
  return parsed.filter((a) => a.accountStatus === undefined || a.accountStatus.toUpperCase() === 'ACTIVE')
}

function personAccountsOf(body: unknown): PersonAccount[] {
  const outer = (body as { accounts?: unknown })?.accounts
  if (!Array.isArray(outer)) return []
  const out: PersonAccount[] = []
  for (const raw of outer) {
    const parsed = personAccountSchema.safeParse(raw)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/** Véhicules d'un compte, validés un par un : un véhicule illisible n'en cache pas d'autres. */
export function toVehicleLinks(body: unknown): VehicleLink[] {
  const parsed = vehiclesSchema.safeParse(body)
  if (!parsed.success) return []
  const out: VehicleLink[] = []
  for (const raw of parsed.data.vehicleLinks) {
    const link = vehicleLinkSchema.safeParse(raw)
    if (link.success) out.push(link.data)
  }
  return out
}

/**
 * Un véhicule = un appareil `vehicle` identifié par son VIN — stable, sans `:` ni espace, donc un
 * `externalId` valable. Le nom suit ce que le compte sait en dire, du plus parlant au plus brut :
 * la plaque, puis le modèle, puis le VIN.
 */
export function toDescriptor(link: VehicleLink, capabilities: readonly Capability[] = CAPABILITIES): DeviceDescriptor {
  return {
    id: makeDeviceId('renault', link.vin),
    pluginId: 'renault',
    externalId: link.vin,
    kind: 'vehicle',
    name: vehicleName(link),
    capabilities: [...capabilities],
    // le fabricant, écrit comme il s'écrit : l'UI affiche sinon l'id du plugin (« renault »), et le
    // constructeur, lui, CRIE ses libellés (`brand.label` = « RENAULT »)
    meta: { manufacturer: 'Renault' },
  }
}

/** « ZE-123-AB », sinon « Renault 5 E-Tech », sinon le VIN. Jamais vide : le contrat l'exige. */
export function vehicleName(link: VehicleLink): string {
  const d = link.vehicleDetails
  const plate = d?.registrationNumber?.trim()
  if (plate) return plate
  const model = [d?.brand?.label, d?.model?.label].map((s) => s?.trim()).filter(Boolean).join(' ')
  return model || link.vin
}

// ---- Réveil de charge --------------------------------------------------------------------------

/**
 * La charge utile du réveil : les réglages TELS QU'ILS SONT, avec un horodatage neuf. Rien d'autre
 * ne change — c'est l'écriture qui réveille la voiture, pas son contenu. Rejouer des valeurs codées
 * en dur (ce que font d'autres outils) écraserait l'heure de départ, la durée et la température que
 * l'utilisateur a choisies dans sa voiture.
 *
 * `null` si les réglages lus ne sont pas un objet : mieux vaut ne rien envoyer que n'importe quoi.
 */
export function wakePayload(settings: unknown, now: number): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return { ...(settings as Record<string, unknown>), lastSettingsUpdateTimestamp: new Date(now).toISOString() }
}

/**
 * Les niveaux VE avec une nouvelle CIBLE de charge. Même règle que `wakePayload` : on rejoue ce que
 * la voiture vient de donner — le plancher `socMin` est SON réglage, pas le nôtre — et on ne change
 * que la cible, horodatage rafraîchi comme le fait l'application du fabricant.
 */
export function socTargetPayload(levels: unknown, percent: number, now: number): Record<string, unknown> | null {
  if (!levels || typeof levels !== 'object' || Array.isArray(levels)) return null
  return {
    ...(levels as Record<string, unknown>),
    socTarget: percent,
    lastEnergyUpdateTimestamp: new Date(now).toISOString(),
  }
}

/**
 * L'heure locale tombe-t-elle dans la fenêtre `HH:MM`–`HH:MM` ? Le réveil n'a de sens qu'en journée :
 * la nuit, une voiture branchée qui ne charge pas attend souvent SA charge programmée, et la secouer
 * serait se battre contre le réglage de l'utilisateur.
 *
 * Une fenêtre qui passe minuit (`22:00`–`06:00`) est acceptée : elle se lit alors à cheval.
 * Bornes égales = fenêtre vide (jamais), ce qui est le moyen de couper la fonction par la configuration.
 */
export function inWindow(date: Date, from: string, to: string): boolean {
  const min = (hhmm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
    if (!m) return null
    const h = Number(m[1]), mm = Number(m[2])
    return h < 24 && mm < 60 ? h * 60 + mm : null
  }
  const a = min(from), b = min(to)
  if (a === null || b === null || a === b) return false
  const t = date.getHours() * 60 + date.getMinutes()
  return a < b ? t >= a && t < b : t >= a || t < b
}

// ---- Des lectures à l'état ---------------------------------------------------------------------

/**
 * `chargingStatus` est un FLOTTANT ÉNUMÉRÉ, pas un booléen. Les valeurs qui nous concernent :
 * `0.0` pas en charge, `0.1` en attente d'une charge programmée, `0.2` charge terminée,
 * `0.3` en attente de la charge courante, `1.0` charge en cours. Seul `1.0` est « en charge ».
 *
 * `0.3` avec un câble branché est l'état où la R5 se coince quand la borne lui coupe le courant
 * (charge sur surplus solaire) : elle ne repart pas d'elle-même. C'est cet état qu'un futur mode
 * de réveil devra reconnaître.
 */
export const CHARGE_IN_PROGRESS = 1
/** `plugStatus` : `1` branché, `0` débranché, `-1` erreur, `-2147483648` inconnu. */
export const PLUGGED = 1

/** Les lectures d'un tour, chacune facultative : la R5 en refuse plusieurs, et une peut échouer. */
export interface VehicleReadings {
  battery?: unknown
  cockpit?: unknown
  location?: unknown
  hvac?: unknown
  socLevels?: unknown
}

/**
 * Les `attributes` d'une réponse `kca`, ou `undefined`. Gère le cas où Renault rend un HTTP 200
 * SANS `data` — ce que fait `cockpit` en v2, avec un mot d'esprit à la place des données.
 */
function attributes(body: unknown): Record<string, unknown> | undefined {
  const data = (body as { data?: unknown } | null | undefined)?.data
  const attrs = (data as { attributes?: unknown } | null | undefined)?.attributes
  return attrs && typeof attrs === 'object' ? attrs as Record<string, unknown> : undefined
}

/** Un nombre fini, ou `undefined` : `null`, chaîne ou absent ne doivent jamais devenir un zéro. */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Une date ISO en ms epoch, ou `undefined`. */
function at(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * L'état d'un véhicule à partir des lectures du tour. Tout champ absent de la réponse est absent du
 * patch — JAMAIS un zéro : sur ce contrat, `soc: 0` se lirait « batterie vide » et `rangeKm: 0`
 * « plus d'autonomie ». `readAt` date la lecture, c'est ce que l'UI affiche.
 *
 * Ce que la R5 ne donne PAS, et qui reste donc absent : verrouillage, cap, pression des pneus,
 * vitesse et rapport, température extérieure, et la PUISSANCE de charge (revérifié voiture en
 * charge, cf. `BATTERY_CHARGING`) — l'UI l'estime à l'affichage, à partir de la capacité saisie
 * dans la maison ; rien d'estimé n'entre dans l'état.
 */
export function toStatePatch(r: VehicleReadings, now: number): StatePatch<'vehicle'> {
  const patch: StatePatch<'vehicle'> = { readAt: now }

  const battery = attributes(r.battery)
  if (battery) {
    const soc = num(battery.batteryLevel)
    if (soc !== undefined) patch.soc = soc
    const range = num(battery.batteryAutonomy)
    if (range !== undefined) patch.rangeKm = range
    const plug = num(battery.plugStatus)
    if (plug !== undefined) patch.pluggedIn = plug === PLUGGED
    const charge = num(battery.chargingStatus)
    if (charge !== undefined) patch.charging = charge === CHARGE_IN_PROGRESS
    // `chargingRemainingTime` (minutes) TRAÎNE : la capture réelle le donne daté de l'avant-veille
    // sur une voiture débranchée. Il ne vaut que pendant la charge ; sinon on l'efface.
    if (patch.charging) {
      const eta = num(battery.chargingRemainingTime)
      patch.chargeMinutesRemaining = eta !== undefined && eta > 0 ? eta : null
    } else if (charge !== undefined) patch.chargeMinutesRemaining = null
  }

  const odometer = num(attributes(r.cockpit)?.totalMileage)
  if (odometer !== undefined) patch.odometerKm = odometer

  const location = attributes(r.location)
  const lat = num(location?.gpsLatitude)
  const lon = num(location?.gpsLongitude)
  if (lat !== undefined && lon !== undefined) {
    patch.location = { lat, lon, at: at(location?.lastUpdateTime) ?? now }
  }

  // la R5 donne l'INTÉRIEUR de l'habitacle ; elle ne dit rien de la température extérieure
  const inside = num(attributes(r.hvac)?.internalTemperature)
  if (inside !== undefined) patch.insideTempC = inside

  // `ev/soc-levels` (kcm) n'a pas d'enveloppe `data` : les champs sont à la racine
  const levels = r.socLevels as { socTarget?: unknown; socMin?: unknown } | null | undefined
  const target = num(levels?.socTarget)
  if (target !== undefined) patch.chargeLimit = target
  // le plancher que l'utilisateur a réglé dans sa voiture : Tesla n'a pas cette notion, la R5 si
  const floor = num(levels?.socMin)
  if (floor !== undefined) patch.socMin = floor

  return patch
}
