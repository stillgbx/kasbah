import type { DeviceDescriptor, StatePatch } from '@kasbah/shared'
import { feederDataSchema, fountainDataSchema, rosterSchema, workRecordSchema, type FeederData, type RosterDevice } from './types'

// Mappage PetKit → contrat Kasbah.
//
// Deux règles tenues partout : ce que la machine ne dit pas reste INCONNU (jamais 0, jamais false —
// règle du contrat), et on ne publie que les champs dont le sens est établi. Les dizaines d'autres
// clés que l'API rend (réglages de notification, plans de repas, vidéos) n'ont pas de porteur dans
// le contrat et n'en cherchent pas : elles sont lisibles par `GET /api/plugins/petkit/raw`.

export const PLUGIN_ID = 'petkit'

/** Modèles couverts. La mangeoire de cette maison est un `d4`, la fontaine un `ctw3`. */
export const FEEDER_TYPES = ['d3', 'd4', 'd4h'] as const
export const FOUNTAIN_TYPES = ['ctw2', 'ctw3'] as const

/**
 * Rations acceptées, PAR MODÈLE, **dans l'unité BRUTE de l'API** — c'est le fabricant qui les
 * impose et elles ne se déduisent pas. Un `d4` n'en connaît que cinq ; un `d3` accepte tout de 5
 * à 200. Un modèle absent de cette table ne se voit pas proposer de ration plutôt qu'en inventer.
 */
export const RAW_PORTIONS: Record<string, number[]> = {
  d4: [10, 20, 30, 40, 50],
  d4h: [10, 20, 30, 40, 50],
  d3: Array.from({ length: 40 }, (_, i) => (i + 1) * 5),
}

/**
 * L'unité dans laquelle un modèle compte. Un `d4` déclare `settings.factor: 10` et compte en
 * DIXIÈMES DE TASSE ; un `d3` pèse en grammes. La table dit l'unité, l'appareil dit le facteur —
 * afficher « 30 g » là où la machine veut dire 0,3 tasse se trompe d'un facteur trois, et c'est
 * l'erreur qu'on a commise jusqu'au 21/09.
 */
export const FEEDER_UNITS: Record<string, 'cup' | 'g'> = { d4: 'cup', d4h: 'cup', d3: 'g' }

/**
 * Modèles qui savent APPELER l'animal. Pas la Fresh Element Solo : elle n'a pas de haut-parleur,
 * et `d4/callPet` répond **404** (vérifié le 21/09, comme `call_pet` et `soundList`). Le bouton
 * existait et ne faisait rien — c'est l'utilisateur qui l'a remarqué. Seuls les modèles à caméra
 * et micro (gamme YumShare) portent la fonction.
 */
export const CALL_PET_TYPES: readonly string[] = ['d4h', 'd4sh']
/** Facteur de repli quand la machine ne le déclare pas : 10 pour une mangeoire en tasses. */
const DEFAULT_FACTOR: Record<string, number> = { d4: 10, d4h: 10, d3: 1 }

/** Quantité brute → unité affichée. Trois décimales suffisent (les dixièmes de tasse en ont une). */
const toUnit = (raw: number, factor: number): number => Math.round((raw / factor) * 1000) / 1000

/**
 * Où lire l'état, par famille. Ce n'est PAS le même chemin des deux côtés : une mangeoire répond
 * sur `<type>/device_detail`, une fontaine Bluetooth sur `<type>/deviceData` — et `ctw3/device_detail`
 * rend un 404 franc (vérifié le 21/09). Le mauvais chemin ne se devine pas, il se relève.
 */
export const detailPath = (type: string): string =>
  (FOUNTAIN_TYPES as readonly string[]).includes(type) ? `${type}/deviceData` : `${type}/device_detail`

/** Noms commerciaux, pour que la carte dise « Fresh Element Solo » et non « d4 ». */
const MODEL_NAMES: Record<string, string> = {
  d3: 'Fresh Element Infinity', d4: 'Fresh Element Solo', d4h: 'YumShare Solo',
  ctw2: 'Eversweet', ctw3: 'Eversweet Max',
}

export interface PetkitDevice {
  externalId: string
  deviceId: string
  /** Code modèle en minuscules (`d4`, `ctw3`), tel qu'il entre dans les CHEMINS d'API. */
  type: string
  /** Code NUMÉRIQUE du modèle, attendu par les appels Bluetooth (24 pour une Ctw3). */
  typeId: string | null
  /** Diviseur des quantités, déclaré par la machine (`settings.factor`) ; connu au premier détail. */
  factor: number | null
  /** Propriétaire de l'appareil, exigé par le relevé des passages ; connu au premier détail. */
  userId: string | null
  name: string
  groupId: string
  mac: string | null
  kind: 'pet_feeder' | 'pet_fountain'
}

/** Aplatit l'inventaire, qui arrive à plat ou groupé par famille selon les comptes. */
export function toDevices(body: unknown, groupId = ''): PetkitDevice[] {
  const parsed = rosterSchema.safeParse(body)
  if (!parsed.success) return []
  const flat: { dev: RosterDevice; groupId: string }[] = []
  // Le roster est demandé PAR GROUPE : l'appareil ne répète pas l'identifiant du sien, c'est
  // l'appelant qui le connaît. On garde `dev.groupId` quand il est là, pour la forme groupée.
  for (const d of parsed.data.devices ?? []) flat.push({ dev: d, groupId: String(d.groupId ?? groupId) })
  for (const g of parsed.data.list ?? []) {
    for (const d of g.devices ?? []) flat.push({ dev: d, groupId: String(d.groupId ?? g.groupId ?? '') })
  }
  const out: PetkitDevice[] = []
  for (const { dev, groupId } of flat) {
    const type = String(dev.type ?? dev.deviceType ?? '').toLowerCase()
    const kind = (FEEDER_TYPES as readonly string[]).includes(type) ? 'pet_feeder'
      : (FOUNTAIN_TYPES as readonly string[]).includes(type) ? 'pet_fountain' : null
    if (!kind) continue
    const rawId = dev.id ?? dev.deviceId
    if (rawId === undefined) continue
    const deviceId = String(rawId)
    out.push({
      // le type entre dans l'id externe : deux appareils de modèles différents peuvent porter le
      // même identifiant numérique chez PetKit, et l'id doit rester stable d'un démarrage à l'autre
      externalId: `${type}-${deviceId}`,
      deviceId, type, groupId,
      typeId: dev.deviceTypeId === undefined ? null : String(dev.deviceTypeId),
      factor: null,
      userId: null,
      // Nom de REPLI seulement : le roster n'en porte pas. Le vrai nom, celui que l'utilisateur a
      // donné dans l'appli, arrive au premier détail (`toIdentity`).
      name: (dev.name ?? dev.deviceName)?.trim() || `${MODEL_NAMES[type] ?? type} ${deviceId}`,
      mac: dev.mac ?? null,
      kind,
    })
  }
  return out
}

export function toDescriptor(d: PetkitDevice): DeviceDescriptor {
  const model = MODEL_NAMES[d.type] ?? d.type
  if (d.kind === 'pet_feeder') {
    const raw = RAW_PORTIONS[d.type]
    const unit = FEEDER_UNITS[d.type]
    const factor = d.factor ?? DEFAULT_FACTOR[d.type] ?? 1
    const portions = raw && unit ? raw.map((v) => toUnit(v, factor)) : undefined
    return {
      id: `${PLUGIN_ID}:${d.externalId}`, pluginId: PLUGIN_ID, externalId: d.externalId, kind: 'pet_feeder', name: d.name,
      // `feed` seulement si l'on SAIT quelles rations ce modèle accepte ET dans quelle unité :
      // déclarer la capacité sans la liste ferait afficher une section de boutons vide, et sans
      // l'unité ferait afficher des nombres qui ne veulent rien dire.
      capabilities: [
        ...(portions ? (['feed'] as const) : []),
        ...(CALL_PET_TYPES.includes(d.type) ? (['call_pet'] as const) : []),
        'consumables', 'battery',
      ],
      meta: { manufacturer: 'PetKit', model, ...(portions && unit ? { petFeeder: { portions, unit } } : {}) },
    }
  }
  return {
    id: `${PLUGIN_ID}:${d.externalId}`, pluginId: PLUGIN_ID, externalId: d.externalId, kind: 'pet_fountain', name: d.name,
    // `water_usage` ne veut pas dire « un volume » : une Eversweet Max ne mesure aucun millilitre
    // (elle rend -1) mais elle COMPTE LES PASSAGES de l'animal et leur durée, ce que l'appli du
    // fabricant affiche en « 6 fois ». C'est cela qu'on publie.
    capabilities: ['water_usage', 'on_off', 'pump_mode', 'consumables', 'battery'],
    meta: { manufacturer: 'PetKit', model },
  }
}

/**
 * Le nom et l'adresse Bluetooth, tels que le DÉTAIL les porte — le roster ne les donne pas.
 * `btMac` est l'adresse radio propre d'une mangeoire ; `mac` celle de l'appareil. Pour une
 * fontaine, c'est `mac` qui sert de cible au relais.
 */
export function toIdentity(body: unknown): { name: string | null; mac: string | null; factor: number | null; userId: string | null } {
  const o = (body ?? {}) as { name?: unknown; mac?: unknown; btMac?: unknown; userId?: unknown; settings?: { factor?: unknown } }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const f = o.settings?.factor
  return {
    name: str(o.name),
    mac: str(o.mac) ?? str(o.btMac),
    factor: typeof f === 'number' && f > 0 ? f : null,
    userId: str(o.userId) ?? (typeof o.userId === 'number' ? String(o.userId) : null),
  }
}

export function toFeederPatch(body: unknown, type: string, now: number): StatePatch<'pet_feeder'> {
  const parsed = feederDataSchema.safeParse(body)
  if (!parsed.success) return {}
  const d = parsed.data
  const st = d.state
  if (!st) return {}
  const factor = d.settings?.factor ?? DEFAULT_FACTOR[type] ?? 1
  const patch: StatePatch<'pet_feeder'> = {}
  // `food` compte les portions restantes chez certains modèles et vaut 0/1 chez d'autres : dans les
  // deux cas, 0 veut dire « plus rien ». On n'en tire donc QUE le manque, jamais un niveau.
  if (st.food !== undefined) patch.foodLow = st.food <= 0
  if (st.feeding !== undefined) patch.feeding = st.feeding > 0
  if (st.desiccantLeftDays !== undefined) patch.desiccantDays = Math.max(0, Math.round(st.desiccantLeftDays))
  // La machine réelle, sur secteur et SANS piles, répond `batteryPower: 0`. Publier 0 % ferait
  // lire « batterie à plat » là où il n'y a simplement pas de pile. On ne publie donc que du
  // positif — pile absente et pile vide se confondent ici, volontairement : les deux appellent le
  // même geste, aller voir la machine (même arbitrage que le réservoir d'un aspirateur).
  if (st.batteryPower !== undefined && st.batteryPower > 0) patch.batteryPct = clampPct(st.batteryPower)
  const feed = st.feedState
  if (feed?.realAmountTotal !== undefined) patch.servedToday = toUnit(Math.max(0, feed.realAmountTotal), factor)
  if (feed?.planAmountTotal !== undefined) patch.plannedToday = toUnit(Math.max(0, feed.planAmountTotal), factor)
  // Absent d'un `d4` : sans plateau pesant, la machine ne sait pas ce qui a été MANGÉ. La ligne
  // reste alors vide plutôt que d'afficher le servi sous un autre nom.
  if (feed?.eatAmountTotal !== undefined) patch.eatenToday = toUnit(Math.max(0, feed.eatAmountTotal), factor)
  const next = nextMeal(d, now)
  patch.nextMealAt = next?.at ?? null
  patch.nextMealAmount = next ? toUnit(next.amount, factor) : null
  // `null` efface : une erreur résolue doit disparaître de la carte, pas y rester collée.
  patch.errorMessage = st.errorMsg?.trim() ? st.errorMsg.trim() : null
  return patch
}

/**
 * Le prochain repas PROGRAMMÉ d'ici minuit. Le plan arrive en sept listes, une par jour de la
 * semaine (`repeats` : 1 = lundi … 7 = dimanche), chacune portant des repas datés en SECONDES
 * depuis minuit. On prend celle d'aujourd'hui et le premier repas encore à venir.
 *
 * Rien après le dernier repas du jour : on rend `undefined` plutôt que le premier de demain, parce
 * que « prochain repas 01:00 » affiché un soir se lirait comme dans une heure.
 */
function nextMeal(d: FeederData, now: number): { at: number; amount: number } | undefined {
  const day = new Date(now)
  // `repeats` compte à partir de LUNDI, `getDay()` à partir de dimanche.
  const weekday = ((day.getDay() + 6) % 7) + 1
  const today = d.multiFeedItem?.feedDailyList?.find((l) => Number(l.repeats) === weekday)
  if (!today || today.suspended) return undefined
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const upcoming = (today.items ?? [])
    .filter((i) => i.time !== undefined && midnight + i.time * 1000 > now)
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))[0]
  return upcoming?.time === undefined ? undefined : { at: midnight + upcoming.time * 1000, amount: upcoming.amount ?? 0 }
}

export function toFountainPatch(body: unknown, now: number): StatePatch<'pet_fountain'> {
  const parsed = fountainDataSchema.safeParse(body)
  if (!parsed.success) return {}
  const d = parsed.data
  const patch: StatePatch<'pet_fountain'> = {}
  // La marche de la pompe est DANS `status`, pas au premier niveau — lue à côté, elle resterait
  // introuvable et la fontaine paraîtrait éteinte en permanence.
  if (d.status?.powerStatus !== undefined) patch.on = d.status.powerStatus > 0
  // 2 = cycle marche/repos (l'appli dit « Intermittent »), sinon débit continu.
  if (d.mode !== undefined) patch.mode = d.mode === 2 ? 'intermittent' : 'continuous'
  patch.filterPct = known(d.filterPercent) ? clampPct(d.filterPercent) : null
  patch.filterDays = known(d.filterExpectedDays) ? Math.round(d.filterExpectedDays) : null
  if (d.lackWarning !== undefined) patch.waterLow = d.lackWarning > 0
  if (d.electricity?.batteryPercent !== undefined) patch.batteryPct = clampPct(d.electricity.batteryPercent)
  patch.todayMl = known(d.todayCleanWater) ? d.todayCleanWater : null
  if (d.breakdownWarning !== undefined) patch.errorMessage = d.breakdownWarning > 0 ? 'breakdown' : null
  // Date du relevé : c'est la fontaine qui la donne, et à défaut l'instant du relais réussi. Sans
  // elle, la carte laisserait croire au temps réel une valeur parfois vieille de plusieurs heures.
  patch.syncedAt = parseSync(d.syncTime ?? d.updateAt) ?? now
  return patch
}

const clampPct = (v: number): number => Math.min(100, Math.max(0, Math.round(v)))

/**
 * **`-1` est la sentinelle « je ne compte pas ça »**, pas une valeur. La fontaine réelle répond -1
 * pour l'eau du jour, les jours de filtre et le temps de pompe cumulé. Les ramener à 0 afficherait
 * « 0 mL bus » et « 0 jour de filtre » : deux affirmations fausses, là où il n'y a rien à dire
 * (même piège que la sonde absente rendue à -39 par MELCloud).
 */
const known = (v: number | undefined): v is number => v !== undefined && v >= 0

/** Les dates PetKit arrivent en ISO ; une valeur illisible vaut « on ne sait pas dater ». */
function parseSync(v: string | undefined): number | undefined {
  if (!v) return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : undefined
}

/**
 * Les passages du jour, lus dans `getWorkRecord` : combien de fois l'animal est venu boire, et
 * combien de temps il est resté en moyenne. C'est la seule mesure de consommation qu'une Eversweet
 * Max sache produire — elle ne connaît pas les millilitres.
 */
export function toDrinkPatch(body: unknown): StatePatch<'pet_fountain'> {
  const parsed = workRecordSchema.safeParse(body)
  if (!parsed.success) return {}
  const stays = parsed.data.map((r) => r.stayTime).filter((v): v is number => v !== undefined && v >= 0)
  return {
    drinksToday: parsed.data.length,
    // Sans durée relevée, la moyenne n'existe pas : on l'EFFACE plutôt que de rendre 0, qui se
    // lirait « il est venu sans boire ».
    drinkAvgS: stays.length ? Math.round(stays.reduce((a, b) => a + b, 0) / stays.length) : null,
  }
}
