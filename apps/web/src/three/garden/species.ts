import { z } from 'zod'
import { GARDEN_KINDS } from '@kasbah/shared'

// Garden species: one RECIPE (proportions, crown habit, colors, fruit) per file
// `species/<id>.json`, read by the same faceted generator as the families (`speciesShape.ts`). It is what the skill
// `garden-species` writes from a photo: adding a species = dropping a file, no code.
//
// All measurements are RELATIVE to the tree's height (1): the real height is that of the
// element, `height` is only the value proposed when it is planted.

const hex = z.string().regex(/^#[0-9a-f]{6}$/i)
const unit = z.number().min(0).max(1)

export const CROWN_SHAPES = ['round', 'spreading', 'oval', 'cone', 'column', 'tiered'] as const

const accentSchema = z.object({ color: hex, count: z.number().int().min(1).max(200), size: z.number().min(0.003).max(0.08) })

/**
 * What a season changes in the base recipe (which is SUMMER): remaining foliage (0 = bare, the
 * main branches show), leaf colors, fruit or flowers (`null` = none).
 */
const seasonSchema = z.object({
  foliage: unit.optional(),
  leaf: z.object({ color: hex, top: hex }).optional(),
  accent: accentSchema.nullable().optional(),
})

export const speciesSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(GARDEN_KINDS),
  name: z.object({ fr: z.string().min(1), en: z.string().min(1) }),
  /** Height proposed at planting (m). */
  height: z.number().min(0.1).max(40),
  trunk: z.object({
    /** Height of the bare trunk, as a share of the total height. */
    height: unit,
    /** Radius at the foot, as a share of the total height. */
    radius: z.number().min(0.005).max(0.2),
    /** Lean of the trunk (radians, toward a randomly drawn direction). */
    lean: z.number().min(0).max(0.6),
    /** Main branches that go from the top of the trunk toward the crown (0 = none). */
    forks: z.number().int().min(0).max(6),
    /** Start of the main branches on the trunk, as a share of the total height (absent = top of the trunk): low for a multi-stem tree. */
    forkAt: unit.optional(),
    /** Spread of the main branches' feet around the trunk, as a share of the height (absent = a single point): parallel culms of a bamboo. */
    spread: z.number().min(0).max(0.3).optional(),
    color: hex,
  }),
  crown: z.object({
    shape: z.enum(CROWN_SHAPES),
    /** Crown diameter relative to the total height (1.2 = wider than tall). */
    width: z.number().min(0.1).max(3),
    /** Number of foliage masses (mass-based habits: round, spreading, oval). */
    masses: z.number().int().min(1).max(16),
    /** Bumpiness of each mass (0 = smooth, 0.3 = very irregular). */
    roughness: z.number().min(0).max(0.5),
    /** Droop of the edge masses (0 = none, 1 = weeping). */
    droop: unit,
    /** Platforms of the `tiered` habit (absent = 3): 1 for an umbrella pine, 4 or 5 for an old cedar. */
    tiers: z.number().int().min(1).max(6).optional(),
  }),
  leaf: z.object({ color: hex, top: hex }),
  /** Fruit or flowers: small facets sown on the surface of the crown. */
  accent: accentSchema.optional(),
  /** Seasonal variants; a missing season = the base one. */
  seasons: z.object({ spring: seasonSchema, autumn: seasonSchema, winter: seasonSchema, summer: seasonSchema }).partial().optional(),
  /** Where the recipe comes from (photo, note): to find it again and rework it. */
  source: z.string().optional(),
})
export type SpeciesRecipe = z.infer<typeof speciesSchema>

const files = import.meta.glob<{ default: unknown }>('./species/*.json', { eager: true })

/** The catalog, sorted by name. An invalid file is DROPPED with a warning, not blocking. */
export const SPECIES: readonly SpeciesRecipe[] = Object.entries(files).flatMap(([path, mod]) => {
  const parsed = speciesSchema.safeParse(mod.default)
  if (parsed.success) return [parsed.data]
  console.warn(`[garden] species ignored ${path}:`, parsed.error.issues[0]?.message)
  return []
}).sort((a, b) => a.name.fr.localeCompare(b.name.fr))

/** A species of the catalog, if it exists AND belongs to this family (otherwise the family wins). */
export function speciesOf(item: { kind: string; species?: string }): SpeciesRecipe | undefined {
  const s = item.species ? SPECIES.find((x) => x.id === item.species) : undefined
  return s && s.kind === item.kind ? s : undefined
}
