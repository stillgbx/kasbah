import { z } from 'zod'
import { CLIMATE_MODES, type DeviceKind } from './kinds'

// État courant d'un appareil, discriminé par `kind`. `updatedAt` est posé par le serveur
// (jamais par un plugin) ; `available:false` conserve les dernières valeurs connues
// (l'UI les grise au lieu de les perdre).

const pct = z.number().min(0).max(100)
export const xySchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
export type ColorXY = z.infer<typeof xySchema>

const base = { updatedAt: z.number().int(), available: z.boolean() }

export const lightStateSchema = z.object({
  kind: z.literal('light'), ...base,
  on: z.boolean(),
  brightness: pct.optional(),
  colorTempMirek: z.number().optional(),
  color: xySchema.optional(),
  /** Effet du fabricant en cours (`no_effect` quand aucun) — voir `meta.effects`. */
  effect: z.string().optional(),
})

export const COVER_MOTIONS = ['opening', 'closing', 'stopped'] as const
export const coverStateSchema = z.object({
  kind: z.literal('cover'), ...base,
  /**
   * 0 = fermé, 100 = ouvert. **Absente = position inconnue**, et c'est un cas courant : une radio
   * unidirectionnelle (RTS chez Somfy) ne renvoie jamais où elle en est. Tant qu'aucune commande
   * n'est passée par Kasbah, il n'y a rien à afficher — une valeur par défaut se lirait comme un
   * fait (« Baissé » pour un store en réalité remonté, et un compteur de résumé faux avec lui).
   */
  position: pct.optional(),
  tilt: pct.optional(),
  motion: z.enum(COVER_MOTIONS),
  /**
   * Position favorite MÉMORISÉE DANS LE MOTEUR (le « my » de Somfy), même échelle que `position`.
   * Absente = l'appareil sait y aller mais ne dit pas où elle est — c'est le cas d'une radio
   * unidirectionnelle. La capacité `preset` dit qu'on peut la rappeler ; cette valeur, seulement
   * qu'on peut la montrer. Kasbah ne la programme pas, il la lit.
   */
  presetPosition: pct.optional(),
})

export const PLAYBACKS = ['playing', 'paused', 'idle', 'off'] as const
export const mediaPlayerStateSchema = z.object({
  kind: z.literal('media_player'), ...base,
  playback: z.enum(PLAYBACKS),
  volume: pct,
  muted: z.boolean(),
  nowPlaying: z.object({
    title: z.string(),
    artist: z.string().optional(),
    album: z.string().optional(),
    artUrl: z.string().optional(),
    durationS: z.number().optional(),
    positionS: z.number().optional(),
    source: z.string().optional(),
  }).optional(),
})

export const CLIMATE_ACTIONS = ['heating', 'cooling', 'idle', 'off'] as const
export const climateStateSchema = z.object({
  kind: z.literal('climate'), ...base,
  mode: z.enum(CLIMATE_MODES),
  action: z.enum(CLIMATE_ACTIONS).optional(),
  targetTempC: z.number(),
  currentTempC: z.number(),
  humidity: pct.optional(),
  fanMode: z.string().optional(),
})

export const VACUUM_ACTIVITIES = ['docked', 'cleaning', 'paused', 'returning', 'error'] as const
export const vacuumStateSchema = z.object({
  kind: z.literal('vacuum'), ...base,
  activity: z.enum(VACUUM_ACTIVITIES),
  battery: pct,
  binFull: z.boolean().optional(),
  errorMessage: z.string().optional(),
})

export const MOWER_ACTIVITIES = ['parked', 'mowing', 'charging', 'returning', 'paused', 'error'] as const
export const mowerStateSchema = z.object({
  kind: z.literal('mower'), ...base,
  activity: z.enum(MOWER_ACTIVITIES),
  battery: pct,
  nextStartAt: z.number().optional(),
  errorMessage: z.string().optional(),
  /** Position locale (repère maison, mètres) si le robot la publie. */
  position: z.tuple([z.number(), z.number()]).optional(),
})

export const sensorStateSchema = z.object({
  kind: z.literal('sensor'), ...base,
  value: z.number(),
})

export const energyStateSchema = z.object({
  kind: z.literal('energy'), ...base,
  productionW: z.number(),
  consumptionW: z.number(),
  /** >0 import réseau, <0 export. */
  gridW: z.number(),
  /** >0 charge, <0 décharge. */
  batteryW: z.number().optional(),
  batterySoc: pct.optional(),
  todayProductionWh: z.number().optional(),
  todayConsumptionWh: z.number().optional(),
})

export const CHARGER_STATUSES = ['disconnected', 'connected', 'charging', 'finished', 'error'] as const
export const evChargerStateSchema = z.object({
  kind: z.literal('ev_charger'), ...base,
  status: z.enum(CHARGER_STATUSES),
  powerW: z.number(),
  sessionWh: z.number(),
  maxCurrentA: z.number().optional(),
})

export const vehicleStateSchema = z.object({
  kind: z.literal('vehicle'), ...base,
  soc: pct,
  rangeKm: z.number(),
  pluggedIn: z.boolean(),
  charging: z.boolean(),
  chargePowerW: z.number().optional(),
  chargeLimit: pct.optional(),
  locked: z.boolean(),
  location: z.object({ lat: z.number(), lon: z.number(), at: z.number() }).optional(),
  odometerKm: z.number().optional(),
})

export const deviceStateSchema = z.discriminatedUnion('kind', [
  lightStateSchema, coverStateSchema, mediaPlayerStateSchema, climateStateSchema, vacuumStateSchema,
  mowerStateSchema, sensorStateSchema, energyStateSchema, evChargerStateSchema, vehicleStateSchema,
])
export type DeviceState = z.infer<typeof deviceStateSchema>
export type StateFor<K extends DeviceKind> = Extract<DeviceState, { kind: K }>
/** Patch émis par un plugin : tout est optionnel ; `kind`/`updatedAt` ne se patchent pas (distributif sur K). */
/**
 * Modification partielle d'un état, côté serveur uniquement (le client reçoit toujours l'état
 * entier). `undefined` = « je ne parle pas de ce champ » ; **`null` = « efface ce champ »**, et
 * n'est accepté que sur un champ déjà optionnel — c'est le seul moyen de repasser une valeur à
 * « inconnue ». Un plugin en a besoin : rappeler la position favorite d'un moteur unidirectionnel
 * le déplace vers une position qu'on ne connaît pas, donc celle qu'on affichait devient fausse.
 */
export type StatePatch<K extends DeviceKind = DeviceKind> = K extends DeviceKind
  ? { [P in keyof Omit<StateFor<K>, 'kind' | 'updatedAt'>]?: undefined extends StateFor<K>[P] ? StateFor<K>[P] | null : StateFor<K>[P] }
  : never

const STATE_KEYS = new Map<DeviceKind, ReadonlySet<string>>(
  deviceStateSchema.options.map((o) => [o.shape.kind.value as DeviceKind, new Set(Object.keys(o.shape))]),
)
/** Clés légales de l'état d'un kind (pour rejeter un patch qui ne le concerne pas). */
export function stateKeys(kind: DeviceKind): ReadonlySet<string> {
  return STATE_KEYS.get(kind) ?? new Set()
}
