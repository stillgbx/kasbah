import { Color, OctahedronGeometry, Vector3, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { DEFAULT_HEDGE_WIDTH } from '@kasbah/shared'
import type { Season } from './season'
import { blob, facet, positionsOnly, rng, type GardenShape } from './shapes'
import type { SpeciesRecipe } from './species'
import { limb } from './speciesShape'

// A hedge: a ROW of tight plants along the segment (m, x axis), over its width (m, y axis).
// Each plant is a stack of faceted masses, with its stems at the foot, a little taller or
// shorter than its neighbors, a little lighter or darker: the foliages overlap and close the
// hedge, the top is cut out. First attempt: a continuous clipped block, readable but without detail.
//
// Built in meters on all THREE axes (otherwise the masses get squashed), then brought back to height 1:
// the instance only stretches it in height. The height therefore goes into the cache key.

/** Clear foot under the foliage (m): the stems show there. */
const FOOT_M = 0.12

const cache = new Map<string, GardenShape>()

/** Radius of a mass of a `width` m hedge: enough to fill the width, bounded for a very wide hedge. */
const massRadius = (width: number) => Math.min(0.5, Math.max(0.12, width * 0.38))

/** Automatic spacing between two plants (m): tighter than their width, the foliages overlap. */
export function autoHedgeSpacing(width: number): number {
  return massRadius(width) * 1.2
}

/** A slightly lighter or darker tint: two neighboring plants are not the same green. */
function shade(c: Color, k: number): Color {
  return c.clone().multiplyScalar(k)
}

/**
 * The hedge of `length` × `width` × `height` meters in `season`. `recipe`: the species (seasonal colors,
 * bumpiness, bark, flowers); `styled`: under a style's palette, shading only (the tint comes from
 * the instance). `spacing`: foot to foot (m); absent = automatic, spread over the length. `seed`: the draw.
 */
export function hedgeShape(length: number, season: Season, recipe?: SpeciesRecipe, styled = false, width = DEFAULT_HEDGE_WIDTH, height = 1.8, spacing?: number, seed = 0): GardenShape {
  const key = `${seed}:${length.toFixed(2)}:${width.toFixed(2)}:${height.toFixed(2)}:${spacing?.toFixed(2) ?? 'auto'}:${season}:${styled}:${recipe ? JSON.stringify(recipe) : '-'}`
  const hit = cache.get(key)
  if (hit) return hit
  // the element's seed: "another shape" redraws the plants, as for a tree
  const next = rng(0x2545f491 ^ Math.round(length * 100) ^ (Math.round(width * 100) << 12) ^ Math.imul(seed, 0x9e3779b1))
  const L = length, D = width, H = height
  const rough = recipe?.crown.roughness ?? 0.15
  const over = recipe?.seasons?.[season] ?? {}
  const leafColors = over.leaf ?? recipe?.leaf
  const leafGradient = recipe && !styled && leafColors ? ([new Color(leafColors.color), new Color(leafColors.top)] as const) : undefined
  const barkColor = recipe && !styled ? new Color(recipe.trunk.color) : undefined

  const r = massRadius(D)
  const cols = Math.max(1, Math.round(D / (r * 1.3)))
  const inset = r * 1.2                                 // the end plants stay within the set length
  const span = Math.max(0, L - 2 * inset)
  // automatic: as many plants as the tight spacing fits, spread over the length; set:
  // the exact spacing, the row centered on the segment (beyond a plant's width, gaps)
  const step = spacing ?? autoHedgeSpacing(D)
  const n = Math.max(1, (spacing === undefined ? Math.round(span / step) : Math.floor(span / step + 1e-6)) + 1)
  const pitch = n > 1 ? (spacing === undefined ? span / (n - 1) : step) : 0
  const start = -((n - 1) * pitch) / 2

  const leaf: BufferGeometry[] = []
  const bark: BufferGeometry[] = []
  for (let p = 0; p < n; p++) {
    const x0 = start + p * pitch + (p > 0 && p < n - 1 ? (next() - 0.5) * Math.min(pitch * 0.25, r * 0.5) : 0)
    const top = H * (0.9 + next() * 0.1)                 // each plant has its own height: the top is cut out
    // Masses STRETCHED in height, unequal and offset: a plant is a shrub, not a column of
    // marbles. Round and on a grid, they made a "pile of balls" (the first failure of the trees).
    const E = 1.5
    const rows = Math.max(1, Math.round((top - FOOT_M - r * E) / (r * E * 1.3)) + 1)
    const tint = 0.9 + next() * 0.2
    const masses: BufferGeometry[] = []
    for (let row = 0; row < rows; row++) {
      const crown = row === rows - 1                      // the top mass stays round: it draws the silhouette
      for (let c = 0; c < cols; c++) {
        const rr = r * (0.8 + next() * 0.4)
        const half = rr * (crown ? 1 : E) * (1 + rough)   // half height, bumpiness included
        const zBase = rows > 1 ? FOOT_M + r * E + (row * (top - FOOT_M - r * E * 2)) / (rows - 1) : (FOOT_M + top) / 2
        const z = Math.min(top - half, Math.max(FOOT_M + half * 0.7, zBase + (next() - 0.5) * r * E * 0.7))
        // outer edge of a mass on the set width; the columns shift from one row to the next
        const edge = Math.max(0, D / 2 - rr * (1 + rough))
        const y = cols > 1 ? -edge + (c * 2 * edge) / (cols - 1) : (next() - 0.5) * edge
        const g = blob(rr, rough, next)
        if (!crown) g.scale(1, 1, E)
        masses.push(g.translate(x0 + (next() - 0.5) * r * 0.7, y, z))
      }
    }
    const merged = mergeGeometries(masses, false)
    for (const g of masses) g.dispose()
    leaf.push(facet(merged, next, leafGradient ? [shade(leafGradient[0], tint), shade(leafGradient[1], tint)] : undefined))
    // two stems at the foot, visible under the foliage
    const stems = [0, 1].map((k) => limb(new Vector3(x0 + (k - 0.5) * r * 0.5, (next() - 0.5) * D * 0.3, 0), new Vector3(x0 + (k - 0.5) * r * 0.2, (next() - 0.5) * D * 0.2, FOOT_M + r), Math.min(0.04, r * 0.12)))
    const stemGeo = mergeGeometries(stems, false)
    for (const g of stems) g.dispose()
    bark.push(facet(stemGeo, next, barkColor ? [barkColor, barkColor] : undefined))
  }

  const toUnit = (list: BufferGeometry[]) => {
    const g = mergeGeometries(list, false)
    for (const x of list) x.dispose()
    return g.scale(1, 1, 1 / H)
  }
  const parts: GardenShape['parts'] = [{ part: 'leaf', geometry: toUnit(leaf) }, { part: 'bark', geometry: toUnit(bark) }]

  // flowers of a hedge species: sown on the sides and the top, in proportion to the length
  const accentRecipe = over.accent === undefined ? recipe?.accent : over.accent ?? undefined
  if (accentRecipe) {
    const flowers: BufferGeometry[] = []
    const count = Math.min(400, Math.round((accentRecipe.count * L) / 3))
    const size = accentRecipe.size * H                   // a recipe's size is a share of the height
    for (let i = 0; i < count; i++) {
      const onTop = next() < 0.3
      const x = (next() - 0.5) * L * 0.95
      const y = onTop ? (next() - 0.5) * D * 0.7 : (next() < 0.5 ? -1 : 1) * (D / 2 + r * 0.1)
      const z = onTop ? H * 0.93 : FOOT_M + r + next() * (H * 0.85 - FOOT_M - r)
      flowers.push(positionsOnly(new OctahedronGeometry(size, 0)).translate(x, y, z))
    }
    const merged = mergeGeometries(flowers, false)
    for (const g of flowers) g.dispose()
    parts.push({ part: 'accent', geometry: facet(merged, next, styled ? undefined : [new Color(accentRecipe.color), new Color(accentRecipe.color)]).scale(1, 1, 1 / H) })
  }
  const shape: GardenShape = { parts, width: L }
  cache.set(key, shape)
  return shape
}
