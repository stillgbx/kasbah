import { approximateSunPosition, sunPosition } from '../three/core/sun'

// Fait-il jour ? La seule question que pose l'apparence « Auto » (`stores/settings.ts`).
//
// Le seuil n'est PAS le passage de l'horizon : l'app passe en SOMBRE une demi-heure AVANT le
// coucher, et ne revient en CLAIR qu'une demi-heure APRÈS le lever — le crépuscule civil, le moment
// où la pièce s'assombrit alors que le soleil est encore là. Choix de l'utilisateur.
//
// Trois sources, de la meilleure à la dernière, et chacune ne sert que si la précédente manque :
//   1. les heures publiées par l'appareil `weather` (Open-Meteo les donne pour le lieu exact) ;
//   2. sinon le soleil CALCULÉ ici depuis l'origine GPS de la maison (`three/core/sun.ts`) ;
//   3. sinon la journée type 7 h - 21 h d'`approximateSunPosition` — le défaut, écrit une seule fois.
//
// Les deux dernières ne donnent pas des heures mais une HAUTEUR : une demi-heure de course rasante
// vaut environ 5° sous nos latitudes, d'où le seuil. Le décalage est symétrique en hauteur (le
// soleil est aussi haut une demi-heure après son lever qu'une demi-heure avant son coucher), ce qui
// donne la même règle des deux côtés de la journée.

/** Marge de crépuscule prise sur les heures publiées par la météo. */
export const TWILIGHT_MS = 30 * 60 * 1000
/** Hauteur du soleil qui vaut cette marge, quand on n'a que sa position. */
export const DAY_ALTITUDE_DEG = 5

export interface DaylightInput {
  now: Date
  /** Lever publié par la météo (ms epoch). `0` ou absent = pas de météo, on calcule. */
  sunrise?: number
  sunset?: number
  /** Origine géographique de la maison (`house.origin`), ou `null` si elle n'est pas géoréférencée. */
  geo?: { lat: number; lon: number } | null
}

export function isDaylight({ now, sunrise, sunset, geo = null }: DaylightInput): boolean {
  if (sunrise && sunset && sunset > sunrise) {
    const t = now.getTime()
    return t >= sunrise + TWILIGHT_MS && t < sunset - TWILIGHT_MS
  }
  const p = geo ? sunPosition(now, geo.lat, geo.lon) : approximateSunPosition(now)
  return p.altitudeDeg > DAY_ALTITUDE_DEG
}
