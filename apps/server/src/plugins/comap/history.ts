import type { ConsumptionPoint } from '@kasbah/shared'
import type { ComapHistoryState } from './state'

// Construit l'historique de consommation à partir des lectures successives de `consumption` et de
// `rtc` (l'horloge de la STATION, source de vérité pour dater chaque lecture — pas celle du
// serveur). Fonctions PURES, sans horloge système ni I/O : un état avant, un état après.
//
// JOURNALIER : `consumption.day` est déjà un cumul absolu depuis minuit LOCAL, remis à zéro par la
// station elle-même — un point journalier n'est jamais qu'une RELECTURE de `day`, jamais une somme
// de deltas. La dernière valeur vue un jour donné EST le total de ce jour, qu'on l'ait lue juste
// avant minuit ou pas : quand le jour change, on arrête simplement de mettre à jour son point et on
// en ouvre un nouveau — aucun geste explicite de « clôture » n'est nécessaire.
//
// HORAIRE : `day` ne se remet à zéro qu'à minuit, pas chaque heure — l'heure n'existe donc pas
// côté station, elle s'accumule ici delta par delta. Un delta qui chevauche un changement d'heure
// est crédité en entier à l'heure qui vient de s'ouvrir (l'écart réel, à une cadence de sondage de
// l'ordre de la minute, est négligeable). Un trou de plus d'une heure entre deux lectures, en
// revanche, est TROP LONG pour savoir dans quelle heure la consommation a eu lieu : l'heure ouverte
// à la reprise repart de zéro plutôt que d'hériter d'un delta qui ne lui appartient peut-être pas
// (pas de pic inventé) — les heures sautées restent ABSENTES, jamais à zéro.
//
// MENSUEL : voir `monthlyOf`, plus bas — jamais persisté, la station le donne déjà tout fait.

export const HOURLY_POINTS_MAX = 48
export const DAILY_POINTS_MAX = 62

const HOUR_MS = 3_600_000
/** Au-delà, on ne sait plus dans quelle heure la consommation observée a eu lieu (voir plus haut). */
const MAX_BRIDGE_GAP_MS = HOUR_MS

/** Une lecture réussie, réduite à ce dont l'historique a besoin. */
export interface ComapReading {
  /** `consumption.day` : litres consommés depuis minuit local, selon la station. */
  day: number
  /** Instant de la lecture (ms epoch) — voir `readingAt`. */
  at: number
}

/**
 * Ce qu'il faut garder d'une lecture pour dater et chiffrer la suivante. JAMAIS persisté : un
 * redémarrage n'a pas de précédent (voir `applyReading`), au même titre que `model`/`failures` dans
 * `index.ts` — seuls les points déjà calculés (`ComapHistoryState`) survivent au redémarrage.
 */
export interface ComapHistoryCursor {
  at: number
  day: number
}

/**
 * `rtc.date`/`rtc.time` tels que la station les rend (`[jour, mois, année]`, `[heure, minute]`) →
 * l'instant qu'ils désignent, en heure LOCALE du serveur. Même hypothèse que le fuseau par défaut
 * d'Automower : la station est dans la même maison que le serveur qui la lit.
 */
export function readingAt(rtc: { date: readonly [number, number, number]; time: readonly [number, number] }): number {
  const [d, m, y] = rtc.date
  const [h, min] = rtc.time
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

function localDayStart(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function localHourStart(at: number): number {
  return Math.floor(at / HOUR_MS) * HOUR_MS
}

/** Remplace le dernier point s'il porte déjà ce `t` (même pas de temps), sinon en ajoute un — borné à `max`. */
function upsert(points: ConsumptionPoint[], t: number, litres: number, max: number): ConsumptionPoint[] {
  const last = points[points.length - 1]
  const next = last?.t === t ? [...points.slice(0, -1), { t, litres }] : [...points, { t, litres }]
  return next.length > max ? next.slice(next.length - max) : next
}

/** Ajoute `delta` au dernier point s'il porte déjà ce `t` (part de 0 sinon) — même bornage que `upsert`. */
function addTo(points: ConsumptionPoint[], t: number, delta: number, max: number): ConsumptionPoint[] {
  const last = points[points.length - 1]
  return upsert(points, t, (last?.t === t ? last.litres : 0) + delta, max)
}

/**
 * Intègre une lecture réussie. `cursor` absent = pas de précédent (premier sondage du plugin, ou
 * juste après un redémarrage) : cette lecture pose alors seulement la référence pour la suivante et
 * ne produit qu'un point journalier — `day` étant déjà un cumul, il n'a besoin d'aucun précédent ;
 * `hourly`, lui, reste inchangé (pas de delta calculable sans lecture antérieure).
 */
export function applyReading(
  state: ComapHistoryState,
  cursor: ComapHistoryCursor | undefined,
  reading: ComapReading,
): { state: ComapHistoryState; cursor: ComapHistoryCursor } {
  const daily = upsert(state.daily, localDayStart(reading.at), reading.day, DAILY_POINTS_MAX)
  const nextCursor: ComapHistoryCursor = { at: reading.at, day: reading.day }

  if (!cursor) return { state: { hourly: state.hourly, daily }, cursor: nextCursor }

  const gapMs = reading.at - cursor.at
  const sameDay = localDayStart(reading.at) === localDayStart(cursor.at)
  // `day` est remis à zéro à minuit : passé le changement de jour, le delta EST le cumul du nouveau
  // jour (rien à soustraire à un compteur qui n'existe plus). `Math.max(0, …)` protège d'une horloge
  // ou d'un compteur qui reculerait sans que `rtc` l'ait vu — jamais un delta négatif publié.
  const delta = Math.max(0, sameDay ? reading.day - cursor.day : reading.day)
  const hourStart = localHourStart(reading.at)
  const hourly = gapMs > MAX_BRIDGE_GAP_MS
    ? upsert(state.hourly, hourStart, 0, HOURLY_POINTS_MAX)
    : addTo(state.hourly, hourStart, delta, HOURLY_POINTS_MAX)

  return { state: { hourly, daily }, cursor: nextCursor }
}

/**
 * Historique mensuel : jamais persisté (voir `state.ts`), la station le donne déjà tout fait.
 * `year[i]` pour un mois CLOS, `month` (le cumul courant) pour le mois en cours — qui vaut 0 dans
 * `year` tant qu'il n'est pas terminé, ce que `month` seul sait dire. Les mois pas encore commencés
 * (indices après le mois courant) restent ABSENTS de la série : leur 0 dans `year` ne dit pas
 * « rien consommé », il dit « n'a pas encore eu lieu ».
 */
export function monthlyOf(rtc: { date: readonly [number, number, number] }, month: number, year: readonly number[]): ConsumptionPoint[] {
  const [, rtcMonth, rtcYear] = rtc.date
  const currentIndex = rtcMonth - 1
  const points: ConsumptionPoint[] = []
  for (let i = 0; i <= currentIndex && i < year.length; i++) {
    points.push({ t: new Date(rtcYear, i, 1).getTime(), litres: i === currentIndex ? month : year[i]! })
  }
  return points
}
