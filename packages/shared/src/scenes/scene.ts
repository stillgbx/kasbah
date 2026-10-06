import { z } from 'zod'
import { pluginIdSchema } from '../devices/descriptor'

// Scène PLUGIN : un préréglage qui vit chez le fabricant (scène Hue d'une pièce ou d'une zone),
// fixe ou à palette animée. Kasbah ne la recompose pas — il la liste, en montre l'aperçu et
// demande son rappel. À ne pas confondre avec la scène 3D. (Les « scènes maison », lots de
// commandes déclarés dans house.json, ont été retirées le 2026-10-06 : aucun code ne les lisait.)

export const SCENE_ID_RE = /^[a-z0-9_]+:[^:\s]+$/
export const sceneIdSchema = z.string().regex(SCENE_ID_RE, 'sceneId: <pluginId>:<externalId>')
export type SceneId = z.infer<typeof sceneIdSchema>

const pct = z.number().min(0).max(100)
const hexSchema = z.string().regex(/^#[0-9a-f]{6}$/i)

/** `room` se rattache à la pièce de même nom (même convention que `descriptor.meta.room`) ; une
 *  `zone` traverse plusieurs pièces et n'appartient donc à aucune. */
export const SCENE_GROUP_KINDS = ['room', 'zone'] as const
export type SceneGroupKind = (typeof SCENE_GROUP_KINDS)[number]

export const pluginSceneSchema = z.object({
  id: sceneIdSchema,
  pluginId: pluginIdSchema,
  externalId: z.string().min(1),
  name: z.string().min(1),
  group: z.object({ name: z.string().min(1), kind: z.enum(SCENE_GROUP_KINDS) }).optional(),
  /** La scène a une palette animée : elle accepte un rappel en mode `dynamic`. */
  dynamic: z.boolean(),
  /**
   * La scène est réglée pour démarrer animée (case « démarrer l'animation automatiquement » de
   * l'app Hue, `auto_dynamic`). PRÉFÉRENCE, pas capacité : elle vit CHEZ LE FABRICANT et s'écrit
   * là-bas (`sceneUpdateSchema`), pour que toutes les apps lisent la même valeur.
   */
  autoDynamic: z.boolean().default(false),
  /** Aperçu : couleurs sRGB de la palette (ou des valeurs fixes), dans l'ordre du fabricant. */
  swatches: z.array(hexSchema).default([]),
}).superRefine((s, ctx) => {
  if (s.id !== `${s.pluginId}:${s.externalId}`) {
    ctx.addIssue({ code: 'custom', path: ['id'], message: 'id must equal `${pluginId}:${externalId}`' })
  }
})
export type PluginScene = z.infer<typeof pluginSceneSchema>

/** `static` = valeurs fixes appliquées, `dynamic` = palette en cours d'animation. */
export const SCENE_ACTIVATIONS = ['inactive', 'static', 'dynamic'] as const
export type SceneActivation = (typeof SCENE_ACTIVATIONS)[number]

export const pluginSceneStateSchema = z.object({
  active: z.enum(SCENE_ACTIVATIONS),
  updatedAt: z.number().int(),
})
export type PluginSceneState = z.infer<typeof pluginSceneStateSchema>

export const pluginSceneEntrySchema = z.object({ scene: pluginSceneSchema, state: pluginSceneStateSchema })
export type PluginSceneEntry = z.infer<typeof pluginSceneEntrySchema>

/**
 * `static` applique les valeurs fixes, `dynamic` lance la palette animée, `off` éteint le groupe de
 * la scène (pièce ou zone du fabricant) — il n'existe pas de « désactiver une scène » chez les
 * fabricants : une scène s'éteint en éteignant ses lampes.
 */
export const SCENE_RECALL_MODES = ['static', 'dynamic', 'off'] as const
export type SceneRecallMode = (typeof SCENE_RECALL_MODES)[number]

export const sceneRecallSchema = z.object({
  mode: z.enum(SCENE_RECALL_MODES).default('static'),
  /** Rappel atténué (le fabricant met la scène à l'échelle) ; ignoré par `off`. */
  brightness: pct.optional(),
  transitionMs: z.number().int().min(0).optional(),
})
export type SceneRecall = z.infer<typeof sceneRecallSchema>
export type SceneRecallInput = z.input<typeof sceneRecallSchema>

/**
 * Écriture d'une préférence DANS le fabricant. `autoDynamic` y vit déjà (case « démarrer
 * l'animation automatiquement ») : la modifier sur le pont plutôt que côté app garde une seule
 * source de vérité, quelle que soit l'app qui règle le paramètre.
 */
export const sceneUpdateSchema = z.object({ autoDynamic: z.boolean() })
export type SceneUpdate = z.infer<typeof sceneUpdateSchema>

/**
 * Création d'une ambiance pour un groupe (pièce ou zone) du fabricant, en RECOPIANT une ambiance
 * déjà présente ailleurs : palette et valeurs viennent de la source, seules les lampes visées
 * changent. Les fabricants ne publient pas leur galerie de préréglages (vérifié sur un pont Hue :
 * aucune ressource catalogue), donc la seule matière fiable est ce que le pont porte déjà.
 * `groupName` est rapproché comme partout ailleurs : par nom normalisé (`roomKey`).
 */
export const sceneCreateSchema = z.object({
  fromSceneId: sceneIdSchema,
  groupName: z.string().min(1),
})
export type SceneCreate = z.infer<typeof sceneCreateSchema>


export function makeSceneId(pluginId: string, externalId: string): SceneId {
  return `${pluginId}:${externalId}`
}

export function parseSceneId(id: string): { pluginId: string; externalId: string } {
  if (!SCENE_ID_RE.test(id)) throw new Error(`invalid scene id "${id}"`)
  const i = id.indexOf(':')
  return { pluginId: id.slice(0, i), externalId: id.slice(i + 1) }
}
