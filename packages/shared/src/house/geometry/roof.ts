import type { HouseDefaults } from '../defaults'
import type { House, Level, Roof, Room } from '../schema'
import type { RoofDescriptor, Vec3 } from './types'
import { bbox, centroid, clipConvex, offsetPolygon, pointInPolygon, signedArea, type Vec2 } from './vec2'
import { isWalled, wallHeight } from './walls'

const FLAT_THICKNESS = 0.2
const EPS = 1e-6
/** Beyond a side of the footprint, the strip where a walled room makes it a party wall (as `classifySegments`). */
const ABUT_MARGIN = 0.05
/** Area (m²) a room must have in that strip: a corner that only touches it does not count. */
const ABUT_AREA = 1e-4

/** Highest level (the order of the array is not semantic). */
export function topLevel(levels: readonly Level[]): Level {
  return levels.reduce((best, l) => (l.elevation > best.elevation ? l : best), levels[0]!)
}

/** Default footprint of a level: bbox of the walled rooms enlarged by the exterior thickness. */
export function defaultOutline(level: Level, rooms: readonly Room[], defaults: HouseDefaults): Vec2[] | null {
  const pts = rooms.filter((r) => r.levelId === level.id && isWalled(r)).flatMap((r) => r.polygon)
  if (pts.length === 0) return null
  const { min, max } = bbox(pts)
  const t = defaults.exteriorWallThickness
  return [[min[0] - t, min[1] - t], [max[0] + t, min[1] - t], [max[0] + t, max[1] + t], [min[0] - t, max[1] + t]]
}

/** The roofs of the house: `roofs`, or the former single `roof`. */
export function roofsOf(house: Pick<House, 'roofs' | 'roof'>): Roof[] {
  return house.roofs.length > 0 ? house.roofs : house.roof ? [house.roof] : []
}

/** Level that carries a roof: the written one, else that of its rooms, else the highest. */
export function roofLevel(house: House, roof: Roof): Level | undefined {
  if (roof.levelId) return house.levels.find((l) => l.id === roof.levelId)
  const first = roof.rooms?.[0] && house.rooms.find((r) => r.id === roof.rooms![0])
  if (first) return house.levels.find((l) => l.id === first.levelId)
  return topLevel(house.levels)
}

/** The highest roof: the one the roof level of the scene shows. */
export function mainRoof(roofs: readonly RoofDescriptor[]): RoofDescriptor | undefined {
  return roofs.reduce<RoofDescriptor | undefined>((best, r) => (!best || r.zBase > best.zBase ? r : best), undefined)
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

/**
 * Footprint of a roof that names its rooms: their rectangle, which on each side gets the exterior
 * wall and the overhang — unless a walled room outside the roof, whose walls rise at least as high,
 * abuts that side. There, the wall is a party wall that rises with the higher volume, and the roof
 * stops at its own face of it. Over a LOWER neighbour, the roof keeps its overhang.
 */
function roomsFootprint(
  covered: readonly Room[], onLevel: readonly Room[], defaults: HouseDefaults, overhang: number,
  eaves: number, heightOf: (room: Room) => number,
): Vec2[] {
  const { min, max } = bbox(covered.flatMap((r) => r.polygon))
  const ids = new Set(covered.map((r) => r.id))
  const others = onLevel.filter((r) => !ids.has(r.id) && isWalled(r) && heightOf(r) >= eaves - EPS)
  const d = 2 * defaults.interiorWallThickness + ABUT_MARGIN
  const m = ABUT_MARGIN
  const strips = [
    rect(min[0] + m, min[1] - d, max[0] - m, min[1]),   // south
    rect(max[0], min[1] + m, max[0] + d, max[1] - m),   // east
    rect(min[0] + m, max[1], max[0] - m, max[1] + d),   // north
    rect(min[0] - d, min[1] + m, min[0], max[1] - m),   // west
  ]
  const abuts = strips.map((s) => others.some((r) => Math.abs(signedArea(clipConvex(r.polygon, s))) > ABUT_AREA))
  const t = defaults.exteriorWallThickness
  const [south, east, north, west] = abuts.map((a) => (a ? 0 : t + overhang))
  return rect(min[0] - west!, min[1] - south!, max[0] + east!, max[1] + north!)
}

/** Slope planes of a pitched roof, on the rectangle that encloses `outline`. */
function pitchedFaces(roof: Roof, outline: readonly Vec2[], zBase: number): { faces: Vec3[][]; zRidge: number } {
  const { min, max } = bbox(outline)
  const sx = max[0] - min[0], sy = max[1] - min[1]
  const tan = Math.tan((roof.pitch * Math.PI) / 180)
  const c00: Vec2 = [min[0], min[1]], c10: Vec2 = [max[0], min[1]], c11: Vec2 = [max[0], max[1]], c01: Vec2 = [min[0], max[1]]
  const at = (p: Vec2, z: number): Vec3 => [p[0], p[1], z]

  if (roof.type === 'shed') {
    // yaw 0 descends toward +y, 90 toward −x, 180 toward −y, 270 toward +x
    const yaw = ((roof.yaw % 360) + 360) % 360
    const rise = (p: Vec2) => (yaw === 0 ? max[1] - p[1] : yaw === 90 ? p[0] - min[0] : yaw === 180 ? p[1] - min[1] : max[0] - p[0]) * tan
    const corners = [c00, c10, c11, c01]
    const faces: Vec3[][] = [corners.map((p) => at(p, zBase + rise(p)))]
    // under each slope edge that leaves the eaves: a vertical gable (triangle) or the high wall (quad)
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!, b = corners[(i + 1) % 4]!
      const ra = rise(a), rb = rise(b)
      if (ra < EPS && rb < EPS) continue
      const face: Vec3[] = [at(a, zBase), at(b, zBase)]
      if (rb > EPS) face.push(at(b, zBase + rb))
      if (ra > EPS) face.push(at(a, zBase + ra))
      faces.push(face)
    }
    return { faces, zRidge: zBase + (yaw % 180 === 0 ? sy : sx) * tan }
  }

  if (roof.type === 'hip') {
    // four slopes of the same pitch: the ridge runs along the longest side, a point on a square
    const alongX = sx >= sy
    const hs = (alongX ? sy : sx) / 2
    const zRidge = zBase + hs * tan
    const mid = alongX ? (min[1] + max[1]) / 2 : (min[0] + max[0]) / 2
    const r0: Vec3 = alongX ? [min[0] + hs, mid, zRidge] : [mid, min[1] + hs, zRidge]
    const r1: Vec3 = alongX ? [max[0] - hs, mid, zRidge] : [mid, max[1] - hs, zRidge]
    const b = (p: Vec2) => at(p, zBase)
    if ((alongX ? sx : sy) - 2 * hs < EPS) {
      const apex: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, zRidge]
      return { faces: [[b(c00), b(c10), apex], [b(c10), b(c11), apex], [b(c11), b(c01), apex], [b(c01), b(c00), apex]], zRidge }
    }
    const faces: Vec3[][] = alongX
      ? [[b(c00), b(c10), r1, r0], [b(c10), b(c11), r1], [b(c11), b(c01), r0, r1], [b(c01), b(c00), r0]]   // S, E, N, W
      : [[b(c10), b(c11), r1, r0], [b(c11), b(c01), r1], [b(c01), b(c00), r0, r1], [b(c00), b(c10), r0]]   // E, N, W, S
    return { faces, zRidge }
  }

  const axis = roof.ridgeAxis ?? (sx >= sy ? 'x' : 'y')
  const halfSpan = (axis === 'x' ? sy : sx) / 2
  const zRidge = zBase + halfSpan * tan
  const faces: Vec3[][] = []
  if (axis === 'x') {
    const my = (min[1] + max[1]) / 2
    faces.push(
      [[min[0], min[1], zBase], [max[0], min[1], zBase], [max[0], my, zRidge], [min[0], my, zRidge]],   // south slope
      [[max[0], max[1], zBase], [min[0], max[1], zBase], [min[0], my, zRidge], [max[0], my, zRidge]],   // north slope
      [[min[0], max[1], zBase], [min[0], min[1], zBase], [min[0], my, zRidge]],                          // west gable
      [[max[0], min[1], zBase], [max[0], max[1], zBase], [max[0], my, zRidge]],                          // east gable
    )
  } else {
    const mx = (min[0] + max[0]) / 2
    faces.push(
      [[max[0], min[1], zBase], [max[0], max[1], zBase], [mx, max[1], zRidge], [mx, min[1], zRidge]],   // east slope
      [[min[0], max[1], zBase], [min[0], min[1], zBase], [mx, min[1], zRidge], [mx, max[1], zRidge]],   // west slope
      [[min[0], min[1], zBase], [max[0], min[1], zBase], [mx, min[1], zRidge]],                          // south gable
      [[max[0], max[1], zBase], [min[0], max[1], zBase], [mx, max[1], zRidge]],                          // north gable
    )
  }
  return { faces, zRidge }
}

/**
 * Walled rooms under a roof: those it names, else those whose centre falls in its footprint
 * (written, of the level, or the rectangle of the level). `base` = that footprint, without overhang.
 */
function coverOf(
  house: House, roof: Roof, defaults: HouseDefaults,
): { level: Level; onLevel: Room[]; covered: Room[]; base?: Vec2[] } | undefined {
  const level = roofLevel(house, roof)
  if (!level) return undefined
  const onLevel = house.rooms.filter((r) => r.levelId === level.id)
  if (!roof.outline && roof.rooms) {
    const covered = onLevel.filter((r) => roof.rooms!.includes(r.id) && isWalled(r))
    return covered.length > 0 ? { level, onLevel, covered } : undefined
  }
  const base = roof.outline ?? level.outline ?? defaultOutline(level, house.rooms, defaults)
  if (!base) return undefined
  return { level, onLevel, covered: onLevel.filter((r) => isWalled(r) && pointInPolygon(centroid(r.polygon), base)), base }
}

/** Per room, the eaves height written by the roof that covers it (level-local). */
function eavesByRoom(house: House, defaults: HouseDefaults): Map<string, number> {
  const out = new Map<string, number>()
  for (const roof of roofsOf(house)) {
    if (roof.eaves === undefined) continue
    for (const r of coverOf(house, roof, defaults)?.covered ?? []) out.set(r.id, roof.eaves)
  }
  return out
}

/** `eaves`: the heights written by all the roofs (`eavesByRoom`), to know which neighbour rises higher. */
export function computeRoof(
  house: House, roof: Roof, defaults: HouseDefaults, eaves: ReadonlyMap<string, number> = new Map(),
): RoofDescriptor | undefined {
  const cover = coverOf(house, roof, defaults)
  if (!cover) return undefined
  const { level, onLevel, covered, base } = cover
  const height = roof.eaves ?? level.height ?? defaults.levelHeight
  const heightOf = (r: Room) => eaves.get(r.id) ?? wallHeight(r, level, defaults)
  const outline = base
    ? (roof.overhang > 0 ? offsetPolygon(base, roof.overhang) : [...base])
    : roomsFootprint(covered, onLevel, defaults, roof.overhang, height, heightOf)
  const zBase = level.elevation + height
  const common = {
    ...(roof.id ? { id: roof.id } : {}),
    levelId: level.id,
    rooms: covered.map((r) => r.id),
    ...(roof.eaves !== undefined ? { eaves: roof.eaves } : {}),
    outline, zBase,
  }
  if (roof.type === 'flat') {
    return { ...common, type: 'flat', zRidge: zBase + FLAT_THICKNESS, thickness: FLAT_THICKNESS, faces: [] }
  }
  const { faces, zRidge } = pitchedFaces(roof, outline, zBase)
  return { ...common, type: roof.type, zRidge, thickness: 0, faces }
}

/** The roofs of the house that can be computed, in the order of the file. */
export function computeRoofs(house: House, defaults: HouseDefaults): RoofDescriptor[] {
  const eaves = eavesByRoom(house, defaults)
  return roofsOf(house).flatMap((r) => computeRoof(house, r, defaults, eaves) ?? [])
}
