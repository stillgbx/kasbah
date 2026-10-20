import { BufferAttribute, BufferGeometry, ExtrudeGeometry, Path, Shape, ShapeGeometry, Vector2, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { add, centroid, ensureCCW, lineIntersect, longestEdgeYawDeg, normalize, perpLeft, scale, sub, type Vec2, type Vec3 } from '@kasbah/shared'

export function toShape(polygon: readonly Vec2[]): Shape {
  return new Shape(polygon.map(([x, y]) => new Vector2(x, y)))
}

/** Extrusion of a polygon of the XY plane from z0 to z1 (house reference frame, Z-up). */
export function extrudePolygon(polygon: readonly Vec2[], z0: number, z1: number): ExtrudeGeometry {
  const g = new ExtrudeGeometry(toShape(polygon), { depth: z1 - z0, bevelEnabled: false })
  g.translate(0, 0, z0)
  return g
}

/** Extrusion pierced with holes (room slab with skylights, flat roof with Velux windows). */
export function extrudePolygonWithHoles(
  outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], z0: number, z1: number,
): ExtrudeGeometry {
  const shape = toShape(outer)
  for (const h of holes) shape.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))))
  const g = new ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false })
  g.translate(0, 0, z0)
  return g
}

export function flatPolygon(polygon: readonly Vec2[], z: number): ShapeGeometry {
  const g = new ShapeGeometry(toShape(polygon))
  g.translate(0, 0, z)
  return g
}

/**
 * 2D reference frame of a planar face, in meters: u along its first edge (the eaves of a roof slope),
 * v in the plane, pointing UP (toward the ridge). Used for UVs — the texture repeats every
 * `tileM` meters, tile rows parallel to the eaves — and for cutting the holes.
 */
function faceFrame(face: readonly Vec3[]): { to2: (p: Vec3) => [number, number]; from2: (u: number, v: number) => Vec3 } {
  const a = face[0]!, b = face[1]!, c = face[2]!
  const e1 = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
  const n = new Vector3().crossVectors(e1, new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2])).normalize()
  const e2 = new Vector3().crossVectors(n, e1).normalize()
  if (e2.z < 0) e2.negate()
  return {
    to2: (p) => {
      const d = new Vector3(p[0] - a[0], p[1] - a[1], p[2] - a[2])
      return [d.dot(e1), d.dot(e2)]
    },
    from2: (u, v) => [a[0] + e1.x * u + e2.x * v, a[1] + e1.y * u + e2.y * v, a[2] + e1.z * u + e2.z * v],
  }
}

/** Convex planar faces (fan) → non-indexed geometry with normals and UVs in meters. */
export function planarFaces(faces: readonly Vec3[][]): BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  for (const face of faces) {
    const { to2 } = faceFrame(face)
    for (let i = 1; i + 1 < face.length; i++) {
      for (const p of [face[0]!, face[i]!, face[i + 1]!]) {
        positions.push(...p)
        uvs.push(...to2(p))
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  g.computeVertexNormals()
  return g
}

/**
 * Gable roof faces pierced with holes. Each hole whose `faceIndex` designates the face is projected
 * into the plane of the face (local 2D reference frame) then cut via a Shape with holes, put back in 3D.
 */
export function planarFacesWithHoles(
  faces: readonly Vec3[][],
  holes: readonly { faceIndex?: number; corners?: readonly Vec3[] }[],
): BufferGeometry {
  const parts: BufferGeometry[] = []
  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]!
    if (face.length < 3) continue
    const faceHoles = holes.filter((h) => h.faceIndex === fi && h.corners && h.corners.length >= 3)
    if (faceHoles.length === 0) {
      parts.push(planarFaces([face]))
      continue
    }
    const { to2, from2 } = faceFrame(face)
    const outline = face.map(to2)
    const shape = new Shape(outline.map(([u, v]) => new Vector2(u, v)))
    for (const h of faceHoles) {
      const hole2 = h.corners!.map(to2)
      shape.holes.push(new Path(hole2.map(([u, v]) => new Vector2(u, v))))
    }
    const g = new ShapeGeometry(shape)
    const pos = g.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = from2(pos.getX(i), pos.getY(i))
      pos.setXYZ(i, x, y, z)
    }
    pos.needsUpdate = true
    g.computeVertexNormals()
    // mergeGeometries requires the same attributes everywhere: planarFaces is not indexed. The
    // ShapeGeometry's UVs are already the (u, v) coordinates of the face's frame: we keep them.
    const flat = g.toNonIndexed()
    g.dispose()
    parts.push(flat)
  }
  if (parts.length === 0) return planarFaces(faces)
  if (parts.length === 1) return parts[0]!
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  return merged ?? planarFaces(faces)
}

/**
 * Offsets a CCW polygon INWARD by `d` (mitered corners). `offsetPolygon` (shared) only serves
 * the overhang — outward — and its square-end fallback only holds for a positive
 * distance. Used for rings: margin of a selected room, pool coping, parapet.
 */
export function insetPolygon(polygon: readonly Vec2[], d: number): Vec2[] {
  const p = ensureCCW(polygon)
  const n = p.length
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = p[(i - 1 + n) % n]!, cur = p[i]!, next = p[(i + 1) % n]!
    const dA = normalize(sub(cur, prev)), dB = normalize(sub(next, cur))
    const oA = add(prev, scale(perpLeft(dA), d))            // LEFT perpendicular = toward the inside of a CCW
    const oB = add(cur, scale(perpLeft(dB), d))
    out.push(lineIntersect(oA, dA, oB, dB) ?? oB)
  }
  return out
}

/** Flat polygon PIERCED with holes (the pools of a plot), laid at `z`. */
export function flatWithHoles(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], z: number): ShapeGeometry {
  const shape = toShape(outer)
  for (const h of holes) shape.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))))
  const g = new ShapeGeometry(shape)
  g.translate(0, 0, z)
  return g
}

/** Flat ring between two polygons (the second is the hole), laid at `z`. */
export const flatRing = (outer: readonly Vec2[], inner: readonly Vec2[], z: number): ShapeGeometry => flatWithHoles(outer, [inner], z)

/** Disc pierced with holes: the infinite ground, which must not cover a pool dug beneath it. */
export function discWithHoles(radius: number, holes: readonly (readonly Vec2[])[], z: number): ShapeGeometry {
  const shape = new Shape().absarc(0, 0, radius, 0, Math.PI * 2, false)
  for (const h of holes) shape.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))))
  const g = new ShapeGeometry(shape, 72)
  g.translate(0, 0, z)
  return g
}

/** Ring extruded from z0 to z1: a low wall that follows an outline. */
export function extrudeRing(outer: readonly Vec2[], inner: readonly Vec2[], z0: number, z1: number): ExtrudeGeometry {
  const shape = toShape(outer)
  shape.holes.push(new Path(inner.map(([x, y]) => new Vector2(x, y))))
  const g = new ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false })
  g.translate(0, 0, z0)
  return g
}

/**
 * Builds a geometry in the polygon's frame — its longest side on the y axis, around
 * its center — then puts it back in place. The UVs of `ExtrudeGeometry` and `ShapeGeometry` take
 * the LOCAL positions: a patterned material (a pool's tiling) then follows the edges of the
 * polygon instead of the world axes — a pool rotated by 30° had its tiles askew.
 */
export function alignedToLongestEdge(polygon: readonly Vec2[], build: (local: Vec2[]) => BufferGeometry): BufferGeometry {
  const yaw = ((longestEdgeYawDeg(polygon) ?? 0) * Math.PI) / 180
  const [cx, cy] = centroid(polygon)
  const cos = Math.cos(-yaw), sin = Math.sin(-yaw)
  const local = polygon.map(([x, y]): Vec2 => {
    const dx = x - cx, dy = y - cy
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
  })
  const g = build(local)
  g.translate(-cx, -cy, 0)
  g.rotateZ(yaw)
  g.translate(cx, cy, 0)
  return g
}
