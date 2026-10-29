import { BoxGeometry, Matrix4, Mesh, Vector3, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { LevelGeometry, OpeningMaterial, OpeningRect, OpeningType, RoofDescriptor, Vec2, Vec3, WallPrism } from '@kasbah/shared'
import { joineryMaterial, type JoineryRole, type MaterialSet } from './materials'
import { extrudePolygon, extrudeRing, insetPolygon } from './shapes'

// Procedural ARCHITECTURAL detail: what turns an extruded box into a building. No
// asset, no extra data in house.json — everything is derived from the wall prisms and the
// opening rectangles (`packages/shared/src/house/geometry`). Four families:
//  - the SURROUND of an opening (four jambs for a window, three for a door), set at
//    mid-thickness of the wall, where the glazing already is — the shutter, for its part, lives near the
//    outer face (`markers.ts`, 0.8 of the thickness) and does not touch it;
//  - the SILL of a window, which projects from the facade and whose top is FLUSH with the breast: a
//    closed shutter comes down to there, a higher sill would cut it;
//  - the COPING of the walls, a lighter rail that overhangs each face by one centimeter:
//    seen from above, it is what draws the plan; from the side, it is the edge of the wall;
//  - the PLINTH of the exterior walls, a darker band that sets the house on its ground,
//    and that steps in by eight millimeters on the room side — a baseboard.
// Plus the LEAF of a door (closed, on the inside): an empty opening reads as a hole.
//
// The offsets are made ACROSS the wall only, never along it: two pieces of the same wall
// (solid, lintel, solid) keep copings that touch exactly, without overlap
// — two overlapping coplanar tops flicker. A one-centimeter notch remains
// at each outer corner, invisible at the scale of a house.
//
// One MERGED geometry per material and per level: a house with thirty openings means three
// more draw calls, not three hundred.

const FRAME = 0.06          // visible width of a window jamb (m)
const DOOR_FRAME = 0.07     // same, door
const CAP_H = 0.03          // height of the coping, taken FROM the wall…
const CAP_UP = 0.005        // …plus what sticks out above it (two coplanar tops would flicker)
const CAP_OUT = 0.01        // overhang of the coping on each side
const PLINTH_H = 0.28
const PLINTH_OUT = 0.015    // overhang of the plinth on the facade side
const PLINTH_IN = 0.008     // and on the room side: the baseboard
const SILL_H = 0.05
const SILL_OUT = 0.05       // overhang of the sill in front of the facade
const SILL_SIDE = 0.04      // and on each side of the opening
const LEAF = 0.04           // thickness of a leaf
const EPS = 1e-6
/** No dressed opening: the case of every house that has no linked cover. */
const EMPTY_SET: ReadonlySet<string> = new Set<string>()
/** Gap (m) between two solid leaves: this line is what makes a double door read. */
const LEAF_GAP = 0.02

/**
 * What is GLAZED: a window, a bay window, a glazed door. These three receive glazing in
 * their reveal (`buildPane`); a solid door, a passage and a garage door do not.
 *
 * Declared here, in a LEAF module: `buildHouse` already imports `buildDetails` from here, and the reverse
 * would make a cycle — Vite re-evaluates a module on hot reload, and a cycle leaves it half initialized
 * (see `6_faq/6_0_pieges-outillage.md`).
 */
export const GLAZED_OPENINGS: ReadonlySet<OpeningType> = new Set<OpeningType>(['window', 'bay', 'glass-door', 'roof-window', 'skylight'])

/**
 * Glazed for real: by its KIND, or because the survey gives it glass as its material. A
 * solid door declared as glass then receives its glazing and loses its opaque panel — that is all
 * that "Material: Glass" means, and it is the only material that affects the geometry.
 */
export const isGlazed = (o: OpeningRect): boolean => o.material === 'glass' || GLAZED_OPENINGS.has(o.type)

/**
 * A box in an opening's frame: x along the wall from the left edge, y in the thickness
 * from the inner face, z from the sill. `at` is the CENTER of the box.
 */
function boxAt(o: OpeningRect, size: readonly [number, number, number], at: readonly [number, number, number]): BufferGeometry {
  const g = new BoxGeometry(size[0], size[1], size[2])
  // After `rotateZ`, the local y axis follows the LEFT perpendicular of `u` — and the outward normal
  // of a wall (CCW room) is the RIGHT perpendicular. Without this sign, frames and sills went
  // into the room: observed on the real house, a sill laid at the foot of the window on the parquet side.
  const side = Math.sign(-o.u[1] * o.normal[0] + o.u[0] * o.normal[1]) || 1
  g.translate(at[0], side * at[1], at[2])
  g.rotateZ(Math.atan2(o.u[1], o.u[0]))
  g.translate(o.origin[0], o.origin[1], o.origin[2])
  return g
}

/**
 * Surround of an opening (DARK jambs: on a light wall, it is the frame that draws the
 * window — the maquette has charcoal joinery) and sill of a window (LIGHT, like the rails).
 *
 * Three families are told apart at first glance, and that is intended — the user is correcting a
 * survey, they must see that they designated the right opening:
 *  - a WINDOW: frame on its four sides, plus a sill that projects from the facade;
 *  - a BAY WINDOW: frame on four sides too (it has a bottom rail, that is its track),
 *    but NO sill — it goes down to the floor — and a vertical mullion per leaf, otherwise three
 *    meters of glass in one piece look like nothing;
 *  - a DOOR, glazed or solid: three sides, no bottom rail (that is the threshold), no sill.
 */
function frameOfOpening(o: OpeningRect, frames: BufferGeometry[], trim: BufferGeometry[]): void {
  if (o.type === 'passage') return
  // wall frame only: surface openings have their fixed frame drawn with the glazing
  if (o.host === 'floor' || o.host === 'roof') return
  const f = o.type === 'window' ? FRAME : DOOR_FRAME
  const { width: w, height: h, depth: d } = o
  if (w <= 2 * f + EPS || h <= f + EPS) return
  const fd = Math.min(0.12, Math.max(0.04, d * 0.4))        // depth of the frame in the thickness
  frames.push(
    boxAt(o, [f, fd, h], [f / 2, d / 2, h / 2]),
    boxAt(o, [f, fd, h], [w - f / 2, d / 2, h / 2]),
    boxAt(o, [w - 2 * f, fd, f], [w / 2, d / 2, h - f / 2]),
  )
  // bottom rail: a window's breast, a bay window's track; a door has a threshold, not a rail
  if (o.type === 'window' || o.type === 'bay') frames.push(boxAt(o, [w - 2 * f, fd, f], [w / 2, d / 2, f / 2]))
  if (o.type === 'window') {
    const sy = 0.06 + SILL_OUT
    trim.push(boxAt(o, [w + 2 * SILL_SIDE, sy, SILL_H], [w / 2, d - 0.06 + sy / 2, -SILL_H / 2]))
  }
  // A MULLION per joint between leaves, on everything that is glazed: without them, three meters of glass
  // in one piece look like nothing. The bay window already got them by default; now it is the
  // number of leaves that decides (`openingLeaves` returns the same thing when the file is silent).
  if (isGlazed(o)) {
    for (let i = 1; i < o.leaves; i++) frames.push(boxAt(o, [f, fd, h - 2 * f], [(i * w) / o.leaves, d / 2, h / 2]))
  }
}

/** The `n` leaves of an opening `inner` wide, with their gap: width of a leaf, and its left edge. */
function leafSpans(inner: number, n: number): { width: number; x0: (i: number) => number } | null {
  const gap = n > 1 ? LEAF_GAP : 0
  const width = (inner - gap * (n - 1)) / n
  return width > EPS ? { width, x0: (i: number) => i * (width + gap) } : null
}

/**
 * What FILLS the opening: the solid leaf of a door (inner side), the curtain of a garage
 * door — and, for a GLAZED door, a simple leaf frame, dark, around the glass already laid
 * by `buildPane`. An opaque panel would hide precisely what defines it.
 */
function leafOfOpening(o: OpeningRect, out: BufferGeometry[], frames: BufferGeometry[]): void {
  if (o.type !== 'door' && o.type !== 'garage' && o.type !== 'glass-door') return
  const f = DOOR_FRAME
  const { width: w, height: h, depth: d } = o
  if (w <= 2 * f + EPS || h <= f + EPS) return
  const span = leafSpans(w - 2 * f, o.leaves)
  if (!span) return
  if (isGlazed(o)) {
    const lh = h - f, r = f * 0.8                   // the leaf is a little thinner than the fixed frame
    const y = d * 0.35
    for (let i = 0; i < o.leaves; i++) {
      const x = f + span.x0(i), lw = span.width
      if (lw <= 2 * r + EPS) continue
      frames.push(
        boxAt(o, [r, LEAF, lh], [x + r / 2, y, lh / 2]),
        boxAt(o, [r, LEAF, lh], [x + lw - r / 2, y, lh / 2]),
        boxAt(o, [lw - 2 * r, LEAF, r], [x + lw / 2, y, lh - r / 2]),
        boxAt(o, [lw - 2 * r, LEAF, r], [x + lw / 2, y, r / 2]),
      )
    }
    return
  }
  // SOLID leaves: one panel per leaf, separated by their gap — a double door is
  // recognized by this vertical line, not by a panel twice as wide
  const thick = o.type === 'garage' ? 0.05 : LEAF
  const y = o.type === 'garage' ? d / 2 : d * 0.35
  for (let i = 0; i < o.leaves; i++) {
    out.push(boxAt(o, [span.width, thick, h - f], [f + span.x0(i) + span.width / 2, y, (h - f) / 2]))
  }
}

/**
 * The quad of a wall piece is [P0, Q0, Q1, P1]: P on the inner line, Q on the outer
 * line (`pieceFootprint`). It is offset ACROSS only: `inward` on the P side, `outward` on the Q side.
 */
function acrossOffset(fp: WallPrism['footprint'], inward: number, outward: number): Vec2[] {
  const [p0, q0, q1, p1] = fp
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1]
  const L = Math.hypot(dx, dy) || 1
  let nx = dy / L, ny = -dx / L                              // a perpendicular…
  if ((q0[0] - p0[0]) * nx + (q0[1] - p0[1]) * ny < 0) { nx = -nx; ny = -ny }   // …oriented toward Q
  return [
    [p0[0] - nx * inward, p0[1] - ny * inward],
    [q0[0] + nx * outward, q0[1] + ny * outward],
    [q1[0] + nx * outward, q1[1] + ny * outward],
    [p1[0] - nx * inward, p1[1] - ny * inward],
  ]
}

/** Coping: on each piece that reaches the top of ITS wall (the solid part and the lintel, not the breast). */
function capsOfWalls(walls: readonly WallPrism[], out: BufferGeometry[]): void {
  const top = new Map<string, number>()
  for (const w of walls) {
    const k = `${w.roomId}/${w.segment}`
    top.set(k, Math.max(top.get(k) ?? -Infinity, w.z1))
  }
  for (const w of walls) {
    if (w.z1 < top.get(`${w.roomId}/${w.segment}`)! - EPS) continue
    out.push(extrudePolygon(acrossOffset(w.footprint, CAP_OUT, CAP_OUT), w.z1 - CAP_H, w.z1 + CAP_UP))
  }
}

/** Plinth: the EXTERIOR wall pieces that start from the floor (a door leaves its gap there). */
function plinthsOfWalls(walls: readonly WallPrism[], out: BufferGeometry[]): void {
  for (const w of walls) {
    if (w.kind !== 'exterior' || w.z0 > EPS) continue
    // two millimeters above the finished floor: the overhang does not share its face with the floor
    out.push(extrudePolygon(acrossOffset(w.footprint, PLINTH_IN, PLINTH_OUT), w.z0 + 0.002, Math.min(w.z1, w.z0 + PLINTH_H)))
  }
}

function meshOf(parts: BufferGeometry[], material: MaterialSet['trim'], name: string): Mesh | null {
  if (parts.length === 0) return null
  // a box is INDEXED, an extrusion is not: `mergeGeometries` refuses to mix the two
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p))
  const g = mergeGeometries(flat, false)
  for (const p of parts) p.dispose()
  for (const p of flat) if (!parts.includes(p)) p.dispose()
  if (!g) return null
  const mesh = new Mesh(g, material)
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  // stored with the level's walls (ghost of a level above, material reset); no room
  mesh.userData = { role: 'wall', kind: 'detail', material }
  return mesh
}

/**
 * The JOINERY is merged per tint, not as a block: an opening that asks for neither material nor
 * color falls back on its role's shared material, and so adds no draw call. An
 * ordinary house keeps its two meshes; only the openings that want something else
 * cost one more, and two windows of the same tint share it.
 */
type Buckets = Map<string, { parts: BufferGeometry[]; material?: OpeningMaterial; color?: string }>
function bucket(buckets: Buckets, o: OpeningRect): BufferGeometry[] {
  // the EMPTY key is the default setting's: it is the one that keeps its mesh without a suffix
  const key = o.material || o.color ? `${o.material ?? ''}|${o.color ?? ''}` : ''
  let b = buckets.get(key)
  if (!b) { b = { parts: [], ...(o.material ? { material: o.material } : {}), ...(o.color ? { color: o.color } : {}) }; buckets.set(key, b) }
  return b.parts
}
function meshesOf(buckets: Buckets, mats: MaterialSet, role: JoineryRole, name: string): (Mesh | null)[] {
  return [...buckets].map(([key, b]) => meshOf(b.parts, joineryMaterial(mats, role, b.material, b.color), key ? `${name}#${key}` : name))
}

/** The detail of a level: rails, surrounds, plinth, leaves — the last two per tint. */
export function buildDetails(level: LevelGeometry, mats: MaterialSet, dressed: ReadonlySet<string> = EMPTY_SET): Mesh[] {
  const trim: BufferGeometry[] = []
  const plinth: BufferGeometry[] = []
  const frames: Buckets = new Map()
  const doors: Buckets = new Map()
  for (const o of level.openings) {
    frameOfOpening(o, bucket(frames, o), trim)
    // The leaf of an opening DRESSED by a cover belongs to the device: it is the device that
    // draws it, at its dimensions and in its colors, and that opens it. Drawing a second one here left a
    // closed garage door behind the curtain that had just gone up. The FIXED FRAME and the GLAZING,
    // for their part, stay with the structure: a shutter removes neither the frame nor the glass of the window it covers.
    if (!dressed.has(o.openingId)) leafOfOpening(o, bucket(doors, o), bucket(frames, o))
  }
  capsOfWalls(level.walls, trim)
  plinthsOfWalls(level.walls, plinth)
  return [
    meshOf(trim, mats.trim, 'details:trim'),
    ...meshesOf(frames, mats, 'frame', 'details:frames'),
    meshOf(plinth, mats.plinth, 'details:plinth'),
    ...meshesOf(doors, mats, 'door', 'details:doors'),
  ].filter((m): m is Mesh => m !== null)
}

// ---- the roof -----------------------------------------------------------------------------------

const FASCIA_DROP = 0.18      // height of a fascia board (m)
const FASCIA_T = 0.04         // its thickness
const FASCIA_GAP = 0.01       // set off from the gable: two coplanar faces would flicker
const PARAPET_H = 0.35        // parapet of a flat roof, above the slab
const PARAPET_T = 0.2

/**
 * A board along a 3D edge, hanging below it and pushed toward `out`: a parallelepiped
 * (a unit box given an oblique base), so that the board of a sloping verge
 * follows the slope while keeping its faces vertical.
 */
function board(a: Vec3, b: Vec3, out: Vec2): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1)
  const e = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const m = new Matrix4().makeBasis(e, new Vector3(out[0] * FASCIA_T, out[1] * FASCIA_T, 0), new Vector3(0, 0, FASCIA_DROP))
  const k = FASCIA_GAP + FASCIA_T / 2
  m.setPosition((a[0] + b[0]) / 2 + out[0] * k, (a[1] + b[1]) / 2 + out[1] * k, (a[2] + b[2]) / 2 - FASCIA_DROP / 2)
  g.applyMatrix4(m)
  return g
}

/**
 * The roof detail. Pitched roof: a FASCIA board under each slope edge that runs along the border of
 * the roof (eaves, gable verges, the high edge of a single slope) — never on the ridge nor on the hips,
 * which are inside it. It is the visible thickness of a roof that has none
 * (`faces` is a set of planes, `thickness` 0). Flat roof: a PARAPET, a low wall in the walls'
 * material that runs around the slab, coped like the walls.
 */
export function buildRoofDetails(roof: RoofDescriptor, mats: MaterialSet): Mesh[] {
  const out: Mesh[] = []
  if (roof.type === 'flat') {
    const inner = insetPolygon(roof.outline, PARAPET_T)
    const z0 = roof.zRidge, z1 = roof.zRidge + PARAPET_H
    const wall = new Mesh(extrudeRing(roof.outline, inner, z0, z1), mats.wall)
    wall.name = 'roof:parapet'
    wall.userData = { role: 'roof', material: mats.wall }
    const cap = new Mesh(extrudeRing(insetPolygon(roof.outline, -CAP_OUT), insetPolygon(inner, CAP_OUT), z1 - CAP_H, z1 + CAP_UP), mats.trim)
    cap.name = 'roof:parapet-cap'
    cap.userData = { role: 'roof', material: mats.trim }
    out.push(wall, cap)
  } else {
    const parts: BufferGeometry[] = []
    const pts = roof.faces.flat()
    const lo = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))]
    const hi = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]
    const onBorder = (a: Vec3, b: Vec3) => [0, 1].some((k) => [lo[k]!, hi[k]!].some((v) => Math.abs(a[k]! - v) < EPS && Math.abs(b[k]! - v) < EPS))
    for (const face of roof.faces) {
      // a gable is vertical: its ground footprint has no area
      let area = 0
      for (let i = 0; i < face.length; i++) {
        const p = face[i]!, q = face[(i + 1) % face.length]!
        area += p[0] * q[1] - q[0] * p[1]
      }
      if (Math.abs(area) < EPS) continue
      const cx = face.reduce((s, p) => s + p[0], 0) / face.length
      const cy = face.reduce((s, p) => s + p[1], 0) / face.length
      for (let i = 0; i < face.length; i++) {
        const a = face[i]!, b = face[(i + 1) % face.length]!
        if (!onBorder(a, b)) continue                                           // ridge, hips
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (L < EPS) continue
        let out2: Vec2 = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]
        if (out2[0] * ((a[0] + b[0]) / 2 - cx) + out2[1] * ((a[1] + b[1]) / 2 - cy) < 0) out2 = [-out2[0], -out2[1]]
        parts.push(board(a, b, out2))
      }
    }
    const fascia = meshOf(parts, mats.frame, 'roof:fascia')
    if (fascia) { fascia.userData = { role: 'roof', material: mats.frame }; out.push(fascia) }
  }
  for (const m of out) { m.castShadow = true; m.receiveShadow = true }
  return out
}
