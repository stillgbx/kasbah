#!/usr/bin/env node
/**
 * Génère les blocs de section de `doc/index.md` depuis le catalogue de chaque section, et contrôle
 * ces catalogues.
 *
 * Index à deux niveaux :
 *  - la liste des pages d'une section, avec leurs résumés, vit dans le bloc
 *    `<!-- catalogue:begin -->` … `<!-- catalogue:end -->` de `doc/<section>/README.md` : une phrase
 *    d'introduction, puis des groupes `### Nom` portant chacun une table
 *    `Page | Résumé | Dernière mise à jour` ;
 *  - `doc/index.md` n'en porte qu'un bloc généré entre `<!-- section:<nom>:begin … -->` et
 *    `<!-- section:<nom>:end -->` : l'introduction, le lien vers le README, titres et dates.
 *
 * Contrôles :
 *   ERREUR  dossier de section `doc/N_nom/` sans bloc dans index.md ;
 *   ERREUR  lien du catalogue vers un fichier absent ;
 *   ERREUR  page `.md` du dossier absente du catalogue (README.md exclu) ;
 *   ALERTE  résumé de plus de 350 caractères ;
 *   ALERTE  résumé daté (une date AAAA-MM-JJ : il raconte l'historique au lieu du périmètre) ;
 *   ALERTE  ligne de table mal découpée (un ` | ` dans le résumé) ;
 *   ALERTE  en-tête de page (`Dernière mise à jour`) plus récent que la date du catalogue.
 *
 * Idempotent : n'écrit index.md que si son contenu change.
 *
 *   node scripts/wiki-index.mjs           régénère index.md
 *   node scripts/wiki-index.mjs --check   n'écrit rien ; code 1 si index.md est à régénérer ou en ERREUR
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docRoot = join(root, 'doc')
const indexFile = join(docRoot, 'index.md')
const maxSummary = 350
const check = process.argv.includes('--check')

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const blockRe = /<!-- section:([\w.-]+):begin[^>]*-->[\s\S]*?<!-- section:\1:end -->/g

/** Cellules d'une ligne de table markdown, sans les `|` de bord. */
function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(' | ').map((c) => c.trim())
}

function readCatalogue(section) {
  const readme = join(docRoot, section, 'README.md')
  if (!existsSync(readme)) throw new Error(`Section ${section} : README.md introuvable.`)
  const block = read(readme).match(/<!-- catalogue:begin -->\n([\s\S]*?)\n<!-- catalogue:end -->/)
  if (!block) throw new Error(`Section ${section} : bloc <!-- catalogue:begin/end --> absent de ${section}/README.md.`)

  const intro = []
  const groups = []
  let current = null
  for (const line of block[1].split('\n')) {
    const group = line.match(/^### (.+)$/)
    const row = line.match(/^\| *\[([^\]]+)\]\(([^)]+)\)/)
    if (group) {
      current = { name: group[1].trim(), items: [] }
      groups.push(current)
    } else if (row) {
      if (!current) groups.push((current = { name: 'Pages', items: [] }))
      const c = cells(line)
      current.items.push({ title: row[1], target: row[2], summary: c[1] ?? '', date: /^\d{4}-\d{2}-\d{2}$/.test(c.at(-1)) ? c.at(-1) : null, cellCount: c.length })
    } else if (!current && line.trim()) {
      intro.push(line.trim())
    }
  }
  return { intro: intro.join(' '), groups }
}

function buildBlock(section, cat) {
  const pages = cat.groups.flatMap((g) => g.items)
  const last = pages.map((p) => p.date).filter(Boolean).sort().at(-1)
  const lines = [`<!-- section:${section}:begin (généré par scripts/wiki-index.mjs depuis ${section}/README.md - ne pas éditer ici) -->`]
  lines.push(`${cat.intro} Résumés : [${section}/README.md](${section}/README.md) (${pages.length} pages${last ? `, dernière mise à jour ${last}` : ''}).`.trim())
  for (const g of cat.groups.filter((g) => g.items.length)) {
    lines.push('', `| ${g.name} | Dernière mise à jour |`, '|---|---|')
    for (const i of g.items) lines.push(`| [${i.title}](${section}/${i.target}) | ${i.date ?? '-'} |`)
  }
  lines.push(`<!-- section:${section}:end -->`)
  return lines.join('\n')
}

function listMarkdown(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listMarkdown(path)
    return name.endsWith('.md') && name !== 'README.md' ? [path] : []
  })
}

function checkCatalogue(section, cat) {
  const issues = []
  const dir = join(docRoot, section)
  const listed = new Set()
  for (const i of cat.groups.flatMap((g) => g.items)) {
    const path = join(dir, i.target.split('#')[0])
    listed.add(path.toLowerCase())
    if (!/^(https?:|#)/.test(i.target) && !existsSync(path)) issues.push(['ERREUR', `${section} : lien vers un fichier absent : ${i.target}`])
    if (i.cellCount !== 3) issues.push(['ALERTE', `${section} : ligne en ${i.cellCount} cellules (un « | » dans le résumé ?) : ${i.title}`])
    if (i.summary.length > maxSummary) issues.push(['ALERTE', `${section} : résumé de ${i.summary.length} caractères (max ${maxSummary}) : ${i.title}`])
    if (/\b20\d\d-\d\d-\d\d\b/.test(i.summary)) issues.push(['ALERTE', `${section} : le résumé est daté (historique au lieu du périmètre) : ${i.title}`])
    if (i.date && existsSync(path)) {
      const header = read(path).split('\n').slice(0, 10).join('\n').match(/Dernière mise à jour\s*:\s*(\d{4}-\d{2}-\d{2})/)
      if (header && header[1] > i.date) issues.push(['ALERTE', `${section} : en-tête de page du ${header[1]}, catalogue du ${i.date} : ${i.title}`])
    }
  }
  for (const path of listMarkdown(dir)) {
    if (!listed.has(path.toLowerCase())) issues.push(['ERREUR', `${section} : page absente du catalogue : ${relative(root, path).replaceAll('\\', '/')}`])
  }
  return issues
}

// --- Génération -------------------------------------------------------------------

const index = read(indexFile)
const sections = [...index.matchAll(blockRe)].map((m) => m[1])
const catalogues = new Map(sections.map((s) => [s, readCatalogue(s)]))
const issues = sections.flatMap((s) => checkCatalogue(s, catalogues.get(s)))
for (const name of readdirSync(docRoot)) {
  if (/^\d+_/.test(name) && statSync(join(docRoot, name)).isDirectory() && !sections.includes(name)) {
    issues.push(['ERREUR', `dossier de section doc/${name}/ sans bloc <!-- section:${name}:begin/end --> dans index.md`])
  }
}

const next = index.replace(blockRe, (_, s) => buildBlock(s, catalogues.get(s)))
const changed = next !== index
const errors = issues.filter(([level]) => level === 'ERREUR')

console.log(`Sections générées : ${sections.join(', ') || 'aucune'}.`)
for (const [level, msg] of issues) console.log(`  [${level}] ${msg}`)

if (check) {
  if (changed) console.log('index.md doit être régénéré.')
  else console.log('index.md à jour.')
  process.exit(changed || errors.length ? 1 : 0)
}
if (changed) writeFileSync(indexFile, next, 'utf8')
console.log(changed ? 'index.md régénéré.' : 'index.md à jour.')
process.exit(errors.length ? 1 : 0)
