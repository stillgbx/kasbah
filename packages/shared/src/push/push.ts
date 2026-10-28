import { z } from 'zod'
import type { DeviceKind } from '../devices/kinds'

// Push notifications (Web Push): the server sends the alerts of the house and the "Notify" action
// of the automations to the phones and browsers that subscribed. Each subscription picks its
// CATEGORIES; the server decides which category a message belongs to.

export const NOTIFY_CATEGORIES = ['vehicles', 'robots', 'pets', 'weather', 'plugins', 'automations'] as const
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number]

/** The category of a device's alerts (`deviceAlerts`); absent = its alerts are never pushed. */
export const NOTIFY_CATEGORY_OF_KIND: Partial<Record<DeviceKind, NotifyCategory>> = {
  vehicle: 'vehicles', mower: 'robots', vacuum: 'robots', weather: 'weather', pet_feeder: 'pets', pet_fountain: 'pets',
}

/** Languages of the texts the server writes; the subscription says which one its screen reads. */
export const PUSH_LANGS = ['fr', 'en'] as const
export type PushLang = (typeof PUSH_LANGS)[number]

const base64url = z.string().regex(/^[A-Za-z0-9_-]+=*$/)

/** `PushSubscription.toJSON()` of the browser, what the server needs of it. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).regex(/^https:\/\//, 'https endpoint expected'),
  keys: z.object({ p256dh: base64url.max(200), auth: base64url.max(100) }),
})
export type PushSubscriptionJson = z.infer<typeof pushSubscriptionSchema>

/** Body of a `PUT /api/push/subscription`: subscribes this screen, or changes its categories. */
export const pushSubscribeBodySchema = z.object({
  subscription: pushSubscriptionSchema,
  categories: z.array(z.enum(NOTIFY_CATEGORIES)).max(NOTIFY_CATEGORIES.length),
  lang: z.enum(PUSH_LANGS),
})
export type PushSubscribeBody = z.infer<typeof pushSubscribeBodySchema>

/** Body of a `DELETE /api/push/subscription` and of a `POST /api/push/test`. */
export const pushEndpointBodySchema = z.object({ endpoint: pushSubscriptionSchema.shape.endpoint })

/** What the service worker receives and shows. `tag`: a message with the same tag replaces the previous one. */
export interface PushMessage {
  title: string
  body: string
  tag: string
  /** Path of the app opened by a tap on the notification. */
  url: string
}
