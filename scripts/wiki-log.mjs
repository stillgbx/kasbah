#!/usr/bin/env node
/**
 * Archive par mois les entrées de `doc/log.md` antérieures au mois en cours.
 *
 * `doc/log.md` ne garde que le mois en cours. Toute entrée `## [AAAA-MM-JJ] …` d'un mois antérieur
 * part dans `doc/log/AAAA-MM.md` (une archive par mois, plus récentes en haut). Le script tient aussi
 * le catalogue `doc/log/README.md` et les blocs `<!-- log-nav:… -->` (mois précédent / suivant) en
 * tête et en pied de `log.md` et de chaque archive.
 *
 * Décision mécanique, script idempotent, sans effet quand il n'y a rien à faire : les skills qui
 * écrivent dans `log.md` le lancent avant chaque ajout. Robuste aux merges : une entrée déjà dans son
 * archive (même texte) n'est pas dupliquée, une entrée d'un mois déjà archivé rejoint son archive à
 * sa place. Les entrées sont déplacées telles quelles : seul l'ordre change, et les blocs log-nav.
 *
 *   node scripts/wiki-log.mjs                 archive et régénère
 *   node scripts/wiki-log.mjs --check         n'écrit rien ; code 1 si un archivage est nécessaire
 *   node scripts/wiki-log.mjs --month 2026-11 mois courant forcé (essai)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docRoot = join(root, 'doc')
const logFile = join(docRoot, 'log.md')
const archiveDir = join(docRoot, 'log')
const catalogFile = join(archiveDir, 'README.md')

const args = process.argv.slice(2)
const check = args.includes('--check')
const monthArg = args.includes('--month') ? args[args.indexOf('--month') + 1] : null
if (monthArg && !/^\d{4}-\d{2}$/.test(monthArg)) throw new Error(`--month attend AAAA-MM, reçu : ${monthArg}`)
const now = new Date()
const month = monthArg ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

const headingRe = /^(?=## \[\d{4}-\d{2}-\d{2}\])/m
const navRe = /\n*<!-- log-nav:begin[^>]*-->[\s\S]*?<!-- log-nav:end -->\n*/g
const navBegin = '<!-- log-nav:begin (généré par scripts/wiki-log.mjs, ne pas éditer) -->'
const navEnd = '<!-- log-nav:end -->'

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null)

/** Découpe un journal en { head, entries[] } ; les blocs log-nav sont retirés avant. */
function splitLog(text) {
  const parts = text.replace(navRe, '\n\n').split(headingRe)
  const entries = parts.slice(1).map((part) => {
    const body = part.trimEnd()
    return { date: body.slice(4, 14), month: body.slice(4, 11), type: body.match(/^## \[[\d-]+\] (\S+)/)?.[1] ?? '', text: body }
  })
  return { head: parts[0].trimEnd(), entries }
}

/** Tri par date décroissante ; `sort` est stable : l'ordre d'origine tient à date égale. */
const sortEntries = (entries) => [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
const joinEntries = (entries) => entries.map((e) => e.text).join('\n\n')

// --- État courant ---------------------------------------------------------------

const logText = read(logFile)
if (logText === null) throw new Error(`log.md introuvable : ${logFile}`)
const log = splitLog(logText)

const archives = new Map()
if (existsSync(archiveDir)) {
  for (const name of readdirSync(archiveDir).filter((n) => /^\d{4}-\d{2}\.md$/.test(n))) {
    archives.set(name.slice(0, 7), splitLog(read(join(archiveDir, name))).entries)
  }
}

// --- Déplacement des entrées antérieures au mois courant --------------------------

const keep = log.entries.filter((e) => e.month >= month)
const moved = new Map()
for (const e of log.entries.filter((e) => e.month < month)) {
  if (!moved.has(e.month)) moved.set(e.month, [])
  moved.get(e.month).push(e)
}

let movedCount = 0
let dupCount = 0
for (const [m, entries] of moved) {
  const existing = archives.get(m) ?? []
  const known = new Set(existing.map((e) => e.text))
  const fresh = []
  for (const e of entries) {
    if (known.has(e.text)) continue
    known.add(e.text)
    fresh.push(e)
  }
  dupCount += entries.length - fresh.length
  movedCount += fresh.length
  // Venues de log.md, elles passent devant les entrées déjà archivées à date égale (écrites après).
  archives.set(m, sortEntries([...fresh, ...existing]))
}

// --- Navigation et sorties --------------------------------------------------------

const months = [...archives.keys()].sort().reverse()
const total = months.reduce((n, m) => n + archives.get(m).length, 0)
const outputs = new Map()

// log.md : le bloc de navigation se place sous l'introduction, avant un éventuel `---` qui la clôt.
let head = log.head
let headRule = ''
const ruled = head.match(/^([\s\S]*?)\n+---$/)
if (ruled) {
  head = ruled[1]
  headRule = '\n\n---'
}
const headNav = months.length
  ? `> **Mois en cours uniquement** (${month}). Les mois précédents sont archivés dans [log/](log/README.md) ` +
    `par \`scripts/wiki-log.mjs\` : ${total} entrées, de ${months.at(-1)} à ${months[0]}, une archive par mois.\n` +
    '> Pour remonter plus loin : chercher (`Grep`) un nom de page, un fichier ou un mot-clé dans `log/`, ' +
    "plutôt que lire les archives ; la date de mise à jour d'une page donne le mois à ouvrir. " +
    `Mois précédent : [log/${months[0]}.md](log/${months[0]}.md).`
  : `> **Mois en cours uniquement** (${month}). Aucune archive pour l'instant.`
let out = `${head}\n\n${navBegin}\n${headNav}\n${navEnd}${headRule}\n\n`
if (keep.length) out += `${joinEntries(keep)}\n\n`
if (months.length) {
  out += `${navBegin}\n> Fin du mois en cours. Entrées plus anciennes : [log/${months[0]}.md](log/${months[0]}.md) - catalogue : [log/README.md](log/README.md).\n${navEnd}\n`
}
outputs.set(logFile, `${out.trimEnd()}\n`)

months.forEach((m, i) => {
  const entries = archives.get(m)
  const newer = i > 0 ? `[${months[i - 1]}](${months[i - 1]}.md)` : '[log.md (mois en cours)](../log.md)'
  const older = i < months.length - 1 ? `[${months[i + 1]}](${months[i + 1]}.md)` : null
  const top =
    `> Archive mensuelle de [log.md](../log.md) : ${entries.length} entrées du ${entries.at(-1).date} au ${entries[0].date}, plus récentes en haut.\n` +
    `> Mois suivant : ${newer}${older ? ` - mois précédent : ${older}` : ' - premier mois du journal'} - catalogue : [README.md](README.md).`
  const foot = older ? `> Fin de ${m}. Entrées plus anciennes : ${older}.` : '> Début du journal.'
  outputs.set(
    join(archiveDir, `${m}.md`),
    `# Journal du wiki — ${m}\n\n${navBegin}\n${top}\n${navEnd}\n\n${joinEntries(entries)}\n\n${navBegin}\n${foot}\n${navEnd}\n`,
  )
})

/** « a 3, b 1 » : valeurs comptées, les plus fréquentes d'abord, puis par nom. */
function tally(values, limit = Infinity) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
}

if (months.length) {
  const rows = months.map((m) => {
    const entries = archives.get(m)
    const types = tally(entries.map((e) => e.type)).map(([t, n]) => `${t} ${n}`).join(', ')
    const cited = [...joinEntries(entries).matchAll(/(?<![\w/.-])(\d_[a-z][a-z0-9-]*)\//g)].map((x) => x[1])
    const sections = tally(cited, 5).map(([s, n]) => `${s} (${n})`).join(', ')
    return `| [${m}](${m}.md) | ${entries.length} | ${types} | ${sections} |`
  })
  outputs.set(
    catalogFile,
    `# Archives du journal du wiki

> Généré par \`scripts/wiki-log.mjs\` - ne pas éditer à la main (régénéré à chaque archivage).

[\`log.md\`](../log.md) ne garde que les entrées du mois en cours. Chaque mois échu est déplacé ici, dans
\`AAAA-MM.md\`, plus récentes en haut. Format des entrées inchangé : \`## [AAAA-MM-JJ] <type> | <titre>\`.

## Quand fouiller les archives

- La question porte sur l'**historique** (quand, pourquoi, à la suite de quoi une page a changé) et
  \`log.md\` ne répond pas.
- Un **nom de page**, de fichier ou de plugin n'apparaît pas dans \`log.md\`.
- La date de mise à jour d'une page (en-tête ou catalogue de section) est antérieure au mois en cours :
  son entrée est dans l'archive de ce mois-là.

## Comment fouiller

1. **Chercher, ne pas lire** : \`Grep\` sur \`doc/log/\` avec le nom de fichier de la page, un nom de
   plugin ou un mot-clé. Le résultat donne directement le mois.
2. Lire l'entrée trouvée avec un \`offset\`/\`limit\` ciblé, pas l'archive entière.
3. Sans piste précise, le tableau ci-dessous dit quels mois ont touché quelle section.

## Catalogue

${total} entrées archivées. Sections : dossiers les plus cités dans les entrées du mois (nombre de mentions).

| Mois | Entrées | Types | Sections les plus touchées |
|---|---|---|---|
${rows.join('\n')}
`,
  )
}

// --- Écriture ---------------------------------------------------------------------

const changed = [...outputs].filter(([path, text]) => read(path) !== text).map(([path]) => path)
const rel = (p) => relative(root, p).replaceAll('\\', '/')

if (!changed.length) {
  console.log(`log.md à jour : rien à archiver (${month}).`)
  process.exit(0)
}
if (check) {
  console.log(`Archivage nécessaire : ${movedCount} entrée(s) à déplacer, ${changed.length} fichier(s) à régénérer :`)
  for (const p of changed) console.log(`  - ${rel(p)}`)
  process.exit(1)
}

mkdirSync(archiveDir, { recursive: true })
for (const p of changed) writeFileSync(p, outputs.get(p), 'utf8')
console.log(`Archivage : ${movedCount} entrée(s) déplacée(s) hors de log.md${dupCount ? `, ${dupCount} doublon(s) ignoré(s)` : ''}.`)
for (const m of [...moved.keys()].sort().reverse()) console.log(`  - ${m} : ${moved.get(m).length} entrée(s) -> doc/log/${m}.md`)
console.log('Fichiers écrits :')
for (const p of changed) console.log(`  - ${rel(p)}`)
