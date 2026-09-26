import type { Relief } from '../schema'
import { offsetPolygon, pointInPolygon, type Vec2 } from './vec2'
import type { TerrainDescriptor } from './types'

// Relief du terrain : une grille de hauteurs (`site.relief`) lue comme une surface lisse, écrêtée
// sous les planchers et aplanie autour des bassins. Pur, sans Three : la scène s'en sert pour son maillage, `deviceFloorZ` pour
// poser un appareil du jardin, l'éditeur pour ses poignées.

/** La grille parsée : `cm[j * cols + i]`, rangée 0 au sud (y = origin[1]), colonne 0 à l'ouest. */
export interface ReliefGrid {
  step: number
  origin: Vec2
  cols: number
  rows: number
  cm: number[]
}

/**
 * Un BASSIN se pose sur un sol plat : sous lui et sur `PAD_FLAT` mètres autour le relief ne compte
 * pas, il revient ensuite en douceur sur `PAD_BLEND` mètres — sans quoi la margelle flotterait ou
 * s'enterrait. Le palier fait aussi que le maillage, découpé autour du bassin, n'y montre aucune
 * fente : tout y est à la même hauteur.
 *
 * La MAISON, elle, n'aplanit rien : le terrain peut monter contre ses murs (un talus qui vient
 * toucher la terrasse), et des nœuds SOUS elle servent à modeler ses abords. Il est seulement
 * écrêté sous chaque plancher (`Footprint`), pour qu'aucune bosse ne perce un sol.
 */
export const PAD_FLAT = 1
export const PAD_BLEND = 2

export function parseRelief(relief: Relief | undefined): ReliefGrid | null {
  if (!relief) return null
  const rows = relief.rows.map((row) => row.split(' ').map(Number))
  return { step: relief.step, origin: [relief.origin[0], relief.origin[1]], cols: rows[0]!.length, rows: rows.length, cm: rows.flat() }
}

export function serializeRelief(grid: ReliefGrid): Relief {
  const rows: string[] = []
  for (let j = 0; j < grid.rows; j++) rows.push(grid.cm.slice(j * grid.cols, (j + 1) * grid.cols).map((v) => Math.round(v)).join(' '))
  return { step: grid.step, origin: [grid.origin[0], grid.origin[1]], rows }
}

export const isFlatRelief = (grid: ReliefGrid): boolean => grid.cm.every((v) => Math.round(v) === 0)

/**
 * Une grille à zéro qui couvre `polygon` avec une maille de marge, calée sur les multiples du pas :
 * deux grilles faites au même pas ont les mêmes nœuds, quel que soit le contour.
 */
export function emptyReliefGrid(polygon: readonly Vec2[], step: number): ReliefGrid {
  const xs = polygon.map((p) => p[0]), ys = polygon.map((p) => p[1])
  const i0 = Math.floor(Math.min(...xs) / step) - 1, i1 = Math.ceil(Math.max(...xs) / step) + 1
  const j0 = Math.floor(Math.min(...ys) / step) - 1, j1 = Math.ceil(Math.max(...ys) / step) + 1
  const cols = i1 - i0 + 1, rows = j1 - j0 + 1
  return { step, origin: [i0 * step, j0 * step], cols, rows, cm: new Array<number>(cols * rows).fill(0) }
}

/** Position d'un nœud en repère maison. */
export const reliefNodeXY = (grid: ReliefGrid, i: number, j: number): Vec2 => [grid.origin[0] + i * grid.step, grid.origin[1] + j * grid.step]

const node = (g: ReliefGrid, i: number, j: number): number => {
  const ci = i < 0 ? 0 : i >= g.cols ? g.cols - 1 : i
  const cj = j < 0 ? 0 : j >= g.rows ? g.rows - 1 : j
  return g.cm[cj * g.cols + ci]!
}

/**
 * Cubique MONOTONE (Fritsch–Butland) sur [p1, p2] : passe PAR les nœuds (la poignée qu'on tire est
 * bien à la hauteur affichée) et ne sort JAMAIS de [p1, p2] entre eux. Catmull-Rom dépassait : un
 * plateau suivi d'une chute gagnait une bosse avant la descente, et un creux au pied du talus.
 * La pente en un nœud est la moyenne HARMONIQUE des deux pentes voisines, nulle quand elles changent
 * de signe (un sommet, un fond, un bord de plateau restent plats) : c'est ce qui borne la courbe.
 */
function monotone(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const slope = (a: number, b: number) => (a * b <= 0 ? 0 : (2 * a * b) / (a + b))
  const d0 = p1 - p0, d1 = p2 - p1, d2 = p3 - p2
  const m1 = slope(d0, d1), m2 = slope(d1, d2)
  const t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2
}

/** Écart de hauteur (m) de la grille en (x, y), bicubique monotone ; bord prolongé hors grille. */
export function reliefDelta(grid: ReliefGrid, x: number, y: number): number {
  const u = (x - grid.origin[0]) / grid.step, v = (y - grid.origin[1]) / grid.step
  const i = Math.floor(u), j = Math.floor(v), tu = u - i, tv = v - j
  const row = (jj: number) => monotone(node(grid, i - 1, jj), node(grid, i, jj), node(grid, i + 1, jj), node(grid, i + 2, jj), tu)
  return monotone(row(j - 1), row(j), row(j + 1), row(j + 2), tv) / 100
}

/** Plus bas et plus haut écart de la grille (m) — la surface lissée n'en sort pas. */
export function reliefRange(grid: ReliefGrid | null): [number, number] {
  if (!grid) return [0, 0]
  let lo = 0, hi = 0
  for (const v of grid.cm) { if (v < lo) lo = v; if (v > hi) hi = v }
  return [lo / 100, hi / 100]
}

/** Emprises aplanies : les bassins. */
export function terrainPads(house: { site: { zones: readonly { kind: string; polygon: Vec2[] }[] } }): Vec2[][] {
  return house.site.zones.filter((z) => z.kind === 'pool').map((z) => z.polygon)
}

/** Emprise d'une pièce vue du terrain : sous elle, le sol ne dépasse pas `ceiling` (z absolu). */
export interface Footprint { polygon: Vec2[]; ceiling: number }

/**
 * Une emprise par pièce, élargie de la MOITIÉ du mur extérieur (qui se pose dehors, contre le
 * contour de la pièce) : le passage du terrain libre au terrain écrêté tombe dans l'épaisseur du
 * mur, invisible, et le sol touche la face extérieure à sa vraie hauteur. Le plafond est le dessous
 * de la dalle du niveau — jamais sous la cote du terrain, qui reste le sol d'une maison plate.
 *
 * Les contours de niveau (`outline`) n'en font pas partie : ce sont des emprises approchées (celles
 * de la maison réelle sont des rectangles plus grands, ou plus petits, que les pièces).
 */
export function terrainFootprints(
  house: { rooms: readonly { polygon: Vec2[]; levelId: string }[]; levels: readonly { id: string; elevation: number }[]; site: { elevation: number } },
  defaults: { slabThickness: number; exteriorWallThickness: number },
): Footprint[] {
  const elevation = new Map(house.levels.map((l) => [l.id, l.elevation]))
  return house.rooms.map((r) => ({
    polygon: offsetPolygon(r.polygon, defaults.exteriorWallThickness / 2),
    ceiling: Math.max(house.site.elevation, (elevation.get(r.levelId) ?? 0) - defaults.slabThickness),
  }))
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

const smoothstep = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

interface PadSet { polys: Vec2[][]; min: Vec2; max: Vec2 }
const padSets = new WeakMap<Vec2[][], PadSet>()
function padSet(pads: Vec2[][]): PadSet {
  let set = padSets.get(pads)
  if (!set) {
    const pts = pads.flat()
    const reach = PAD_FLAT + PAD_BLEND
    set = pts.length
      ? { polys: pads, min: [Math.min(...pts.map((p) => p[0])) - reach, Math.min(...pts.map((p) => p[1])) - reach], max: [Math.max(...pts.map((p) => p[0])) + reach, Math.max(...pts.map((p) => p[1])) + reach] }
      : { polys: [], min: [0, 0], max: [-1, -1] }
    padSets.set(pads, set)
  }
  return set
}

/** Part du relief qui s'applique en (x, y) : 0 sur le bâti et son palier, 1 au-delà du raccord. */
export function padWeight(pads: Vec2[][], x: number, y: number): number {
  const set = padSet(pads)
  if (x < set.min[0] || y < set.min[1] || x > set.max[0] || y > set.max[1]) return 1
  const p: Vec2 = [x, y]
  let d = Infinity
  for (const poly of set.polys) {
    if (pointInPolygon(p, poly)) return 0
    for (let k = 0; k < poly.length; k++) d = Math.min(d, segmentDistance(p, poly[k]!, poly[(k + 1) % poly.length]!))
  }
  return smoothstep((d - PAD_FLAT) / PAD_BLEND)
}

interface FootprintBox { f: Footprint; x0: number; y0: number; x1: number; y1: number }
const footprintBoxes = new WeakMap<Footprint[], FootprintBox[]>()

/** Le plus bas des plafonds des emprises qui couvrent (x, y) ; `Infinity` hors de la maison. */
export function footprintCeiling(footprints: Footprint[], x: number, y: number): number {
  let boxes = footprintBoxes.get(footprints)
  if (!boxes) {
    boxes = footprints.map((f) => {
      const xs = f.polygon.map((p) => p[0]), ys = f.polygon.map((p) => p[1])
      return { f, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    })
    footprintBoxes.set(footprints, boxes)
  }
  let c = Infinity
  for (const b of boxes) {
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1 || b.f.ceiling >= c) continue
    if (pointInPolygon([x, y], b.f.polygon)) c = b.f.ceiling
  }
  return c
}

/**
 * La surface LIBRE du relief en (x, y), avant écrêtage sous les planchers : c'est là qu'est un nœud
 * qu'on tire, même sous la maison, où le terrain dessiné reste sous le sol.
 */
export function reliefSurface(terrain: TerrainDescriptor, x: number, y: number): number {
  if (!terrain.relief) return terrain.z
  const w = padWeight(terrain.pads, x, y)
  return w === 0 ? terrain.z : terrain.z + w * reliefDelta(terrain.relief, x, y)
}

/** Hauteur ABSOLUE du terrain en (x, y). Sans relief, c'est `terrain.z` partout, comme avant. */
export function terrainHeight(terrain: TerrainDescriptor, x: number, y: number): number {
  if (!terrain.relief) return terrain.z
  return Math.min(reliefSurface(terrain, x, y), footprintCeiling(terrain.footprints, x, y))
}
