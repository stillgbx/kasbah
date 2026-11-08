import { deviceRight, EMPTY_SHOPPING_LIST, grants, kindRight, type DeviceDescriptor, type DeviceId, type House, type Need, type Right, type ServerMessage } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { DeviceRegistry } from '../core/registry'
import type { UsersFile } from '../mcp/auth'
import { sendError } from './errors'

// Rights of an account (`rights` in `mcp-users.json`), enforced on every route in one `preHandler`:
// after the router (the route's PATTERN decides, never the raw URL) and after the `onRequest` hooks
// that set `req.account` (session, MCP tool replaying a route). An admin may everything, and alone
// the settings (plugins, house plan, accounts, server update, Matter); an account without a list
// keeps every domain. The machine itself (`null`, `isLoopbackRequest`) is never checked.
//
// Reads too: a device's own routes need its right, the device list and the WebSocket leave out what
// the account may not see (`filterMessage`), and so does the house plan (`filterHouse`): a hidden
// device leaves no name and no place in the 3D view.

/** `device`: the right of the device the route drives (`:id`). */
export type RouteRight = Need | 'device'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Admin only, read or write: account management, server update, Matter (its pairing code hands over
// what it publishes), the instructions of every account. From home only, too (`http/session.ts`).
const ADMIN_PATHS = ['/api/mcp/users', '/api/system', '/api/matter', '/api/assistant/log']

// Core writes, by route prefix. `null`: personal (push subscription, the assistant), or checked tool
// by tool (`/mcp`).
export const CORE_WRITES: readonly [string, Need][] = [
  ['/api/house', 'admin'],
  ['/api/properties', 'admin'],
  // vendor scenes are light scenes (Hue)
  ['/api/scenes', 'lights'],
  ['/api/automations', 'automations'],
  ['/api/automation-order', 'automations'],
  ['/api/shopping', 'shopping'],
  ['/api/push', null], ['/api/diag', null], ['/api/assistant', null],
  ['/login', null], ['/logout', null], ['/oauth', null], ['/mcp', null],
]

// Core reads guarded as a whole. `/api/devices` (the list) and `/ws` are filtered instead.
const CORE_READS: readonly [string, Right][] = [
  ['/api/scenes', 'lights'],
  ['/api/automations', 'automations'],
  ['/api/shopping', 'shopping'],
]

/**
 * Plugin routes (`/api/plugins/<id>/…`): the plugin's domain, except the WRITES whose first segment is
 * in `settings` (linking an account, pairing a bridge, forgetting a device), which need an admin.
 * `right: null` = personal to each account (its own Claude token) or a service of the app (speech).
 */
export const PLUGIN_RIGHTS: Readonly<Record<string, { right: Right | null; settings?: readonly string[] }>> = {
  agenda: { right: 'agenda', settings: ['calendars'] },
  automower: { right: 'robots', settings: ['usage'] },
  claude: { right: null },
  comap: { right: 'water' },
  dirigera: { right: 'lights', settings: ['pair'] },
  enphase: { right: 'energy', settings: ['token', 'subscription'] },
  google_cast: { right: 'media', settings: ['devices'] },
  home_assistant: { right: 'media', settings: ['entities'] },
  hormann: { right: 'access' },
  hue: { right: 'lights', settings: ['pair'] },
  irobot: { right: 'robots', settings: ['login', 'logout'] },
  melcloud: { right: 'heating', settings: ['login', 'logout'] },
  // its account is each person's own, like YouTube Music's cookie
  mixcloud: { right: 'media' },
  nest: { right: 'cameras' },
  open_meteo: { right: 'weather' },
  petkit: { right: 'pets', settings: ['login', 'logout'] },
  // subscriptions are each person's own, like Mixcloud's resume points
  podcasts: { right: 'media' },
  radio: { right: 'media' },
  renault: { right: 'vehicles', settings: ['login', 'logout'] },
  sonos: { right: 'media', settings: ['devices'] },
  tahoma: { right: 'covers' },
  tesla: { right: 'vehicles', settings: ['public-key', 'register', 'usage'] },
  toutemonannee: { right: 'school', settings: ['login', 'logout'] },
  transcription: { right: null, settings: ['settings'] },
  tuya: { right: 'heating' },
  ytmusic: { right: 'media' },
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

/**
 * What a route needs, from its method and its PATTERN (`req.routeOptions.url`). A plugin or a core
 * write missing from the tables above needs an admin (`mapped: false`): forgetting one refuses too
 * much rather than too little, and the server says so at startup.
 */
export function classifyRoute(method: string, url: string): { right: RouteRight; mapped: boolean } {
  const write = !SAFE_METHODS.has(method)
  const seg = url.split('/')
  if (seg[1] === 'api' && seg[2] === 'plugins' && seg[3] && !seg[3].startsWith(':')) {
    const plugin = PLUGIN_RIGHTS[seg[3]]
    if (!plugin) return { right: 'admin', mapped: false }
    const rest = seg.slice(4)
    // vendor dumps and account linking (OAuth: a GET that stores the token) are settings for any method
    if (rest.includes('raw') || rest[0] === 'auth') return { right: 'admin', mapped: true }
    return { right: write && rest[0] !== undefined && plugin.settings?.includes(rest[0]) ? 'admin' : plugin.right, mapped: true }
  }
  if (ADMIN_PATHS.some((prefix) => under(url, prefix))) return { right: 'admin', mapped: true }
  if (under(url, '/api/music')) return { right: 'media', mapped: true }
  // the device, its history, forecast, journal, map… and its command
  if (under(url, '/api/devices/:id')) return { right: 'device', mapped: true }
  if (!write) return { right: CORE_READS.find(([prefix]) => under(url, prefix))?.[1] ?? null, mapped: true }
  // turning a plugin on or off
  if (url === '/api/plugins/:id') return { right: 'admin', mapped: true }
  const core = CORE_WRITES.find(([prefix]) => under(url, prefix))
  return core ? { right: core[1], mapped: true } : { right: 'admin', mapped: false }
}

export const routeRight = (method: string, url: string): RouteRight => classifyRoute(method, url).right

export interface RightsDeps {
  users: () => Promise<UsersFile>
  registry: Pick<DeviceRegistry, 'get'>
}

/** What an account may do. `rights`: its domains, absent = all of them (always for an admin). */
export interface Access { admin: boolean; house: boolean; rights: readonly Right[] | undefined }

const accessOf = (u: UsersFile['users'][number]): Access => ({ admin: u.admin === true, house: u.house === true, rights: u.admin ? undefined : u.rights })
/** The domains of an account; a name without an account sees nothing. */
const rightsOf = async (users: () => Promise<UsersFile>, user: string) => {
  const u = (await users()).users.find((a) => a.name === user)
  return u ? accessOf(u).rights : []
}

/** Does this access allow `need`? No access (no such account) allows nothing but `null`. */
export const allows = (access: Access | undefined, need: Need): boolean =>
  need === null || (access !== undefined && (need === 'admin' ? access.admin : grants(access.rights, need)))

/** May this account do what `need` asks? The machine itself (`null`) may always. */
export async function mayUse(users: () => Promise<UsersFile>, user: string | null, need: Need): Promise<boolean> {
  if (user === null) return true
  const u = (await users()).users.find((a) => a.name === user)
  return allows(u && accessOf(u), need)
}

/** What each account may do; a name missing from the map has no account. */
export async function accountRights(users: () => Promise<UsersFile>): Promise<Map<string, Access>> {
  return new Map((await users()).users.map((u) => [u.name, accessOf(u)]))
}

/** What this account may see of the devices; the machine itself (`null`) sees them all. */
export async function deviceFilter(users: () => Promise<UsersFile>, user: string | null): Promise<(d: DeviceDescriptor) => boolean> {
  if (user === null) return () => true
  const rights = await rightsOf(users, user)
  return (d) => grants(rights, deviceRight(d))
}

/**
 * The house plan as an account with these rights (absent = all, an admin's) sees it: without the
 * devices it may not see. `rightOf` as in `filterMessage`; a device the registry does not know is
 * judged on its kind hint. An admin sees the whole plan: it edits it.
 */
export function filterHouse(house: House, rights: readonly Right[] | undefined, rightOf: (id: DeviceId) => Right | null | undefined): House {
  if (rights === undefined) return house
  const rightOfDevice = (d: House['devices'][number]) => {
    const r = d.deviceId ? rightOf(d.deviceId) : undefined
    return r !== undefined ? r : d.kind ? kindRight(d.kind) : null
  }
  return { ...house, devices: house.devices.filter((d) => grants(rights, rightOfDevice(d))) }
}

/** The right of a device by its id, from the registry (`undefined` = unknown). */
export const registryRight = (registry: Pick<DeviceRegistry, 'get'>) => (id: DeviceId): Right | null | undefined => {
  const e = registry.get(id)
  return e ? deviceRight(e.descriptor) : undefined
}

/** The house plan this account may see; the machine itself (`null`) sees it whole. */
export async function houseView(users: () => Promise<UsersFile>, registry: Pick<DeviceRegistry, 'get'>, user: string | null): Promise<(h: House) => House> {
  if (user === null) return (h) => h
  const rights = await rightsOf(users, user)
  return (h) => filterHouse(h, rights, registryRight(registry))
}

/**
 * The WebSocket message an account with these rights receives, `null` = nothing. `rightOf`: the right
 * of a device by its id (`undefined` = an unknown device, never shown).
 */
export function filterMessage(msg: ServerMessage, rights: readonly Right[], rightOf: (id: DeviceId) => Right | null | undefined): ServerMessage | null {
  const may = (r: Right | null) => grants(rights, r)
  const seen = (id: DeviceId) => { const r = rightOf(id); return r !== undefined && may(r) }
  switch (msg.type) {
    case 'snapshot': return {
      ...msg,
      devices: msg.devices.filter((e) => may(deviceRight(e.descriptor))),
      scenes: may('lights') ? msg.scenes : [],
      automations: may('automations') ? msg.automations : [],
      shopping: may('shopping') ? msg.shopping : EMPTY_SHOPPING_LIST,
    }
    case 'devices': return { ...msg, devices: msg.devices.filter((e) => may(deviceRight(e.descriptor))) }
    case 'state': case 'deviceEvent': return seen(msg.deviceId) ? msg : null
    case 'availability': {
      const deviceIds = msg.deviceIds.filter(seen)
      return deviceIds.length ? { ...msg, deviceIds } : null
    }
    case 'scenes': case 'scene': return may('lights') ? msg : null
    case 'automations': return may('automations') ? msg : null
    case 'shopping': return may('shopping') ? msg : null
    case 'house': return { ...msg, house: filterHouse(msg.house, rights, rightOf) }
    default: return msg
  }
}

export const rightRefused = (need: Exclude<Need, null>) => (need === 'admin' ? 'this needs an admin account' : `this account may not use "${need}"`)

/**
 * Enforces the rights on every route registered AFTER this call (a `preHandler`: 403 `NO_RIGHT`), and
 * collects the routes the tables do not know (`unmapped`, warned about at startup).
 */
export function registerRights(app: FastifyInstance, deps: RightsDeps): { unmapped: string[] } {
  const unmapped: string[] = []
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (!classifyRoute(method, route.url).mapped) unmapped.push(`${method} ${route.url}`)
    }
  })
  app.addHook('preHandler', async (req, reply) => {
    const user = req.account
    const url = req.routeOptions.url
    if (user === null || url === undefined) return
    let right = routeRight(req.method, url)
    if (right === 'device') {
      // an unknown device: the route says 404 itself
      const entry = deps.registry.get((req.params as { id?: string }).id ?? '')
      right = entry ? deviceRight(entry.descriptor) : null
    }
    if (!await mayUse(deps.users, user, right)) await sendError(reply, 403, 'NO_RIGHT', rightRefused(right!))
  })
  return { unmapped }
}
