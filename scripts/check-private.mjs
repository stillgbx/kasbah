#!/usr/bin/env node
/**
 * Garde-fou des données personnelles : refuse ce qui identifierait la vraie maison ou sa famille.
 *
 * La liste des valeurs interdites est elle-même sensible : elle vit dans `.private-denylist` à la
 * racine, fichier gitignoré qui n'existe que chez le propriétaire. Une ligne par valeur, littérale,
 * ou `re:<expression régulière>` ; `#` commente. Sans ce fichier, le script ne bloque rien.
 *
 *   node scripts/check-private.mjs            tout le dépôt suivi (fichiers de travail)
 *   node scripts/check-private.mjs --staged   les lignes ajoutées du commit en préparation (hook pre-commit)
 *   node scripts/check-private.mjs --message <fichier>   le message de commit (hook commit-msg)
 *
 * Hooks : `npm run hooks` pointe git sur `.githooks/` (une fois par clone).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const listFile = join(root, '.private-denylist')

if (!existsSync(listFile)) {
  if (process.argv.includes('--all')) console.warn('[check-private] pas de .private-denylist : rien à vérifier')
  process.exit(0)
}

const rules = readFileSync(listFile, 'utf8').split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => (l.startsWith('re:') ? new RegExp(l.slice(3), 'u') : { test: (s) => s.includes(l) }))

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
const found = []
const scan = (where, text) => text.split(/\r?\n/).forEach((line, i) => {
  if (rules.some((r) => r.test(line))) found.push(`${where}:${i + 1}`)
})

const mode = process.argv[2] ?? '--all'
if (mode === '--message') {
  scan('message de commit', readFileSync(process.argv[3], 'utf8'))
} else if (mode === '--staged') {
  let file = '?'
  for (const line of git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff').split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(6)
    else if (line.startsWith('+') && rules.some((r) => r.test(line))) found.push(file)
  }
} else {
  for (const f of git('ls-files', '-z').split('\0').filter(Boolean)) {
    const buf = readFileSync(join(root, f))
    if (!buf.subarray(0, 8000).includes(0)) scan(f, buf.toString('utf8'))
  }
}

if (found.length) {
  // On nomme l'endroit, jamais la valeur : la sortie peut finir dans un journal.
  console.error(`[check-private] donnée personnelle trouvée (voir .private-denylist) :\n  ${[...new Set(found)].join('\n  ')}`)
  process.exit(1)
}
