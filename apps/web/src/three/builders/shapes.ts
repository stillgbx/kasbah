import { BufferAttribute, BufferGeometry, ExtrudeGeometry, Path, Shape, ShapeGeometry, Vector2 } from 'three'
import { add, centroid, ensureCCW, lineIntersect, longestEdgeYawDeg, normalize, perpLeft, scale, sub, type Vec2, type Vec3 } from '@kasbah/shared'

export function toShape(polygon: readonly Vec2[]): Shape {
  return new Shape(polygon.map(([x, y]) => new Vector2(x, y)))
}

/** Extrusion d'un polygone du plan XY de z0 à z1 (repère maison, Z-up). */
export function extrudePolygon(polygon: readonly Vec2[], z0: number, z1: number): ExtrudeGeometry {
  const g = new ExtrudeGeometry(toShape(polygon), { depth: z1 - z0, bevelEnabled: false })
  g.translate(0, 0, z0)
  return g
}

export function flatPolygon(polygon: readonly Vec2[], z: number): ShapeGeometry {
  const g = new ShapeGeometry(toShape(polygon))
  g.translate(0, 0, z)
  return g
}

/** Faces planes convexes (éventail) → géométrie indexée avec normales. */
export function planarFaces(faces: readonly Vec3[][]): BufferGeometry {
  const positions: number[] = []
  for (const face of faces) {
    for (let i = 1; i + 1 < face.length; i++) {
      positions.push(...face[0]!, ...face[i]!, ...face[i + 1]!)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.computeVertexNormals()
  return g
}

/**
 * Décale un polygone CCW vers l'INTÉRIEUR de `d` (coins mitrés). `offsetPolygon` (shared) ne sert
 * que le débord — vers l'extérieur — et son repli de bout droit ne vaut que pour une distance
 * positive. Sert aux anneaux : marge d'une pièce sélectionnée, margelle, acrotère.
 */
export function insetPolygon(polygon: readonly Vec2[], d: number): Vec2[] {
  const p = ensureCCW(polygon)
  const n = p.length
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = p[(i - 1 + n) % n]!, cur = p[i]!, next = p[(i + 1) % n]!
    const dA = normalize(sub(cur, prev)), dB = normalize(sub(next, cur))
    const oA = add(prev, scale(perpLeft(dA), d))            // perpendiculaire GAUCHE = vers l'intérieur d'un CCW
    const oB = add(cur, scale(perpLeft(dB), d))
    out.push(lineIntersect(oA, dA, oB, dB) ?? oB)
  }
  return out
}

/** Polygone plat PERCÉ de trous (les bassins d'une parcelle), posé à `z`. */
export function flatWithHoles(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], z: number): ShapeGeometry {
  const shape = toShape(outer)
  for (const h of holes) shape.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))))
  const g = new ShapeGeometry(shape)
  g.translate(0, 0, z)
  return g
}

/** Anneau plat entre deux polygones (le second est le trou), posé à `z`. */
export const flatRing = (outer: readonly Vec2[], inner: readonly Vec2[], z: number): ShapeGeometry => flatWithHoles(outer, [inner], z)

/** Disque percé de trous : le sol infini, qui ne doit pas boucher un bassin creusé sous lui. */
export function discWithHoles(radius: number, holes: readonly (readonly Vec2[])[], z: number): ShapeGeometry {
  const shape = new Shape().absarc(0, 0, radius, 0, Math.PI * 2, false)
  for (const h of holes) shape.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))))
  const g = new ShapeGeometry(shape, 72)
  g.translate(0, 0, z)
  return g
}

/** Anneau extrudé de z0 à z1 : un muret qui suit un contour. */
export function extrudeRing(outer: readonly Vec2[], inner: readonly Vec2[], z0: number, z1: number): ExtrudeGeometry {
  const shape = toShape(outer)
  shape.holes.push(new Path(inner.map(([x, y]) => new Vector2(x, y))))
  const g = new ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false })
  g.translate(0, 0, z0)
  return g
}

/**
 * Construit une géométrie dans le repère du polygone — son plus grand côté sur l'axe y, autour de
 * son centre — puis la remet en place. Les UV d'`ExtrudeGeometry` et de `ShapeGeometry` reprennent
 * les positions LOCALES : une matière à motif (le carrelage d'un bassin) suit alors les bords du
 * polygone au lieu des axes du monde — une piscine tournée de 30° avait ses carreaux en biais.
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
