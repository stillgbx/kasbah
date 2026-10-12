import { SPOKEN_RULES } from './spoken-rules'

// La réponse de l'assistant réécrite pour la voix : ce qui se lit bien à l'écran (« 8h00 », « 21 °C »,
// « RDC ») se prononce mal en synthèse, qui épelle ou saute le symbole. Le texte affiché ne change pas ;
// seul celui envoyé au moteur de synthèse passe ici. Les correspondances sont dans `spoken-rules.ts`,
// plus celles de la maison (`houseWords` : l'abréviation d'un étage → son nom), qui priment et valent
// dans toutes les langues.

/** Ni lettre ni chiffre avant / après : un mot entier, accents compris. */
const BEFORE = '(?<![\\p{L}\\d])'
const AFTER = '(?![\\p{L}\\d])'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const longestFirst = (keys: string[]) => [...keys].sort((a, b) => b.length - a.length)
const endsInWord = (s: string) => /[\p{L}\d]$/u.test(s)

/** Remplace chaque mot de `words` ; « n° » et « env. » finissent sur un signe : l'espace qui suit est repris. */
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
 * Les mots de la maison, casse respectée (« ET » n'est pas « et ») ; une abréviation sans lettre ou d'un
 * seul signe (« 1 », « E ») est écartée : elle remplacerait des nombres et des lettres de la phrase.
 */
const houseOnly = (houseWords: Record<string, string>) =>
  Object.fromEntries(Object.entries(houseWords).filter(([w, said]) => w.length >= 2 && /\p{L}/u.test(w) && w !== said))

export function spokenText(text: string, language: string, houseWords: Record<string, string> = {}): string {
  const rules = SPOKEN_RULES[language]
  let out = replaceWords(text, houseOnly(houseWords), false)
  out = replaceWords(out, rules?.words ?? {}, true)
  if (!rules) return out
  const plural = (n: string) => rules.plural(Number(n.replace(',', '.')))
  // « -3 °C » : le signe seul se tait ; pas dans « 3-5 », collé au nombre d'avant
  out = out.replace(/(^|[\s(])-(?=\d)/g, `$1${rules.minus} `)
  const units = longestFirst(Object.keys(rules.units))
  if (units.length) {
    out = out.replace(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s?(${units.map(escape).join('|')})${AFTER}`, 'gu'), (_, n: string, unit: string) => `${n} ${rules.units[unit]![plural(n) ? 1 : 0]}`)
  }
  if (rules.hours) {
    const [one, many] = rules.hours
    // les minutes sans zéro devant (« 8 heures 5 »), rien pour « 00 »
    const clock = (h: string, m?: string) => `${Number(h)} ${plural(h) ? many : one}${m && Number(m) ? ` ${Number(m)}` : ''}`
    out = out.replace(new RegExp(`(?<![\\d,.])(\\d{1,2})\\s?h(?:\\s?(\\d{2}))?${AFTER}`, 'gu'), (_, h: string, m?: string) => clock(h, m))
    out = out.replace(/(?<![\d:,.])(\d{1,2}):(\d{2})(?![\d:])/g, (_, h: string, m: string) => clock(h, m))
  }
  return out
}
