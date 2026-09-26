import { BufferAttribute, BufferGeometry, ExtrudeGeometry, Path, Shape, ShapeGeometry, Vector2, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
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

/** Extrusion percée de trous (dalle de pièce avec puits de lumière, toit plat avec Velux). */
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
 * Faces de toit gable percées de trous. Chaque trou dont `faceIndex` désigne la face est projeté
 * dans le plan de la face (repère local 2D) puis découpé via un Shape à trous, remis en 3D.
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
    const a = face[0]!, b = face[1]!, c = face[2]!
    const e1 = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
    const n = new Vector3().crossVectors(
      e1, new Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
    ).normalize()
    const e2 = new Vector3().crossVectors(n, e1).normalize()
    const to2 = (p: Vec3): [number, number] => {
      const d = new Vector3(p[0] - a[0], p[1] - a[1], p[2] - a[2])
      return [d.dot(e1), d.dot(e2)]
    }
    const from2 = (u: number, v: number): Vec3 => [
      a[0] + e1.x * u + e2.x * v,
      a[1] + e1.y * u + e2.y * v,
      a[2] + e1.z * u + e2.z * v,
    ]
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
    // mergeGeometries exige les mêmes attributs partout : planarFaces n'est ni indexé ni UV-é
    const flat = g.toNonIndexed()
    flat.deleteAttribute('uv')
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
