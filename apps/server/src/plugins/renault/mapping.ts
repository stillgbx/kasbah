import { makeDeviceId, type Capability, type CommandOf, type DeviceDescriptor, type StatePatch } from '@kasbah/shared'
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
export const CAPABILITIES: readonly Capability[] = ['soc', 'range', 'location', 'charge_limit', 'climate_precondition']

/**
 * La climatisation de la R5, telle que son appli la montre (captures de l'utilisateur, 2026-10-01) :
 * « climatiser » maintenant, 10 min au plus ; une consigne ± et trois options — siège conducteur,
 * volant, siège passager — « communes à tous les programmes ». Ce sont des réglages du
 * PRÉCONDITIONNEMENT (`ev/settings` : `preconditioningTemperature`, `preconditioningHeated*`), en
 * marche / arrêt, qui se règlent clim éteinte. Bornes 16-26 °C au degré : HYPOTHÈSE, l'appli ne les
 * montre pas, à corriger au premier refus.
 */
export const CLIMATE_FEATURES = {
  minC: 16, maxC: 26, stepC: 1, seats: ['fl', 'fr'] as ('fl' | 'fr')[], seatLevels: 1, steeringWheelHeat: true, heatWhileOff: true,
}

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
  const color = bodyColor(link)
  return {
    id: makeDeviceId('renault', link.vin),
    pluginId: 'renault',
    externalId: link.vin,
    kind: 'vehicle',
    name: vehicleName(link),
    capabilities: [...capabilities],
    // le fabricant, écrit comme il s'écrit : l'UI affiche sinon l'id du plugin (« renault »), et le
    // constructeur, lui, CRIE ses libellés (`brand.label` = « RENAULT »)
    meta: { manufacturer: 'Renault', vehicle: { ...(color ? { color } : {}), climate: CLIMATE_FEATURES } },
  }
}

/**
 * La teinte réelle du véhicule, déduite de sa configuration d'usine.
 *
 * Renault ne publie NULLE PART le nom de la couleur : ni `vehicleDetails`, ni `/details` — qui
 * pourtant étiquette en clair la batterie, l'autoradio ou la boîte. Ce qu'on a, c'est la référence
 * de configuration passée au moteur de rendu de ses images (`3dv.renault.com/ImageFromBookmark`,
 * paramètre `configuration`), une suite de codes dont `TE<teinte>` porte la peinture de caisse
 * (relevé du 2026-09-15 : `TEGNE`, doublé de `TPGNE` pour les boucliers et `TSGNE` pour les
 * rétroviseurs — même code, donc bien la teinte).
 *
 * La table ne contient QUE des codes vérifiés sur une voiture réelle. Un code inconnu ne rend
 * rien : la scène retombe sur sa couleur de thème et l'utilisateur tranche à la main, ce qui vaut
 * mieux que d'afficher une couleur inventée.
 */
const PAINT: Record<string, string> = {
  // Noir Étoilé, vérifié sur le rendu Renault de la R5 E-Tech du 2026-09-15.
  GNE: '#14171a',
}

export function bodyColor(link: VehicleLink): string | undefined {
  const url = link.vehicleDetails?.assets?.find((a) => a?.assetType === 'PICTURE')?.renditions?.find((r) => r?.url)?.url
  if (!url) return undefined
  const raw = /[?&]configuration=([^&]+)/.exec(url)?.[1]
  if (!raw) return undefined
  // Les codes sont séparés par des `/`, encodés `%2F` dans l'URL — on décode avant de découper.
  const code = decodeURIComponent(raw).split('/').find((c) => /^TE[A-Z0-9]{2,4}$/i.test(c))?.slice(2)
  return code ? PAINT[code.toUpperCase()] : undefined
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
 * Ce que Renault rend à une écriture de réglages n'est PAS un enregistrement : c'est une COMMANDE
 * déposée pour la voiture — `{ commandId, type: 'HVAC_CHARGE_SYNCH', status: 'CREATED' }` — que son
 * boîtier appliquera à sa prochaine connexion, ou jamais s'il dort. On la jetait ; c'est pourtant
 * la seule chose qui dise ce qu'est devenu un réveil. Rendue en une ligne lisible, jamais levée.
 */
export function commandSummary(res: unknown): string | null {
  if (!res || typeof res !== 'object') return null
  const r = res as Record<string, unknown>
  const parts = [r.type, r.status, r.commandId].filter((v) => typeof v === 'string' && v !== '')
  return parts.length ? parts.join(' ') : null
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

/** Le corps de `actions/hvac-start` : démarrer à une consigne, ou annuler. */
export function hvacStartPayload(action: 'start' | 'cancel', targetTemperature?: number): Record<string, unknown> {
  return { data: { type: 'HvacStart', attributes: { action, ...(action === 'start' && targetTemperature !== undefined ? { targetTemperature } : {}) } } }
}

/** Le seuil de batterie sous lequel la R5 refuse de climatiser (`hvac-status.socThreshold`, 15 % à la capture). */
export function hvacSocThreshold(hvac: unknown): number | undefined {
  return num(attributes(hvac)?.socThreshold)
}

/**
 * Les réglages VE avec la consigne, les sièges et le volant demandés. Même règle que `wakePayload` :
 * on rejoue ce que la voiture vient de donner (heure de départ, programmes : SES réglages) et on ne
 * change que les champs du préconditionnement que la commande nomme.
 */
export function climateSettingsPayload(settings: unknown, cmd: CommandOf<'vehicle.climate_set'>, now: number): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return {
    ...(settings as Record<string, unknown>),
    ...(cmd.targetTempC !== undefined ? { preconditioningTemperature: cmd.targetTempC } : {}),
    ...(cmd.seatHeat?.fl !== undefined ? { preconditioningHeatedLeftSeat: cmd.seatHeat.fl > 0 } : {}),
    ...(cmd.seatHeat?.fr !== undefined ? { preconditioningHeatedRightSeat: cmd.seatHeat.fr > 0 } : {}),
    ...(cmd.steeringWheelHeat !== undefined ? { preconditioningHeatedStrgWheel: cmd.steeringWheelHeat } : {}),
    lastSettingsUpdateTimestamp: new Date(now).toISOString(),
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
 *
 * **Et `chargingStatus` MENT (2026-09-19).** Voiture en charge, 5,5 kW mesurés à la borne et par
 * l'onduleur, elle a servi pendant des heures un `0.3` dans des trames par ailleurs FRAÎCHES et
 * exactes : même trame, `batteryLevel` qui grimpe (63 → 71 → 73) et 52 minutes de charge restantes
 * datées de l'instant. L'appli MY Renault affichait la même erreur — c'est le champ qui est faux,
 * pas la liaison. D'où `isCharging()` ci-dessous, qui ne le croit plus sur parole.
 */
export const CHARGE_IN_PROGRESS = 1
/** `plugStatus` : `1` branché, `0` débranché, `-1` erreur, `-2147483648` inconnu. */
export const PLUGGED = 1

/**
 * « Cette voiture charge-t-elle ? » — deux témoins valent mieux qu'un menteur.
 *
 * `chargingStatus === 1.0` reste le oui franc. À défaut, on croit le **temps de charge restant
 * daté de la trame elle-même** : la capture du 2026-09-14 a établi que ce champ TRAÎNE hors charge
 * (rendu daté de l'avant-veille sur une voiture à l'arrêt) et n'est rafraîchi que pendant une
 * charge. Un temps restant à l'heure de la trame est donc une charge en cours, quoi qu'en dise
 * `chargingStatus`.
 *
 * Ce que cette règle ne couvre PAS, faute d'observation : une voiture qui attendrait une charge
 * PROGRAMMÉE en rafraîchissant quand même son estimation. Un seul contre-exemple est connu (14/09,
 * branchée en attente, temps restant vieux de deux jours) et il va dans le bon sens ; si un jour
 * l'UI annonce « en charge » à tort, c'est ici qu'il faut revenir.
 */
export function isCharging(battery: Record<string, unknown>): boolean | undefined {
  const status = num(battery.chargingStatus)
  if (status === CHARGE_IN_PROGRESS) return true
  const eta = num(battery.chargingRemainingTime)
  const fresh = eta !== undefined && eta > 0
    && at(battery.chargingRemainingTimeLastUpdateDateTime) === at(battery.timestamp)
  if (fresh) return true
  // ni l'un ni l'autre : on ne sait dire « non » que si la voiture a donné son état
  return status === undefined ? undefined : false
}

/** Les lectures d'un tour, chacune facultative : la R5 en refuse plusieurs, et une peut échouer. */
export interface VehicleReadings {
  battery?: unknown
  cockpit?: unknown
  location?: unknown
  hvac?: unknown
  socLevels?: unknown
  /** `ev/settings` (kcm) : les réglages du préconditionnement — consigne, sièges, volant. */
  settings?: unknown
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
 * « plus d'autonomie ». `readAt` date les VALEURS et non notre appel (voir plus bas).
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
    // Kamereon ne va pas chercher la voiture : il rend le DERNIER état qu'elle a remonté, et son
    // boîtier se tait dès qu'elle dort. Dater l'état de notre appel serait donc mentir — le
    // 2026-09-19 il a servi six heures durant des chiffres de 11:42 pendant que l'UI annonçait
    // « lu il y a 4 min ». Contrairement à Tesla, la R5 n'a aucune notion de veille : cet
    // horodatage est le seul signe qu'elle a décroché, et c'est ce que `readAt` doit porter.
    patch.readAt = at(battery.timestamp) ?? now
    const soc = num(battery.batteryLevel)
    if (soc !== undefined) patch.soc = soc
    const range = num(battery.batteryAutonomy)
    if (range !== undefined) patch.rangeKm = range
    const plug = num(battery.plugStatus)
    if (plug !== undefined) patch.pluggedIn = plug === PLUGGED
    const charge = isCharging(battery)
    if (charge !== undefined) patch.charging = charge
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
  // `hvacStatus` vaut `off` à la capture ; `on` pendant une climatisation
  const hvacStatus = attributes(r.hvac)?.hvacStatus
  if (typeof hvacStatus === 'string') patch.climateOn = hvacStatus.toLowerCase() === 'on'

  // `ev/settings` (kcm), sans enveloppe : la conduite à gauche fait du siège GAUCHE celui du conducteur
  const settings = r.settings as Record<string, unknown> | null | undefined
  const preTemp = num(settings?.preconditioningTemperature)
  if (preTemp !== undefined) patch.climateTargetC = preTemp
  const left = settings?.preconditioningHeatedLeftSeat, right = settings?.preconditioningHeatedRightSeat
  if (typeof left === 'boolean' && typeof right === 'boolean') patch.seatHeat = { fl: left ? 1 : 0, fr: right ? 1 : 0 }
  const wheel = settings?.preconditioningHeatedStrgWheel
  if (typeof wheel === 'boolean') patch.steeringWheelHeat = wheel

  // `ev/soc-levels` (kcm) n'a pas d'enveloppe `data` : les champs sont à la racine
  const levels = r.socLevels as { socTarget?: unknown; socMin?: unknown } | null | undefined
  const target = num(levels?.socTarget)
  if (target !== undefined) patch.chargeLimit = target
  // le plancher que l'utilisateur a réglé dans sa voiture : Tesla n'a pas cette notion, la R5 si
  const floor = num(levels?.socMin)
  if (floor !== undefined) patch.socMin = floor

  return patch
}
