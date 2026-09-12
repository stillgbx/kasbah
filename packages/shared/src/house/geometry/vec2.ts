// Utilitaires 2D purs sur des tuples [x, y] (mètres, repère maison : x est, y nord).

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

/** Normale à droite du sens de parcours : pour un polygone CCW, c'est l'EXTÉRIEUR. */
export const perpRight = (d: Vec2): Vec2 => [d[1], -d[0]]
export const perpLeft = (d: Vec2): Vec2 => [-d[1], d[0]]

/** Intersection des droites (p + s·d) et (q + t·e) ; null si parallèles. */
export function lineIntersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = cross(d, e)
  if (Math.abs(den) < 1e-9) return null
  const s = cross(sub(q, p), e) / den
  return add(p, scale(d, s))
}

/** Aire signée (shoelace) : > 0 pour un polygone CCW. */
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

/** Test point-dans-polygone (ray casting, frontière incluse de façon tolérante). */
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

/** Convexité d'un polygone : tous les tournants dans le même sens (colinéaires ignorés). */
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
 * Intersection de `subject` avec le CONVEXE `clip` (Sutherland–Hodgman : on coupe le sujet
 * par le demi-plan intérieur de chaque arête du clip). Renvoie [] si les deux sont disjoints.
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

/** Centroïde surfacique (repli sur la moyenne des sommets pour une aire nulle). */
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

/** Abscisse curviligne (m) de la projection de p sur la droite (a → b). */
export function projectOntoSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = normalize(sub(b, a))
  return dot(sub(p, a), d)
}

/**
 * Décale un polygone CCW vers l'extérieur de `dist` (coins mitrés, repli en bout droit
 * quand deux arêtes sont colinéaires). Sert au débord de toit.
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
