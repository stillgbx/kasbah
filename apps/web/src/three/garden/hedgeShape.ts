import { Color, OctahedronGeometry, Vector3, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { DEFAULT_HEDGE_WIDTH } from '@kasbah/shared'
import type { Season } from './season'
import { blob, facet, positionsOnly, rng, type GardenShape } from './shapes'
import type { SpeciesRecipe } from './species'
import { limb } from './speciesShape'

// Une haie : une RANGÉE de sujets serrés le long du segment (m, axe x), sur sa largeur (m, axe y).
// Chaque sujet est un empilement de masses facettées, avec ses tiges au pied, un peu plus haut ou plus
// bas que ses voisins, un peu plus clair ou plus sombre : les feuillages se chevauchent et ferment la
// haie, le dessus se découpe. Premier essai : un bloc taillé continu, lisible mais sans détail.
//
// Construite en mètres sur les TROIS axes (sinon les masses s'écrasent), puis ramenée à la hauteur 1 :
// l'instance ne l'étire qu'en hauteur. La hauteur entre donc dans la clé du cache.

/** Pied dégagé sous le feuillage (m) : on y voit les tiges. */
const FOOT_M = 0.12

const cache = new Map<string, GardenShape>()

/** Rayon d'une masse d'une haie de `width` m : de quoi remplir la largeur, borné pour une haie très large. */
const massRadius = (width: number) => Math.min(0.5, Math.max(0.12, width * 0.38))

/** Espacement automatique entre deux sujets (m) : plus serré que leur largeur, les feuillages se chevauchent. */
export function autoHedgeSpacing(width: number): number {
  return massRadius(width) * 1.2
}

/** Une teinte un peu plus claire ou plus sombre : deux sujets voisins ne sont pas du même vert. */
function shade(c: Color, k: number): Color {
  return c.clone().multiplyScalar(k)
}

/**
 * La haie de `length` × `width` × `height` mètres en `season`. `recipe` : l'espèce (couleurs de saison,
 * bosselage, écorce, fleurs) ; `styled` : sous la palette d'un style, ombrage seul (la teinte vient de
 * l'instance). `spacing` : de pied à pied (m) ; absent = automatique, réparti sur la longueur. `seed` : le tirage.
 */
export function hedgeShape(length: number, season: Season, recipe?: SpeciesRecipe, styled = false, width = DEFAULT_HEDGE_WIDTH, height = 1.8, spacing?: number, seed = 0): GardenShape {
  const key = `${seed}:${length.toFixed(2)}:${width.toFixed(2)}:${height.toFixed(2)}:${spacing?.toFixed(2) ?? 'auto'}:${season}:${styled}:${recipe ? JSON.stringify(recipe) : '-'}`
  const hit = cache.get(key)
  if (hit) return hit
  // la graine de l'élément : « une autre forme » retire les sujets, comme pour un arbre
  const next = rng(0x2545f491 ^ Math.round(length * 100) ^ (Math.round(width * 100) << 12) ^ Math.imul(seed, 0x9e3779b1))
  const L = length, D = width, H = height
  const rough = recipe?.crown.roughness ?? 0.15
  const over = recipe?.seasons?.[season] ?? {}
  const leafColors = over.leaf ?? recipe?.leaf
  const leafGradient = recipe && !styled && leafColors ? ([new Color(leafColors.color), new Color(leafColors.top)] as const) : undefined
  const barkColor = recipe && !styled ? new Color(recipe.trunk.color) : undefined

  const r = massRadius(D)
  const cols = Math.max(1, Math.round(D / (r * 1.3)))
  const inset = r * 1.2                                 // les sujets des bouts restent dans la longueur réglée
  const span = Math.max(0, L - 2 * inset)
  // automatique : autant de sujets que l'espacement serré en loge, répartis sur la longueur ; réglé :
  // l'espacement exact, la rangée centrée sur le segment (au-delà de la largeur d'un sujet, des trous)
  const step = spacing ?? autoHedgeSpacing(D)
  const n = Math.max(1, (spacing === undefined ? Math.round(span / step) : Math.floor(span / step + 1e-6)) + 1)
  const pitch = n > 1 ? (spacing === undefined ? span / (n - 1) : step) : 0
  const start = -((n - 1) * pitch) / 2

  const leaf: BufferGeometry[] = []
  const bark: BufferGeometry[] = []
  for (let p = 0; p < n; p++) {
    const x0 = start + p * pitch + (p > 0 && p < n - 1 ? (next() - 0.5) * Math.min(pitch * 0.25, r * 0.5) : 0)
    const top = H * (0.9 + next() * 0.1)                 // chaque sujet a sa hauteur : le dessus se découpe
    // Masses ÉTIRÉES en hauteur, inégales et décalées : un sujet est un arbuste, pas une colonne de
    // billes. Rondes et en grille, elles faisaient une « pile de boules » (le premier raté des arbres).
    const E = 1.5
    const rows = Math.max(1, Math.round((top - FOOT_M - r * E) / (r * E * 1.3)) + 1)
    const tint = 0.9 + next() * 0.2
    const masses: BufferGeometry[] = []
    for (let row = 0; row < rows; row++) {
      const crown = row === rows - 1                      // la masse du sommet reste ronde : elle dessine la silhouette
      for (let c = 0; c < cols; c++) {
        const rr = r * (0.8 + next() * 0.4)
        const half = rr * (crown ? 1 : E) * (1 + rough)   // demi-hauteur, bosselage compris
        const zBase = rows > 1 ? FOOT_M + r * E + (row * (top - FOOT_M - r * E * 2)) / (rows - 1) : (FOOT_M + top) / 2
        const z = Math.min(top - half, Math.max(FOOT_M + half * 0.7, zBase + (next() - 0.5) * r * E * 0.7))
        // bord extérieur d'une masse sur la largeur réglée ; les colonnes se décalent d'une rangée à l'autre
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
    // deux tiges au pied, visibles sous le feuillage
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

  // fleurs d'une espèce de haie : semées sur les flancs et le dessus, au prorata de la longueur
  const accentRecipe = over.accent === undefined ? recipe?.accent : over.accent ?? undefined
  if (accentRecipe) {
    const flowers: BufferGeometry[] = []
    const count = Math.min(400, Math.round((accentRecipe.count * L) / 3))
    const size = accentRecipe.size * H                   // la taille d'une recette est en part de la hauteur
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
