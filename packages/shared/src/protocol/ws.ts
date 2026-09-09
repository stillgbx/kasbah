import { z } from 'zod'
import { deviceDescriptorSchema, deviceIdSchema } from '../devices/descriptor'
import { deviceStateSchema } from '../devices/state'
import { houseSchema } from '../house/schema'
import { pluginSceneEntrySchema, pluginSceneStateSchema, sceneIdSchema } from '../scenes/scene'

// Protocole WebSocket serveur → client. Les états sont envoyés ENTIERS (pas des patchs) :
// messages idempotents, aucune fusion côté client, reconnexion = « recevoir un snapshot ».

export const deviceEntrySchema = z.object({ descriptor: deviceDescriptorSchema, state: deviceStateSchema })
export type DeviceEntry = z.infer<typeof deviceEntrySchema>

/**
 * Événement TRANSITOIRE d'un appareil (pas un état) : coup de sonnette, mouvement… Arrive par Pub/Sub
 * chez Nest. Le client réagit sur le moment (cadrer la pièce, ouvrir le direct) ; rien n'est conservé.
 */
export const DEVICE_EVENT_KINDS = ['chime', 'motion', 'person', 'sound'] as const
export type DeviceEventKind = (typeof DEVICE_EVENT_KINDS)[number]

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'), serverTime: z.number(), devices: z.array(deviceEntrySchema),
    /** Scènes des fabricants ; absent d'un serveur qui n'en expose pas. */
    scenes: z.array(pluginSceneEntrySchema).default([]),
  }),
  z.object({ type: z.literal('state'), deviceId: deviceIdSchema, state: deviceStateSchema }),
  z.object({ type: z.literal('availability'), deviceIds: z.array(deviceIdSchema), available: z.boolean() }),
  z.object({ type: z.literal('devices'), devices: z.array(deviceEntrySchema) }),
  /** Liste des scènes d'un fabricant (découverte, ajout/suppression côté pont). */
  z.object({ type: z.literal('scenes'), scenes: z.array(pluginSceneEntrySchema) }),
  z.object({ type: z.literal('scene'), sceneId: sceneIdSchema, state: pluginSceneStateSchema }),
  /** La maison a été réécrite (placement d'un appareil depuis une tablette). */
  z.object({ type: z.literal('house'), house: houseSchema }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  /** Un appareil vient de signaler un événement (sonnette, mouvement) ; `at` = horloge serveur. */
  z.object({ type: z.literal('deviceEvent'), deviceId: deviceIdSchema, event: z.enum(DEVICE_EVENT_KINDS), at: z.number() }),
])
export type ServerMessage = z.infer<typeof serverMessageSchema>

/** Réservé : le client n'envoie rien en v1 (les commandes passent en REST). */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), clientId: z.string() }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>
