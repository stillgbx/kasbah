import { Box3, Vector3 } from 'three'
import type { AABB3, Vec3 } from '@kasbah/shared'

// Repère maison Z-up (x est, y nord, z haut) → monde Three Y-up. Le groupe racine porte
// rotation.x = -π/2, donc un point local (x, y, z) devient (x, z, -y) en monde.

export function houseToWorld([x, y, z]: Vec3, out = new Vector3()): Vector3 {
  return out.set(x, z, -y)
}

export function worldToHouse(v: Vector3): Vec3 {
  return [v.x, -v.z, v.y]
}

export function boundsToWorldBox(b: AABB3): Box3 {
  return new Box3(new Vector3(b.min[0], b.min[2], -b.max[1]), new Vector3(b.max[0], b.max[2], -b.min[1]))
}
