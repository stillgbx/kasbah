import { z } from 'zod'
import { deviceEntrySchema } from './ws'

export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export type ApiError = z.infer<typeof apiErrorSchema>

export const devicesResponseSchema = z.object({ devices: z.array(deviceEntrySchema) })
export type DevicesResponse = z.infer<typeof devicesResponseSchema>

export const PLUGIN_HEALTH_STATUSES = ['ok', 'degraded', 'needs_pairing', 'error', 'not_implemented', 'disabled'] as const
export const pluginHealthSchema = z.object({
  status: z.enum(PLUGIN_HEALTH_STATUSES),
  detail: z.string().optional(),
  deviceCount: z.number().int().optional(),
  /** Noms des variables d'environnement lues par le plugin (jamais leurs valeurs). */
  keys: z.array(z.string()).optional(),
})
export type PluginHealth = z.infer<typeof pluginHealthSchema>

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
