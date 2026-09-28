import { Color, ConeGeometry, CylinderGeometry, OctahedronGeometry, Quaternion, Vector3, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Season } from './season'
import { blob, facet, gardenSeed, positionsOnly, rng, type GardenPart, type GardenShape } from './shapes'
import type { SpeciesRecipe } from './species'

// Générateur des espèces : une recette (`species.ts`) → une forme facettée, à la saison voulue.

/** Un cylindre de `a` à `b` (repère maison), pour les charpentières. */
function limb(a: Vector3, b: Vector3, r: number): BufferGeometry {
  const dir = new Vector3().subVectors(b, a)
  const g = new CylinderGeometry(r * 0.6, r, dir.length(), 5, 1)
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize()))
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return positionsOnly(g)
}

const cache = new Map<string, GardenShape>()

/**
 * La forme `variant` d'une espèce en `season` : même recette, autre tirage (masses, fruits, inclinaison).
 * `style` (un style qui a sa palette de jardin) : ombrage seul, sans les couleurs de l'espèce — la
 * teinte viendra de l'instance —, et `foliage` qui s'ajoute à celui de la saison.
 */
export function speciesShape(recipe: SpeciesRecipe, variant: number, season: Season = 'summer', style?: { foliage: number }): GardenShape {
  const key = `${recipe.id}:${variant}:${season}:${style?.foliage ?? '-'}:${JSON.stringify(recipe)}`
  const hit = cache.get(key)
  if (hit) return hit
  // le tirage ne dépend PAS de la saison : le même arbre perd ses feuilles, il ne change pas de port
  const next = rng(gardenSeed({ id: recipe.id }) ^ (variant * 7919))
  const { trunk, crown } = recipe
  const over = recipe.seasons?.[season] ?? {}
  const foliage = (over.foliage ?? 1) * (style?.foliage ?? 1)
  const leafColors = over.leaf ?? recipe.leaf
  const accentRecipe = over.accent === undefined ? recipe.accent : over.accent ?? undefined
  const R = crown.width / 2
  const z0 = trunk.height * 0.85                      // le houppier mord un peu sur le fût
  const crownH = 1 - z0

  // fût : trois tronçons, incliné dans une direction tirée
  const bark: BufferGeometry[] = []
  const heading = next() * Math.PI * 2
  const top = new Vector3(Math.cos(heading) * Math.sin(trunk.lean) * trunk.height, Math.sin(heading) * Math.sin(trunk.lean) * trunk.height, trunk.height)
  bark.push(limb(new Vector3(0, 0, 0), top, trunk.radius))

  const leaf: BufferGeometry[] = []
  const masses: { c: Vector3; r: number }[] = []
  if (crown.shape === 'cone') {
    const tiers = 3 + Math.floor(next() * 2)
    for (let i = 0; i < tiers; i++) {
      const h = crownH * 0.45
      const g = new ConeGeometry(R * (1 - i * (0.7 / tiers)), h, 7, 1)
      g.rotateX(Math.PI / 2)
      g.translate(top.x, top.y, z0 + i * ((crownH - h) / Math.max(1, tiers - 1)) + h / 2)
      leaf.push(positionsOnly(g))
      masses.push({ c: new Vector3(top.x, top.y, z0 + (i + 0.5) * (crownH / tiers)), r: R * (1 - i * (0.7 / tiers)) * 0.6 })
    }
  } else {
    // Masses posées sur la COQUILLE d'un ellipsoïde (demi-axes R et crownH/2), à des élévations propres
    // au port — un dôme pour un port étalé, presque toute la sphère pour une boule —, plus une masse
    // au cœur. Empilées dans le volume, elles donnaient une pile de boules sans silhouette.
    const n = crown.shape === 'column' ? Math.max(3, crown.masses) : crown.masses
    const [eMin, eMax] = crown.shape === 'spreading' ? [-0.35, 1.2] : crown.shape === 'round' ? [-0.8, 1.3] : [-1, 1.3]
    const zc = z0 + crownH / 2
    const shell = 0.62                                 // centres en retrait de la coquille : les masses la débordent
    const r0 = 0.5 * Math.min(R, crownH / 2) * (1.15 - Math.min(0.4, n * 0.025))
    for (let i = 0; i < n; i++) {
      const core = i === 0
      const a = ((i + next() * 0.7) / n) * Math.PI * 2 * 1.618
      const e = eMin + (eMax - eMin) * ((i * 0.618 + next() * 0.5) % 1)
      const edge = Math.max(0, Math.cos(e) - 0.4)       // les masses du bord retombent, pas celles du sommet
      const r = (core ? 1.25 : 0.8 + 0.4 * next()) * r0
      const c = core
        ? new Vector3(top.x, top.y, zc + crownH * 0.08)
        : new Vector3(top.x + Math.cos(a) * Math.cos(e) * R * shell, top.y + Math.sin(a) * Math.cos(e) * R * shell,
          zc + Math.sin(e) * (crownH / 2) * shell - crown.droop * edge * crownH * 0.4)
      const g = blob(r, crown.roughness, next).translate(c.x, c.y, c.z)
      // une masse sur deux, puis toutes, selon le feuillage restant ; le tirage continue quand même
      if (i < Math.round(n * foliage)) leaf.push(g)
      else g.dispose()
      masses.push({ c, r })
    }
  }
  // charpentières : du haut du fût vers les masses les plus basses, jusqu'aux deux tiers.
  const low = [...masses].sort((m1, m2) => m1.c.z - m2.c.z)
  if (foliage >= 1) {
    for (let k = 0; k < Math.min(trunk.forks, low.length); k++) bark.push(limb(top, top.clone().lerp(low[k]!.c, 0.7), trunk.radius * 0.6))
  } else {
    // Un arbre dégarni montre sa ramure, qui doit se lire ÉTAGÉE : une flèche prolonge le fût dans le
    // houppier, et chaque branche en part à la hauteur de la masse qu'elle nourrit (les basses en bas),
    // avec deux rameaux vers le bord de cette masse. Parties toutes du haut du fût, elles faisaient balai.
    const crest = low[low.length - 1]!
    const leader = new Vector3(top.x, top.y, crest.c.z + crest.r * 0.5)
    bark.push(limb(top, leader, trunk.radius * 0.7))
    low.forEach((m, k) => {
      const from = top.clone().lerp(leader, 0.1 + 0.65 * (k / Math.max(1, low.length - 1)))
      const to = from.clone().lerp(m.c, 0.95)
      bark.push(limb(from, to, trunk.radius * 0.45))
      const knot = from.clone().lerp(to, 0.55)
      for (let t = 0; t < 2; t++) {
        const tip = m.c.clone().add(new Vector3(next() - 0.5, next() - 0.5, next() * 0.6).normalize().multiplyScalar(m.r * 0.85))
        bark.push(limb(knot, tip, trunk.radius * 0.25))
      }
    })
  }

  const accent: BufferGeometry[] = []
  if (accentRecipe) {
    for (let i = 0; i < accentRecipe.count; i++) {
      const m = masses[Math.floor(next() * masses.length)]!
      const d = new Vector3(next() - 0.5, next() - 0.5, next() - 0.7).normalize()   // plutôt sous le feuillage, comme un fruit pendant
      const p = m.c.clone().addScaledVector(d, m.r * 0.95)
      accent.push(positionsOnly(new OctahedronGeometry(accentRecipe.size, 0)).translate(p.x, p.y, p.z))
    }
  }

  const colors = (a: string, b = a) => [new Color(a), new Color(b)] as const
  const raw: [GardenPart, BufferGeometry[], readonly [Color, Color]][] = [
    ['bark', bark, colors(recipe.trunk.color)],
    ...(leaf.length ? [['leaf', leaf, colors(leafColors.color, leafColors.top)] as [GardenPart, BufferGeometry[], readonly [Color, Color]]] : []),
    ...(accent.length ? [['accent', accent, colors(accentRecipe!.color)] as [GardenPart, BufferGeometry[], readonly [Color, Color]]] : []),
  ]
  const merged = raw.map(([part, list]) => ({ geometry: mergeGeometries(list, false), part }))
  for (const [, list] of raw) for (const g of list) g.dispose()
  // Échelle tirée de l'enveloppe de TOUTES les masses, dessinées ou non : sans quoi l'arbre nu de
  // l'hiver, plus bas que son houppier, serait étiré jusqu'à la même hauteur.
  const bump = 1 + crown.roughness                    // une masse bosselée déborde de son rayon
  const topZ = Math.max(top.z, ...masses.map((m) => m.c.z + m.r * bump))
  const reach = Math.max(...masses.map((m) => Math.hypot(m.c.x, m.c.y) + m.r * bump))
  for (const p of merged) p.geometry.scale(1 / topZ, 1 / topZ, 1 / topZ)
  const width = (2 * reach) / topZ
  merged.forEach((p, i) => { p.geometry = facet(p.geometry, next, style ? undefined : raw[i]![2]) })
  const shape: GardenShape = { parts: merged, width }
  cache.set(key, shape)
  return shape
}
