import type { ConsumptionPoint, DeviceConsumption } from '@kasbah/shared'

/**
 * Historique de consommation d'eau (`GET /api/devices/:id/consumption`) mis en colonnes pour un
 * graphique en barres. Trois principes, tous dictés par le contrat (`deviceConsumptionSchema`) :
 *
 * 1. Chaque période a un nombre de colonnes FIXE (`PERIOD_STEPS`) : la largeur du graphique ne
 *    dépend jamais de ce que le serveur a mesuré, seulement de la période choisie.
 * 2. Un pas jamais mesuré reste `litres: null`, jamais `0` — c'est le contrat qui le dit
 *    (« un pas jamais mesuré est absent, pas à zéro »), et c'est ce qui distingue à l'écran
 *    « mesuré à 0 L » de « pas de mesure ».
 * 3. `week` et `month` lisent tous les deux `daily` (la même série sert les deux échelles) ; seul
 *    le nombre de colonnes gardées change.
 */
export type ConsumptionPeriod = 'day' | 'week' | 'month' | 'year'
export const CONSUMPTION_PERIODS: readonly ConsumptionPeriod[] = ['day', 'week', 'month', 'year']

/** Nombre de colonnes réservées par période — jamais le nombre de points reçus. */
export const PERIOD_STEPS: Record<ConsumptionPeriod, number> = { day: 24, week: 7, month: 31, year: 12 }

/** La série du contrat qui nourrit cette période. */
export function seriesFor(consumption: DeviceConsumption | null, period: ConsumptionPeriod): readonly ConsumptionPoint[] {
  if (!consumption) return []
  switch (period) {
    case 'day': return consumption.hourly
    case 'week':
    case 'month': return consumption.daily
    case 'year': return consumption.monthly
  }
}

export interface ConsumptionSlot { t: number; litres: number | null }

/** Début du pas courant (heure pleine / minuit / premier du mois), selon la période. */
function currentStepStart(period: ConsumptionPeriod, now: number): Date {
  const d = new Date(now)
  if (period === 'day') { d.setMinutes(0, 0, 0); return d }
  d.setHours(0, 0, 0, 0)
  if (period === 'year') d.setDate(1)
  return d
}

/** Recule `n` pas (heures, jours ou mois civils) depuis un début de pas. */
function stepBack(period: ConsumptionPeriod, from: Date, n: number): number {
  const d = new Date(from)
  if (period === 'day') d.setHours(d.getHours() - n)
  else if (period === 'year') d.setMonth(d.getMonth() - n)
  else d.setDate(d.getDate() - n)
  return d.getTime()
}

/** Tolérance de rapprochement point ↔ pas attendu : un peu moins qu'un demi-pas, pour ne jamais confondre deux pas voisins. */
function tolerance(period: ConsumptionPeriod, stepStart: number, prevStepStart: number): number {
  return (stepStart - prevStepStart) * 0.4
}

/**
 * Range les points reçus dans les `PERIOD_STEPS[period]` derniers pas attendus, DU PLUS ANCIEN AU
 * PLUS RÉCENT. Un pas sans point à proximité reste `null` : c'est un pas jamais mesuré, pas une
 * consommation nulle. Le rapprochement se fait par proximité (et non égalité stricte de `t`) parce
 * que rien dans le contrat ne garantit que l'horloge du serveur tombe pile sur l'heure du navigateur.
 */
export function bucketSlots(points: readonly ConsumptionPoint[], period: ConsumptionPeriod, now = Date.now()): ConsumptionSlot[] {
  const count = PERIOD_STEPS[period]
  const latest = currentStepStart(period, now)
  const starts = Array.from({ length: count }, (_, i) => stepBack(period, latest, count - 1 - i))
  return starts.map((t, i) => {
    const tol = tolerance(period, t, i > 0 ? starts[i - 1]! : stepBack(period, latest, count))
    const hit = points.find((p) => Math.abs(p.t - t) <= tol)
    return { t, litres: hit ? hit.litres : null }
  })
}

/** Somme des pas mesurés d'une fenêtre (les pas absents ne comptent ni pour ni contre). */
export function slotsTotal(slots: readonly ConsumptionSlot[]): number {
  return slots.reduce((sum, s) => sum + (s.litres ?? 0), 0)
}

/** Le plus grand pas mesuré d'une fenêtre, plancher à 1 pour ne jamais diviser par zéro. */
export function slotsMax(slots: readonly ConsumptionSlot[]): number {
  return Math.max(1, ...slots.map((s) => s.litres ?? 0))
}

/**
 * Repères ronds pour l'axe des ordonnées : 3 à 4 valeurs lisibles (multiples de 1, 2 ou 5 × 10ⁿ),
 * jamais le maximum brut mesuré (un axe qui affiche « 12 396 » n'apprend rien qu'un axe à 5 000 /
 * 10 000 ne dise mieux). Le pas de la série (D3 `tickStep`) arrondit vers le haut : un repère qui
 * dépasserait le maximum réel est écarté plutôt que d'étirer les barres pour l'atteindre — c'est ce
 * qui produit l'exemple ci-dessus (12 396 de maximum réel, repères 5 000 et 10 000 seulement).
 */
export function niceAxisTicks(max: number, targetCount = 3): number[] {
  if (max <= 0) return []
  const roughStep = max / targetCount
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const residual = roughStep / magnitude
  const step = (residual >= Math.sqrt(50) ? 10 : residual >= Math.sqrt(10) ? 5 : residual >= Math.sqrt(2) ? 2 : 1) * magnitude
  const ticks: number[] = []
  for (let v = step; v <= max + step * 1e-9; v += step) ticks.push(v)
  return ticks
}

/**
 * Consommation moyenne d'un foyer français, en litres par personne et par jour — Observatoire
 * national des services publics d'eau et d'assainissement (SISPEA, données 2023, publiées 2025) ;
 * stable entre 144 et 150 L depuis 2014.
 *
 * Un ORDRE DE GRANDEUR, jamais un verdict : la consommation PAR PERSONNE baisse quand le foyer
 * grandit (≈148 L/pers. à deux, ≈101 L/pers. à quatre — CIEAU/INSEE) et varie fortement d'une
 * région à l'autre (l'INSEE relève 100 L/j/habitant dans 133 communes franciliennes). `N × 145` ne
 * prétend donc qu'à situer, pas à juger.
 */
export const FRENCH_AVERAGE_LPD_PER_PERSON = 145

/** Repère de consommation moyenne française pour un foyer de `householdSize` personnes, en L/jour. */
export function frenchAverageDailyLitres(householdSize: number): number {
  return FRENCH_AVERAGE_LPD_PER_PERSON * householdSize
}

/** Durée moyenne d'un mois civil (365,25 / 12) : le repère annuel s'en sert pour rester une DROITE
 * plutôt qu'un escalier suivant le nombre de jours réel de chaque mois — choix du propriétaire (voir
 * `frenchAverageReference`). */
const AVERAGE_DAYS_PER_MONTH = 30.44

/**
 * Le repère à comparer à UN pas de la période choisie, ou `null` quand la comparaison n'a pas de
 * sens pour ce pas :
 * - `day` : chaque barre est une HEURE — personne ne consomme uniformément sur 24 h, une ligne
 *   horaire mentirait. Le repère se compare au TOTAL du jour, pas à une barre (voir le graphique).
 * - `week` / `month` : chaque barre est un JOUR — le repère est le même pour toutes, `N × 145`.
 * - `year` : chaque barre est un MOIS — le repère est aussi une DROITE, `N × 145 × 30,44`, pas un
 *   escalier suivant le nombre de jours réel de chaque mois : une ligne plate se lit d'un coup d'œil
 *   sur un mur, ce que le propriétaire préfère à l'exactitude de l'escalier (13,49 m³ un mois de 31
 *   jours, 12,18 en février). Contrepartie assumée : février se compare à un mois moyen et paraît
 *   donc un peu plus économe qu'il ne l'est (nuance donnée en infobulle, voir `referenceHint`).
 */
export function frenchAverageReference(period: ConsumptionPeriod, householdSize: number): number | null {
  if (period === 'day') return null
  const perDay = frenchAverageDailyLitres(householdSize)
  return period === 'year' ? perDay * AVERAGE_DAYS_PER_MONTH : perDay
}
