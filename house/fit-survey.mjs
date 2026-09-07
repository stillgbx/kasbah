#!/usr/bin/env node
// Dérive les polygones de pièces (face intérieure finie, en mètres) depuis les relevés bruts
// `room.meta.survey.points` (cm, mesurés à l'intérieur des pièces).
//
// Pourquoi un ajustement : un relevé intérieur réduit chaque paroi mitoyenne à une seule ligne
// partagée, alors que le moteur de murs veut un écart de `t + t'` entre deux faces intérieures
// en vis-à-vis — chaque pièce porte son mur vers l'extérieur (cf. doc/2_maison/2_1_geometrie.md).
// Chaque face en vis-à-vis est donc reculée de l'épaisseur que le voisin pousse dans elle
// (`t_voisin × manque / (t + t')`), ce qui donne :
//   - deux pièces murées → demi-cloison chacune, et une surcharge `walls[].thickness` ;
//   - pièce murée ↔ pièce SANS mur (`terrace`, `balcony` : sas, terrasse, balcon) → la pièce
//     murée ne bouge pas et garde sa façade, la pièce sans mur absorbe toute l'épaisseur.
// Les arêtes de façade ne bougent pas, donc l'emprise du relevé est conservée.
//
// L'épaisseur de cloison vient de `house.meta.survey.partition` (m, cloison complète), sinon du
// défaut `interiorWallThickness` × 2. Le défaut global reste celui des niveaux non relevés.
//
// `house.meta.survey.levelOffsets = { <levelId>: [dx, dy] }` (unité du relevé) corrige le REPÈRE
// d'une campagne de relevé dont le 0;0 ne tombait pas sur celui des autres niveaux. C'est une
// translation appliquée aux points bruts : les mesures dictées restent intactes dans `points`.
//
// Usage : node house/fit-survey.mjs [house/maison.json] [--check]
//         --check : ne réécrit rien, sort en 1 si un polygone calculé diffère du fichier.

import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const check = args.includes('--check')
const file = args.find((a) => !a.startsWith('--')) ?? 'house/maison.json'

// Mêmes pièces murées que `WALLED_KINDS` dans packages/shared/src/house/geometry/walls.ts.
const WALLED = new Set(['room', 'corridor', 'stairs', 'garage'])

const EPS = 1e-9
const round = (v) => Math.round(v * 1e4) / 1e4
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const len = (a) => Math.hypot(a[0], a[1])
const signedArea = (p) => p.reduce((s, a, i) => s + cross(a, p[(i + 1) % p.length]), 0) / 2

/** Arêtes orientées d'un polygone CCW : direction unitaire `d` et normale extérieure `n`. */
function edges(poly) {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]
    const L = len(sub(b, a))
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    return { a, b, d, n: [d[1], -d[0]], L }
  })
}

/**
 * Rentre chaque arête de `inset[i]` et recalcule les sommets à l'intersection des droites
 * décalées voisines (gère les angles droits, rentrants et les biais).
 */
function insetPolygon(poly, inset) {
  const es = edges(poly)
  const n = poly.length
  return poly.map((_, i) => {
    const prev = es[(i - 1 + n) % n]
    const cur = es[i]
    const p0 = [prev.a[0] - prev.n[0] * inset[(i - 1 + n) % n], prev.a[1] - prev.n[1] * inset[(i - 1 + n) % n]]
    const p1 = [cur.a[0] - cur.n[0] * inset[i], cur.a[1] - cur.n[1] * inset[i]]
    const den = cross(prev.d, cur.d)
    if (Math.abs(den) < EPS) return [round(p1[0]), round(p1[1])] // arêtes colinéaires
    const t = cross(sub(p1, p0), cur.d) / den
    return [round(p0[0] + prev.d[0] * t), round(p0[1] + prev.d[1] * t)]
  })
}

/** Pièces dont une arête antiparallèle fait face à `e`, avec l'écart mesuré et le recouvrement. */
function facingRooms(e, others) {
  const out = []
  for (const other of others) {
    for (const o of edges(other.poly)) {
      if (dot(e.d, o.d) > -0.999) continue
      const u = (p) => dot(sub(p, e.a), e.d)
      const lo = Math.max(0, Math.min(u(o.a), u(o.b)))
      const hi = Math.min(e.L, Math.max(u(o.a), u(o.b)))
      if (hi - lo < 0.01) continue
      const gap = dot(sub(o.a, e.a), e.n)
      if (gap < -0.01 || gap > 1) continue
      out.push({ other, gap, lo, hi })
    }
  }
  return out
}

/** Longueur d'arête effectivement couverte par des vis-à-vis (union des recouvrements). */
function covered(facings) {
  const spans = facings.map(({ lo, hi }) => [lo, hi]).sort((a, b) => a[0] - b[0])
  let total = 0, end = -Infinity
  for (const [lo, hi] of spans) {
    if (hi <= end) continue
    total += hi - Math.max(lo, end)
    end = hi
  }
  return total
}

const house = JSON.parse(readFileSync(file, 'utf8'))
const conv = house.meta?.survey ?? {}
/** Cloison complète entre deux pièces murées ; chacune en porte la moitié. */
const partition = conv.partition ?? 2 * (house.defaults?.interiorWallThickness ?? 0.1)
const half = round(partition / 2)
const ext = house.defaults?.exteriorWallThickness ?? 0.3
const surveyed = house.rooms.filter((r) => r.meta?.survey?.points)

if (!surveyed.length) {
  console.error(`${file} : aucune pièce avec meta.survey.points`)
  process.exit(1)
}

/** Épaisseur que `self` porte sur une arête faisant face à `other` (0 si `self` n'a pas de mur). */
const thicknessAgainst = (self, other) => (!self.walled ? 0 : other.walled ? half : ext)

const unit = conv.unit === 'cm' ? 0.01 : conv.unit === 'mm' ? 0.001 : 1
/** Correction du repère de relevé, par niveau (le 0;0 d'une campagne peut être décalé). */
const offsetOf = (levelId) => conv.levelOffsets?.[levelId] ?? [0, 0]
const raw = new Map(
  surveyed.map((r) => {
    const [dx, dy] = offsetOf(r.levelId)
    return [r.id, {
      id: r.id,
      levelId: r.levelId,
      walled: WALLED.has(r.kind ?? 'room'),
      poly: r.meta.survey.points.map(([x, y]) => [round((x + dx) * unit), round((y + dy) * unit)]),
    }]
  }),
)

let changed = 0
const report = []
const warnings = []
for (const room of surveyed) {
  const self = raw.get(room.id)
  if (signedArea(self.poly) <= 0) {
    console.error(`${room.id} : relevé non CCW (${signedArea(self.poly).toFixed(2)} m²) — inverser les points`)
    process.exit(1)
  }
  const others = [...raw.values()].filter((r) => r.id !== room.id && r.levelId === room.levelId)
  const es = edges(self.poly)
  const facing = es.map((e) => facingRooms(e, others))
  const inset = facing.map((fs) => round(Math.max(0, ...fs.map(({ other, gap }) => {
    const t = thicknessAgainst(self, other), t2 = thicknessAgainst(other, self)
    return t + t2 > EPS ? (t2 * Math.max(0, t + t2 - gap)) / (t + t2) : 0
  }))))
  // Un alignement droit reste droit : une arête coupée en deux (partie mitoyenne + partie
  // façade, cas d'un décroché) prend le rentrement de sa portion la plus rentrée, sinon le
  // mur se voilerait de la demi-cloison sur la longueur.
  for (let pass = 0; pass < inset.length; pass++) {
    for (let i = 0; i < inset.length; i++) {
      const j = (i + 1) % inset.length
      if (Math.abs(cross(es[i].d, es[j].d)) > EPS || dot(es[i].d, es[j].d) < 0) continue
      const m = Math.max(inset[i], inset[j])
      inset[i] = m; inset[j] = m
    }
  }
  const poly = insetPolygon(self.poly, inset)

  // Arêtes mitoyennes de deux pièces murées : `kind` et épaisseur explicites. Le sondage
  // automatique du moteur (à 2 × interiorWallThickness + 5 cm derrière l'arête) tomberait
  // dans le joint entre deux pièces d'en face et classerait le mur en façade. Une arête qui
  // fait face à une pièce sans mur est une vraie façade : rien à écrire, le sondage la classe
  // correctement (il ignore les pièces non murées). Les `kind` posés à la main l'emportent.
  // Le script possède entièrement la classification mitoyenne : il RÉGÉNÈRE toutes les
  // surcharges `interior` (les garder d'un run à l'autre les rendrait obsolètes dès qu'une
  // arête est coupée et que les index glissent). Seules les surcharges qu'il ne sait pas
  // déduire sont préservées : `none` (passage ouvert) et `exterior` (façade forcée).
  const kept = new Map((room.walls ?? [])
    .filter((w) => w.kind === 'none' || w.kind === 'exterior')
    .map((w) => [w.segment, { segment: w.segment, kind: w.kind, ...(w.thickness == null ? {} : { thickness: w.thickness }) }]))
  const walls = poly
    .map((_, i) => {
      if (!self.walled) return kept.get(i)
      // Seul un vis-à-vis avec une pièce MURÉE rend l'arête mitoyenne ; face à une pièce sans
      // mur (terrasse, sas) ou face à rien, c'est une façade. Une arête ne portant qu'une
      // nature et une épaisseur, une arête à cheval sur les deux doit être coupée.
      const mitoyen = facing[i].filter(({ other }) => other.walled)
      if (!mitoyen.length) return kept.get(i)
      const free = round(es[i].L - covered(mitoyen))
      if (free > partition) {
        warnings.push(`${room.id} arête ${i} (${es[i].L.toFixed(2)} m) : mitoyenne ET en façade sur ` +
          `${(free * 100).toFixed(0)} cm — couper l'arête en ajoutant un point colinéaire au relevé`)
      }
      return { segment: i, kind: 'interior', thickness: half, ...kept.get(i) }
    })
    .filter(Boolean)

  const before = JSON.stringify([room.polygon, room.walls ?? null])
  room.polygon = poly
  if (walls.length) room.walls = walls
  else delete room.walls
  if (before !== JSON.stringify([room.polygon, room.walls ?? null])) changed++

  // Ordre de clés lisible (walls juste avant openings, meta en dernier).
  const order = ['id', 'levelId', 'name', 'polygon', 'kind', 'height', 'walls', 'openings', 'style', 'meta']
  const keys = [...order.filter((k) => k in room), ...Object.keys(room).filter((k) => !order.includes(k))]
  house.rooms[house.rooms.indexOf(room)] = Object.fromEntries(keys.map((k) => [k, room[k]]))

  report.push({
    id: room.id,
    levelId: room.levelId,
    brut: signedArea(self.poly),
    fini: signedArea(poly),
    inset: inset.filter(Boolean).length,
    mitoyen: walls.filter((w) => w.thickness).length,
    total: inset.length,
  })
}

// Emprise de chaque niveau relevé = boîte des pièces MURÉES, élargie du mur extérieur.
// (Les terrasses et balcons sont hors enveloppe : ils ne doivent pas être couverts par le toit.)
for (const level of house.levels) {
  const polys = [...raw.values()].filter((r) => r.levelId === level.id && r.walled).map((r) => r.poly)
  if (!polys.length) continue
  const xs = polys.flat().map((p) => p[0]), ys = polys.flat().map((p) => p[1])
  const outline = [
    [round(Math.min(...xs) - ext), round(Math.min(...ys) - ext)],
    [round(Math.max(...xs) + ext), round(Math.min(...ys) - ext)],
    [round(Math.max(...xs) + ext), round(Math.max(...ys) + ext)],
    [round(Math.min(...xs) - ext), round(Math.max(...ys) + ext)],
  ]
  if (JSON.stringify(level.outline) !== JSON.stringify(outline)) {
    level.outline = outline
    changed++
    console.log(`emprise ${level.id} → x ${outline[0][0]}..${outline[1][0]}  y ${outline[0][1]}..${outline[2][1]}`)
  }
}

// Contrôle : plus aucune paire de faces en vis-à-vis en dessous de l'écart requis.
const fitted = new Map(surveyed.map((r) => [r.id, { ...raw.get(r.id), poly: r.polygon }]))
const problems = []
for (const room of surveyed) {
  const self = fitted.get(room.id)
  const others = [...fitted.values()].filter((r) => r.id !== room.id && r.levelId === room.levelId)
  for (const e of edges(room.polygon)) {
    for (const { other, gap } of facingRooms(e, others)) {
      const need = thicknessAgainst(self, other) + thicknessAgainst(other, self)
      if (gap < need - 1e-3) problems.push(`${room.id} ↔ ${other.id} : écart ${(gap * 100).toFixed(1)} cm < ${(need * 100).toFixed(0)} cm`)
    }
  }
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
console.log(`cloison ${(partition * 100).toFixed(0)} cm (${(half * 100).toFixed(0)} cm portés par chaque pièce murée), ` +
  `façade ${(ext * 100).toFixed(0)} cm`)
for (const m of [...new Set(warnings)]) console.warn(`  ! ${m}`)
if (problems.length) {
  console.error(`\n${problems.length} vis-à-vis trop serré(s) :`)
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`)
  process.exit(1)
}

if (check) {
  if (changed) { console.error(`\n${changed} polygone(s) divergent du relevé — rejouer sans --check`); process.exit(1) }
  console.log('\npolygones à jour')
} else if (changed) {
  writeFileSync(file, `${JSON.stringify(house, null, 2)}\n`)
  console.log(`\n${changed} polygone(s) réécrit(s) dans ${file}`)
} else {
  console.log('\nrien à réécrire')
}
