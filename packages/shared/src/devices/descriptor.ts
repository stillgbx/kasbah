import { z } from 'zod'
import { CAMERA_CLASSES, CAPABILITIES, CLIMATE_CLASSES, CLIMATE_MODES, COVER_CLASSES, DEVICE_KINDS, KIND_CAPABILITIES, MEDIA_PLAYER_CLASSES, SENSOR_CLASSES, STREAM_PROTOCOLS, VEHICLE_FINISHES } from './kinds'

// Identité d'un appareil : `${pluginId}:${externalId}`. Une seule chaîne sert de clé de Map,
// de segment d'URL, de champ WS et de nom de nœud 3D — jamais de couple à joindre côté client.
export const PLUGIN_ID_RE = /^[a-z0-9_]+$/
export const DEVICE_ID_RE = /^[a-z0-9_]+:[^:\s]+$/

export const pluginIdSchema = z.string().regex(PLUGIN_ID_RE, 'pluginId: [a-z0-9_]+')
export const deviceIdSchema = z.string().regex(DEVICE_ID_RE, 'deviceId: <pluginId>:<externalId>')
export type DeviceId = z.infer<typeof deviceIdSchema>

/** Couleur `#rrggbb`, la forme que produisent et attendent `rgbToHex` / `hexToRgb`. */
export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'couleur: #rrggbb')

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
  climate: z.object({
    modes: z.array(z.enum(CLIMATE_MODES)),
    /**
     * SUR QUOI la zone se règle, quand ce n'est pas l'air de la pièce. Une pompe à chaleur air-eau
     * pilote certaines zones sur la température de l'EAU DE DÉPART (loi d'eau) : la consigne y vaut
     * 45 °C et le « mesuré » est celui du circuit, pas d'un salon. Les afficher sous le vocabulaire
     * d'un thermostat d'ambiance ferait lire 45 °C comme une consigne de pièce.
     *
     * `room` (défaut, absent = celui-ci) : ambiante, le cas de tout thermostat.
     * `flow` : température de départ du circuit.
     *
     * Ne change RIEN à la forme de l'état — `currentTempC` et `targetTempC` restent les deux mêmes
     * champs ; ce champ dit seulement de quoi ils parlent, donc comment les nommer.
     */
    control: z.enum(['room', 'flow']).optional(),
    /**
     * Ce que l'appareil EST physiquement : un thermostat au mur, ou une pompe à chaleur au sol.
     * Décide le marqueur 3D et rien d'autre. Absent = `thermostat`.
     */
    deviceClass: z.enum(CLIMATE_CLASSES).optional(),
  }).optional(),
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
   * Ce que le fabricant laisse deviner de la CARROSSERIE. `color` : la teinte réelle du véhicule,
   * quand le relevé permet de la déduire — Renault l'encode dans la référence de sa configuration,
   * Tesla la nomme dans `vehicle_config`. `finish` : l'aspect de la peinture, que Tesla laisse
   * choisir depuis l'écran de bord. Absents = on n'a rien trouvé, et ce n'est pas une panne : la
   * plupart des plugins ne disent rien de la peinture.
   *
   * C'est un DÉFAUT, jamais une vérité : le réglage manuel de la maison (`HouseDevice.bodyColor`)
   * l'emporte toujours, parce qu'un covering, une repeinte ou simplement un goût le contredisent.
   */
  vehicle: z.object({ color: hexColorSchema.optional(), finish: z.enum(VEHICLE_FINISHES).optional() }).optional(),
  /**
   * Le plugin RETIENT cet appareil même absent du réseau (un Cast éteint ne s'annonce plus, et son
   * entrée dans la maison perdrait son nom et son état). L'UI peut donc proposer de l'oublier —
   * `DELETE /api/plugins/<plugin>/devices/<externalId>` par convention. Absent = la liste du plugin
   * fait foi, il n'y a rien à oublier.
   */
  forgettable: z.boolean().optional(),
  /**
   * D'où vient la météo (kind `weather`). `attribution` est OBLIGATOIRE : les données libres
   * (Open-Meteo, CC BY 4.0) exigent d'être créditées, et c'est l'UI qui l'affiche — le plugin ne
   * fait que le dire. `model` : le modèle numérique derrière les chiffres (« AROME France HD »).
   */
  weather: z.object({ attribution: z.string().min(1), model: z.string().optional() }).optional(),
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
