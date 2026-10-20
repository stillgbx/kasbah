import type { HouseDefaults } from '../defaults'
import type { Level, Room } from '../schema'
import type { FloorDescriptor, FloorHole, LabelAnchor } from './types'
import { centroid } from './vec2'

const THIN_SLAB = 0.05

/** Floor slabs (local z: the top face is at 0, the slab goes down below the level). */
export function computeFloors(
  level: Level, roomsOnLevel: readonly Room[], defaults: HouseDefaults,
  floorHoles?: ReadonlyMap<string, FloorHole[]>,
): FloorDescriptor[] {
  return roomsOnLevel.map((room) => {
    const thin = room.kind === 'terrace' || room.kind === 'balcony'
    const holes = floorHoles?.get(room.id)
    return {
      roomId: room.id, levelId: level.id, polygon: [...room.polygon],
      z0: -(thin ? THIN_SLAB : defaults.slabThickness), z1: 0, kind: room.kind,
      ...(room.style?.floor ? { floorStyle: room.style.floor } : {}),
      ...(room.style?.floorFinish ? { finish: room.style.floorFinish } : {}),
      ...(holes && holes.length > 0 ? { holes } : {}),
    }
  })
}

export function computeLabelAnchors(roomsOnLevel: readonly Room[]): LabelAnchor[] {
  return roomsOnLevel.map((room) => ({ roomId: room.id, position: centroid(room.polygon) }))
}
