#!/usr/bin/env node
// Dominant colors of a photo ZONE, for the `garden-species` skill: the foliage, the trunk,
// the fruits of a photographed tree become the colors of its recipe.
//
// The image is shrunk by ffmpeg (already required by the server) into raw RGB pixels, then the pixels
// of the zone are grouped by k-means. The sky and blown-out whites are discarded: a tree
// photographed against the light would otherwise bring white back into its foliage.
//
// Usage: node scripts/photo-palette.mjs <image> [--crop x,y,w,h] [--k 3]
//   --crop: zone in FRACTIONS of the image (0..1), the whole image by default.
// Output: one line per color, from the most present to the least present: `#rrggbb  42 %`.

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
  if (max > 235 && max - min < 25) continue        // sky, blown-out white
  pixels.push([r, g, b])
}
if (!pixels.length) { console.error('empty zone (is it all sky?)'); process.exit(1) }

// k-means, seeds spread over the luminance for a result that is stable from one run to the next
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
