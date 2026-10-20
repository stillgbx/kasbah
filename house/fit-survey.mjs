#!/usr/bin/env node
// Derives the room polygons (finished inner face, in meters) from the raw surveys
// `room.meta.survey.points` (cm, measured inside the rooms).
//
// The computation lives in `packages/shared/src/house/survey.ts` (`fitSurvey`): it is the same one
// the server replays on every write of the measurements from the UI. This script is only its
// command-line wrapper (reading, report, writing). The why of the computation — half-partitions,
// rooms without walls, `partition`, `levelOffsets` — is explained at the top of the module.
//
// Usage: node house/fit-survey.mjs [house/maison.json] [--check]
//        --check: rewrites nothing, exits 1 if a computed polygon differs from the file.

import { readFileSync, writeFileSync } from 'node:fs'
import { register } from 'tsx/esm/api'

register()
const { fitSurvey } = await import('../packages/shared/src/house/survey.ts')

const args = process.argv.slice(2)
const check = args.includes('--check')
const file = args.find((a) => !a.startsWith('--')) ?? 'house/maison.json'

const house = JSON.parse(readFileSync(file, 'utf8'))
if (!house.rooms.some((r) => r.meta?.survey?.points)) {
  console.error(`${file}: no room with meta.survey.points`)
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
      `(${r.mitoyen}/${r.total} shared edges, ${r.inset} inset${r.inset > 1 ? 's' : ''})`,
    )
  }
  console.log(`${rows.length} rooms, ${rows.reduce((s, r) => s + r.brut, 0).toFixed(2)} → ` +
    `${rows.reduce((s, r) => s + r.fini, 0).toFixed(2)} m²`)
}
console.log(`partition ${(partition * 100).toFixed(0)} cm (${((Math.round(partition / 2 * 1e4) / 1e4) * 100).toFixed(0)} cm carried by each walled room), ` +
  `facade ${(ext * 100).toFixed(0)} cm`)
for (const m of warnings) console.warn(`  ! ${m}`)
if (problems.length) {
  console.error(`\n${problems.length} facing gap(s) too tight:`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

if (check) {
  if (changed) { console.error(`\n${changed} polygon(s) differ from the survey — rerun without --check`); process.exit(1) }
  console.log('\npolygons up to date')
} else if (changed) {
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`\n${changed} polygon(s) rewritten in ${file}`)
} else {
  console.log('\nnothing to rewrite')
}
