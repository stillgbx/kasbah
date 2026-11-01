import { z } from 'zod'
import { deviceClassOf } from '../devices/activity'
import type { DeviceDescriptor } from '../devices/descriptor'
import type { DeviceKind } from '../devices/kinds'
import type { NotifyCategory } from '../push/push'

// Rights of an account: what a signed-in person (public address, MCP token, the app's assistant) may
// use. One switch per DOMAIN, the way the house is used, not per device. The local network has no
// account: it is the house, and keeps every right. An account without a list keeps every right too.

export const RIGHTS = [
  'lights', 'covers', 'access', 'heating', 'vehicles', 'media', 'cameras', 'robots', 'pets',
  'energy', 'water', 'weather', 'agenda', 'school', 'shopping', 'automations', 'settings',
] as const
export type Right = (typeof RIGHTS)[number]

/** The rights granted; absent = all of them. */
export const rightsSchema = z.array(z.enum(RIGHTS))

/** A cover that opens the house (gate, garage door, window) needs `access`, not `covers`. */
export const ACCESS_COVER_CLASSES: ReadonlySet<string> = new Set(['gate', 'garage', 'window'])

const RIGHT_OF_KIND: Record<DeviceKind, Right | null> = {
  light: 'lights', cover: 'covers', media_player: 'media', climate: 'heating', fan: 'heating',
  vacuum: 'robots', mower: 'robots', energy: 'energy', ev_charger: 'vehicles', vehicle: 'vehicles',
  camera: 'cameras', weather: 'weather', water: 'water', pet_feeder: 'pets', pet_fountain: 'pets',
  // a sensor only measures: nothing to guard
  sensor: null,
}

/** The right that driving this device needs; `null` = none. */
export function deviceRight(descriptor: DeviceDescriptor): Right | null {
  if (descriptor.kind === 'cover' && ACCESS_COVER_CLASSES.has(deviceClassOf(descriptor) ?? '')) return 'access'
  return RIGHT_OF_KIND[descriptor.kind]
}

/** The right a push notification category needs: an account without it is not notified. */
export const RIGHT_OF_NOTIFY_CATEGORY: Record<NotifyCategory, Right> = {
  vehicles: 'vehicles', robots: 'robots', pets: 'pets', weather: 'weather', plugins: 'settings', automations: 'automations',
}

/** Does this list of rights (absent = all) grant `right` (`null` = nothing to grant)? */
export const grants = (rights: readonly Right[] | undefined, right: Right | null): boolean =>
  right === null || rights === undefined || rights.includes(right)
