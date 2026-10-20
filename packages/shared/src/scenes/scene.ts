import { z } from 'zod'
import { pluginIdSchema } from '../devices/descriptor'

// PLUGIN scene: a preset that lives at the vendor (Hue scene of a room or a zone),
// fixed or with an animated palette. Kasbah does not recompose it — it lists it, shows its preview and
// requests its recall. Not to be confused with the 3D scene. (The "house scenes", batches of
// commands declared in house.json, were removed on 2026-10-06: no code read them.)

export const SCENE_ID_RE = /^[a-z0-9_]+:[^:\s]+$/
export const sceneIdSchema = z.string().regex(SCENE_ID_RE, 'sceneId: <pluginId>:<externalId>')
export type SceneId = z.infer<typeof sceneIdSchema>

const pct = z.number().min(0).max(100)
const hexSchema = z.string().regex(/^#[0-9a-f]{6}$/i)

/** `room` attaches to the room of the same name (same convention as `descriptor.meta.room`); a
 *  `zone` spans several rooms and therefore belongs to none. */
export const SCENE_GROUP_KINDS = ['room', 'zone'] as const
export type SceneGroupKind = (typeof SCENE_GROUP_KINDS)[number]

export const pluginSceneSchema = z.object({
  id: sceneIdSchema,
  pluginId: pluginIdSchema,
  externalId: z.string().min(1),
  name: z.string().min(1),
  group: z.object({ name: z.string().min(1), kind: z.enum(SCENE_GROUP_KINDS) }).optional(),
  /** The scene has an animated palette: it accepts a recall in `dynamic` mode. */
  dynamic: z.boolean(),
  /**
   * The scene is set to start animated (the "start the animation automatically" checkbox of
   * the Hue app, `auto_dynamic`). A PREFERENCE, not a capability: it lives AT THE VENDOR and is written
   * there (`sceneUpdateSchema`), so that all the apps read the same value.
   */
  autoDynamic: z.boolean().default(false),
  /** Preview: sRGB colors of the palette (or of the fixed values), in the vendor's order. */
  swatches: z.array(hexSchema).default([]),
}).superRefine((s, ctx) => {
  if (s.id !== `${s.pluginId}:${s.externalId}`) {
    ctx.addIssue({ code: 'custom', path: ['id'], message: 'id must equal `${pluginId}:${externalId}`' })
  }
})
export type PluginScene = z.infer<typeof pluginSceneSchema>

/** `static` = fixed values applied, `dynamic` = palette being animated. */
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
 * `static` applies the fixed values, `dynamic` starts the animated palette, `off` turns off the group of
 * the scene (vendor room or zone) — there is no "deactivate a scene" at the
 * vendors: a scene is turned off by turning off its lights.
 */
export const SCENE_RECALL_MODES = ['static', 'dynamic', 'off'] as const
export type SceneRecallMode = (typeof SCENE_RECALL_MODES)[number]

export const sceneRecallSchema = z.object({
  mode: z.enum(SCENE_RECALL_MODES).default('static'),
  /** Dimmed recall (the vendor scales the scene); ignored by `off`. */
  brightness: pct.optional(),
  transitionMs: z.number().int().min(0).optional(),
})
export type SceneRecall = z.infer<typeof sceneRecallSchema>
export type SceneRecallInput = z.input<typeof sceneRecallSchema>

/**
 * Writing a preference IN the vendor. `autoDynamic` already lives there (checkbox "start
 * the animation automatically"): changing it on the bridge rather than on the app side keeps a single
 * source of truth, whichever app sets the parameter.
 */
export const sceneUpdateSchema = z.object({ autoDynamic: z.boolean() })
export type SceneUpdate = z.infer<typeof sceneUpdateSchema>

/**
 * Creation of a light scene for a vendor group (room or zone), by COPYING a light scene
 * already present elsewhere: palette and values come from the source, only the targeted lights
 * change. Vendors do not publish their gallery of presets (verified on a Hue bridge:
 * no catalog resource), so the only reliable material is what the bridge already carries.
 * `groupName` is matched as everywhere else: by normalized name (`roomKey`).
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
