/**
 * Les présentations d'album ou d'artiste de YouTube Music sont souvent tirées de Wikipédia et finissent
 * par leur source et leur licence (« Source : Wikipedia (url), licence : Creative Commons… », « From
 * Wikipedia (url) under Creative Commons… »). On sépare le texte de cette mention, pour l'écrire en
 * petit dessous — sans les URL, que YouTube tronque (« …/Erik_Sa..., licence », parfois sans parenthèse
 * fermante) et qui peuvent contenir leurs propres parenthèses (« Paradise_(EP) »).
 */
const CREDIT = /\s*((?:Source\s*:|From)\s+Wikip[eé]dia\b[\s\S]*)$/i

export function splitCredit(description: string | null | undefined): { text: string | null; credit: string | null } {
  const d = description ?? ''
  const m = CREDIT.exec(d)
  const text = d.replace(CREDIT, '').trim() || null
  const credit = m
    ? m[1]!.replace(/\s*\(?https?:\/\/[^\s,)]*\)?/g, '').replace(/[()]/g, '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim() || null
    : null
  return { text, credit }
}
