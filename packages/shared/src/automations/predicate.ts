import { z } from 'zod'
import { deviceIdSchema } from '../devices/descriptor'
import { CAMERA_CLASSES, CLIMATE_CLASSES, COVER_CLASSES, DEVICE_KINDS, MEDIA_PLAYER_CLASSES, SENSOR_CLASSES } from '../devices/kinds'

// Predicates of an automation: what is tested to trigger (`state.when`) or to prevent
// (`unless`). Everything is written on the CONTRACT (kinds, state fields, rooms of the house), never on a
// vendor: a plugin that is off removes its devices, and the predicate becomes "unknown" (see the
// `incomplete` status), without anything deleting it.
//
// THREE-valued evaluation, server side: true, false, or unknown (device absent or
// unavailable, optional field absent). Only "true" passes. This is what makes a rising edge
// safe: a restart, a plugin that comes back, a device that reappears trigger nothing.
//
// No `.default()` in this module: the automations file is written as parsed, and zod 4
// does not validate its defaults (pitfall documented in `house/schema.ts`).

export const PREDICATE_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] as const
export type PredicateOp = (typeof PREDICATE_OPS)[number]

/** Local wall-clock time "HH:MM". */
export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure : HH:MM')
/** Local date "YYYY-MM-DD". */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date : AAAA-MM-JJ')
/** Days of the week, 0 = Sunday: convention of `Date.getDay()` (and of `workDays` in mock-sim). */
export const daysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)

/** Kind of a device, all kinds combined (shutter, TV, doorbell, heat pump…). */
export const deviceClassSchema = z.union([
  z.enum(COVER_CLASSES), z.enum(MEDIA_PLAYER_CLASSES), z.enum(CAMERA_CLASSES), z.enum(SENSOR_CLASSES), z.enum(CLIMATE_CLASSES),
])

/** `not` inverts the result; an "unknown" stays unknown. */
const negatable = { not: z.boolean().optional() }

const LEAVES = [
  /**
   * Comparison of a state field. `field` is validated AT RUN TIME against the keys of the kind
   * (`stateKeys`): an unknown field makes the rule `incomplete`, not a refusal to save.
   */
  z.object({
    type: z.literal('device'), deviceId: deviceIdSchema, field: z.string().min(1),
    op: z.enum(PREDICATE_OPS), value: z.union([z.string(), z.number(), z.boolean()]), ...negatable,
  }),
  /** The device is ACTIVE (`isDeviceOn`): light on, player playing, shutter open… */
  z.object({ type: z.literal('deviceOn'), deviceId: deviceIdSchema, ...negatable }),
  /** The vehicle is at home: within `HOME_RADIUS_M` of the origin. */
  z.object({ type: z.literal('vehicleOnSite'), deviceId: deviceIdSchema, ...negatable }),
  /** The vehicle is parked on this spot (snapping rule `assignParkings`, at rest). */
  z.object({ type: z.literal('vehicleParkedAt'), deviceId: deviceIdSchema, parkingId: z.string().min(1), ...negatable }),
  /** At least one device of this kind (and of this nature) is ACTIVE in the room. */
  z.object({ type: z.literal('anyInRoom'), roomId: z.string().min(1), kind: z.enum(DEVICE_KINDS), deviceClass: deviceClassSchema.optional(), ...negatable }),
  /** Local time range; `to` before `from` = the range crosses midnight. */
  z.object({ type: z.literal('timeWindow'), from: hhmmSchema, to: hhmmSchema, ...negatable }),
  z.object({ type: z.literal('days'), days: daysSchema, ...negatable }),
  /** Period, bounds included. */
  z.object({ type: z.literal('dateRange'), from: isoDateSchema, to: isoDateSchema, ...negatable }),
] as const

export const leafPredicateSchema = z.discriminatedUnion('type', [...LEAVES])
export type LeafPredicate = z.infer<typeof leafPredicateSchema>

/** A single level of OR: an `any` group contains only leaves. */
export const anyPredicateSchema = z.object({ type: z.literal('any'), of: z.array(leafPredicateSchema).min(1).max(10), ...negatable })

export const predicateSchema = z.discriminatedUnion('type', [...LEAVES, anyPredicateSchema])
export type Predicate = z.infer<typeof predicateSchema>
export type PredicateType = Predicate['type']
