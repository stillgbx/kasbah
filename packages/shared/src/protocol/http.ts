import { z } from 'zod'
import { deviceEntrySchema } from './ws'
import { pluginSceneEntrySchema } from '../scenes/scene'

export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export type ApiError = z.infer<typeof apiErrorSchema>

export const devicesResponseSchema = z.object({ devices: z.array(deviceEntrySchema) })
export type DevicesResponse = z.infer<typeof devicesResponseSchema>

export const scenesResponseSchema = z.object({ scenes: z.array(pluginSceneEntrySchema) })
export type ScenesResponse = z.infer<typeof scenesResponseSchema>


export const PLUGIN_HEALTH_STATUSES = ['ok', 'degraded', 'needs_pairing', 'error', 'not_implemented', 'disabled'] as const
export const pluginHealthSchema = z.object({
  status: z.enum(PLUGIN_HEALTH_STATUSES),
  detail: z.string().optional(),
  deviceCount: z.number().int().optional(),
  /** Noms des variables d'environnement lues par le plugin (jamais leurs valeurs). */
  keys: z.array(z.string()).optional(),
  /**
   * Consommation d'un quota, quand l'API du fabricant est FACTURÉE ou bornée et que le plugin se
   * rationne (Tesla : les lectures du jour). `labelKey` est une clé i18n de l'app web — même
   * convention que `PluginPart.labelKey`, le serveur ne connaît pas la langue de la tablette.
   * Absent = ce plugin ne compte rien, et l'UI n'a rien à montrer.
   */
  quota: z.object({
    used: z.number().min(0),
    limit: z.number().positive(),
    labelKey: z.string(),
    /** `usd` : `used` et `limit` sont des DOLLARS, à formater comme une somme. Absent = un décompte. */
    unit: z.literal('usd').optional(),
    /** Début de la période comptée (ms epoch), quand elle en a une : l'UI peut la dater. */
    since: z.number().optional(),
  }).optional(),
})
export type PluginHealth = z.infer<typeof pluginHealthSchema>

/** Sous-item d'un plugin (un kind simulé par `mock`…) : ce que l'UI affiche et bascule. */
export const pluginPartSchema = z.object({
  id: z.string(),
  /** Clé i18n du libellé (`kinds.light`…) : le serveur ne connaît pas la langue de la tablette. */
  labelKey: z.string(),
  enabled: z.boolean(),
})
export type PluginPartInfo = z.infer<typeof pluginPartSchema>

/** Un plugin tel que le voit l'écran Réglages : ce qu'il est, ce qu'on en a choisi, comment il va. */
export const pluginInfoSchema = z.object({
  id: z.string(),
  /** Un squelette déclaré mais pas encore écrit ne s'active pas (interrupteur grisé). */
  implemented: z.boolean(),
  enabled: z.boolean(),
  /** N'a de sens que pour un plugin à scènes ; absent sinon. */
  autoDynamicForNewScenes: z.boolean().optional(),
  parts: z.array(pluginPartSchema),
  health: pluginHealthSchema,
})
export type PluginInfo = z.infer<typeof pluginInfoSchema>

export const pluginsResponseSchema = z.object({ plugins: z.array(pluginInfoSchema) })
export type PluginsResponse = z.infer<typeof pluginsResponseSchema>

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  uptimeS: z.number(),
  clients: z.number().int(),
  plugins: z.record(z.string(), pluginHealthSchema),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

export const commandResponseSchema = z.object({ ok: z.literal(true) })

/** Historique horaire d'un appareil énergie (moyennes par heure, ordre chronologique). */
export const energyHistoryPointSchema = z.object({
  /** Début de l'heure (ms epoch). */
  t: z.number(),
  productionW: z.number(),
  consumptionW: z.number(),
  gridW: z.number(),
  samples: z.number().int(),
})
export const energyHistorySchema = z.object({ deviceId: z.string(), points: z.array(energyHistoryPointSchema) })
export type EnergyHistoryPoint = z.infer<typeof energyHistoryPointSchema>
export type EnergyHistory = z.infer<typeof energyHistorySchema>
