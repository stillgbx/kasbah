#!/usr/bin/env node
// Récupère les matières PHOTO du pack « photo » (apps/web/src/three/textures/assets.ts) depuis
// ambientCG — tout y est CC0, sans compte — et les réduit pour l'app :
//   apps/web/public/assets/textures/photo/<rôle>/{color,normal,roughness}.jpg   (512 px, JPEG)
// plus un SOURCES.md qui dit d'où vient chaque image.
//
// Pourquoi un script et pas les zips tels quels : un jeu 1K d'ambientCG pèse 5 Mo (couleur, deux
// normales, déplacement, occlusion, .blend…) ; l'app n'en garde que trois cartes, à 512 px, soit
// ~300 Ko par matière. Une image d'un mètre cinquante vue à quinze mètres n'a pas besoin de plus.
//
// Usage : node scripts/fetch-textures.mjs [--size 512] [--force]
// Requiert `ffmpeg` dans le PATH (déjà nécessaire au serveur pour le relais vidéo).
// Les archives sont des zips « stored » ou « deflate » : lues ici sans dépendance (zlib de Node).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

/** rôle → identifiant ambientCG. Changer une ligne = changer la matière (puis relancer avec --force). */
const ROLES = {
  plaster: 'Plaster001',
  concrete: 'Concrete046',
  wood: 'WoodFloor051',   // parquet ; Planks033B archivé sous photo/wood033b/
  tile: 'Tiles107',       // carreaux blancs clairs à joint fin (Tiles052 était trop sombre)
  poolTile: 'Tiles133A',  // faïence du bassin, inchangée
  carpet: 'Carpet016',
  grass: 'Grass006',      // pelouse ; Grass004 archivée sous photo/grass004/
  pavers: 'PavingStones128',
  soil: 'Ground048',
  roof: 'RoofingTiles013A',
  stone: 'Bricks100',
  gravel: 'Gravel043',
}
/**
 * Finitions du catalogue (`packages/shared/src/house/finishes.ts`) qui ne sont pas déjà un rôle du
 * pack : elles vivent sous `textures/finishes/<asset>/`. Liste à tenir avec le catalogue (un test
 * côté web vérifie que chaque dossier du catalogue existe).
 */
const FINISH_ASSETS = [
  'WoodFloor040', 'WoodFloor062', 'WoodFloor064', 'WoodFloor036', 'WoodFloor070', 'Planks029S',
  'Tiles141', 'Tiles143', 'Tiles052', 'Tiles040', 'Marble014', 'Travertine009', 'Tiles136A', 'Tiles071', 'Tiles101',
  'Carpet012', 'Carpet014', 'Concrete016', 'Concrete048', 'PaintedPlaster017', 'Plaster002',
  'Bricks101', 'Bricks060', 'Bricks084', 'WoodSiding009', 'PavingStones136', 'PavingStones137', 'PavingStones144',
]
/** Vignette du sélecteur de finitions (px). */
const THUMB = 128
/** fichier de sortie → suffixe ambientCG. NormalGL : convention OpenGL (Y vers le haut), celle de three. */
const MAPS = { color: 'Color', normal: 'NormalGL', roughness: 'Roughness' }
const QUALITY = '1K-JPG'

const args = process.argv.slice(2)
const size = Number(args[args.indexOf('--size') + 1] || 512) || 512
const force = args.includes('--force')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const texRoot = join(root, 'apps/web/public/assets/textures')
const outRoot = join(texRoot, 'photo')

/** Les entrées d'un zip, par nom, décompressées à la demande (répertoire central → en-tête local). */
function readZip(buf) {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('zip : fin de répertoire central introuvable')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip : entrée de répertoire invalide')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const raw = buf.subarray(start, start + compSize)
      if (method === 0) return raw
      if (method === 8) return inflateRawSync(raw)
      throw new Error(`zip : compression ${method} non gérée (${name})`)
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function fetchRole(role, id, tmp, dir = join(outRoot, role)) {
  if (!force && [...Object.keys(MAPS), 'thumb'].every((m) => existsSync(join(dir, `${m}.jpg`)))) {
    console.log(`  ${role.padEnd(9)} ${id.padEnd(18)} déjà là`)
    return
  }
  const url = `https://ambientcg.com/get?file=${id}_${QUALITY}.zip`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${id} : HTTP ${res.status} (${url})`)
  const zip = readZip(Buffer.from(await res.arrayBuffer()))
  mkdirSync(dir, { recursive: true })
  for (const [out, suffix] of Object.entries(MAPS)) {
    const name = `${id}_${QUALITY}_${suffix}.jpg`
    const entry = zip.get(name)
    if (!entry) throw new Error(`${id} : ${name} absent de l'archive (${[...zip.keys()].join(', ')})`)
    const src = join(tmp, name)
    writeFileSync(src, entry())
    // -q:v 4 : JPEG de bonne qualité (échelle 2–31, 2 = meilleur) ; carré, la texture se répète
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${size}:${size}`, '-q:v', '4', join(dir, `${out}.jpg`)])
    if (out === 'color') execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${THUMB}:${THUMB}`, '-q:v', '5', join(dir, 'thumb.jpg')])
  }
  console.log(`  ${role.padEnd(9)} ${id.padEnd(18)} ok (${size} px)`)
}

function writeSources() {
  const rows = Object.entries(ROLES).map(([role, id]) => `| \`${role}\` | ${id} | https://ambientcg.com/view?id=${id} |`)
  writeFileSync(join(outRoot, 'SOURCES.md'), [
    '# Pack « photo » — provenance',
    '',
    `Textures PBR d'[ambientCG](https://ambientcg.com), licence **CC0 1.0** (domaine public). Réduites à ${size} px par`,
    '`scripts/fetch-textures.mjs` ; trois cartes gardées par matière : couleur, normale (OpenGL), rugosité.',
    '',
    '| Rôle | Asset | Page |',
    '|---|---|---|',
    ...rows,
    '',
    'Finitions du catalogue (`../finishes/<asset>/`, même provenance et même licence) : ' + FINISH_ASSETS.join(', ') + '.',
    '',
  ].join('\n'))
}

const tmp = await mkdtemp(join(tmpdir(), 'kasbah-tex-'))
try {
  console.log(`Pack photo → ${outRoot}`)
  for (const [role, id] of Object.entries(ROLES)) await fetchRole(role, id, tmp)
  for (const id of FINISH_ASSETS) await fetchRole(id, id, tmp, join(texRoot, 'finishes', id))
  writeSources()
} finally {
  await rm(tmp, { recursive: true, force: true })
}
