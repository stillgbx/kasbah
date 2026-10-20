/**
 * YouTube Music's album or artist descriptions are often drawn from Wikipedia and end
 * with their source and license ("Source : Wikipedia (url), licence : Creative Commons…", "From
 * Wikipedia (url) under Creative Commons…"). We separate the text from this mention, to write it
 * small below — without the URLs, which YouTube truncates ("…/Erik_Sa..., licence", sometimes without a closing
 * parenthesis) and which may contain their own parentheses ("Paradise_(EP)").
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
