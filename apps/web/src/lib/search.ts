// Recherche par NOM dans la maison. Pur : ni store, ni DOM — l'agrégation des entités vit dans
// `composables/useSearch.ts`. Pas d'index inversé : quelques centaines d'entrées tiennent en
// mémoire, un balayage par frappe coûte moins que la frappe elle-même. Ce qui compte ici est la
// normalisation (un nom se tape sans accent ni majuscule) et le classement.

/** Minuscules sans diacritiques : « Chambre Étage » se trouve en tapant « etage ». */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Ce qui sépare deux mots dans un nom d'appareil : espaces, tiret, apostrophes, ponctuation. */
const SEPARATOR = /[\s'’·,./_-]/

export const MATCH_START = 3
export const MATCH_WORD = 2
export const MATCH_INSIDE = 1

/**
 * Place d'un terme dans un texte, tous deux déjà normalisés ; `null` s'il est absent. Le nom qui
 * COMMENCE par ce qu'on tape passe devant celui qui le porte au milieu d'un mot : taper « salon »
 * doit donner la pièce Salon avant la lampe « Cube salon ».
 */
export function scoreTerm(haystack: string, term: string): number | null {
  const at = haystack.indexOf(term)
  if (at < 0) return null
  if (at === 0) return MATCH_START
  return SEPARATOR.test(haystack[at - 1]!) ? MATCH_WORD : MATCH_INSIDE
}

/** Les mots de la requête, normalisés. Une requête vide n'a aucun terme. */
export const queryTerms = (query: string): string[] => normalize(query).split(/\s+/).filter(Boolean)

/**
 * Score d'un texte pour une requête de plusieurs mots (« cube salon ») : TOUS les termes doivent y
 * être, et c'est le plus mal placé qui donne la note — un nom où chaque mot tombe en début de mot
 * vaut mieux qu'un nom où l'un d'eux se cache au milieu.
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
