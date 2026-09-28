#!/usr/bin/env node
// Couleurs dominantes d'une ZONE de photo, pour la skill `garden-species` : le feuillage, le tronc,
// les fruits d'un arbre photographié deviennent les couleurs de sa recette.
//
// L'image est réduite par ffmpeg (déjà requis par le serveur) en pixels RGB bruts, puis les pixels
// de la zone sont regroupés par k-moyennes. Le ciel et les blancs cramés sont écartés : un arbre
// photographié à contre-jour ramènerait sinon du blanc dans son feuillage.
//
// Usage : node scripts/photo-palette.mjs <image> [--crop x,y,w,h] [--k 3]
//   --crop : zone en FRACTIONS de l'image (0..1), par défaut l'image entière.
// Sortie : une ligne par couleur, de la plus présente à la moins présente : `#rrggbb  42 %`.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
const file = args.find((a, i) => !a.startsWith('--') && !['--crop', '--k'].includes(args[i - 1]))
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
if (!file || !existsSync(file)) {
  console.error('usage: node scripts/photo-palette.mjs <image> [--crop x,y,w,h] [--k 3]')
  process.exit(1)
}
const [cx, cy, cw, ch] = (opt('--crop') ?? '0,0,1,1').split(',').map(Number)
const K = Number(opt('--k') ?? 3)
const SIDE = 96

const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file,
  '-vf', `crop=iw*${cw}:ih*${ch}:iw*${cx}:ih*${cy},scale=${SIDE}:${SIDE}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
{ maxBuffer: 1 << 24 })

const pixels = []
for (let i = 0; i + 2 < raw.length; i += 3) {
  const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]]
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max > 235 && max - min < 25) continue        // ciel, blanc cramé
  pixels.push([r, g, b])
}
if (!pixels.length) { console.error('zone vide (tout est ciel ?)'); process.exit(1) }

// k-moyennes, graines réparties sur la luminance pour un résultat stable d'un lancement à l'autre
const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
const sorted = [...pixels].sort((a, b) => lum(a) - lum(b))
let centers = Array.from({ length: K }, (_, k) => [...sorted[Math.floor(((k + 0.5) / K) * sorted.length)]])
let owner = new Array(pixels.length).fill(0)
for (let iter = 0; iter < 20; iter++) {
  owner = pixels.map((p) => {
    let best = 0, dist = Infinity
    centers.forEach((c, k) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < dist) { dist = d; best = k } })
    return best
  })
  centers = centers.map((c, k) => {
    const mine = pixels.filter((_, i) => owner[i] === k)
    return mine.length ? [0, 1, 2].map((j) => mine.reduce((s, p) => s + p[j], 0) / mine.length) : c
  })
}
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
centers
  .map((c, k) => ({ c, share: owner.filter((o) => o === k).length / pixels.length }))
  .sort((a, b) => b.share - a.share)
  .forEach(({ c, share }) => console.log(`${hex(c)}  ${Math.round(share * 100)} %`))
