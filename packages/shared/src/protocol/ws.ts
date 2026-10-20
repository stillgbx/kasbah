import { z } from 'zod'
import { deviceDescriptorSchema, deviceIdSchema } from '../devices/descriptor'
import { deviceStateSchema } from '../devices/state'
import { houseSchema } from '../house/schema'
import { pluginSceneEntrySchema, pluginSceneStateSchema, sceneIdSchema } from '../scenes/scene'
import { automationEntrySchema } from '../automations/automation'
import { shoppingListSchema } from '../shopping/shopping'

// Server → client WebSocket protocol. States are sent WHOLE (not patches):
// idempotent messages, no merging on the client side, reconnection = "receive a snapshot".

export const deviceEntrySchema = z.object({ descriptor: deviceDescriptorSchema, state: deviceStateSchema })
export type DeviceEntry = z.infer<typeof deviceEntrySchema>

/**
 * TRANSIENT event of a device (not a state): doorbell ring, motion… Arrives through Pub/Sub
 * at Nest. The client reacts on the spot (frame the room, open the live view); nothing is kept.
 */
export const DEVICE_EVENT_KINDS = ['chime', 'motion', 'person', 'sound'] as const
export type DeviceEventKind = (typeof DEVICE_EVENT_KINDS)[number]

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'), serverTime: z.number(), devices: z.array(deviceEntrySchema),
    /** Vendor scenes; absent from a server that does not expose any. */
    scenes: z.array(pluginSceneEntrySchema).default([]),
    /** Automations of the house and their status; absent from a server that has none. */
    automations: z.array(automationEntrySchema).default([]),
    /** Shopping list of the house; absent from a server that has none (the screen keeps its own). */
    shopping: shoppingListSchema.optional(),
    /**
     * Property the server keeps alive (`house.id`). A screen that reconnects and finds it
     * changed (another screen switched demo property) reloads everything rather than mixing two houses.
     */
    propertyId: z.string().optional(),
    /**
     * Identifier of the web build the server serves (`build-id.txt` of the static folder); absent without
     * a build. A screen that does not carry the same one offers to reload: its lazy views no longer exist.
     */
    appBuild: z.string().optional(),
  }),
  z.object({ type: z.literal('state'), deviceId: deviceIdSchema, state: deviceStateSchema }),
  z.object({ type: z.literal('availability'), deviceIds: z.array(deviceIdSchema), available: z.boolean() }),
  z.object({ type: z.literal('devices'), devices: z.array(deviceEntrySchema) }),
  /** List of the scenes of a vendor (discovery, add/removal on the bridge side). */
  z.object({ type: z.literal('scenes'), scenes: z.array(pluginSceneEntrySchema) }),
  z.object({ type: z.literal('scene'), sceneId: sceneIdSchema, state: pluginSceneStateSchema }),
  /** The house has been rewritten (placement of a device from a screen). */
  z.object({ type: z.literal('house'), house: houseSchema }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  /** WHOLE list of the automations and their status, at every change (write, run, device gone). */
  z.object({ type: z.literal('automations'), automations: z.array(automationEntrySchema) }),
  /** WHOLE shopping list, at every write (it is small: no patch). */
  z.object({ type: z.literal('shopping'), shopping: shoppingListSchema }),
  /** A device has just reported an event (doorbell, motion); `at` = server clock. */
  z.object({ type: z.literal('deviceEvent'), deviceId: deviceIdSchema, event: z.enum(DEVICE_EVENT_KINDS), at: z.number() }),
])
export type ServerMessage = z.infer<typeof serverMessageSchema>

/** Reserved: the client sends nothing in v1 (commands go through REST). */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), clientId: z.string() }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>
