import { z } from 'zod'

// Formes CLIP v2 (https://<bridge>/clip/v2). Schémas VOLONTAIREMENT souples (`looseObject`) :
// le bridge ajoute des champs à chaque firmware, on ne lit que ce dont on a besoin.

export const hueRefSchema = z.object({ rid: z.string(), rtype: z.string() })
export type HueRef = z.infer<typeof hueRefSchema>

export const hueLightSchema = z.looseObject({
  id: z.string(),
  type: z.string().optional(),
  owner: hueRefSchema.optional(),
  metadata: z.looseObject({ name: z.string().optional(), archetype: z.string().optional() }).optional(),
  on: z.object({ on: z.boolean() }).optional(),
  dimming: z.looseObject({ brightness: z.number(), min_dim_level: z.number().optional() }).optional(),
  color_temperature: z.looseObject({
    mirek: z.number().nullable().optional(),
    mirek_valid: z.boolean().optional(),
    mirek_schema: z.object({ mirek_minimum: z.number(), mirek_maximum: z.number() }).optional(),
  }).optional(),
  color: z.looseObject({ xy: z.object({ x: z.number(), y: z.number() }).optional(), gamut_type: z.string().optional() }).optional(),
})
export type HueLight = z.infer<typeof hueLightSchema>

export const hueDeviceSchema = z.looseObject({
  id: z.string(),
  product_data: z.looseObject({
    product_name: z.string().optional(), model_id: z.string().optional(), manufacturer_name: z.string().optional(),
  }).optional(),
  metadata: z.looseObject({ name: z.string().optional() }).optional(),
  services: z.array(hueRefSchema).default([]),
})
export type HueDevice = z.infer<typeof hueDeviceSchema>

export const hueRoomSchema = z.looseObject({
  id: z.string(),
  metadata: z.looseObject({ name: z.string().optional() }).optional(),
  children: z.array(hueRefSchema).default([]),
  services: z.array(hueRefSchema).default([]),
})
export type HueRoom = z.infer<typeof hueRoomSchema>

export const hueGroupedLightSchema = z.looseObject({
  id: z.string(),
  owner: hueRefSchema.optional(),
  on: z.object({ on: z.boolean() }).optional(),
  dimming: z.looseObject({ brightness: z.number() }).optional(),
})
export type HueGroupedLight = z.infer<typeof hueGroupedLightSchema>

export const hueZigbeeConnectivitySchema = z.looseObject({
  id: z.string(),
  owner: hueRefSchema.optional(),
  status: z.string(),
})
export type HueZigbeeConnectivity = z.infer<typeof hueZigbeeConnectivitySchema>

export const hueResponseSchema = z.object({
  errors: z.array(z.looseObject({ description: z.string().optional() })).default([]),
  data: z.array(z.looseObject({ id: z.string().optional() })).default([]),
})

/** Trame du flux /eventstream/clip/v2 : un tableau d'événements portant chacun des ressources partielles. */
export const hueEventItemSchema = z.looseObject({ id: z.string(), type: z.string() })
export const hueEventSchema = z.looseObject({
  creationtime: z.string().optional(),
  id: z.string().optional(),
  type: z.enum(['update', 'add', 'delete', 'error']),
  data: z.array(hueEventItemSchema).default([]),
})
export const hueEventFrameSchema = z.array(hueEventSchema)
export type HueEvent = z.infer<typeof hueEventSchema>

/** Réponse de POST /api (appairage, API v1). */
export const huePairResponseSchema = z.array(z.looseObject({
  success: z.looseObject({ username: z.string(), clientkey: z.string().optional() }).optional(),
  error: z.looseObject({ type: z.number(), description: z.string().optional() }).optional(),
}))

/** Réponse de https://discovery.meethue.com/ */
export const hueDiscoverySchema = z.array(z.looseObject({ id: z.string(), internalipaddress: z.string(), port: z.number().optional() }))

export interface HuePutBody {
  on?: { on: boolean }
  dimming?: { brightness: number }
  color_temperature?: { mirek: number }
  color?: { xy: { x: number; y: number } }
  dynamics?: { duration: number }
}
