import { z } from 'zod'
import { deviceClassOf } from '../devices/activity'
import type { DeviceDescriptor } from '../devices/descriptor'
import type { DeviceKind } from '../devices/kinds'
import type { NotifyCategory } from '../push/push'

// Rights of an account: what a signed-in person (app, MCP token, the app's assistant) may use. One
// switch per DOMAIN, the way the house is used, not per device. An account without a list keeps every
// right. Settings (plugins, house plan, accounts, server update) are not a right: they belong to the
// ADMIN accounts (`admin` in `mcp-users.json`).

export const RIGHTS = [
  'lights', 'covers', 'access', 'heating', 'vehicles', 'media', 'cameras', 'robots', 'pets',
  'energy', 'water', 'weather', 'agenda', 'school', 'shopping', 'automations',
] as const
export type Right = (typeof RIGHTS)[number]

/** What an action needs: a right, an admin account, or nothing (`null`). */
export type Need = Right | 'admin' | null

export const isRight = (s: string): s is Right => (RIGHTS as readonly string[]).includes(s)

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

/** The right of a kind alone, for a house device not linked to a plugin (no descriptor, no class). */
export const kindRight = (kind: DeviceKind): Right | null => RIGHT_OF_KIND[kind]

/** What a push notification category needs: an account without it is not notified. */
export const RIGHT_OF_NOTIFY_CATEGORY: Record<NotifyCategory, Exclude<Need, null>> = {
  vehicles: 'vehicles', robots: 'robots', pets: 'pets', weather: 'weather', plugins: 'admin', automations: 'automations',
}

/** Does this list of rights (absent = all) grant `right` (`null` = nothing to grant)? */
export const grants = (rights: readonly Right[] | undefined, right: Right | null): boolean =>
  right === null || rights === undefined || rights.includes(right)
