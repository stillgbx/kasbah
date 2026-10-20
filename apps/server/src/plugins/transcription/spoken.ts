import { SPOKEN_RULES } from './spoken-rules'

// The assistant's answer rewritten for the voice: what reads well on screen ("8h00", "21 °C", "RDC")
// is mispronounced by speech synthesis, which spells out or skips the symbol. The displayed text
// doesn't change; only the one sent to the synthesis engine goes through here. The mappings are in
// `spoken-rules.ts`, plus the house's own (`houseWords`: a level's abbreviation → its name), which
// take precedence and apply in every language.

/** No letter or digit before / after: a whole word, accents included. */
const BEFORE = '(?<![\\p{L}\\d])'
const AFTER = '(?![\\p{L}\\d])'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const longestFirst = (keys: string[]) => [...keys].sort((a, b) => b.length - a.length)
const endsInWord = (s: string) => /[\p{L}\d]$/u.test(s)

/** Replaces each word of `words`; "n°" and "env." end on a symbol: the following space is kept. */
function replaceWords(text: string, words: Record<string, string>, ignoreCase: boolean): string {
  const keys = Object.keys(words)
  if (!keys.length) return text
  const said = new Map(keys.map((w) => [ignoreCase ? w.toLowerCase() : w, words[w]!]))
  const alternatives = longestFirst(keys).map((w) => (endsInWord(w) ? `${escape(w)}${AFTER}` : `${escape(w)}\\s*`))
  return text.replace(new RegExp(`${BEFORE}(?:${alternatives.join('|')})`, ignoreCase ? 'giu' : 'gu'), (match) => {
    const key = match.trimEnd()
    return `${said.get(ignoreCase ? key.toLowerCase() : key)}${endsInWord(key) ? '' : ' '}`
  })
}

/**
 * The house's words, case respected ("ET" is not "et"); an abbreviation without a letter or of a
 * single character ("1", "E") is left out: it would replace numbers and letters in the sentence.
 */
const houseOnly = (houseWords: Record<string, string>) =>
  Object.fromEntries(Object.entries(houseWords).filter(([w, said]) => w.length >= 2 && /\p{L}/u.test(w) && w !== said))

export function spokenText(text: string, language: string, houseWords: Record<string, string> = {}): string {
  const rules = SPOKEN_RULES[language]
  let out = replaceWords(text, houseOnly(houseWords), false)
  out = replaceWords(out, rules?.words ?? {}, true)
  if (!rules) return out
  const plural = (n: string) => rules.plural(Number(n.replace(',', '.')))
  // "-3 °C": the bare sign is silent; not in "3-5", attached to the number before
  out = out.replace(/(^|[\s(])-(?=\d)/g, `$1${rules.minus} `)
  const units = longestFirst(Object.keys(rules.units))
  if (units.length) {
    out = out.replace(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?(${units.map(escape).join('|')})${AFTER}`, 'gu'), (_, n: string, unit: string) => `${n} ${rules.units[unit]![plural(n) ? 1 : 0]}`)
  }
  if (rules.hours) {
    const [one, many] = rules.hours
    // minutes without a leading zero ("8 heures 5"), nothing for "00"
    const clock = (h: string, m?: string) => `${Number(h)} ${plural(h) ? many : one}${m && Number(m) ? ` ${Number(m)}` : ''}`
    out = out.replace(new RegExp(`(?<![\\d,.])(\\d{1,2})\\s?h(?:\\s?(\\d{2}))?${AFTER}`, 'gu'), (_, h: string, m?: string) => clock(h, m))
    out = out.replace(/(?<![\d:,.])(\d{1,2}):(\d{2})(?![\d:])/g, (_, h: string, m: string) => clock(h, m))
  }
  return out
}
