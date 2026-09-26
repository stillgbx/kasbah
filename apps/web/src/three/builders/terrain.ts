import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three'
import { ensureCCW, footprintCeiling, padWeight, pointInPolygon, reliefDelta, signedArea, type TerrainDescriptor, type Vec2 } from '@kasbah/shared'

// Terrain EN RELIEF : un polygone (percé de ses bassins) découpé en mailles carrées de
// `TERRAIN_MESH_RES`, dont chaque sommet prend la hauteur de la surface (`terrainHeight`).
//
// Pourquoi des mailles et pas `ShapeGeometry` : la triangulation d'un polygone ne met des sommets
// que sur son contour — de longs triangles qui traversent la parcelle et n'ont rien pour suivre une
// bosse. Chaque maille est le carré coupé par le contour (Sutherland–Hodgman, le carré étant
// convexe) puis privé des triangles de ses bassins ; les mailles sont calées sur les multiples du
// pas, donc le terrain et une zone posée dessus partagent leurs sommets intérieurs.
//
// La géométrie est construite UNE fois par contour ; bouger le relief ne refait que les z
// (`applyTerrainHeights`) — c'est ce qui rend l'édition au doigt fluide.

export const TERRAIN_MESH_RES = 0.5

type Line = (p: Vec2) => number

/** Garde la partie de `poly` où `f(p) ≥ 0` (f affine) : Sutherland–Hodgman sur un demi-plan. */
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

/** Retire les points confondus qui se suivent (la découpe en laisse sur les coins). */
function clean(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of poly) {
    const q = out[out.length - 1]
    if (!q || Math.abs(q[0] - p[0]) > 1e-7 || Math.abs(q[1] - p[1]) > 1e-7) out.push(p)
  }
  while (out.length > 1 && Math.abs(out[0]![0] - out[out.length - 1]![0]) <= 1e-7 && Math.abs(out[0]![1] - out[out.length - 1]![1]) <= 1e-7) out.pop()
  return out
}

/** `poly` privé du triangle CCW `t` : trois morceaux au plus, un par côté du triangle. */
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

/** Une maille grossière longeant un mur est découpée en `REFINE` × `REFINE`. */
const REFINE = 4

/**
 * Les mailles traversées par le CONTOUR de la maison. Une arête dont les deux côtés sont dans une
 * emprise (la cloison entre deux pièces) n'en est pas : seul le bord de l'ensemble compte.
 */
function refinedCells(walls: readonly (readonly Vec2[])[], res: number): Set<string> {
  const out = new Set<string>()
  const insideAny = (p: Vec2) => walls.some((w) => pointInPolygon(p, w))
  for (const w of walls) {
    for (let k = 0; k < w.length; k++) {
      const a = w[k]!, b = w[(k + 1) % w.length]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 1e-6) continue
      const nx = (b[1] - a[1]) / len * 0.05, ny = -(b[0] - a[0]) / len * 0.05
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
      if (insideAny([mx + nx, my + ny]) && insideAny([mx - nx, my - ny])) continue
      const n = Math.ceil(len / (res / 8))
      for (let i = 0; i <= n; i++) {
        const x = a[0] + (b[0] - a[0]) * (i / n), y = a[1] + (b[1] - a[1]) * (i / n)
        out.add(`${Math.floor(x / res)},${Math.floor(y / res)}`)
      }
    }
  }
  return out
}

/** Ajoute les points `sub` des côtés de maille `near` le long des arêtes de `piece` qui y reposent. */
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

/** Convexe, points alignés admis (ceux qu'ajoute `densifyBorders`). */
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
 * Le polygone `outer` percé de `holes`, maillé en carrés de `res` à plat (z = 0). UV = (x, y) en
 * mètres, comme `ShapeGeometry` : les matières du terrain se posent pareil sur l'une ou l'autre.
 */
export function drapeGeometry(
  outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], res = TERRAIN_MESH_RES, walls: readonly (readonly Vec2[])[] = [],
): BufferGeometry {
  const poly = ensureCCW(outer)
  const holeTris = holes.flatMap((h) => triangles(ensureCCW(h)).map((t) => {
    const xs = t.map((p) => p[0]), ys = t.map((p) => p[1])
    return { t, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
  }))
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
  const refined = refinedCells(walls, res)
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
    if (area > 0) index.push(ia, ib, ic)                 // normale vers +z
    else index.push(ia, ic, ib)
  }
  /** Maille [x0, x1] × [y0, y1] de `column` (la parcelle déjà coupée à cette bande de x), bassins retirés. */
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
      // la triangulation retire les points ALIGNÉS — justement ceux qu'on vient d'ajouter sur un côté :
      // un morceau convexe se triangule donc en éventail depuis son centre, qui les garde tous
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
        // le long d'un mur : mailles fines, le raccord entre terrain libre et écrêté reste dans le mur
        for (let sx = 0; sx < REFINE; sx++) {
          const sx0 = x0 + sx * sub, sx1 = sx0 + sub
          const subColumn = clipHalf(clipHalf(column, (p) => p[0] - sx0), (p) => sx1 - p[0])
          if (subColumn.length < 3) continue
          for (let sy = 0; sy < REFINE; sy++) region(subColumn, sx0, y0 + sy * sub, sx1, y0 + (sy + 1) * sub)
        }
        continue
      }
      // une maille voisine d'une maille fine reçoit ses sommets sur le côté commun : sans eux, le
      // bord de la maille fine aurait des points que celle-ci n'a pas, et le terrain se fendrait
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
 * La jupe : un ruban vertical le long du contour, du terrain jusqu'au sol infini. Sans elle, une
 * bosse au bord de la parcelle laisserait voir le vide sous le terrain, et un creux, le sol infini
 * par-dessus. Échantillonnée où le maillage coupe le contour, pour épouser son bord.
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
  // deux sommets par point du contour : le haut (pair, z posé par `applyTerrainHeights`) et le bas (impair)
  const pos = new Float32Array(pts.length * 6)
  pts.forEach(([x, y], i) => { pos.set([x, y, 0, x, y, 0], i * 6) })
  const index: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    // les deux faces : le ruban monte vers une bosse ou descend dans un creux, il se voit des deux côtés
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
 * Pose les z d'une géométrie de `drapeGeometry` (ou de `skirtGeometry`) sur la surface du terrain,
 * décalés de `lift`. La part de relief de chaque sommet (`padWeight`) et le plancher qui le couvre
 * (`footprintCeiling`), les coûteux, sont retenus sur la géométrie tant que les emprises sont les
 * mêmes : pendant un glissement, seul le relief change.
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
    if (skirt && i % 2 === 1) { pos.setZ(i, terrain.z - 0.02); continue }   // pied de la jupe : le sol infini
    const d = relief && w[i]! > 0 ? w[i]! * reliefDelta(relief, pos.getX(i), pos.getY(i)) : 0
    pos.setZ(i, Math.min(terrain.z + d, ceil[i]!) + lift)
  }
  pos.needsUpdate = true
  if (!skirt) g.computeVertexNormals()
  g.computeBoundingBox()
  g.computeBoundingSphere()
}
