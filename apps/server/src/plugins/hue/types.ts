import { z } from 'zod'

// CLIP v2 shapes (https://<bridge>/clip/v2). DELIBERATELY loose schemas (`looseObject`):
// the bridge adds fields with every firmware, we only read what we need.

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
  /** "Light" effects (candle, fire, cosmos…). `effect_values` lists what the model can do. */
  effects: z.looseObject({
    status: z.string().optional(),
    effect_values: z.array(z.string()).optional(),
    status_values: z.array(z.string()).optional(),
  }).optional(),
  /** Same information in the bridge's recent format (firmware ≥ 1.72). */
  effects_v2: z.looseObject({
    status: z.looseObject({ effect: z.string().optional(), effect_values: z.array(z.string()).optional() }).optional(),
  }).optional(),
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

const hueXySchema = z.object({ x: z.number(), y: z.number() })
const hueMirekSchema = z.looseObject({ mirek: z.number().nullable().optional() })

/**
 * Scene: `actions` carries the fixed values per light, `palette` the colors the bridge cycles in
 * dynamic mode, `status.active` says which one is running (`static` | `dynamic_palette`).
 * `group` points to a `room` OR a `zone` (a zone spans several rooms).
 */
export const hueSceneSchema = z.looseObject({
  id: z.string(),
  metadata: z.looseObject({ name: z.string().optional() }).optional(),
  group: hueRefSchema.optional(),
  actions: z.array(z.looseObject({
    target: hueRefSchema.optional(),
    action: z.looseObject({
      on: z.object({ on: z.boolean() }).optional(),
      dimming: z.looseObject({ brightness: z.number() }).optional(),
      color: z.looseObject({ xy: hueXySchema.optional() }).optional(),
      color_temperature: hueMirekSchema.optional(),
    }).optional(),
  })).default([]),
  palette: z.looseObject({
    color: z.array(z.looseObject({ color: z.looseObject({ xy: hueXySchema.optional() }).optional() })).default([]),
    color_temperature: z.array(z.looseObject({ color_temperature: hueMirekSchema.optional() })).default([]),
    dimming: z.array(z.looseObject({})).default([]),
    /** `effects` and `effects_v2` are MUTUALLY EXCLUSIVE, even empty (the bridge refuses both). */
    effects: z.array(z.looseObject({})).default([]),
    effects_v2: z.array(z.looseObject({})).default([]),
  }).optional(),
  status: z.looseObject({ active: z.string().optional() }).optional(),
  /** Set in the Hue app: does the scene start animated? */
  auto_dynamic: z.boolean().optional(),
})
export type HueScene = z.infer<typeof hueSceneSchema>

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

/** Frame of the /eventstream/clip/v2 stream: an array of events, each carrying partial resources. */
export const hueEventItemSchema = z.looseObject({ id: z.string(), type: z.string() })
export const hueEventSchema = z.looseObject({
  creationtime: z.string().optional(),
  id: z.string().optional(),
  type: z.enum(['update', 'add', 'delete', 'error']),
  data: z.array(hueEventItemSchema).default([]),
})
export const hueEventFrameSchema = z.array(hueEventSchema)
export type HueEvent = z.infer<typeof hueEventSchema>

/** Response of POST /api (pairing, API v1). */
export const huePairResponseSchema = z.array(z.looseObject({
  success: z.looseObject({ username: z.string(), clientkey: z.string().optional() }).optional(),
  error: z.looseObject({ type: z.number(), description: z.string().optional() }).optional(),
}))

/** Response of https://discovery.meethue.com/ */
export const hueDiscoverySchema = z.array(z.looseObject({ id: z.string(), internalipaddress: z.string(), port: z.number().optional() }))

export interface HuePutBody {
  on?: { on: boolean }
  dimming?: { brightness: number }
  color_temperature?: { mirek: number }
  color?: { xy: { x: number; y: number } }
  effects?: { effect: string }
  dynamics?: { duration: number }
}

/**
 * PUT body on a scene. `static` applies the fixed values WITHOUT animating, `dynamic_palette`
 * animates. We do NOT use `active`: it starts the animation when the scene carries `auto_dynamic`,
 * so Kasbah's two modes would be indistinguishable on those scenes.
 */
export interface HueSceneRecallBody {
  recall: {
    action: 'static' | 'dynamic_palette'
    duration?: number
    dimming?: { brightness: number }
  }
}

/** Write of a scene setting (not a recall): the Hue app's "start animated" checkbox. */
export interface HueSceneSettingsBody {
  auto_dynamic: boolean
}

/** Body of the scene creation POST (metadata + group + values per light + palette). */
export interface HueSceneCreateBody {
  metadata: { name: string }
  group: HueRef
  actions: Array<{ target: HueRef; action: Record<string, unknown> }>
  palette?: Record<string, unknown>
}

export type HueWriteBody = HuePutBody | HueSceneRecallBody | HueSceneSettingsBody
