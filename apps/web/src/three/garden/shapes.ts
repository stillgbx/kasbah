import { Box3, BufferAttribute, ConeGeometry, CylinderGeometry, IcosahedronGeometry, Vector3, type BufferGeometry, type Color } from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import type { GardenKind } from '@kasbah/shared'

// Formes PROCÉDURALES des éléments du jardin : aucun fichier, une géométrie tirée d'une graine.
// Chaque famille a `GARDEN_VARIANTS` formes ; un élément prend celle de sa graine, et son échelle,
// sa rotation et une pointe de couleur font le reste : trente sapins, quatre géométries.
//
// Repère maison (Z vers le haut), pied à l'origine, HAUTEUR 1 exactement : l'élément est mis à sa
// hauteur par l'échelle de son instance. Les pierres descendent un peu sous zéro (enterrées).
//
// Style LOW-POLY FACETTÉ (référence donnée le 2026-09-28 : les packs nature de Pure Poly) : peu de
// faces, normales par face, et une clarté qui varie d'une face à l'autre et monte vers le sommet —
// c'est ce qui donne le grain « palette » sans aucune texture.

export const GARDEN_VARIANTS = 4
/** `accent` : fruits ou fleurs d'une espèce (`species.ts`), semés sur le houppier. */
export type GardenPart = 'bark' | 'leaf' | 'stone' | 'accent'

/** Une pièce d'une forme : sa géométrie et la matière de jardin qui l'habille. */
export interface GardenShapePart {
  geometry: BufferGeometry
  part: GardenPart
}

export interface GardenShape {
  parts: GardenShapePart[]
  /** Diamètre au sol de la forme, rapporté à sa hauteur (1). */
  width: number
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même graine, même forme. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Graine d'un élément : la sienne, sinon un hachage de son id (FNV-1a). */
export function gardenSeed(item: { id: string; seed?: number }): number {
  if (item.seed !== undefined) return item.seed
  let h = 0x811c9dc5
  for (let i = 0; i < item.id.length; i++) h = Math.imul(h ^ item.id.charCodeAt(i), 0x01000193)
  return h >>> 0
}

const Y_TO_Z = Math.PI / 2

/** Ne garder que les positions, indexées : c'est ce que `mergeGeometries` exige de toutes les pièces. */
export function positionsOnly(g: BufferGeometry): BufferGeometry {
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  return g.index ? g : mergeVertices(g)
}

/**
 * Une boule bosselée (houppier, buisson, pierre). La bosse est une fonction CONTINUE de la position,
 * pas un tirage par sommet : l'icosaèdre répète ses sommets d'une face à l'autre, un tirage par
 * sommet l'aurait fendu.
 */
export function blob(r: number, bump: number, next: () => number, detail = 1): BufferGeometry {
  const g = positionsOnly(new IcosahedronGeometry(1, detail))
  const k = [2 + next() * 3, 2 + next() * 3, 2 + next() * 3]
  const s = [next() * 6, next() * 6, next() * 6]
  const pos = g.getAttribute('position')
  const v = new Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const n = Math.sin(v.x * k[0]! + s[0]!) * Math.sin(v.y * k[1]! + s[1]!) * Math.sin(v.z * k[2]! + s[2]!)
    v.multiplyScalar(r * (1 + bump * n))
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  return g
}

function trunk(rBottom: number, rTop: number, h: number, x = 0, y = 0, z = 0): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, h, 6, 1)
  g.rotateX(Y_TO_Z)
  g.translate(x, y, z + h / 2)
  return positionsOnly(g)
}

function broadleaf(next: () => number): Record<string, BufferGeometry[]> {
  const bark = [trunk(0.05, 0.034, 0.52)]
  const leaf = [blob(0.27, 0.12, next).translate(0, 0, 0.68)]
  const n = 3 + Math.floor(next() * 3)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + next() * 0.8
    const d = 0.13 + next() * 0.07
    leaf.push(blob(0.15 + next() * 0.06, 0.15, next).translate(Math.cos(a) * d, Math.sin(a) * d, 0.58 + next() * 0.2))
  }
  return { bark, leaf }
}

function conifer(next: () => number, variant: number): Record<string, BufferGeometry[]> {
  const bark = [trunk(0.04, 0.03, 0.2)]
  const leaf: BufferGeometry[] = []
  // la dernière forme est un cyprès : une colonne étroite plutôt qu'un sapin étagé
  const column = variant === GARDEN_VARIANTS - 1
  const tiers = column ? 1 : 3 + Math.floor(next() * 2)
  const r0 = column ? 0.13 : 0.26 + next() * 0.06
  for (let i = 0; i < tiers; i++) {
    const h = column ? 0.88 : 0.42
    const g = new ConeGeometry(r0 * (1 - i * (0.7 / tiers)), h, 7, 1)
    g.rotateX(Y_TO_Z)
    g.translate(0, 0, (column ? 0.12 : 0.12 + i * (0.58 / tiers)) + h / 2)
    leaf.push(positionsOnly(g))
  }
  return { bark, leaf }
}

function palm(next: () => number): Record<string, BufferGeometry[]> {
  const bark: BufferGeometry[] = []
  const segments = 6
  const lean = (next() - 0.5) * 0.12
  const segH = 0.86 / segments
  let x = 0
  for (let i = 0; i < segments; i++) {
    const dx = lean * ((i + 1) ** 2 - i ** 2) / segments
    bark.push(trunk(0.04 - i * 0.002, 0.036 - i * 0.002, segH * 1.05, x, 0, i * segH))
    x += dx
  }
  const leaf: BufferGeometry[] = []
  const fronds = 7 + Math.floor(next() * 3)
  for (let i = 0; i < fronds; i++) {
    const len = 0.34 + next() * 0.1
    const g = new ConeGeometry(0.055, len, 4, 1)
    g.rotateZ(-Math.PI / 2)                          // pointe vers +x
    g.translate(len / 2, 0, 0)
    g.scale(1, 1, 0.22)                              // palme plate
    g.rotateY(0.25 + next() * 0.55)                  // retombe
    g.rotateZ((i / fronds) * Math.PI * 2 + next() * 0.3)
    g.translate(x, 0, 0.86)
    leaf.push(positionsOnly(g))
  }
  return { bark, leaf }
}

function shrub(next: () => number): Record<string, BufferGeometry[]> {
  const leaf = [blob(0.5, 0.14, next).scale(1, 1, 0.85).translate(0, 0, 0.42)]
  const n = 2 + Math.floor(next() * 3)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + next()
    leaf.push(blob(0.3 + next() * 0.08, 0.16, next).translate(Math.cos(a) * 0.32, Math.sin(a) * 0.32, 0.3))
  }
  return { leaf }
}

function rock(next: () => number): Record<string, BufferGeometry[]> {
  const g = blob(0.5, 0.32, next, 1).scale(1.1 + next() * 0.5, 0.9 + next() * 0.3, 0.75)
  return { stone: [g] }
}

/**
 * Pied à z = 0 (une pierre enterrée d'un cinquième), hauteur 1 : c'est ce qui rend la hauteur
 * écrite dans la maison exacte, quelle que soit la forme tirée.
 */
function normalize(parts: readonly BufferGeometry[], buried: number): number {
  const box = new Box3()
  for (const g of parts) { g.computeBoundingBox(); box.union(g.boundingBox!) }
  const h = box.max.z - box.min.z
  const s = 1 / h
  for (const g of parts) {
    g.translate(0, 0, -box.min.z)
    g.scale(s, s, s)
    g.translate(0, 0, -buried)
    g.computeVertexNormals()
    g.computeBoundingBox()
    g.computeBoundingSphere()
  }
  return Math.max(box.max.x - box.min.x, box.max.y - box.min.y) * s
}

/**
 * Facettes : chaque triangle a ses propres sommets (donc sa normale), et une clarté en couleur de
 * sommet — un peu au hasard, et plus claire vers le haut de la pièce, comme un houppier pris par le
 * ciel. Sans `gradient`, la teinte reste celle de l'instance (la couleur de sommet ne fait que la
 * moduler) ; avec, la couleur va du bas au haut de la pièce — c'est ainsi qu'une espèce porte les
 * siennes.
 */
export function facet(g: BufferGeometry, next: () => number, gradient?: readonly [Color, Color]): BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g
  if (flat !== g) g.dispose()
  flat.computeVertexNormals()                        // sans index : une normale par face
  flat.computeBoundingBox()
  const { min, max } = flat.boundingBox!
  const span = max.z - min.z || 1
  const pos = flat.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let f = 0; f < pos.count; f += 3) {
    const z = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3
    const t = (z - min.z) / span
    const jit = 0.88 + next() * 0.24
    const rgb = gradient
      ? [0, 1, 2].map((c) => (gradient[0].toArray()[c]! * (1 - t) + gradient[1].toArray()[c]! * t) * jit)
      : Array(3).fill((0.8 + 0.3 * t) * jit)
    for (let k = 0; k < 3; k++) colors.set(rgb, (f + k) * 3)
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  flat.computeBoundingSphere()
  return flat
}

const cache = new Map<string, GardenShape>()

/**
 * La forme `variant` d'une famille, construite une fois et partagée par toutes les instances.
 * `foliage` < 1 retire des masses de feuillage (feuillus et buissons seulement : un conifère amputé
 * de ses étages hauts n'aurait plus l'air de rien) — la hauteur, elle, reste celle de l'arbre entier.
 */
export function gardenShape(kind: GardenKind, variant: number, foliage = 1): GardenShape {
  const key = `${kind}:${variant}:${foliage}`
  const hit = cache.get(key)
  if (hit) return hit
  const next = rng(0x9e3779b9 ^ (variant * 7919) ^ kind.length * 104729)
  const raw = kind === 'broadleaf' ? broadleaf(next)
    : kind === 'conifer' ? conifer(next, variant)
      : kind === 'palm' ? palm(next)
        : kind === 'shrub' ? shrub(next)
          : rock(next)
  // mise à l'échelle sur la forme ENTIÈRE, avant d'en retirer des masses
  const width = normalize(Object.values(raw).flat(), kind === 'rock' ? 0.2 : 0)
  if (foliage < 1 && raw.leaf && (kind === 'broadleaf' || kind === 'shrub')) {
    // la grande masse centrale part la première : garder les petites fait un arbre dégarni, pas un
    // arbre plus petit
    const keep = Math.max(1, Math.round(raw.leaf.length * foliage))
    for (const g of raw.leaf.slice(0, raw.leaf.length - keep)) g.dispose()
    raw.leaf = raw.leaf.slice(raw.leaf.length - keep)
  }
  const parts: GardenShapePart[] = Object.entries(raw).map(([part, list]) => ({ geometry: mergeGeometries(list, false), part: part as GardenPart }))
  for (const list of Object.values(raw)) for (const g of list) g.dispose()
  for (const p of parts) p.geometry = facet(p.geometry, next)
  const shape: GardenShape = { parts, width }
  cache.set(key, shape)
  return shape
}
