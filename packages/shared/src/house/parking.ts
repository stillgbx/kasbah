import type { DeviceKind } from '../devices/kinds'
import type { DeviceState } from '../devices/state'
import { pointInPolygon, type Vec2 } from './geometry/vec2'
import type { House, Parking, Room, Zone } from './schema'

// What a parking spot knows how to do: tell where its four corners are, at what distance
// a point falls, and — the most common case — which vehicle parks in it. The format of the field lives in
// `schema.ts` (`parkingSchema`), which says WHY it exists; here, it is the rule.
//
// None of this touches Three: the 3D scene applies what these functions decide, and the
// tests check the rule without mounting a scene.

/**
 * Distance (m) beyond the rectangle where a vehicle still snaps, when the spot says nothing about it.
 * Two meters: the order of magnitude of the bias that remains once a device's `gpsOffset` is set
 * (receiver against a wall, approximated house origin). Wider, two neighboring spots would
 * fight over the same car; narrower, a car parked in its spot would not fit in it.
 */
export const PARKING_SNAP_MARGIN = 2

/** Rounded to the centimeter: what these functions return goes into `house.json` (cf. `openings.ts`). */
const cm = (v: number) => Math.round(v * 100) / 100

/**
 * Reference frame of the spot: `fwd` toward the front, `right` toward its right. `yaw` follows the convention of the
 * devices (0 = facing +y, counterclockwise), so the front is `(-sin yaw, cos yaw)`.
 */
export function parkingAxes(p: Pick<Parking, 'yaw'>): { fwd: Vec2; right: Vec2 } {
  const a = (p.yaw * Math.PI) / 180
  const s = Math.sin(a), c = Math.cos(a)
  return { fwd: [-s, c], right: [c, s] }
}

/** The four corners, in the order front-right, front-left, rear-left, rear-right. */
export function parkingCorners(p: Parking): [Vec2, Vec2, Vec2, Vec2] {
  const { fwd, right } = parkingAxes(p)
  const [w, l] = p.size
  const at = (u: number, v: number): Vec2 => [
    p.center[0] + fwd[0] * u + right[0] * v,
    p.center[1] + fwd[1] * u + right[1] * v,
  ]
  return [at(l / 2, w / 2), at(l / 2, -w / 2), at(-l / 2, -w / 2), at(-l / 2, w / 2)]
}

/** A point in the reference frame of the spot: `[along (front +), across (right +)]`, in meters. */
export function toParkingFrame(p: Parking, xy: Vec2): Vec2 {
  const { fwd, right } = parkingAxes(p)
  const dx = xy[0] - p.center[0], dy = xy[1] - p.center[1]
  return [dx * fwd[0] + dy * fwd[1], dx * right[0] + dy * right[1]]
}

/** Distance (m) from a point to the rectangle of the spot — **0 if it is inside**. */
export function parkingDistance(p: Parking, xy: Vec2): number {
  const [u, v] = toParkingFrame(p, xy)
  const [w, l] = p.size
  return Math.hypot(Math.max(0, Math.abs(u) - l / 2), Math.max(0, Math.abs(v) - w / 2))
}

/**
 * Is this device entitled to this spot? The kind first (a car does not park on a
 * robot's base), then the reservation: a spot that names a device is only for it.
 */
export function parkingAccepts(p: Parking, kind: DeviceKind, deviceId?: string): boolean {
  if (p.accepts !== kind) return false
  return p.deviceId === undefined || p.deviceId === deviceId
}

/**
 * Is the vehicle PARKED, that is, truly motionless?
 *
 * The rule is "at rest unless proven otherwise", and it is a choice: the R5 publishes neither speed,
 * nor gear, nor sleep state (only the Tesla gives them). Requiring proof of the stop would amount
 * to never parking the car that needs it the most. So we snap by default, and let go
 * as soon as the vendor SAYS the vehicle is moving — a driving Tesla keeps following its GPS.
 */
export function atRest(state: DeviceState | undefined): boolean {
  if (!state) return true
  if (state.kind === 'mower') return state.activity === 'parked' || state.activity === 'charging'
  if (state.kind === 'vacuum') return state.activity === 'docked'
  if (state.kind === 'vehicle') return !(state.speedKmh !== undefined && state.speedKmh > 0) && state.gear !== 'D' && state.gear !== 'R'
  return true
}

/** A vehicle candidate for a spot: its key in the scene, what it is, and where its GPS puts it. */
export interface ParkingCandidate {
  key: string
  kind: DeviceKind
  deviceId?: string
  point: Vec2
  atRest: boolean
}

/** Where the spot parks the vehicle: its center, and its heading. */
export interface ParkingFix { parkingId: string; position: Vec2; yaw: number }

/**
 * Who parks where, for all the vehicles at once. The result is indexed by candidate `key`.
 *
 * A spot only receives ONE vehicle and a vehicle only takes ONE spot: without this, two cars
 * returned the same evening would overlap in the garage closest to the two readings. The closest
 * is served first — it is the only rule that does not depend on the order of the file.
 */
export function assignParkings(
  parkings: readonly Parking[], candidates: readonly ParkingCandidate[],
): Map<string, ParkingFix> {
  const pairs: { key: string; parking: Parking; d: number }[] = []
  for (const c of candidates) {
    if (!c.atRest) continue
    for (const p of parkings) {
      if (!parkingAccepts(p, c.kind, c.deviceId)) continue
      const d = parkingDistance(p, c.point)
      if (d <= (p.margin ?? PARKING_SNAP_MARGIN)) pairs.push({ key: c.key, parking: p, d })
    }
  }
  pairs.sort((a, b) => a.d - b.d)
  const out = new Map<string, ParkingFix>()
  const taken = new Set<string>()
  for (const { key, parking } of pairs) {
    if (out.has(key) || taken.has(parking.id)) continue
    out.set(key, { parkingId: parking.id, position: [...parking.center], yaw: parking.yaw })
    taken.add(parking.id)
  }
  return out
}

/** What CARRIES a spot: its room, the footprint of its level, otherwise the zone or the terrain. */
export interface ParkingHost { kind: 'room' | 'level' | 'zone' | 'terrain'; id: string; name: string; polygon: Vec2[] }

/**
 * The host of a spot, searched under its center. The rooms are tried from the LOWEST level to the
 * highest, as for a vehicle's heading (`HouseScene.vehicleYaw`): one parks on the ground
 * floor, not in the bedroom that overhangs it.
 *
 * It is what gives the four dimensions of the panel: a spot is measured with a tape measure from the
 * walls of the garage, not from the origin of a file.
 */
export function parkingHost(house: House, p: Parking): ParkingHost | null {
  const elevation = (levelId: string) => house.levels.find((l) => l.id === levelId)?.elevation ?? 0
  // The LEVEL of the spot drives the search: a spot placed on the first floor has nothing to measure
  // from the living room below it. Without a level, it is on the ground and the rooms are tried from the
  // lowest to the highest — which means a spot written before this field is measured as before.
  const rooms: Room[] = p.levelId
    ? house.rooms.filter((r) => r.levelId === p.levelId)
    : [...house.rooms].sort((a, b) => elevation(a.levelId) - elevation(b.levelId))
  const room = rooms.find((r) => pointInPolygon(p.center, r.polygon))
  if (room) return { kind: 'room', id: room.id, name: room.name, polygon: room.polygon }
  // A level without a room under the point — the roof that carries a drone pad — returns its FOOTPRINT
  // when declared; otherwise there is nothing to measure, and the panel says so.
  if (p.levelId) {
    const level = house.levels.find((l) => l.id === p.levelId)
    return level?.outline && pointInPolygon(p.center, level.outline)
      ? { kind: 'level', id: level.id, name: level.name, polygon: level.outline }
      : null
  }
  const zone: Zone | undefined = house.site.zones.find((z) => z.kind !== 'pool' && pointInPolygon(p.center, z.polygon))
  if (zone) return { kind: 'zone', id: zone.id, name: zone.name, polygon: zone.polygon }
  if (pointInPolygon(p.center, house.site.terrain)) return { kind: 'terrain', id: 'terrain', name: '', polygon: house.site.terrain }
  return null
}

/** The four sides of a spot, in the order the panel shows them. */
export const PARKING_SIDES = ['front', 'back', 'left', 'right'] as const
export type ParkingSide = (typeof PARKING_SIDES)[number]

/** Distance from the edge `side` to the outline of the host, `null` if the ray meets none. */
function gapTo(host: readonly Vec2[], from: Vec2, dir: Vec2): number | null {
  let best: number | null = null
  const n = host.length
  for (let i = 0; i < n; i++) {
    const a = host[i]!, b = host[(i + 1) % n]!
    const e: Vec2 = [b[0] - a[0], b[1] - a[1]]
    const den = dir[0] * e[1] - dir[1] * e[0]
    if (Math.abs(den) < 1e-9) continue
    const t = ((a[0] - from[0]) * e[1] - (a[1] - from[1]) * e[0]) / den      // along the ray
    const s = ((a[0] - from[0]) * dir[1] - (a[1] - from[1]) * dir[0]) / den  // along the edge
    if (t < -1e-9 || s < -1e-9 || s > 1 + 1e-9) continue
    if (best === null || t < best) best = t
  }
  return best
}

/**
 * The four dimensions of a spot in its host: what separates it from the outline in front, behind, on the
 * left and on the right. It is how a garage spot is placed — so far from the back wall, so far from the
 * side wall — and they are the four numbers the panel sets, like the two dimensions of an
 * opening (`openingGaps`).
 *
 * Each dimension starts from the MIDDLE of the edge concerned, straight ahead of it. A side that does not meet the
 * outline (spot straddling the edge of its host) is `null`: a measurement is not invented.
 *
 * **Left and right are told from the spot**, that is, sitting in the parked car: the
 * right of the spot is the driver's right.
 */
export function parkingGaps(host: readonly Vec2[], p: Parking): Record<ParkingSide, number | null> {
  const { fwd, right } = parkingAxes(p)
  const [w, l] = p.size
  const edge = (dir: Vec2, half: number): Vec2 => [p.center[0] + dir[0] * half, p.center[1] + dir[1] * half]
  const back: Vec2 = [-fwd[0], -fwd[1]], left: Vec2 = [-right[0], -right[1]]
  const one = (dir: Vec2, half: number) => {
    const d = gapTo(host, edge(dir, half), dir)
    return d === null ? null : cm(Math.max(0, d))
  }
  return { front: one(fwd, l / 2), back: one(back, l / 2), left: one(left, w / 2), right: one(right, w / 2) }
}

/**
 * Wanted dimension on one side → new center. The spot SLIDES by what is missing, along the axis of the
 * side entered: setting the front dimension moves the car back or forward, the left dimension shifts it sideways.
 *
 * The rectangle is not bounded here: a center that left the host shows immediately (the dimensions
 * turn to "—"), and bounding would amount to silently refusing a spot that one is in the middle of
 * moving from one wall to the other.
 */
export function fitParkingGap(host: readonly Vec2[], p: Parking, side: ParkingSide, wanted: number): Vec2 | null {
  const gaps = parkingGaps(host, p)
  const now = gaps[side]
  if (now === null) return null
  const { fwd, right } = parkingAxes(p)
  const axis: Vec2 = side === 'front' ? fwd : side === 'back' ? [-fwd[0], -fwd[1]] : side === 'right' ? right : [-right[0], -right[1]]
  const move = now - Math.max(0, wanted)
  return [cm(p.center[0] + axis[0] * move), cm(p.center[1] + axis[1] * move)]
}

/**
 * Dimensions of a spot that has just been placed, by kind of what parks in it. CATALOG values,
 * like those of an opening (`newOpeningDims`): a car spot is 2.50 m by 5 m, a mower
 * base fits in 60 cm. They do not have to be right, they have to be recognizable
 * in the scene — the four dimensions of the panel then correct them to the centimeter.
 */
export function newParkingSize(kind: DeviceKind): [number, number] {
  if (kind === 'vehicle') return [2.5, 5]
  if (kind === 'mower') return [0.6, 0.8]
  return [0.5, 0.5]
}

/** What is displayed to DESIGNATE a spot: its name if one was given to it, otherwise its id. */
export const parkingLabel = (p: Parking): string => p.name ?? p.id

/** Is a spot DRAWN on the ground (marking) rather than as an object (robot base)? */
export const isParkingBay = (p: Parking): boolean => p.accepts === 'vehicle'
