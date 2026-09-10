import { z } from 'zod'
import { CAMERA_CLASSES, CAPABILITIES, CLIMATE_MODES, COVER_CLASSES, DEVICE_KINDS, KIND_CAPABILITIES, MEDIA_PLAYER_CLASSES, SENSOR_CLASSES, STREAM_PROTOCOLS } from './kinds'

// Identité d'un appareil : `${pluginId}:${externalId}`. Une seule chaîne sert de clé de Map,
// de segment d'URL, de champ WS et de nom de nœud 3D — jamais de couple à joindre côté client.
export const PLUGIN_ID_RE = /^[a-z0-9_]+$/
export const DEVICE_ID_RE = /^[a-z0-9_]+:[^:\s]+$/

export const pluginIdSchema = z.string().regex(PLUGIN_ID_RE, 'pluginId: [a-z0-9_]+')
export const deviceIdSchema = z.string().regex(DEVICE_ID_RE, 'deviceId: <pluginId>:<externalId>')
export type DeviceId = z.infer<typeof deviceIdSchema>

export const deviceMetaSchema = z.object({
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  /** Pièce côté fabricant (ex. room Hue) — informatif, la maison JSON fait foi. */
  room: z.string().optional(),
  isGroup: z.boolean().optional(),
  /** Plage [min, max] en mirek supportée par la lampe. */
  colorTempMirek: z.tuple([z.number(), z.number()]).optional(),
  /** Effets proposés par le fabricant, `no_effect` en premier (capacité `effect`). */
  effects: z.array(z.string()).optional(),
  /** Plage [min, max] de consigne en °C. */
  targetTempC: z.tuple([z.number(), z.number()]).optional(),
  /**
   * Modes que l'appareil DÉCLARE (capacité `hvac_mode`) : un thermostat qui ne chauffe que ne
   * doit pas se voir proposer « Refroidir ». Absent = tous les `CLIMATE_MODES` (cas de la simulation).
   */
  climate: z.object({ modes: z.array(z.enum(CLIMATE_MODES)) }).optional(),
  sensor: z.object({
    unit: z.string(),
    deviceClass: z.enum(SENSOR_CLASSES),
    precision: z.number().int().min(0).max(6).optional(),
  }).optional(),
  /** Nature de l'ouvrant (volet, store, portail…) : décide du vocabulaire affiché. */
  cover: z.object({ deviceClass: z.enum(COVER_CLASSES) }).optional(),
  /** Nature de la caméra et protocoles de flux déclarés par le fabricant (capacité `live_stream`). */
  camera: z.object({
    deviceClass: z.enum(CAMERA_CLASSES),
    protocols: z.array(z.enum(STREAM_PROTOCOLS)).optional(),
  }).optional(),
  /** Nature du lecteur (enceinte, téléviseur, écran connecté) : décide l'icône et le marqueur 3D. Absent = enceinte. */
  mediaPlayer: z.object({ deviceClass: z.enum(MEDIA_PLAYER_CLASSES) }).optional(),
  /**
   * Le plugin RETIENT cet appareil même absent du réseau (un Cast éteint ne s'annonce plus, et son
   * entrée dans la maison perdrait son nom et son état). L'UI peut donc proposer de l'oublier —
   * `DELETE /api/plugins/<plugin>/devices/<externalId>` par convention. Absent = la liste du plugin
   * fait foi, il n'y a rien à oublier.
   */
  forgettable: z.boolean().optional(),
})
export type DeviceMeta = z.infer<typeof deviceMetaSchema>

export const deviceDescriptorSchema = z.object({
  id: deviceIdSchema,
  pluginId: pluginIdSchema,
  externalId: z.string().min(1),
  kind: z.enum(DEVICE_KINDS),
  name: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITIES)),
  meta: deviceMetaSchema.default({}),
}).superRefine((d, ctx) => {
  if (d.id !== `${d.pluginId}:${d.externalId}`) {
    ctx.addIssue({ code: 'custom', path: ['id'], message: 'id must equal `${pluginId}:${externalId}`' })
  }
  const allowed = KIND_CAPABILITIES[d.kind]
  for (const c of d.capabilities) {
    if (!allowed.includes(c)) {
      ctx.addIssue({ code: 'custom', path: ['capabilities'], message: `capability "${c}" not allowed for kind "${d.kind}"` })
    }
  }
})
export type DeviceDescriptor = z.infer<typeof deviceDescriptorSchema>
