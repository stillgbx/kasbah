import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three'
import { ensureCCW, footprintCeiling, padWeight, reliefDelta, signedArea, type Footprint, type TerrainDescriptor, type Vec2 } from '@kasbah/shared'

// Terrain WITH RELIEF: a polygon (pierced by its pools) cut into square cells of
// `TERRAIN_MESH_RES`, each vertex of which takes the height of the surface (`terrainHeight`).
//
// Why cells and not `ShapeGeometry`: triangulating a polygon only puts vertices
// on its outline — long triangles that cross the plot and have nothing to follow a
// bump. Each cell is the square clipped by the outline (Sutherland–Hodgman, the square being
// convex) then stripped of the triangles of its pools; the cells are aligned on multiples of the
// step, so the terrain and a zone laid on it share their inner vertices.
//
// The geometry is built ONCE per outline; moving the relief only redoes the z values
// (`applyTerrainHeights`) — that is what makes finger editing smooth.

export const TERRAIN_MESH_RES = 0.5

type Line = (p: Vec2) => number

/** Keeps the part of `poly` where `f(p) ≥ 0` (f affine): Sutherland–Hodgman on a half-plane. */
function clipHalf(poly: readonly Vec2[], f: Line): Vec2[] {
  const out: Vec2[] = []
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!, b = poly[(k + 1) % poly.length]!
    const fa = f(a), fb = f(b)
    if (fa >= 0) out.push(a)
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

/** Removes coincident consecutive points (clipping leaves some at the corners). */
function clean(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of poly) {
    const q = out[out.length - 1]
    if (!q || Math.abs(q[0] - p[0]) > 1e-7 || Math.abs(q[1] - p[1]) > 1e-7) out.push(p)
  }
  while (out.length > 1 && Math.abs(out[0]![0] - out[out.length - 1]![0]) <= 1e-7 && Math.abs(out[0]![1] - out[out.length - 1]![1]) <= 1e-7) out.pop()
  return out
}

/** `poly` minus the CCW triangle `t`: three pieces at most, one per side of the triangle. */
function subtractTriangle(poly: Vec2[], t: readonly [Vec2, Vec2, Vec2]): Vec2[][] {
  const out: Vec2[][] = []
  let rest = poly
  for (let e = 0; e < 3 && rest.length >= 3; e++) {
    const a = t[e]!, b = t[(e + 1) % 3]!
    const inside: Line = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    const outside = clipHalf(rest, (p) => -inside(p))
    if (outside.length >= 3) out.push(outside)
    rest = clipHalf(rest, inside)
  }
  return out
}

/** A coarse cell running along a wall is cut into `REFINE` × `REFINE`. */
const REFINE = 4

/**
 * The cells crossed by a footprint edge where the CEILING changes from one side to the other: that is where
 * the terrain goes from free to clipped. A partition between two rooms of the same level is not one.
 * A facade under a cantilevered upper floor is: outside, the ceiling is the upper floor's floor.
 * (First version: "both sides are in a room" — it skipped those facades, and the
 * join spread over 50 cm cells that stuck out of the wall, sawtoothed along a slope.)
 */
function refinedCells(footprints: Footprint[], res: number): Set<string> {
  const out = new Set<string>()
  for (const { polygon: w } of footprints) {
    for (let k = 0; k < w.length; k++) {
      const a = w[k]!, b = w[(k + 1) % w.length]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 1e-6) continue
      const nx = (b[1] - a[1]) / len * 0.05, ny = -(b[0] - a[0]) / len * 0.05
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
      if (footprintCeiling(footprints, mx + nx, my + ny) === footprintCeiling(footprints, mx - nx, my - ny)) continue
      const n = Math.ceil(len / (res / 8))
      for (let i = 0; i <= n; i++) {
        const x = a[0] + (b[0] - a[0]) * (i / n), y = a[1] + (b[1] - a[1]) * (i / n)
        out.add(`${Math.floor(x / res)},${Math.floor(y / res)}`)
      }
    }
  }
  return out
}

/** Adds the `sub` points of the `near` cell sides along the edges of `piece` that rest on them. */
function densifyBorders(piece: Vec2[], x0: number, y0: number, x1: number, y1: number, sub: number, near: { l: boolean; r: boolean; b: boolean; t: boolean }): Vec2[] {
  const eps = 1e-7
  const out: Vec2[] = []
  for (let k = 0; k < piece.length; k++) {
    const a = piece[k]!, b = piece[(k + 1) % piece.length]!
    out.push(a)
    const onX = (x: number) => Math.abs(a[0] - x) < eps && Math.abs(b[0] - x) < eps
    const onY = (y: number) => Math.abs(a[1] - y) < eps && Math.abs(b[1] - y) < eps
    let axis: 0 | 1 | null = null, from = 0
    if ((near.l && onX(x0)) || (near.r && onX(x1))) { axis = 1; from = y0 }
    else if ((near.b && onY(y0)) || (near.t && onY(y1))) { axis = 0; from = x0 }
    if (axis === null) continue
    const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis])
    const vals: number[] = []
    for (let m = 1; m < REFINE; m++) { const v = from + m * sub; if (v > lo + eps && v < hi - eps) vals.push(v) }
    if (a[axis] > b[axis]) vals.reverse()
    for (const v of vals) out.push(axis === 1 ? [a[0], v] : [v, a[1]])
  }
  return out
}

/** Convex, collinear points allowed (those added by `densifyBorders`). */
function isConvex(poly: readonly Vec2[]): boolean {
  const sign = Math.sign(signedArea(poly))
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!, b = poly[(k + 1) % poly.length]!, c = poly[(k + 2) % poly.length]!
    if (sign * ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) < -1e-9) return false
  }
  return true
}

function triangles(poly: readonly Vec2[]): [Vec2, Vec2, Vec2][] {
  return ShapeUtils.triangulateShape(poly.map(([x, y]) => new Vector2(x, y)), [])
    .map((f) => [poly[f[0]!]!, poly[f[1]!]!, poly[f[2]!]!] as [Vec2, Vec2, Vec2])
}

/**
 * The `outer` polygon pierced by `holes`, meshed in `res` squares, flat (z = 0). UV = (x, y) in
 * meters, like `ShapeGeometry`: the terrain materials lay the same way on either.
 */
export function drapeGeometry(
  outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], res = TERRAIN_MESH_RES, footprints: Footprint[] = [],
): BufferGeometry {
  const poly = ensureCCW(outer)
  const holeTris = holes.flatMap((h) => triangles(ensureCCW(h)).map((t) => {
    const xs = t.map((p) => p[0]), ys = t.map((p) => p[1])
    return { t, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
  }))
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
  const refined = refinedCells(footprints, res)
  const sub = res / REFINE
  const pos: number[] = []
  const index: number[] = []
  const ids = new Map<string, number>()
  const vertex = (p: Vec2): number => {
    const key = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`
    let id = ids.get(key)
    if (id === undefined) { id = pos.length / 3; pos.push(p[0], p[1], 0); ids.set(key, id) }
    return id
  }
  const emit = (a: Vec2, b: Vec2, c: Vec2) => {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (Math.abs(area) < 1e-10) return
    const ia = vertex(a), ib = vertex(b), ic = vertex(c)
    if (ia === ib || ib === ic || ia === ic) return
    if (area > 0) index.push(ia, ib, ic)                 // normal toward +z
    else index.push(ia, ic, ib)
  }
  /** Cell [x0, x1] × [y0, y1] of `column` (the plot already cut to this x band), pools removed. */
  const region = (column: readonly Vec2[], x0: number, y0: number, x1: number, y1: number, densify?: (piece: Vec2[]) => Vec2[]) => {
    const cell = clean(clipHalf(clipHalf(column, (p) => p[1] - y0), (p) => y1 - p[1]))
    if (cell.length < 3) return
    let pieces = [cell]
    for (const h of holeTris) {
      if (h.x1 <= x0 || h.x0 >= x1 || h.y1 <= y0 || h.y0 >= y1) continue
      pieces = pieces.flatMap((p) => subtractTriangle(p, h.t))
    }
    for (const raw of pieces) {
      const base = clean(raw)
      const piece = densify ? densify(base) : base
      if (piece.length < 3 || Math.abs(signedArea(piece)) < 1e-9) continue
      if (piece.length === 3) emit(piece[0]!, piece[1]!, piece[2]!)
      // triangulation removes COLLINEAR points — precisely the ones just added on a side:
      // a convex piece is therefore triangulated as a fan from its center, which keeps them all
      else if (piece !== base && isConvex(piece)) {
        const c: Vec2 = [piece.reduce((t, p) => t + p[0], 0) / piece.length, piece.reduce((t, p) => t + p[1], 0) / piece.length]
        for (let k = 0; k < piece.length; k++) emit(c, piece[k]!, piece[(k + 1) % piece.length]!)
      } else for (const [a, b, c] of triangles(piece)) emit(a, b, c)
    }
  }
  for (let ix = Math.floor(Math.min(...xs) / res); ix * res < Math.max(...xs); ix++) {
    const x0 = ix * res, x1 = x0 + res
    const column = clipHalf(clipHalf(poly, (p) => p[0] - x0), (p) => x1 - p[0])
    if (column.length < 3) continue
    for (let iy = Math.floor(Math.min(...ys) / res); iy * res < Math.max(...ys); iy++) {
      const y0 = iy * res, y1 = y0 + res
      if (refined.has(`${ix},${iy}`)) {
        // along a wall: fine cells, the join between free and clipped terrain stays inside the wall
        for (let sx = 0; sx < REFINE; sx++) {
          const sx0 = x0 + sx * sub, sx1 = sx0 + sub
          const subColumn = clipHalf(clipHalf(column, (p) => p[0] - sx0), (p) => sx1 - p[0])
          if (subColumn.length < 3) continue
          for (let sy = 0; sy < REFINE; sy++) region(subColumn, sx0, y0 + sy * sub, sx1, y0 + (sy + 1) * sub)
        }
        continue
      }
      // a cell next to a fine cell receives its vertices on the shared side: without them, the
      // edge of the fine cell would have points this one lacks, and the terrain would crack
      const near = { l: refined.has(`${ix - 1},${iy}`), r: refined.has(`${ix + 1},${iy}`), b: refined.has(`${ix},${iy - 1}`), t: refined.has(`${ix},${iy + 1}`) }
      const densify = near.l || near.r || near.b || near.t
        ? (piece: Vec2[]) => densifyBorders(piece, x0, y0, x1, y1, sub, near)
        : undefined
      region(column, x0, y0, x1, y1, densify)
    }
  }
  const g = new BufferGeometry()
  const positions = new Float32Array(pos)
  const uv = new Float32Array((pos.length / 3) * 2)
  for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = pos[i * 3]!; uv[i * 2 + 1] = pos[i * 3 + 1]! }
  g.setAttribute('position', new BufferAttribute(positions, 3))
  g.setAttribute('uv', new BufferAttribute(uv, 2))
  g.setIndex(index)
  return g
}

/**
 * The skirt: a vertical ribbon along the outline, from the terrain down to the infinite ground. Without it, a
 * bump at the edge of the plot would reveal the void under the terrain, and a hollow, the infinite ground
 * on top. Sampled where the mesh crosses the outline, to hug its edge.
 */
export function skirtGeometry(outer: readonly Vec2[], res = TERRAIN_MESH_RES): BufferGeometry {
  const poly = ensureCCW(outer)
  const pts: Vec2[] = []
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!, b = poly[(k + 1) % poly.length]!
    const ts = [0]
    for (const axis of [0, 1] as const) {
      const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis])
      for (let v = Math.ceil(lo / res) * res; v < hi; v += res) if (hi > lo) ts.push((v - a[axis]) / (b[axis] - a[axis]))
    }
    ts.sort((u, v) => u - v)
    for (const t of ts) pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  // two vertices per outline point: the top (even, z set by `applyTerrainHeights`) and the bottom (odd)
  const pos = new Float32Array(pts.length * 6)
  pts.forEach(([x, y], i) => { pos.set([x, y, 0, x, y, 0], i * 6) })
  const index: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    // both faces: the ribbon rises toward a bump or descends into a hollow, it is seen from both sides
    index.push(i * 2 + 1, j * 2 + 1, j * 2, i * 2 + 1, j * 2, i * 2)
    index.push(i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1, i * 2, j * 2)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setIndex(index)
  g.userData.skirt = true
  return g
}

/**
 * Sets the z values of a `drapeGeometry` (or `skirtGeometry`) geometry on the terrain surface,
 * offset by `lift`. Each vertex's share of relief (`padWeight`) and the floor that covers it
 * (`footprintCeiling`), the costly ones, are kept on the geometry as long as the footprints are the
 * same: during a drag, only the relief changes.
 */
export function applyTerrainHeights(g: BufferGeometry, terrain: TerrainDescriptor, lift = 0): void {
  const pos = g.getAttribute('position') as BufferAttribute
  const skirt = g.userData.skirt === true
  let w = g.userData.padWeights as Float32Array | undefined
  let ceil = g.userData.ceilings as Float32Array | undefined
  if (!w || !ceil || g.userData.pads !== terrain.pads || g.userData.footprints !== terrain.footprints) {
    w = new Float32Array(pos.count)
    ceil = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      w[i] = padWeight(terrain.pads, pos.getX(i), pos.getY(i))
      ceil[i] = footprintCeiling(terrain.footprints, pos.getX(i), pos.getY(i))
    }
    g.userData.padWeights = w
    g.userData.ceilings = ceil
    g.userData.pads = terrain.pads
    g.userData.footprints = terrain.footprints
  }
  const relief = terrain.relief
  for (let i = 0; i < pos.count; i++) {
    if (skirt && i % 2 === 1) { pos.setZ(i, terrain.z - 0.02); continue }   // foot of the skirt: the infinite ground
    const d = relief && w[i]! > 0 ? w[i]! * reliefDelta(relief, pos.getX(i), pos.getY(i)) : 0
    pos.setZ(i, Math.min(terrain.z + d, ceil[i]!) + lift)
  }
  pos.needsUpdate = true
  if (!skirt) g.computeVertexNormals()
  g.computeBoundingBox()
  g.computeBoundingSphere()
}
