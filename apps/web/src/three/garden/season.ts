// Garden season: it changes the foliage (colors, bare trees in winter), the flowers and the
// fruit. `auto` follows the date, in METEOROLOGICAL seasons (March-May = spring…) and in the right
// hemisphere: a house in Nouméa has its summer in January. Settings can force one.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type Season = (typeof SEASONS)[number]
export const SEASON_MODES = ['auto', ...SEASONS] as const
export type SeasonMode = (typeof SEASON_MODES)[number]

/** The season at this date, for a latitude (negative = southern hemisphere, seasons shifted by six months). */
export function seasonAt(date: Date, lat = 45): Season {
  const month = (date.getMonth() + (lat < 0 ? 6 : 0)) % 12
  return month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'autumn' : 'winter'
}

export function resolveSeason(mode: SeasonMode, date: Date, lat?: number): Season {
  return mode === 'auto' ? seasonAt(date, lat) : mode
}
