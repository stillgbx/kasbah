// Pure 2D utilities on [x, y] tuples (meters, house reference frame: x east, y north).

export type Vec2 = [number, number]

export const EPS = 1e-9

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1]
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0]
export const length = (a: Vec2): number => Math.hypot(a[0], a[1])
export const dist = (a: Vec2, b: Vec2): number => length(sub(a, b))
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

export function normalize(a: Vec2): Vec2 {
  const l = length(a)
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l]
}

/** Right-hand normal of the direction of travel: for a CCW polygon, it is the OUTSIDE. */
export const perpRight = (d: Vec2): Vec2 => [d[1], -d[0]]
export const perpLeft = (d: Vec2): Vec2 => [-d[1], d[0]]

/** Intersection of the lines (p + s·d) and (q + t·e); null if parallel. */
export function lineIntersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = cross(d, e)
  if (Math.abs(den) < 1e-9) return null
  const s = cross(sub(q, p), e) / den
  return add(p, scale(d, s))
}

/** Signed area (shoelace): > 0 for a CCW polygon. */
export function signedArea(poly: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

export const isCCW = (poly: readonly Vec2[]) => signedArea(poly) > 0

export function ensureCCW(poly: readonly Vec2[]): Vec2[] {
  return isCCW(poly) ? [...poly] : [...poly].reverse()
}

/** Point-in-polygon test (ray casting, boundary included tolerantly). */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!
    const intersect = (a[1] > p[1]) !== (b[1] > p[1])
      && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] + (b[1] === a[1] ? 1e-12 : 0)) + a[0]
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * SIMPLE polygon: at least three distinct vertices, no zero-length side, and two non-neighboring sides do not
 * touch each other (a figure-eight outline, or one that doubles back on itself, has no clear interior).
 */
export function isSimplePolygon(poly: readonly Vec2[]): boolean {
  const n = poly.length
  if (n < 3 || Math.abs(signedArea(poly)) < EPS) return false
  for (let i = 0; i < n; i++) if (dist(poly[i]!, poly[(i + 1) % n]!) < EPS) return false
  const side = (a: Vec2, b: Vec2, c: Vec2) => cross(sub(b, a), sub(c, a))
  const onSeg = (a: Vec2, b: Vec2, p: Vec2) =>
    Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS
    && Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS
  const touch = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
    const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d)
    if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true
    return (Math.abs(d1) <= EPS && onSeg(c, d, a)) || (Math.abs(d2) <= EPS && onSeg(c, d, b))
      || (Math.abs(d3) <= EPS && onSeg(a, b, c)) || (Math.abs(d4) <= EPS && onSeg(a, b, d))
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue                  // neighbors through the closing edge
      if (touch(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return false
    }
  }
  return true
}

/** Convexity of a polygon: all the turns in the same direction (collinear ones ignored). */
export function isConvex(poly: readonly Vec2[]): boolean {
  let sign = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!, c = poly[(i + 2) % n]!
    const z = cross(sub(b, a), sub(c, b))
    if (Math.abs(z) < EPS) continue
    if (sign === 0) sign = Math.sign(z)
    else if (Math.sign(z) !== sign) return false
  }
  return true
}

/**
 * Intersection of `subject` with the CONVEX `clip` (Sutherland–Hodgman: the subject is cut
 * by the inner half-plane of each edge of the clip). Returns [] if the two are disjoint.
 */
export function clipConvex(subject: readonly Vec2[], clip: readonly Vec2[]): Vec2[] {
  let out: Vec2[] = ensureCCW(subject)
  const c = ensureCCW(clip)
  for (let i = 0; i < c.length && out.length > 0; i++) {
    const a = c[i]!, b = c[(i + 1) % c.length]!
    const side = (q: Vec2) => cross(sub(b, a), sub(q, a))
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!, prev = input[(j - 1 + input.length) % input.length]!
      const sc = side(cur), sp = side(prev)
      if ((sc >= 0) !== (sp >= 0)) out.push(lerp(prev, cur, sp / (sp - sc)))
      if (sc >= 0) out.push(cur)
    }
  }
  return out
}

export interface BBox2 { min: Vec2; max: Vec2 }

export function bbox(points: readonly Vec2[]): BBox2 {
  const min: Vec2 = [Infinity, Infinity], max: Vec2 = [-Infinity, -Infinity]
  for (const [x, y] of points) {
    if (x < min[0]) min[0] = x
    if (y < min[1]) min[1] = y
    if (x > max[0]) max[0] = x
    if (y > max[1]) max[1] = y
  }
  return { min, max }
}

/** Area centroid (falls back on the mean of the vertices for a zero area). */
export function centroid(poly: readonly Vec2[]): Vec2 {
  const a = signedArea(poly)
  if (Math.abs(a) < EPS) {
    const s = poly.reduce<Vec2>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0])
    return [s[0] / poly.length, s[1] / poly.length]
  }
  let cx = 0, cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!
    const f = p[0] * q[1] - q[0] * p[1]
    cx += (p[0] + q[0]) * f
    cy += (p[1] + q[1]) * f
  }
  return [cx / (6 * a), cy / (6 * a)]
}

/** Curvilinear abscissa (m) of the projection of p on the line (a → b). */
export function projectOntoSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = normalize(sub(b, a))
  return dot(sub(p, a), d)
}

/**
 * Offsets a CCW polygon outward by `dist` (mitered corners, falls back to a straight end
 * when two edges are collinear). Used for the roof overhang.
 */
export function offsetPolygon(poly: readonly Vec2[], distance: number): Vec2[] {
  const p = ensureCCW(poly)
  const n = p.length
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = p[(i - 1 + n) % n]!, cur = p[i]!, next = p[(i + 1) % n]!
    const dA = normalize(sub(cur, prev)), dB = normalize(sub(next, cur))
    const oA = add(prev, scale(perpRight(dA), distance))
    const oB = add(cur, scale(perpRight(dB), distance))
    const x = lineIntersect(oA, dA, oB, dB)
    out.push(x && dist(x, cur) < 4 * distance + 1e-6 ? x : oB)
  }
  return out
}

/**
 * Orientation of the longest edge of a polygon, in degrees in the `yaw` convention of the
 * devices (0 = facing +y, counterclockwise). `null` if the polygon is degenerate.
 *
 * It is the axis of a room: in a rectangular garage, the long edge is the direction in which
 * a car parks in it. Used to orient what the vendor cannot orient.
 */
export function longestEdgeYawDeg(poly: readonly Vec2[]): number | null {
  let best: Vec2 | null = null
  let bestLen = EPS
  for (let i = 0; i < poly.length; i++) {
    const d = sub(poly[(i + 1) % poly.length]!, poly[i]!)
    const l = length(d)
    if (l > bestLen) { bestLen = l; best = d }
  }
  // +y rotated by `yaw` gives (-sin yaw, cos yaw): aligning it on the edge is atan2(-dx, dy)
  return best ? (Math.atan2(-best[0], best[1]) * 180) / Math.PI : null
}
