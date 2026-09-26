import type { HouseDefaults } from '../defaults'
import { surfaceAxes, surfaceCorners } from '../openings'
import type { House, Level, Opening, Room } from '../schema'
import { isSurfaceOpening, type OpeningType } from '../schema'
import { openingLeaves, planLength } from './walls'
import type { FloorHole, OpeningRect, RoofDescriptor, RoofHole, Vec3 } from './types'
import { pointInPolygon, type Vec2 } from './vec2'

/**
 * Hauteur absolue et pente du toit au point (x, y). `null` si hors emprise.
 * Toit plat : zBase, pente 0. Gable : plan de la face dont la projection contient le point.
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
    // plan ax + by + cz = d via trois points non colinéaires
    const a = face[0]!, b = face[1]!, c = face[2]!
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const nx = ab[1] * ac[2] - ab[2] * ac[1]
    const ny = ab[2] * ac[0] - ab[0] * ac[2]
    const nz = ab[0] * ac[1] - ab[1] * ac[0]
    if (Math.abs(nz) < 1e-9) continue
    const z = a[2] - (nx * (x - a[0]) + ny * (y - a[1])) / nz
    // pente = angle du plan avec l'horizontal
    const nLen = Math.hypot(nx, ny, nz) || 1
    const slope = Math.acos(Math.min(1, Math.abs(nz) / nLen)) * (180 / Math.PI)
    return { z, slope, faceIndex: i }
  }
  return { z: roof.zBase, slope: 0 }
}

/** Cap par défaut d'une fenêtre de toit au point donné : sens de la descente du versant. */
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
  // normale orientée vers le haut : elle PENCHE vers l'aval, sa projection horizontale est la descente
  // (jusqu'au 2026-09-26 on prenait l'opposé : un Velux posé au doigt regardait le faîtage)
  if (Math.abs(nx) + Math.abs(ny) < 1e-9) return 180
  const sign = nz >= 0 ? 1 : -1
  const dx = sign * nx, dy = sign * ny
  // yaw : 0 = +y → atan2(-dx, dy) en degrés
  const deg = (Math.atan2(-dx, dy) * 180) / Math.PI
  return Math.round(((deg % 360) + 360) % 360)
}

/**
 * Emprise VUE DU CIEL d'une ouverture de surface. Un Velux posé sur un VERSANT suit la pente, comme
 * une vraie pose : son cap est celui de la descente (`defaultRoofYaw` — le `yaw` écrit est ignoré, et
 * il se retourne seul d'un versant à l'autre) et sa longueur, mesurée le long de la pente, se
 * raccourcit de cos(pente). Puits de lumière, toit plat, hors toit : l'ouverture telle qu'écrite.
 * Tout ce qui raisonne en plan (trou, cotes, place dans la pièce, chevauchement, pose) passe par elle.
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

/** Coin bas-gauche (vers −fwd, −right) du rectangle de surface, pour alimenter `OpeningRect.origin`. */
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
 * Rectangles d'ouverture de SURFACE d'un niveau (sols + toits des pièces de ce niveau), plus les
 * trous à percer dans les dalles. Les trous de toit sont collectés à part (`roofHolesOf`).
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
        // z : à mi-épaisseur sur le plan du versant, pour que le verre soit DANS le trou
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

/** Trous de toit pour toutes les `roof-window` de la maison. */
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
