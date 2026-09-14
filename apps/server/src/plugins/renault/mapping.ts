import { makeDeviceId, type Capability, type DeviceDescriptor, type StatePatch } from '@kasbah/shared'
import { personAccountSchema, vehicleLinkSchema, vehiclesSchema, type PersonAccount, type VehicleLink } from './types'

// Mappage PUR : ressources Renault ↔ contrat Kasbah. Aucun accès réseau, aucun état.
//
// Deux moitiés : du COMPTE au DESCRIPTEUR, et des LECTURES à l'ÉTAT. La seconde est écrite
// d'après la capture du 2026-09-14 (`__fixtures__/kamereon.ts`), pas d'après la documentation —
// qui se serait trompée sur au moins trois points (version de `cockpit`, sens de la température,
// nature de `chargingStatus`).

/** Phase 1 : lecture seule. Aucune commande n'est déclarée, donc l'UI n'en propose aucune. */
export const PHASE_1_CAPABILITIES: readonly Capability[] = ['soc', 'range', 'location']

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
export function toDescriptor(link: VehicleLink, capabilities: readonly Capability[] = PHASE_1_CAPABILITIES): DeviceDescriptor {
  return {
    id: makeDeviceId('renault', link.vin),
    pluginId: 'renault',
    externalId: link.vin,
    kind: 'vehicle',
    name: vehicleName(link),
    capabilities: [...capabilities],
    meta: {},
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
 * Ce que la R5 ne donne PAS, et qui reste donc absent : verrouillage, puissance de charge
 * instantanée, cap, pression des pneus, vitesse et rapport, température extérieure.
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
  const target = num((r.socLevels as { socTarget?: unknown } | null | undefined)?.socTarget)
  if (target !== undefined) patch.chargeLimit = target

  return patch
}
