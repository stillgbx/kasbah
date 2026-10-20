// Search by NAME in the house. Pure: no store, no DOM — the aggregation of entities lives in
// `composables/useSearch.ts`. No inverted index: a few hundred entries fit in
// memory, a sweep per keystroke costs less than the keystroke itself. What matters here is
// normalization (a name is typed without accents or capitals) and ranking.

/** Lowercase without diacritics: "Chambre Étage" is found by typing "etage". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** What separates two words in a device name: spaces, hyphen, apostrophes, punctuation. */
const SEPARATOR = /[\s'’·,./_-]/

export const MATCH_START = 3
export const MATCH_WORD = 2
export const MATCH_INSIDE = 1

/**
 * Position of a term in a text, both already normalized; `null` if absent. The name that
 * STARTS with what we type comes before the one that carries it in the middle of a word: typing "salon"
 * must give the room Salon before the light "Cube salon".
 */
export function scoreTerm(haystack: string, term: string): number | null {
  const at = haystack.indexOf(term)
  if (at < 0) return null
  if (at === 0) return MATCH_START
  return SEPARATOR.test(haystack[at - 1]!) ? MATCH_WORD : MATCH_INSIDE
}

/** The words of the query, normalized. An empty query has no terms. */
export const queryTerms = (query: string): string[] => normalize(query).split(/\s+/).filter(Boolean)

/**
 * Score of a text for a multi-word query ("cube salon"): ALL the terms must be in it,
 * and it is the worst placed that gives the grade — a name where each word falls at a word start
 * is better than a name where one of them hides in the middle.
 */
export function scoreQuery(haystack: string, terms: readonly string[]): number | null {
  if (terms.length === 0) return null
  let worst = Infinity
  for (const term of terms) {
    const s = scoreTerm(haystack, term)
    if (s === null) return null
    if (s < worst) worst = s
  }
  return worst
}
