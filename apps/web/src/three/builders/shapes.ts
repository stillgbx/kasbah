import { BufferAttribute, BufferGeometry, ExtrudeGeometry, Shape, ShapeGeometry, Vector2 } from 'three'
import type { Vec2, Vec3 } from '@kasbah/shared'

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
