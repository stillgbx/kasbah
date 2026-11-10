import { z } from 'zod'
import { commandSchema } from '../devices/command'
import { deviceIdSchema } from '../devices/descriptor'
import { DEVICE_EVENT_KINDS } from '../devices/events'
import { DEVICE_KINDS } from '../devices/kinds'
import { SCENE_RECALL_MODES, sceneIdSchema } from '../scenes/scene'
import { daysSchema, deviceClassSchema, hhmmSchema, isoDateSchema, predicateSchema } from './predicate'

// An automation is a FLAT rule: a trigger ("When"), blockers ("Unless"),
// actions ("Then"). No graph, no branch: the real examples of the house all fit in it,
// and the editor stays a form that can be done with a finger.
//
// It lives in one file PER HOUSE (`<house>.automations.json`, see the server), it is
// run by the server (the screen sleeps), and it only knows the contract: no plugin has
// anything to implement for its devices to be automated.

export const SUN_EVENTS = ['dawn', 'sunrise', 'sunset', 'dusk'] as const
export type SunEvent = (typeof SUN_EVENTS)[number]

/**
 * TIME trigger: a fixed hour, or a shifted sun event ("15 min before
 * dusk"). The `notBefore` / `notAfter` bounds are read the SAME day and bring the computed hour
 * back inside them: "at sunset, but never after 22:00".
 */
export const timeTriggerSchema = z.object({
  type: z.literal('time'),
  at: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('clock'), time: hhmmSchema }),
    z.object({
      kind: z.literal('sun'), event: z.enum(SUN_EVENTS),
      /** Minutes, negative = before. */
      offsetMin: z.number().int().min(-720).max(720).optional(),
      notBefore: hhmmSchema.optional(),
      notAfter: hhmmSchema.optional(),
    }),
  ]),
  /** Absent = every day. */
  days: daysSchema.optional(),
  /** Absent = all year. Bounds included. */
  dateRange: z.object({ from: isoDateSchema, to: isoDateSchema }).optional(),
})
export type TimeTrigger = z.infer<typeof timeTriggerSchema>

/**
 * STATE trigger: a predicate that BECOMES true (rising edge). `forMin` requires it to stay so for
 * that many minutes ("production exceeds consumption for 10 min"). A time constraint
 * has no place here — it would only be re-evaluated at the next device change: it goes in
 * `unless`.
 */
export const stateTriggerSchema = z.object({
  type: z.literal('state'),
  when: predicateSchema,
  forMin: z.number().int().positive().max(1440).optional(),
})
export type StateTrigger = z.infer<typeof stateTriggerSchema>

/**
 * EVENT trigger: a transient event of a device (a doorbell ring). `cooldownMin` ignores the next
 * events of this automation for that many minutes after a run (a burst of rings acts once); kept in
 * memory only, a restart clears it. A run skipped by "Unless" does not start it.
 */
export const eventTriggerSchema = z.object({
  type: z.literal('event'),
  deviceId: deviceIdSchema,
  event: z.enum(DEVICE_EVENT_KINDS),
  cooldownMin: z.number().int().min(1).max(1440).optional(),
})
export type EventTrigger = z.infer<typeof eventTriggerSchema>

// Iteration 2, described here so that the shape makes room for it (NOT implemented):
//   { type: 'forecast', deviceId, field: 'precipProbability' | 'windKmh', op, value, horizonH }
export const triggerSchema = z.discriminatedUnion('type', [timeTriggerSchema, stateTriggerSchema, eventTriggerSchema])
export type Trigger = z.infer<typeof triggerSchema>

/**
 * TARGET of a command: named devices, or a SELECTION resolved at the moment of acting ("all the
 * shutters of the ground floor") — a light added tomorrow joins it without rewriting anything. No room,
 * no level, no zone = the whole house. `exceptRoomsWith` leaves out the devices whose room
 * contains an ACTIVE device of this kind: "all the lights, except where the TV is on".
 */
export const targetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('devices'), deviceIds: z.array(deviceIdSchema).min(1).max(50) }),
  z.object({
    type: z.literal('selector'),
    kind: z.enum(DEVICE_KINDS),
    deviceClass: deviceClassSchema.optional(),
    roomIds: z.array(z.string().min(1)).optional(),
    levelIds: z.array(z.string().min(1)).optional(),
    zoneIds: z.array(z.string().min(1)).optional(),
    exceptRoomsWith: z.object({ kind: z.enum(DEVICE_KINDS), deviceClass: deviceClassSchema.optional() }).optional(),
  }),
])
export type Target = z.infer<typeof targetSchema>

/** Colors of the "flash" action: a short palette, the server turns it into the light's color. */
export const FLASH_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white'] as const
export type FlashColor = (typeof FLASH_COLORS)[number]
/** Speeds of the "flash" action; the server sets the rhythm (`FLASH_PERIOD_MS`, server side). */
export const FLASH_SPEEDS = ['slow', 'normal', 'fast'] as const
export type FlashSpeed = (typeof FLASH_SPEEDS)[number]
export const FLASH_DURATION_S = { min: 2, max: 300, default: 10 } as const

/** Recall of a vendor light scene, WRITTEN mode (not the default of `sceneRecallSchema`). */
export const automationRecallSchema = z.object({
  mode: z.enum(SCENE_RECALL_MODES),
  brightness: z.number().min(0).max(100).optional(),
  transitionMs: z.number().int().min(0).optional(),
})

/**
 * Makes lights FLASH, run by the server whatever the brand (on and off at full brightness, in
 * `color` if given and the light has colors), then puts each one back as it was. To be seen from
 * afar or by someone who does not hear the doorbell. Devices that are not lights are refused.
 */
export const flashActionSchema = z.object({
  type: z.literal('flash'),
  target: targetSchema,
  color: z.enum(FLASH_COLORS).optional(),
  durationS: z.number().int().min(FLASH_DURATION_S.min).max(FLASH_DURATION_S.max).default(FLASH_DURATION_S.default),
  speed: z.enum(FLASH_SPEEDS).default('normal'),
})
export type FlashAction = z.infer<typeof flashActionSchema>
export type FlashActionInput = z.input<typeof flashActionSchema>
/** "Try" of a flash from the editor (`POST /api/automations/flash-test`): this long at most. */
export const FLASH_TEST_MAX_S = 5

export const actionSchema = z.discriminatedUnion('type', [
  /**
   * A command of the contract, verified device by device as from the interface. `forMin`:
   * "for N minutes" — at the end, the INVERSE command is sent to the devices that acknowledged
   * (`inverseCommand`); ignored for a command that has none.
   */
  z.object({ type: z.literal('command'), target: targetSchema, command: commandSchema, forMin: z.number().int().positive().max(1440).optional() }),
  z.object({ type: z.literal('recallScene'), sceneId: sceneIdSchema, recall: automationRecallSchema }),
  /**
   * A push notification to the screens subscribed to the `automations` category, titled with the
   * automation's name.
   */
  z.object({ type: z.literal('notify'), message: z.string().trim().min(1).max(200) }),
  flashActionSchema,
  // Iteration 2: { type: 'system.run', name } (allowlist from the .env); { type: 'webhook', url }
])
export type AutomationAction = z.infer<typeof actionSchema>

export const AUTOMATION_ID_RE = /^[a-z0-9_.-]{1,64}$/i
export const automationIdSchema = z.string().regex(AUTOMATION_ID_RE, 'id : [a-z0-9_.-], 64 car. au plus')

export const automationSchema = z.object({
  id: automationIdSchema,
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  trigger: triggerSchema,
  /** "Unless": the automation does NOTHING if one of them is true. */
  unless: z.array(predicateSchema).max(20),
  actions: z.array(actionSchema).min(1).max(20),
  /** Set by the server on every write. */
  updatedAt: z.number().int().optional(),
  /**
   * Set by the server: the last write comes from an assistant (MCP), on behalf of `user` (absent =
   * the house). The app shows it as "to review"; a write from the app clears it.
   */
  byAssistant: z.object({ user: z.string().optional(), at: z.number().int() }).optional(),
})
export type Automation = z.infer<typeof automationSchema>

/** Body of a `PUT /api/automations/:id`: the id comes from the URL, `updatedAt` and `byAssistant` from the server. */
export const automationBodySchema = automationSchema.omit({ id: true, updatedAt: true, byAssistant: true })
export type AutomationBody = z.input<typeof automationBodySchema>

/** Body of a `PATCH`: written by hand (a `.partial()` would reinject zod 4's defaults). */
export const automationPatchSchema = z.object({ enabled: z.boolean() })

/** Body of a `PUT /api/automation-order`: the order of the list, that of the file. */
export const automationOrderSchema = z.object({ ids: z.array(automationIdSchema).max(1000) })

/** The file on disk. */
export const automationsFileSchema = z.object({ schemaVersion: z.literal(1), automations: z.array(automationSchema) })
export type AutomationsFile = z.infer<typeof automationsFileSchema>

// ── Status, computed by the server and pushed to the interface ────────────────────────────────

export const AUTOMATION_HEALTHS = ['ok', 'incomplete', 'unavailable'] as const
export type AutomationHealth = (typeof AUTOMATION_HEALTHS)[number]

/** `skipped`: triggered, but an "unless" held. */
export const RUN_OUTCOMES = ['ok', 'partial', 'failed', 'skipped'] as const
export type RunOutcome = (typeof RUN_OUTCOMES)[number]

export const automationRunSchema = z.object({
  at: z.number().int(),
  by: z.enum(['time', 'state', 'event', 'manual']),
  outcome: z.enum(RUN_OUTCOMES),
  errors: z.array(z.object({
    /** Rank of the action in the list. */
    action: z.number().int().min(0),
    deviceId: deviceIdSchema.optional(),
    code: z.string(),
    message: z.string(),
  })),
})
export type AutomationRun = z.infer<typeof automationRunSchema>

export const MISSING_REF_KINDS = ['device', 'field', 'scene', 'room', 'level', 'zone', 'parking'] as const

export const automationStatusSchema = z.object({
  /** `incomplete`: a reference is missing; `unavailable`: a referenced device does not respond. */
  health: z.enum(AUTOMATION_HEALTHS),
  /** What does not exist RIGHT NOW (plugin off, room deleted, field unknown to the kind…). */
  missing: z.array(z.object({ kind: z.enum(MISSING_REF_KINDS), id: z.string() })),
  unavailableDeviceIds: z.array(deviceIdSchema),
  lastRun: automationRunSchema.optional(),
  /** Active time trigger: next planned hour. */
  nextRunAt: z.number().int().optional(),
  /** State trigger with `forMin`: the condition has held since. */
  pendingSince: z.number().int().optional(),
})
export type AutomationStatus = z.infer<typeof automationStatusSchema>

export const automationEntrySchema = z.object({ automation: automationSchema, status: automationStatusSchema })
export type AutomationEntry = z.infer<typeof automationEntrySchema>
