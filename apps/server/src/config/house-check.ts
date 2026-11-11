import { lintHouse, safeParseHouse } from '@kasbah/shared'

// `npm run check:house`: validates a house file without starting the server (see `house-cli.ts`).
// Pure, so the tests do not touch the disk. The lines speak French to the user, like `users-cli.ts`.

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

/** Validates the text of a house file: `ok` is false on unreadable JSON or an invalid house only. */
export function checkHouseText(text: string, label: string): { ok: boolean; lines: string[] } {
  let json: unknown
  try { json = JSON.parse(text) } catch (e) {
    return { ok: false, lines: [`✗ ${label} : JSON illisible`, `  - ${(e as Error).message}`] }
  }
  const r = safeParseHouse(json)
  if (!r.success) {
    return { ok: false, lines: [`✗ ${label} : ${plural(r.issues.length, 'erreur')}`, ...r.issues.map((i) => `  - ${i.path}: ${i.message}`)] }
  }
  const warnings = lintHouse(r.house)
  const lines = [`✓ ${label} : maison valide`]
  if (warnings.length) lines.push(`⚠ ${plural(warnings.length, 'avertissement')}`, ...warnings.map((w) => `  - ${w.code} ${w.path} : ${w.message}`))
  return { ok: true, lines }
}
