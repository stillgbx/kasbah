import { z } from 'zod'

// Formes des réponses de l'Automower Connect API (Husqvarna). On ne déclare que ce qu'on lit, en
// `z.looseObject`, avec des types LARGES sur le reste (leçon TaHoma : contraindre un champ inutile
// suffit à faire échouer toute la réponse). Les fixtures de `__fixtures__/automower.ts` sont
// écrites d'après la documentation et la bibliothèque de référence (aioautomower) ; elles sont à
// REMPLACER par une capture réelle (`GET /api/plugins/automower/raw`) dès les clés posées.

const num = z.number().nullable().optional()
const str = z.string().nullable().optional()
const bool = z.boolean().nullable().optional()

/** `POST /v1/oauth2/token` (Authentication API). `expires_in` en secondes. */
export const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number(),
  token_type: str,
  provider: str,
  scope: str,
  user_id: str,
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

/** Un point du relevé GPS : la liste `positions` en porte une cinquantaine, le plus récent en tête. */
export const positionSchema = z.looseObject({ latitude: z.number(), longitude: z.number() })

/**
 * Ce que le fabricant dit du robot lui-même. Les énumérations sont en MAJUSCULES chez lui
 * (`MOWING`, `PARKED_IN_CS`, `RESTRICTED`…) ; le mappage les lit en minuscules pour ne pas dépendre
 * de la casse, que la documentation et la bibliothèque de référence n'écrivent pas pareil.
 */
export const mowerSectionSchema = z.looseObject({
  mode: str,
  activity: str,
  state: str,
  inactiveReason: str,
  errorCode: num,
  /** Horodatage LOCAL du robot, écrit comme s'il était UTC (voir `mapping.ts`). 0 = pas d'erreur. */
  errorCodeTimestamp: num,
  isErrorConfirmable: bool,
  workAreaId: num,
})
export const plannerSchema = z.looseObject({
  /** Même convention locale ; 0 = « maintenant » (le robot devrait partir). */
  nextStartTimestamp: num,
  override: z.looseObject({ action: str }).nullable().optional(),
  restrictedReason: str,
  externalReason: str,
})
export const statisticsSchema = z.looseObject({
  cuttingBladeUsageTime: num,
  downTime: num,
  numberOfChargingCycles: num,
  numberOfCollisions: num,
  totalChargingTime: num,
  totalCuttingTime: num,
  totalDriveDistance: num,
  totalRunningTime: num,
  totalSearchingTime: num,
  upTime: num,
})

/** Une entrée de `GET /v1/mowers` (`data[]`), enveloppe JSON:API. */
export const mowerDataSchema = z.looseObject({
  type: str,
  id: z.string().min(1),
  attributes: z.looseObject({
    system: z.looseObject({ name: str, model: str, serialNumber: z.union([z.string(), z.number()]).nullable().optional() }).nullable().optional(),
    battery: z.looseObject({ batteryPercent: num }).nullable().optional(),
    capabilities: z.looseObject({ position: bool, headlights: bool, workAreas: bool, stayOutZones: bool, canConfirmError: bool }).nullable().optional(),
    mower: mowerSectionSchema.nullable().optional(),
    planner: plannerSchema.nullable().optional(),
    /** `connected` : le robot parle au cloud ; `statusTimestamp` : dernier statut reçu, en UTC (ms). */
    metadata: z.looseObject({ connected: bool, statusTimestamp: num }).nullable().optional(),
    positions: z.array(z.unknown()).nullable().optional(),
    settings: z.looseObject({ cuttingHeight: num, headlight: z.unknown().optional() }).nullable().optional(),
    statistics: statisticsSchema.nullable().optional(),
    /** Toujours au moins la zone `0` (tout le terrain, sans nom) chez un robot qui gère les zones. */
    workAreas: z.array(z.unknown()).nullable().optional(),
    /** ABSENT tant qu'aucune zone n'est tracée (relevé du 2026-10-12) ; `dirty` = carte en cours de synchronisation. */
    stayOutZones: z.looseObject({ dirty: bool, zones: z.array(z.unknown()).nullable().optional() }).nullable().optional(),
  }),
})

/** Une zone de travail de `workAreas[]` ; `cuttingHeight` en POUR CENT, pas sur l'échelle 1-9 des réglages. */
export const workAreaSchema = z.looseObject({ workAreaId: z.number(), name: str, enabled: bool, cuttingHeight: num })
/** Une zone d'exclusion de `stayOutZones.zones[]`, identifiée par un UUID. */
export const stayOutZoneSchema = z.looseObject({ id: z.string().min(1), name: str, enabled: bool })
export type MowerData = z.infer<typeof mowerDataSchema>

export const mowerListSchema = z.looseObject({ data: z.array(z.unknown()) })

/**
 * Une ligne du journal (`GET /mowers/{id}/messages`, `data.attributes.messages[]`, et la même forme
 * dans `message-event-v2`). `time` en SECONDES, heure locale écrite comme UTC ; `severity` en
 * majuscules (`ERROR`, `FATAL`, `WARNING` vus) ; une position quasi nulle = pas de fix GPS.
 */
export const messageSchema = z.looseObject({
  time: num,
  code: num,
  severity: str,
  latitude: num,
  longitude: num,
})
export const messagesResponseSchema = z.looseObject({
  data: z.looseObject({ attributes: z.looseObject({ messages: z.array(z.unknown()).nullable().optional() }).nullable().optional() }),
})

/**
 * Un événement du WebSocket (format V2, le seul servi depuis mars 2025) : `{ id, type, attributes }`,
 * le `type` nommant la section qui a changé (`battery-event-v2`, `mower-event-v2`,
 * `planner-event-v2`, `position-event-v2`, `cuttingHeight-event-v2`, `headlights-event-v2`,
 * `calendar-event-v2`, `message-event-v2`). Le premier message de la connexion est à part :
 * `{ ready: true, connectionId }`.
 */
export const wsEventSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).optional(),
})
export type WsEvent = z.infer<typeof wsEventSchema>
export const wsReadySchema = z.looseObject({ ready: z.boolean(), connectionId: str })
