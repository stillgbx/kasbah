#!/usr/bin/env node
// Dérive les polygones de pièces (face intérieure finie, en mètres) depuis les relevés bruts
// `room.meta.survey.points` (cm, mesurés à l'intérieur des pièces).
//
// Le calcul vit dans `packages/shared/src/house/survey.ts` (`fitSurvey`) : c'est le même que celui
// que le serveur rejoue à chaque écriture des cotes depuis l'interface. Ce script n'en est que
// l'enveloppe en ligne de commande (lecture, compte rendu, écriture). Le pourquoi du calcul —
// demi-cloisons, pièces sans mur, `partition`, `levelOffsets` — est expliqué en tête du module.
//
// Usage : node house/fit-survey.mjs [house/maison.json] [--check]
//         --check : ne réécrit rien, sort en 1 si un polygone calculé diffère du fichier.

import { readFileSync, writeFileSync } from 'node:fs'
import { register } from 'tsx/esm/api'

register()
const { fitSurvey } = await import('../packages/shared/src/house/survey.ts')

const args = process.argv.slice(2)
const check = args.includes('--check')
const file = args.find((a) => !a.startsWith('--')) ?? 'house/maison.json'

const house = JSON.parse(readFileSync(file, 'utf8'))
if (!house.rooms.some((r) => r.meta?.survey?.points)) {
  console.error(`${file} : aucune pièce avec meta.survey.points`)
  process.exit(1)
}

let result
try { result = fitSurvey(house) } catch (err) { console.error(err.message); process.exit(1) }
const { doc, changed, report, warnings, problems, outlines } = result

const conv = house.meta?.survey ?? {}
const partition = conv.partition ?? 2 * (house.defaults?.interiorWallThickness ?? 0.1)
const ext = house.defaults?.exteriorWallThickness ?? 0.3

for (const { levelId, outline } of outlines) {
  console.log(`emprise ${levelId} → x ${outline[0][0]}..${outline[1][0]}  y ${outline[0][1]}..${outline[2][1]}`)
}
const w = Math.max(...report.map((r) => r.id.length))
for (const level of [...new Set(report.map((r) => r.levelId))]) {
  const rows = report.filter((r) => r.levelId === level)
  console.log(`— ${level} —`)
  for (const r of rows) {
    console.log(
      `${r.id.padEnd(w)}  ${r.brut.toFixed(2).padStart(6)} → ${r.fini.toFixed(2).padStart(6)} m²  ` +
      `(${r.mitoyen}/${r.total} arêtes mitoyennes, ${r.inset} rentrée${r.inset > 1 ? 's' : ''})`,
    )
  }
  console.log(`${rows.length} pièces, ${rows.reduce((s, r) => s + r.brut, 0).toFixed(2)} → ` +
    `${rows.reduce((s, r) => s + r.fini, 0).toFixed(2)} m²`)
}
console.log(`cloison ${(partition * 100).toFixed(0)} cm (${((Math.round(partition / 2 * 1e4) / 1e4) * 100).toFixed(0)} cm portés par chaque pièce murée), ` +
  `façade ${(ext * 100).toFixed(0)} cm`)
for (const m of warnings) console.warn(`  ! ${m}`)
if (problems.length) {
  console.error(`\n${problems.length} vis-à-vis trop serré(s) :`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

if (check) {
  if (changed) { console.error(`\n${changed} polygone(s) divergent du relevé — rejouer sans --check`); process.exit(1) }
  console.log('\npolygones à jour')
} else if (changed) {
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`\n${changed} polygone(s) réécrit(s) dans ${file}`)
} else {
  console.log('\nrien à réécrire')
}
