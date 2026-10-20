import { DataTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

// PROCEDURAL materials of the surfaces, computed here rather than loaded: the app runs on the LAN without a
// CDN, and no image has to be hosted or committed to the repo (the user's ruling:
// "we go as far as we can in procedural, if it is still not satisfying then
// we'll add assets").
//
// A material is a ROLE (`SurfaceRole`): wood, tiling, gravel. It is the render STYLES
// (`three/styles/`) that say which role dresses which surface and with which PBR settings
// — the same `wood` serves as realistic parquet and as pastel flooring, only the color and the roughness
// change. Adding a material = adding an entry to `SPECS`, nothing else.
//
// Each role produces THREE maps, because a single one is not enough to make a surface exist:
//  - `map`, the color (luminance × hue), which the material multiplies by its style color;
//  - `normalMap`, the slope of the material, derived from the same relief: it is what catches the
//    grazing light, where the old `bumpMap` only gave an approximate shimmer;
//  - `ormMap`, a packed map (R unused occlusion = 1, G roughness, B metalness) read by
//    `roughnessMap` and `metalnessMap` from the SAME Texture object — three reads the channel it needs.
//    The material multiplies: the style's `roughness` = the roughness where the map is 1.
//
// The builders' UVs are in METERS (the caps of `ExtrudeGeometry` and `ShapeGeometry` take the
// positions), so `repeat = 1 / tileM` lays a pattern at world scale, seamless (periodic value
// noise, deterministic hashing: the texture is the same at every launch and in tests).

/** An available material. The styles draw on them; adding an entry here is enough to offer one more. */
export type SurfaceRole =
  | 'plaster' | 'wood' | 'tile' | 'poolTile' | 'carpet' | 'concrete'
  | 'grass' | 'water' | 'pavers' | 'soil' | 'roof'
  | 'metal' | 'grid' | 'gloss' | 'stone' | 'gravel' | 'siding'

export interface SurfaceTexture {
  /** Color (sRGB): luminance and hue of the material, to be multiplied by the style color. */
  map: Texture
  /** Slope of the material (tangent space, linear). */
  normalMap: Texture
  /** Normal scale, in three units (x, y). */
  normalScale: number
  /** Roughness in the G channel, multiplier of the style's. */
  roughnessMap: Texture
  /** Metalness in the B channel; `null` = uniform, the style's (a photo has none). */
  metalnessMap: Texture | null
  /** Side (m) of the pattern before repeating. */
  tileM: number
  /** The map carries ITS OWN color (a photo): the material does not tint it with the style's palette. */
  colored?: boolean
}

// Rule held by every pattern: the luminance stays BELOW 1. A material that saturates clips its
// variations and renders a flat area of the style color — exactly what the texture is meant to avoid.
interface Spec {
  /** Side (px) of the maps. */
  size: number
  /** Side (m) of the pattern before repeating. */
  tileM: number
  /** Amplitude (m) of the relief: it is this, relative to `tileM`, that gives the slope of the normals. */
  relief: number
  /** Luminance in [0, 1] of the point (u, v) ∈ [0, 1[². */
  shade(u: number, v: number): number
  /** Relief in [0, 1]. Defaults to the luminance: a light material stands out. */
  height?(u: number, v: number): number
  /** Roughness in [0, 1], MULTIPLIER of the style's. Defaults to 1 (uniform). */
  rough?(u: number, v: number): number
  /** Metalness in [0, 1], multiplier of the style's. Defaults to 1. */
  metal?(u: number, v: number): number
  /** Hue: RGB multipliers around 1 (a material that is not gray under its color). */
  tint?(u: number, v: number): readonly [number, number, number]
}

// ---- noise --------------------------------------------------------------------------------------

/** Deterministic hash → [0, 1[: the texture is the same at every launch and in the tests. */
function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Smoothed value noise, periodic over `period` cells (so the texture repeats seamlessly). */
function noise(u: number, v: number, period: number, seed = 0): number {
  const x = u * period, y = v * period
  const x0 = Math.floor(x), y0 = Math.floor(y)
  const fx = smooth(x - x0), fy = smooth(y - y0)
  const c = (i: number, j: number) => hash(((x0 + i) % period + period) % period, ((y0 + j) % period + period) % period, seed)
  const a = c(0, 0) + (c(1, 0) - c(0, 0)) * fx
  const b = c(0, 1) + (c(1, 1) - c(0, 1)) * fx
  return a + (b - a) * fy
}

/** Several octaves, period doubled each time; result centered on 0.5. */
function fbm(u: number, v: number, period: number, octaves: number, seed = 0): number {
  let sum = 0, amp = 0.5, total = 0, p = period
  for (let i = 0; i < octaves; i++) { sum += noise(u, v, p, seed + i) * amp; total += amp; amp *= 0.5; p *= 2 }
  return sum / total
}

/**
 * Distance to the nearest joint of an `n × n` grid of cells, as a fraction of a cell, and the index of
 * the cell. A SOFT joint (and not a binary threshold) is what tells a tiling from a checkerboard:
 * the chamfer of the edge catches the light.
 */
function cell(u: number, v: number, n: number): { ix: number; iy: number; edge: number } {
  const cx = u * n, cy = v * n
  const ix = Math.floor(cx), iy = Math.floor(cy)
  const dx = Math.abs(cx - ix - 0.5), dy = Math.abs(cy - iy - 0.5)
  return { ix, iy, edge: Math.max(dx, dy) * 2 }         // 0 at the center, 1 on the joint
}

/** Staggered bond (every other course slides by half a block), like a stone wall. */
function brick(u: number, v: number, rows: number, cols: number, seed: number): { ix: number; iy: number; edge: number } {
  const iy = Math.floor(v * rows)
  const uu = (u + hash(0, iy, seed) * 0.5) % 1
  const ix = Math.floor(uu * cols)
  const dx = Math.abs(uu * cols - ix - 0.5) * 2
  const dy = Math.abs(v * rows - iy - 0.5) * 2
  return { ix, iy, edge: Math.max(dx, dy) }
}

/** Joint hollow: 0 far from the edge, 1 in the joint, with a chamfer of `w` (fraction of a cell). */
const grout = (edge: number, w: number) => clamp01((edge - (1 - w)) / w)

// ---- material catalog ---------------------------------------------------------------------------

const SPECS: Record<SurfaceRole, Spec> = {
  // fine plaster: barely grainy, it is the relief that makes it exist
  plaster: {
    size: 256, tileM: 2, relief: 0.0015,
    shade: (u, v) => 0.92 + 0.08 * fbm(u, v, 16, 3, 1),
    height: (u, v) => 0.4 * fbm(u, v, 48, 3, 1) + 0.6 * fbm(u, v, 12, 2, 21),
    rough: (u, v) => 0.92 + 0.08 * fbm(u, v, 12, 2, 22),
  },
  // 12 cm by 1.2 m boards, offset by half a board per row, grained lengthwise
  wood: {
    size: 512, tileM: 2.4, relief: 0.004,
    shade: (u, v) => {
      const row = Math.floor(v * 20)                       // 20 boards of 12 cm over 2.4 m
      const uu = (u + (row % 2) * 0.25) % 1
      const plank = Math.floor(uu * 2)                     // 2 boards of 1.2 m lengthwise
      const tone = 0.76 + 0.22 * hash(plank, row, 7)       // each board has its own tone
      const grain = 0.9 + 0.2 * fbm(u * 6, v * 0.5 + hash(plank, row, 9), 24, 3, 2)
      const gapV = Math.abs(v * 20 - row - 0.5) > 0.47 ? 0.6 : 1   // joint between boards
      const gapU = Math.abs(uu * 2 - plank - 0.5) > 0.49 ? 0.6 : 1
      return Math.min(1, tone * grain) * gapV * gapU
    },
    // the GRAIN is recessed, the joint between boards frankly so: two scales of relief
    height: (u, v) => {
      const row = Math.floor(v * 20)
      const uu = (u + (row % 2) * 0.25) % 1
      const joint = Math.abs(v * 20 - row - 0.5) > 0.45 || Math.abs(uu * 2 - Math.floor(uu * 2) - 0.5) > 0.47
      return joint ? 0 : 0.6 + 0.4 * fbm(u * 6, v * 0.5, 24, 3, 2)
    },
    // the varnish follows the board: each plank wears a little differently
    rough: (u, v) => 0.78 + 0.22 * hash(Math.floor((u + (Math.floor(v * 20) % 2) * 0.25) % 1 * 2), Math.floor(v * 20), 31),
    tint: (u, v) => { const w = 0.06 * (fbm(u * 6, v * 0.5, 24, 2, 33) - 0.5); return [1 + w, 1, 1 - w] as const },
  },
  // clapboard siding: 12 horizontal 20 cm boards, each over the whole length of the pattern — the wall
  // of a chalet. The parquet (`wood`), with short staggered boards, read as brick on a
  // facade. A board is thicker at the bottom, where it overlaps the one below: the shadow of the lap.
  siding: {
    size: 512, tileM: 2.4, relief: 0.006,
    shade: (u, v) => {
      const row = Math.floor(v * 12)
      const f = v * 12 - row                               // 0 = bottom of the board, 1 = top
      const tone = 0.8 + 0.14 * hash(0, row, 41)
      // grain STRETCHED along the board (4 cells over its length, 6 over its height): fine
      // lengthwise, it chopped each board into small blocks — brick
      const grain = 0.9 + 0.2 * fbm(u, v * 18 + hash(1, row, 43), 4, 3, 44)
      return Math.min(1, tone * grain) * (f < 0.07 ? 0.55 : 1)
    },
    height: (u, v) => {
      const f = v * 12 - Math.floor(v * 12)
      return f < 0.07 ? 0 : 1 - 0.6 * f
    },
    rough: (_u, v) => 0.8 + 0.2 * hash(0, Math.floor(v * 12), 45),
    tint: (u, v) => { const w = 0.06 * (fbm(u, v * 18, 4, 2, 46) - 0.5); return [1 + w, 1, 1 - w] as const },
  },
  // 60 cm tiles, 6 mm joint, light cloudiness per tile — house floor
  tile: {
    size: 512, tileM: 2.4, relief: 0.003,
    shade: (u, v) => {
      const { ix, iy, edge } = cell(u, v, 4)
      const g = grout(edge, 0.02)
      const face = 0.86 + 0.1 * hash(ix, iy, 3) + 0.08 * (fbm(u, v, 8, 2, 4) - 0.5)
      return face * (1 - 0.42 * g)
    },
    height: (u, v) => 1 - grout(cell(u, v, 4).edge, 0.035),
    // the earthenware is smooth, the joint is matte: that contrast is what makes a tiling read
    rough: (u, v) => 0.35 + 0.65 * grout(cell(u, v, 4).edge, 0.04),
  },
  // fine earthenware of the pool basin (tighter than the floor) — the procedural holds until the Tiles133A photo
  poolTile: {
    size: 512, tileM: 1.2, relief: 0.002,
    shade: (u, v) => {
      const { ix, iy, edge } = cell(u, v, 4)
      const g = grout(edge, 0.025)
      const face = 0.9 + 0.06 * hash(ix, iy, 5) + 0.05 * (fbm(u, v, 10, 2, 7) - 0.5)
      return face * (1 - 0.35 * g)
    },
    height: (u, v) => 1 - grout(cell(u, v, 4).edge, 0.04),
    rough: (u, v) => 0.3 + 0.7 * grout(cell(u, v, 4).edge, 0.045),
  },
  // carpet: tight, uniform grain
  carpet: {
    size: 256, tileM: 1, relief: 0.003,
    shade: (u, v) => 0.8 + 0.2 * fbm(u, v, 64, 2, 5),
    rough: () => 1,
  },
  // concrete: wide clouds and fine pits
  concrete: {
    size: 256, tileM: 2, relief: 0.002,
    shade: (u, v) => 0.82 + 0.18 * fbm(u, v, 6, 4, 6) - (hash(Math.floor(u * 256), Math.floor(v * 256), 8) > 0.985 ? 0.15 : 0),
    height: (u, v) => 0.5 * fbm(u, v, 40, 3, 6) + 0.5 * fbm(u, v, 6, 3, 61),
    rough: (u, v) => 0.85 + 0.15 * fbm(u, v, 8, 2, 62),
  },
  // lawn: two scales, the tuft and the patch
  grass: {
    size: 256, tileM: 3, relief: 0.012,
    shade: (u, v) => 0.7 + 0.25 * fbm(u, v, 48, 3, 10) * (0.8 + 0.4 * fbm(u, v, 4, 2, 11)),
    rough: () => 1,
    // grass is not a single green: the hollows lean yellow, the tufts blue
    tint: (u, v) => { const w = 0.1 * (fbm(u, v, 12, 2, 12) - 0.5); return [1 + w, 1, 1 - 1.4 * w] as const },
  },
  // water: a light network of "caustics" — the ridges of a folded noise
  water: {
    size: 256, tileM: 4, relief: 0.01,
    shade: (u, v) => { const n = fbm(u, v, 6, 3, 12); return 0.8 + 0.2 * Math.pow(1 - Math.abs(n * 2 - 1), 4) },
    height: (u, v) => 0.5 + 0.5 * (fbm(u, v, 8, 3, 13) - 0.5),
    rough: () => 0.25,
  },
  // 40 cm slabs laid straight, marked joint
  pavers: {
    size: 512, tileM: 2, relief: 0.005,
    shade: (u, v) => {
      const { ix, iy, edge } = cell(u, v, 5)
      const face = 0.78 + 0.16 * hash(ix, iy, 13) + 0.12 * (fbm(u, v, 20, 2, 14) - 0.5)
      return face * (1 - 0.4 * grout(edge, 0.05))
    },
    height: (u, v) => (1 - grout(cell(u, v, 5).edge, 0.08)) * (0.85 + 0.15 * fbm(u, v, 24, 2, 15)),
    rough: (u, v) => 0.8 + 0.2 * hash(cell(u, v, 5).ix, cell(u, v, 5).iy, 16),
  },
  // flowerbed soil: dark, lumpy
  soil: {
    size: 256, tileM: 2, relief: 0.01,
    shade: (u, v) => 0.62 + 0.36 * fbm(u, v, 32, 3, 15),
    rough: () => 1,
  },
  // roofing: gravel / membrane, more uniform than concrete
  roof: {
    size: 256, tileM: 3, relief: 0.004,
    shade: (u, v) => 0.88 + 0.12 * fbm(u, v, 40, 2, 16),
    height: (u, v) => fbm(u, v, 64, 3, 16),
    rough: (u, v) => 0.88 + 0.12 * fbm(u, v, 30, 2, 17),
  },
  // gravel of a flat roof: tight gray grain, coarser than the `roof` membrane
  gravel: {
    size: 256, tileM: 1.6, relief: 0.006,
    shade: (u, v) => 0.6 + 0.3 * fbm(u, v, 56, 3, 18) + 0.1 * (hash(Math.floor(u * 256), Math.floor(v * 256), 19) - 0.5),
    height: (u, v) => fbm(u, v, 56, 3, 18),
    rough: () => 1,
  },
  // brushed metal: fine streaks in one direction, the light slides along them in a streak
  metal: {
    size: 256, tileM: 1, relief: 0.0008,
    shade: (u, v) => 0.88 + 0.12 * noise(u * 40, v, 128, 40),
    height: (u, v) => noise(u * 40, v, 128, 40),
    rough: (u, v) => 0.25 + 0.15 * noise(u * 40, v, 128, 41),
    metal: () => 1,
  },
  // technical floor tile: 1 m cells grooved with a channel, smooth between two ridges
  grid: {
    size: 512, tileM: 2, relief: 0.006,
    shade: (u, v) => {
      const g = grout(cell(u, v, 2).edge, 0.035)
      return (0.86 + 0.1 * fbm(u, v, 16, 2, 50)) * (1 - 0.55 * g)
    },
    height: (u, v) => 1 - grout(cell(u, v, 2).edge, 0.05),
    rough: (u, v) => 0.3 + 0.55 * grout(cell(u, v, 2).edge, 0.06),
    metal: (u, v) => 1 - 0.7 * grout(cell(u, v, 2).edge, 0.06),
  },
  // lacquer: almost smooth, just enough grain that the reflection is not a mirror
  gloss: {
    size: 256, tileM: 2, relief: 0.0004,
    shade: (u, v) => 0.97 + 0.03 * fbm(u, v, 24, 2, 55),
    rough: (u, v) => 0.45 + 0.1 * fbm(u, v, 24, 2, 56),
  },
  // stone: irregular blocks, recessed joints, sandy grain
  stone: {
    size: 512, tileM: 2.5, relief: 0.008,
    shade: (u, v) => {
      const { ix, iy, edge } = brick(u, v, 6, 3, 60)
      const face = 0.76 + 0.16 * hash(ix, iy, 61) + 0.16 * (fbm(u, v, 40, 3, 62) - 0.5)
      return face * (1 - 0.35 * grout(edge, 0.06))
    },
    height: (u, v) => (1 - grout(brick(u, v, 6, 3, 60).edge, 0.09)) * (0.8 + 0.2 * fbm(u, v, 40, 3, 63)),
    rough: () => 1,
  },
}

// ---- baking -------------------------------------------------------------------------------------

function texture(data: Uint8Array, size: number, tileM: number, srgb: boolean): Texture {
  const t = new DataTexture(data, size, size)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(1 / tileM, 1 / tileM)
  t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace
  t.anisotropy = 4
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

function bake(spec: Spec): SurfaceTexture {
  const { size, tileM } = spec
  const height = spec.height ?? spec.shade
  // The relief is sampled once and for all: the normal is read from its neighbors, and
  // recomputing `height` four times per pixel would cost four times the price of the material.
  const h = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    h[y * size + x] = clamp01(height((x + 0.5) / size, (y + 0.5) / size))
  }

  const color = new Uint8Array(size * size * 4)
  const normal = new Uint8Array(size * size * 4)
  const orm = new Uint8Array(size * size * 4)
  // Slope: a height of `relief` meters over a texel of `tileM / size` meters. It is this ratio,
  // and not the amplitude alone, that decides the tilt of the normals — doubling a material's
  // resolution without this factor would make it twice as steep.
  const slope = spec.relief / (tileM / size)
  const wrap = (i: number) => (i + size) % size
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size
    const i = (y * size + x) * 4
    const l = clamp01(spec.shade(u, v))
    const [tr, tg, tb] = spec.tint?.(u, v) ?? [1, 1, 1]
    color[i] = Math.round(clamp01(l * tr) * 255)
    color[i + 1] = Math.round(clamp01(l * tg) * 255)
    color[i + 2] = Math.round(clamp01(l * tb) * 255)
    color[i + 3] = 255

    // centered differences: the slope in x and in y, then the unit normal (z outward)
    const dx = (h[y * size + wrap(x + 1)]! - h[y * size + wrap(x - 1)]!) * 0.5 * slope
    const dy = (h[wrap(y + 1) * size + x]! - h[wrap(y - 1) * size + x]!) * 0.5 * slope
    const inv = 1 / Math.hypot(dx, dy, 1)
    normal[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
    normal[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255)
    normal[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
    normal[i + 3] = 255

    orm[i] = 255
    orm[i + 1] = Math.round(clamp01(spec.rough?.(u, v) ?? 1) * 255)
    orm[i + 2] = Math.round(clamp01(spec.metal?.(u, v) ?? 1) * 255)
    orm[i + 3] = 255
  }
  // the same packed map serves as roughness AND metalness: three reads the channel it needs
  const ormMap = texture(orm, size, tileM, false)
  return {
    map: texture(color, size, tileM, true),
    normalMap: texture(normal, size, tileM, false),
    normalScale: 1,
    roughnessMap: ormMap,
    metalnessMap: ormMap,
    tileM,
  }
}

export type SurfaceTextures = Partial<Record<SurfaceRole, SurfaceTexture>>

/**
 * The baked catalog, KEPT from one scene to the next and from one style to the next. A material is
 * deterministic and immutable: rebaking it would give exactly the same bytes. Baking is not
 * free (a 512 px map is a quarter million times three noise functions), and
 * it was paid at every scene construction — visible as early as the tests.
 *
 * Same policy as the car body cache (`models/loadModel.ts`): nothing is freed, because
 * the catalog is BOUNDED (fourteen roles) and shared. A scene being destroyed therefore does not take
 * away the materials of the one replacing it.
 */
const BAKED = new Map<SurfaceRole, SurfaceTexture>()

/**
 * The requested materials. A style only uses a few roles: baking all fourteen would cost
 * milliseconds and megabytes for nothing.
 */
export function createSurfaceTextures(roles: Iterable<SurfaceRole>): SurfaceTextures {
  const out: SurfaceTextures = {}
  for (const r of new Set(roles)) {
    let t = BAKED.get(r)
    if (!t) { t = bake(SPECS[r]); BAKED.set(r, t) }
    out[r] = t
  }
  return out
}
