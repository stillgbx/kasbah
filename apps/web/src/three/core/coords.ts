import { Box3, Vector3 } from 'three'
import type { AABB3, Vec3 } from '@kasbah/shared'

// Z-up house reference frame (x east, y north, z up) → Y-up Three world. The root group carries
// rotation.x = -π/2, so a local point (x, y, z) becomes (x, z, -y) in the world.

export function houseToWorld([x, y, z]: Vec3, out = new Vector3()): Vector3 {
  return out.set(x, z, -y)
}

export function worldToHouse(v: Vector3): Vec3 {
  return [v.x, -v.z, v.y]
}

export function boundsToWorldBox(b: AABB3): Box3 {
  return new Box3(new Vector3(b.min[0], b.min[2], -b.max[1]), new Vector3(b.max[0], b.max[2], -b.min[1]))
}
