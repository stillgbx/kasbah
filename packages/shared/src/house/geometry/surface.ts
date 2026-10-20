import type { HouseDefaults } from '../defaults'
import { surfaceAxes, surfaceCorners } from '../openings'
import type { House, Level, Opening, Room } from '../schema'
import { isSurfaceOpening, type OpeningType } from '../schema'
import { openingLeaves, planLength } from './walls'
import type { FloorHole, OpeningRect, RoofDescriptor, RoofHole, Vec3 } from './types'
import { pointInPolygon, type Vec2 } from './vec2'

/**
 * Absolute height and slope of the roof at the point (x, y). `null` if outside the footprint.
 * Flat roof: zBase, slope 0. Gable: plane of the face whose projection contains the point.
 */
export function roofAtPoint(
  roof: RoofDescriptor, x: number, y: number,
): { z: number; slope: number; faceIndex?: number } | null {
  if (!pointInPolygon([x, y], roof.outline)) return null
  if (roof.type === 'flat' || roof.faces.length === 0) {
    return { z: roof.zBase, slope: 0 }
  }
  for (let i = 0; i < roof.faces.length; i++) {
    const face = roof.faces[i]!
    const poly: Vec2[] = face.map((p) => [p[0], p[1]])
    if (!pointInPolygon([x, y], poly)) continue
    // plane ax + by + cz = d via three non-collinear points
    const a = face[0]!, b = face[1]!, c = face[2]!
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const nx = ab[1] * ac[2] - ab[2] * ac[1]
    const ny = ab[2] * ac[0] - ab[0] * ac[2]
    const nz = ab[0] * ac[1] - ab[1] * ac[0]
    if (Math.abs(nz) < 1e-9) continue
    const z = a[2] - (nx * (x - a[0]) + ny * (y - a[1])) / nz
    // slope = angle of the plane with the horizontal
    const nLen = Math.hypot(nx, ny, nz) || 1
    const slope = Math.acos(Math.min(1, Math.abs(nz) / nLen)) * (180 / Math.PI)
    return { z, slope, faceIndex: i }
  }
  return { z: roof.zBase, slope: 0 }
}

/** Default heading of a roof window at the given point: direction of the slope's descent. */
export function defaultRoofYaw(roof: RoofDescriptor, x: number, y: number): number {
  const at = roofAtPoint(roof, x, y)
  if (!at || at.faceIndex === undefined || !roof.faces[at.faceIndex]) return 180
  const face = roof.faces[at.faceIndex]!
  const a = face[0]!, b = face[1]!, c = face[2]!
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const nx = ab[1] * ac[2] - ab[2] * ac[1]
  const ny = ab[2] * ac[0] - ab[0] * ac[2]
  const nz = ab[0] * ac[1] - ab[1] * ac[0]
  // normal oriented upward: it LEANS downslope, its horizontal projection is the descent
  // (until 2026-09-26 the opposite was taken: a Velux placed by finger faced the ridge)
  if (Math.abs(nx) + Math.abs(ny) < 1e-9) return 180
  const sign = nz >= 0 ? 1 : -1
  const dx = sign * nx, dy = sign * ny
  // yaw : 0 = +y → atan2(-dx, dy) in degrees
  const deg = (Math.atan2(-dx, dy) * 180) / Math.PI
  return Math.round(((deg % 360) + 360) % 360)
}

/**
 * Footprint SEEN FROM THE SKY of a surface opening. A Velux placed on a SLOPE follows the slope, like
 * a real installation: its heading is that of the descent (`defaultRoofYaw` — the written `yaw` is ignored, and
 * it flips by itself from one slope to the other) and its length, measured along the slope,
 * shortens by cos(slope). Skylight, flat roof, off roof: the opening as written.
 * Everything that reasons in plan (hole, dimensions, place in the room, overlap, placement) goes through it.
 */
export function surfaceFootprint(
  o: { type: OpeningType; x: number; y: number; yaw: number; width: number; height: number },
  roof: RoofDescriptor | undefined,
): { x: number; y: number; yaw: number; width: number; height: number; slope: number } {
  const at = o.type === 'roof-window' && roof ? roofAtPoint(roof, o.x, o.y) : null
  if (!roof || !at || at.faceIndex === undefined || at.slope < 1e-6) {
    return { x: o.x, y: o.y, yaw: o.yaw, width: o.width, height: o.height, slope: 0 }
  }
  return {
    x: o.x, y: o.y, yaw: defaultRoofYaw(roof, o.x, o.y), width: o.width,
    height: planLength(o.height, at.slope), slope: at.slope,
  }
}

/** Bottom-left corner (toward −fwd, −right) of the surface rectangle, to feed `OpeningRect.origin`. */
function surfaceOrigin(center: Vec2, yaw: number, width: number, height: number): Vec2 {
  const { fwd, right } = surfaceAxes(yaw)
  return [
    center[0] - (fwd[0] * height) / 2 - (right[0] * width) / 2,
    center[1] - (fwd[1] * height) / 2 - (right[1] * width) / 2,
  ]
}

function asSurfaceOpening(o: Opening): o is Opening & { x: number; y: number; yaw: number } {
  return isSurfaceOpening(o.type) && o.x !== undefined && o.y !== undefined && o.yaw !== undefined
}

/**
 * SURFACE opening rectangles of a level (floors + roofs of the rooms of this level), plus the
 * holes to pierce in the slabs. The roof holes are collected separately (`roofHolesOf`).
 */
export function computeSurfaceOpenings(
  level: Level, roomsOnLevel: readonly Room[], defaults: HouseDefaults, roof: RoofDescriptor | undefined,
): { openings: OpeningRect[]; floorHoles: Map<string, FloorHole[]> } {
  const openings: OpeningRect[] = []
  const floorHoles = new Map<string, FloorHole[]>()
  const slab = defaults.slabThickness

  for (const room of roomsOnLevel) {
    for (const o of room.openings) {
      if (!asSurfaceOpening(o)) continue
      const { right } = surfaceAxes(o.yaw)
      const origin2 = surfaceOrigin([o.x, o.y], o.yaw, o.width, o.height)
      const corners = surfaceCorners([o.x, o.y], o.yaw, o.width, o.height)

      if (o.type === 'skylight') {
        const hole: FloorHole = { openingId: o.id, polygon: corners }
        const list = floorHoles.get(room.id) ?? []
        list.push(hole)
        floorHoles.set(room.id, list)
        openings.push({
          openingId: o.id, roomId: room.id, levelId: level.id, type: o.type, host: 'floor',
          origin: [origin2[0], origin2[1], -slab],
          u: right, normal: [0, 0],
          width: o.width, height: o.height, depth: slab, leaves: openingLeaves(o),
          yaw: o.yaw, slope: 0,
          ...(o.material ? { material: o.material } : {}),
          ...(o.color ? { color: o.color } : {}),
        })
        continue
      }

      // roof-window
      if (!roof) continue
      const at = roofAtPoint(roof, o.x, o.y)
      if (!at) continue
      const depth = Math.max(0.05, roof.thickness || 0.2)
      const fp = surfaceFootprint(o, roof)
      const roofOrigin = surfaceOrigin([o.x, o.y], fp.yaw, o.width, fp.height)
      openings.push({
        openingId: o.id, roomId: room.id, levelId: level.id, type: o.type, host: 'roof',
        // z: at mid-thickness on the slope plane, so that the glass is IN the hole
        origin: [roofOrigin[0], roofOrigin[1], at.z - level.elevation - depth / 2],
        u: surfaceAxes(fp.yaw).right, normal: [0, 0],
        width: o.width, height: o.height, depth,
        leaves: openingLeaves(o),
        yaw: fp.yaw, slope: at.slope,
        ...(o.material ? { material: o.material } : {}),
        ...(o.color ? { color: o.color } : {}),
      })
    }
  }
  return { openings, floorHoles }
}

/** Roof holes for all the `roof-window`s of the house. */
export function roofHolesOf(house: House, roof: RoofDescriptor): RoofHole[] {
  const holes: RoofHole[] = []
  for (const room of house.rooms) {
    for (const o of room.openings) {
      if (o.type !== 'roof-window' || !asSurfaceOpening(o)) continue
      const at = roofAtPoint(roof, o.x, o.y)
      if (!at) continue
      const fp = surfaceFootprint(o, roof)
      const corners2 = surfaceCorners([o.x, o.y], fp.yaw, o.width, fp.height)
      const hole: RoofHole = {
        openingId: o.id, roomId: room.id, polygon: corners2,
        ...(at.faceIndex !== undefined ? { faceIndex: at.faceIndex } : {}),
      }
      if (at.faceIndex !== undefined && roof.faces[at.faceIndex]) {
        const face = roof.faces[at.faceIndex]!
        const a = face[0]!, b = face[1]!, c = face[2]!
        const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const nx = ab[1] * ac[2] - ab[2] * ac[1]
        const ny = ab[2] * ac[0] - ab[0] * ac[2]
        const nz = ab[0] * ac[1] - ab[1] * ac[0]
        const lift = (x: number, y: number): Vec3 => {
          if (Math.abs(nz) < 1e-9) return [x, y, at.z]
          return [x, y, a[2] - (nx * (x - a[0]) + ny * (y - a[1])) / nz]
        }
        hole.corners = [
          lift(corners2[0][0], corners2[0][1]),
          lift(corners2[1][0], corners2[1][1]),
          lift(corners2[2][0], corners2[2][1]),
          lift(corners2[3][0], corners2[3][1]),
        ]
      }
      holes.push(hole)
    }
  }
  return holes
}
