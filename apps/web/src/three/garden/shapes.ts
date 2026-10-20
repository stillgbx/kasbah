import { Box3, BufferAttribute, ConeGeometry, CylinderGeometry, IcosahedronGeometry, OctahedronGeometry, Vector3, type BufferGeometry, type Color } from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import type { GardenKind } from '@kasbah/shared'

// PROCEDURAL shapes of the garden elements: no file, a geometry drawn from a seed.
// Each family has `GARDEN_VARIANTS` shapes; an element takes the one of its seed, and its scale,
// its rotation and a touch of color do the rest: thirty firs, four geometries.
//
// House reference frame (Z up), foot at the origin, HEIGHT exactly 1: the element is brought to its
// height by its instance's scale. Stones go a little below zero (buried).
//
// FACETED LOW-POLY style (reference given on 2026-09-28: Pure Poly's nature packs): few
// faces, per-face normals, and a lightness that varies from one face to the next and rises toward the top —
// that is what gives the "palette" grain without any texture.

export const GARDEN_VARIANTS = 4
/** `accent`: fruit or flowers of a species (`species.ts`), sown on the crown. */
export type GardenPart = 'bark' | 'leaf' | 'stone' | 'accent'

/** One piece of a shape: its geometry and the garden material that dresses it. */
export interface GardenShapePart {
  geometry: BufferGeometry
  part: GardenPart
}

export interface GardenShape {
  parts: GardenShapePart[]
  /** Ground diameter of the shape, relative to its height (1). */
  width: number
}

/** Deterministic pseudo-random generator (mulberry32): same seed, same shape. */
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

/** Seed of an element: its own, otherwise a hash of its id (FNV-1a). */
export function gardenSeed(item: { id: string; seed?: number }): number {
  if (item.seed !== undefined) return item.seed
  let h = 0x811c9dc5
  for (let i = 0; i < item.id.length; i++) h = Math.imul(h ^ item.id.charCodeAt(i), 0x01000193)
  return h >>> 0
}

const Y_TO_Z = Math.PI / 2

/** Keep only the positions, indexed: that is what `mergeGeometries` requires of all pieces. */
export function positionsOnly(g: BufferGeometry): BufferGeometry {
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  return g.index ? g : mergeVertices(g)
}

/**
 * A bumpy ball (crown, bush, stone). The bump is a CONTINUOUS function of the position,
 * not a draw per vertex: the icosahedron repeats its vertices from one face to the next, a draw per
 * vertex would have split it.
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

/** A generic fruit tree: a broadleaf, lower and more spread out, sown with red fruit. */
function fruit(next: () => number): Record<string, BufferGeometry[]> {
  const { bark = [], leaf = [] } = broadleaf(next)
  for (const g of leaf) g.scale(1.25, 1.25, 0.9)
  const accent: BufferGeometry[] = []
  for (let i = 0; i < 24; i++) {
    const a = next() * Math.PI * 2
    const e = (next() - 0.4) * 1.2
    accent.push(positionsOnly(new OctahedronGeometry(0.025, 0)).translate(Math.cos(a) * Math.cos(e) * 0.36, Math.sin(a) * Math.cos(e) * 0.36, 0.62 + Math.sin(e) * 0.18))
  }
  return { bark, leaf, accent }
}

function conifer(next: () => number, variant: number): Record<string, BufferGeometry[]> {
  const bark = [trunk(0.04, 0.03, 0.2)]
  const leaf: BufferGeometry[] = []
  // the last shape is a cypress: a narrow column rather than a tiered fir
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
    g.rotateZ(-Math.PI / 2)                          // tip toward +x
    g.translate(len / 2, 0, 0)
    g.scale(1, 1, 0.22)                              // flat frond
    g.rotateY(0.25 + next() * 0.55)                  // droops
    g.rotateZ((i / fronds) * Math.PI * 2 + next() * 0.3)
    g.translate(x, 0, 0.86)
    leaf.push(positionsOnly(g))
  }
  return { bark, leaf }
}

/** A clump of almost straight culms, bare at the foot, and plumes of leaves at the top. */
function bamboo(next: () => number): Record<string, BufferGeometry[]> {
  const bark: BufferGeometry[] = []
  const leaf: BufferGeometry[] = []
  const culms = 6 + Math.floor(next() * 4)
  for (let i = 0; i < culms; i++) {
    const a = next() * Math.PI * 2
    const d = next() * 0.09
    const x = Math.cos(a) * d
    const y = Math.sin(a) * d
    const h = 0.7 + next() * 0.3
    const g = trunk(0.014, 0.01, h)
    g.rotateY((next() - 0.5) * 0.12)
    g.rotateZ(a)
    bark.push(g.translate(x, y, 0))
    const tufts = 2 + Math.floor(next() * 2)
    for (let k = 0; k < tufts; k++) {
      const z = h * (0.55 + (k / tufts) * 0.4)
      leaf.push(blob(0.07 + next() * 0.04, 0.2, next).scale(1, 1, 1.5).translate(x * 1.6, y * 1.6, z))
    }
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
 * Foot at z = 0 (a stone buried by a fifth), height 1: this is what makes the height
 * written in the house exact, whatever shape is drawn.
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
 * Facets: each triangle has its own vertices (hence its normal), and a lightness as vertex
 * color — a little random, and lighter toward the top of the piece, like a crown caught by the
 * sky. Without `gradient`, the tint stays the instance's (the vertex color only
 * modulates it); with it, the color goes from the bottom to the top of the piece — that is how a species carries
 * its own.
 */
export function facet(g: BufferGeometry, next: () => number, gradient?: readonly [Color, Color]): BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g
  if (flat !== g) g.dispose()
  flat.computeVertexNormals()                        // no index: one normal per face
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
 * The `variant` shape of a family, built once and shared by all instances.
 * `foliage` < 1 removes foliage masses (broadleaves and bushes only: a conifer stripped
 * of its upper tiers would look like nothing) — the height, for its part, stays that of the whole tree.
 */
export function gardenShape(kind: GardenKind, variant: number, foliage = 1): GardenShape {
  const key = `${kind}:${variant}:${foliage}`
  const hit = cache.get(key)
  if (hit) return hit
  const next = rng(0x9e3779b9 ^ (variant * 7919) ^ kind.length * 104729)
  const raw = kind === 'broadleaf' ? broadleaf(next)
    : kind === 'fruit' ? fruit(next)
    : kind === 'conifer' ? conifer(next, variant)
      : kind === 'palm' ? palm(next)
        : kind === 'bamboo' ? bamboo(next)
        : kind === 'shrub' ? shrub(next)
          : rock(next)
  // scaling on the WHOLE shape, before removing masses from it
  const width = normalize(Object.values(raw).flat(), kind === 'rock' ? 0.2 : 0)
  if (foliage < 1 && raw.leaf && (kind === 'broadleaf' || kind === 'fruit' || kind === 'shrub')) {
    // the big central mass goes first: keeping the small ones makes a thinned tree, not a
    // smaller tree
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
