// Saison du jardin : elle change le feuillage (couleurs, arbres nus l'hiver), les fleurs et les
// fruits. `auto` suit la date, en saisons MÉTÉOROLOGIQUES (mars-mai = printemps…) et dans le bon
// hémisphère : une maison à Nouméa a son été en janvier. Les Réglages peuvent en imposer une.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type Season = (typeof SEASONS)[number]
export const SEASON_MODES = ['auto', ...SEASONS] as const
export type SeasonMode = (typeof SEASON_MODES)[number]

/** La saison à cette date, pour une latitude (négative = hémisphère sud, saisons décalées de six mois). */
export function seasonAt(date: Date, lat = 45): Season {
  const month = (date.getMonth() + (lat < 0 ? 6 : 0)) % 12
  return month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'autumn' : 'winter'
}

export function resolveSeason(mode: SeasonMode, date: Date, lat?: number): Season {
  return mode === 'auto' ? seasonAt(date, lat) : mode
}
