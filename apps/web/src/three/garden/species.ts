import { z } from 'zod'
import { GARDEN_KINDS } from '@kasbah/shared'

// Espèces du jardin : une RECETTE (proportions, port du houppier, couleurs, fruits) par fichier
// `species/<id>.json`, lue par le même générateur facetté que les familles (`speciesShape.ts`). C'est ce que la skill
// `garden-species` écrit à partir d'une photo : ajouter une espèce = déposer un fichier, sans code.
//
// Toutes les mesures sont RELATIVES à la hauteur de l'arbre (1) : la hauteur réelle est celle de
// l'élément, `height` n'est que la valeur proposée quand on le plante.

const hex = z.string().regex(/^#[0-9a-f]{6}$/i)
const unit = z.number().min(0).max(1)

export const CROWN_SHAPES = ['round', 'spreading', 'oval', 'cone', 'column', 'tiered'] as const

const accentSchema = z.object({ color: hex, count: z.number().int().min(1).max(200), size: z.number().min(0.003).max(0.08) })

/**
 * Ce qu'une saison change à la recette de base (qui est l'ÉTÉ) : feuillage restant (0 = nu, les
 * charpentières se voient), couleurs des feuilles, fruits ou fleurs (`null` = aucun).
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
  /** Hauteur proposée à la plantation (m). */
  height: z.number().min(0.1).max(40),
  trunk: z.object({
    /** Hauteur du fût nu, en part de la hauteur totale. */
    height: unit,
    /** Rayon au pied, en part de la hauteur totale. */
    radius: z.number().min(0.005).max(0.2),
    /** Inclinaison du fût (radians, vers une direction tirée au hasard). */
    lean: z.number().min(0).max(0.6),
    /** Charpentières qui partent du haut du fût vers le houppier (0 = aucune). */
    forks: z.number().int().min(0).max(6),
    /** Départ des charpentières sur le fût, en part de la hauteur totale (absent = haut du fût) : bas pour une cépée. */
    forkAt: unit.optional(),
    /** Écart des pieds des charpentières autour du fût, en part de la hauteur (absent = un seul point) : chaumes parallèles d'un bambou. */
    spread: z.number().min(0).max(0.3).optional(),
    color: hex,
  }),
  crown: z.object({
    shape: z.enum(CROWN_SHAPES),
    /** Diamètre du houppier rapporté à la hauteur totale (1,2 = plus large que haut). */
    width: z.number().min(0.1).max(3),
    /** Nombre de masses de feuillage (formes à masses : round, spreading, oval). */
    masses: z.number().int().min(1).max(16),
    /** Bosselage de chaque masse (0 = lisse, 0,3 = très irrégulier). */
    roughness: z.number().min(0).max(0.5),
    /** Retombée des masses du bord (0 = aucune, 1 = pleureur). */
    droop: unit,
    /** Plateaux du port `tiered` (absent = 3) : 1 pour un pin parasol, 4 ou 5 pour un vieux cèdre. */
    tiers: z.number().int().min(1).max(6).optional(),
  }),
  leaf: z.object({ color: hex, top: hex }),
  /** Fruits ou fleurs : petites facettes semées à la surface du houppier. */
  accent: accentSchema.optional(),
  /** Variantes saisonnières ; une saison absente = celle de base. */
  seasons: z.object({ spring: seasonSchema, autumn: seasonSchema, winter: seasonSchema, summer: seasonSchema }).partial().optional(),
  /** D'où vient la recette (photo, note) : pour la retrouver et la reprendre. */
  source: z.string().optional(),
})
export type SpeciesRecipe = z.infer<typeof speciesSchema>

const files = import.meta.glob<{ default: unknown }>('./species/*.json', { eager: true })

/** Le catalogue, trié par nom. Un fichier invalide est ÉCARTÉ avec un avertissement, pas bloquant. */
export const SPECIES: readonly SpeciesRecipe[] = Object.entries(files).flatMap(([path, mod]) => {
  const parsed = speciesSchema.safeParse(mod.default)
  if (parsed.success) return [parsed.data]
  console.warn(`[garden] espèce ignorée ${path}:`, parsed.error.issues[0]?.message)
  return []
}).sort((a, b) => a.name.fr.localeCompare(b.name.fr))

/** Une espèce du catalogue, si elle existe ET appartient à cette famille (sinon la famille gagne). */
export function speciesOf(item: { kind: string; species?: string }): SpeciesRecipe | undefined {
  const s = item.species ? SPECIES.find((x) => x.id === item.species) : undefined
  return s && s.kind === item.kind ? s : undefined
}
