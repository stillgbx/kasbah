import { BoxGeometry, Color, OctahedronGeometry, type BufferGeometry } from 'three'
import { DEFAULT_HEDGE_WIDTH } from '@kasbah/shared'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Season } from './season'
import { facet, positionsOnly, rng, type GardenShape } from './shapes'
import type { SpeciesRecipe } from './species'

// Une haie : un bloc taillé CONTINU, facetté, construit à sa vraie longueur (m, axe x) et à sa vraie
// épaisseur (m, axe y), mais de hauteur 1 : l'instance l'étire à la hauteur de l'élément. Une rangée
// de buissons laissait des trous et un dessus bosselé, pas un mur de feuillage.

/** Un bosselage par demi-mètre : les facettes gardent leur taille quelle que soit la longueur. */
const MODULE_M = 0.5

/** Relief déterministe par POSITION : les sommets confondus de deux faces bougent ensemble, sans fente. */
function bump(x: number, y: number, z: number): number {
  return Math.sin(x * 7.3 + y * 3.1) * Math.sin(y * 5.7 + z * 9.1 + 1.3) * Math.sin(z * 6.1 + x * 2.3 + 0.7)
}

const cache = new Map<string, GardenShape>()

/**
 * La haie de `length` × `width` mètres en `season`. `recipe` : l'espèce (couleurs de saison, bosselage, fleurs) ;
 * `styled` : sous la palette d'un style, ombrage seul (la teinte vient de l'instance).
 */
export function hedgeShape(length: number, season: Season, recipe?: SpeciesRecipe, styled = false, width = DEFAULT_HEDGE_WIDTH): GardenShape {
  const key = `${length.toFixed(2)}:${width.toFixed(2)}:${season}:${styled}:${recipe ? JSON.stringify(recipe) : '-'}`
  const hit = cache.get(key)
  if (hit) return hit
  const next = rng(0x2545f491 ^ Math.round(length * 100) ^ (Math.round(width * 100) << 12))
  const L = length, D = width
  const rough = recipe?.crown.roughness ?? 0.15
  const box = positionsOnly(new BoxGeometry(L, D, 1, Math.max(1, Math.ceil(L / MODULE_M)), Math.max(2, Math.ceil(D / MODULE_M)), 3)).translate(0, 0, 0.5)
  const pos = box.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    // arêtes du haut arrondies : le sommet du bord rentre et descend un peu
    if (z > 0.99 && Math.abs(Math.abs(y) - D / 2) < 1e-6) { y -= Math.sign(y) * Math.min(0.2, D * 0.28); z = 0.93 }
    if (z > 0.99 && Math.abs(Math.abs(x) - L / 2) < 1e-6) { x -= Math.sign(x) * Math.min(0.1, D * 0.14); z = Math.min(z, 0.93) }
    const n = bump(x, y, z)
    const a = rough * 0.3
    pos.setXYZ(i, x + n * a * 0.4, y + n * a * 0.6 * Math.sign(y || 1), z > 0.01 ? z + n * a * 0.25 : 0)
  }
  const over = recipe?.seasons?.[season] ?? {}
  const leaf = over.leaf ?? recipe?.leaf
  const gradient = recipe && !styled && leaf ? ([new Color(leaf.color), new Color(leaf.top)] as const) : undefined
  const parts: GardenShape['parts'] = [{ part: 'leaf', geometry: facet(box, next, gradient) }]

  // fleurs d'une espèce de haie : semées sur les flancs et le dessus, au prorata de la longueur
  const accentRecipe = over.accent === undefined ? recipe?.accent : over.accent ?? undefined
  if (accentRecipe) {
    const flowers: BufferGeometry[] = []
    const n = Math.min(400, Math.round((accentRecipe.count * L) / 3))
    for (let i = 0; i < n; i++) {
      const onTop = next() < 0.3
      const x = (next() - 0.5) * L * 0.95
      const y = onTop ? (next() - 0.5) * D * 0.7 : (next() < 0.5 ? -1 : 1) * D * 0.52
      const z = onTop ? 0.95 : 0.2 + next() * 0.7
      // la taille d'une recette est en part de la hauteur ; x et y sont ici en mètres (haie d'environ 2 m)
      flowers.push(positionsOnly(new OctahedronGeometry(accentRecipe.size, 0)).scale(2, 2, 1).translate(x, y, z))
    }
    const merged = mergeGeometries(flowers, false)
    for (const g of flowers) g.dispose()
    parts.push({ part: 'accent', geometry: facet(merged, next, styled ? undefined : [new Color(accentRecipe.color), new Color(accentRecipe.color)]) })
  }
  const shape: GardenShape = { parts, width: L }
  cache.set(key, shape)
  return shape
}
