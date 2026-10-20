import { z } from 'zod'

// Response shapes of the Automower Connect API (Husqvarna). We only declare what we read, as
// `z.looseObject`, with BROAD types on the rest (TaHoma lesson: constraining a useless field is
// enough to make the whole response fail). The fixtures in `__fixtures__/automower.ts` are written
// from the documentation and the reference library (aioautomower); they are to be REPLACED by a
// real capture (`GET /api/plugins/automower/raw`) as soon as the keys are set.

const num = z.number().nullable().optional()
const str = z.string().nullable().optional()
const bool = z.boolean().nullable().optional()

/** `POST /v1/oauth2/token` (Authentication API). `expires_in` in seconds. */
export const tokenResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  expires_in: z.number(),
  token_type: str,
  provider: str,
  scope: str,
  user_id: str,
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

/** One point of the GPS trail: the `positions` list carries about fifty, the most recent first. */
export const positionSchema = z.looseObject({ latitude: z.number(), longitude: z.number() })

/**
 * What the vendor says about the robot itself. Its enums are in CAPITALS (`MOWING`,
 * `PARKED_IN_CS`, `RESTRICTED`…); the mapping reads them lowercased so as not to depend on the
 * case, which the documentation and the reference library do not write the same way.
 */
export const mowerSectionSchema = z.looseObject({
  mode: str,
  activity: str,
  state: str,
  inactiveReason: str,
  errorCode: num,
  /** The robot's LOCAL timestamp, written as if it were UTC (see `mapping.ts`). 0 = no error. */
  errorCodeTimestamp: num,
  isErrorConfirmable: bool,
  workAreaId: num,
})
export const plannerSchema = z.looseObject({
  /** Same local convention; 0 = "now" (the robot should leave). */
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

/** One entry of `GET /v1/mowers` (`data[]`), JSON:API envelope. */
export const mowerDataSchema = z.looseObject({
  type: str,
  id: z.string().min(1),
  attributes: z.looseObject({
    system: z.looseObject({ name: str, model: str, serialNumber: z.union([z.string(), z.number()]).nullable().optional() }).nullable().optional(),
    battery: z.looseObject({ batteryPercent: num }).nullable().optional(),
    capabilities: z.looseObject({ position: bool, headlights: bool, workAreas: bool, stayOutZones: bool, canConfirmError: bool }).nullable().optional(),
    mower: mowerSectionSchema.nullable().optional(),
    planner: plannerSchema.nullable().optional(),
    /** `connected`: the robot talks to the cloud; `statusTimestamp`: last status received, in UTC (ms). */
    metadata: z.looseObject({ connected: bool, statusTimestamp: num }).nullable().optional(),
    positions: z.array(z.unknown()).nullable().optional(),
    settings: z.looseObject({ cuttingHeight: num, headlight: z.unknown().optional() }).nullable().optional(),
    statistics: statisticsSchema.nullable().optional(),
    /** Always at least area `0` (the whole grounds, unnamed) on a robot that handles areas. */
    workAreas: z.array(z.unknown()).nullable().optional(),
    /** ABSENT as long as no zone is drawn (survey of 2026-10-12); `dirty` = map being synchronized. */
    stayOutZones: z.looseObject({ dirty: bool, zones: z.array(z.unknown()).nullable().optional() }).nullable().optional(),
  }),
})

/** A work area of `workAreas[]`; `cuttingHeight` in PERCENT, not on the settings' 1-9 scale. */
export const workAreaSchema = z.looseObject({ workAreaId: z.number(), name: str, enabled: bool, cuttingHeight: num })
/** A stay-out zone of `stayOutZones.zones[]`, identified by a UUID. */
export const stayOutZoneSchema = z.looseObject({ id: z.string().min(1), name: str, enabled: bool })
export type MowerData = z.infer<typeof mowerDataSchema>

export const mowerListSchema = z.looseObject({ data: z.array(z.unknown()) })

/**
 * One log line (`GET /mowers/{id}/messages`, `data.attributes.messages[]`, and the same shape in
 * `message-event-v2`). `time` in SECONDS, local time written as UTC; `severity` in capitals
 * (`ERROR`, `FATAL`, `WARNING` seen); a near-zero position = no GPS fix.
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
 * A WebSocket event (V2 format, the only one served since March 2025): `{ id, type, attributes }`,
 * the `type` naming the section that changed (`battery-event-v2`, `mower-event-v2`,
 * `planner-event-v2`, `position-event-v2`, `cuttingHeight-event-v2`, `headlights-event-v2`,
 * `calendar-event-v2`, `message-event-v2`). The connection's first message stands apart:
 * `{ ready: true, connectionId }`.
 */
export const wsEventSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()).optional(),
})
export type WsEvent = z.infer<typeof wsEventSchema>
export const wsReadySchema = z.looseObject({ ready: z.boolean(), connectionId: str })
