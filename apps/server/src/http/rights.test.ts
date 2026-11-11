import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { EMPTY_SHOPPING_LIST, type DeviceEntry, type House, type Right, type ServerMessage } from '@kasbah/shared'
import { filterHouse, filterMessage, mayUse, PLUGIN_RIGHTS, registerRights, routeRight } from './rights'

describe('routeRight', () => {
  it('drives a device with the right of that device', () => {
    expect(routeRight('POST', '/api/devices/:id/command')).toBe('device')
  })

  it("guards a device's own reads, and the core reads whose domain is clear", () => {
    for (const url of ['/api/devices/:id', '/api/devices/:id/history', '/api/devices/:id/release-notes']) {
      expect(routeRight('GET', url)).toBe('device')
    }
    expect(routeRight('GET', '/api/scenes')).toBe('lights')
    expect(routeRight('GET', '/api/automations')).toBe('automations')
    expect(routeRight('GET', '/api/shopping')).toBe('shopping')
    // filtered by the route or the hub instead, or needed to draw the view
    for (const url of ['/api/devices', '/api/house', '/api/plugins', '/api/health', '/ws']) expect(routeRight('GET', url)).toBeNull()
  })

  it('guards the core writes by domain, and leaves the house plan to an admin', () => {
    expect(routeRight('PUT', '/api/house/edit')).toBe('admin')
    expect(routeRight('POST', '/api/properties/:id/select')).toBe('admin')
    expect(routeRight('PATCH', '/api/plugins/:id')).toBe('admin')
    expect(routeRight('POST', '/api/scenes/:id/recall')).toBe('lights')
    expect(routeRight('POST', '/api/automations/:id/run')).toBe('automations')
    expect(routeRight('PUT', '/api/automation-order')).toBe('automations')
    expect(routeRight('POST', '/api/shopping/items')).toBe('shopping')
    expect(routeRight('DELETE', '/api/shopping/products/:id')).toBe('shopping')
    expect(routeRight('PUT', '/api/push/subscription')).toBeNull()
    expect(routeRight('POST', '/api/assistant/ask')).toBeNull()
  })

  it('leaves the accounts, the server update, Matter and the assistant log to an admin, read or write', () => {
    for (const [method, url] of [['GET', '/api/mcp/users'], ['PUT', '/api/mcp/users/:name/role'], ['GET', '/api/system/version'],
      ['POST', '/api/system/update'], ['GET', '/api/matter'], ['DELETE', '/api/matter/fabrics/:index'], ['GET', '/api/assistant/log']]) {
      expect(routeRight(method!, url!), url).toBe('admin')
    }
  })

  it("gives a plugin's routes its domain, and its account linking to an admin", () => {
    expect(routeRight('GET', '/api/plugins/nest/cameras/:id/stream')).toBe('cameras')
    expect(routeRight('GET', '/api/plugins/agenda/calendars')).toBe('agenda')
    expect(routeRight('POST', '/api/plugins/agenda/calendars')).toBe('admin')
    expect(routeRight('POST', '/api/plugins/hue/pair')).toBe('admin')
    expect(routeRight('POST', '/api/plugins/renault/login')).toBe('admin')
    expect(routeRight('GET', '/api/plugins/renault/status')).toBe('vehicles')
    expect(routeRight('GET', '/api/plugins/nest/auth/callback')).toBe('admin')
    expect(routeRight('GET', '/api/plugins/enphase/ev/raw')).toBe('admin')
    // each person's own music account and Claude token
    expect(routeRight('PUT', '/api/plugins/ytmusic/cookie')).toBe('media')
    expect(routeRight('PUT', '/api/plugins/claude/account')).toBeNull()
    expect(routeRight('POST', '/api/music/play')).toBe('media')
  })

  it('needs an admin for a plugin or a core write it does not know', () => {
    expect(routeRight('GET', '/api/plugins/newcomer/status')).toBe('admin')
    expect(routeRight('POST', '/api/somewhere')).toBe('admin')
  })

  it('knows every plugin that serves routes', () => {
    const dir = join(import.meta.dirname, '../plugins')
    const withRoutes = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && readFileSync(join(dir, d.name, 'index.ts'), 'utf8').includes('registerRoutes'))
      .map((d) => d.name)
    expect(withRoutes.length).toBeGreaterThan(10)
    expect(withRoutes.filter((id) => !(id in PLUGIN_RIGHTS))).toEqual([])
  })
})

it('lets an admin do everything, an account its domains, a name without an account nothing', async () => {
  const users = async () => ({ users: [
    { name: 'root', password: 'x', admin: true as const, rights: ['lights' as const] },
    { name: 'kid', password: 'x', rights: ['lights' as const] },
    { name: 'all', password: 'x' },
  ] })
  expect(await mayUse(users, 'root', 'admin')).toBe(true)
  expect(await mayUse(users, 'root', 'vehicles')).toBe(true)
  expect(await mayUse(users, 'kid', 'lights')).toBe(true)
  expect(await mayUse(users, 'kid', 'vehicles')).toBe(false)
  expect(await mayUse(users, 'all', 'vehicles')).toBe(true)
  expect(await mayUse(users, 'all', 'admin')).toBe(false)
  expect(await mayUse(users, 'ghost', 'lights')).toBe(false)
  expect(await mayUse(users, 'ghost', null)).toBe(true)
  // the machine itself
  expect(await mayUse(users, null, 'admin')).toBe(true)
})

it('collects the routes registered after it that the tables do not know', async () => {
  const app = Fastify()
  const { unmapped } = registerRights(app, { users: async () => ({ users: [] }), registry: { get: () => undefined } })
  app.post('/api/shopping/items', async () => ({}))
  await app.register(async (sub) => { sub.put('/thing', async () => ({})) }, { prefix: '/api/plugins/newcomer' })
  app.post('/api/somewhere', async () => ({}))
  await app.ready()
  expect(unmapped).toEqual(['PUT /api/plugins/newcomer/thing', 'POST /api/somewhere'])
  await app.close()
})

describe('filterMessage', () => {
  const entry = (id: string, kind: string, meta: object = {}) => ({ descriptor: { id, kind, meta } }) as unknown as DeviceEntry
  const light = entry('p:l', 'light'); const car = entry('p:car', 'vehicle'); const gate = entry('p:gate', 'cover', { cover: { deviceClass: 'gate' } })
  const rightOf = (id: string): Right | null | undefined => ({ 'p:l': 'lights', 'p:car': 'vehicles', 'p:gate': 'access' } as Record<string, Right>)[id]
  const only = (msg: ServerMessage) => filterMessage(msg, ['lights'], rightOf)

  it('keeps out the devices, scenes, automations and list the rights do not grant', () => {
    const snapshot = only({ type: 'snapshot', serverTime: 0, devices: [light, car, gate], scenes: [{} as never], automations: [{} as never], shopping: { items: [{} as never], products: [] } })
    expect(snapshot).toMatchObject({ devices: [light], scenes: [{}], automations: [], shopping: EMPTY_SHOPPING_LIST })
    expect(only({ type: 'devices', devices: [car, light] })).toEqual({ type: 'devices', devices: [light] })
    expect(only({ type: 'state', deviceId: 'p:car', state: {} as never })).toBeNull()
    expect(only({ type: 'state', deviceId: 'p:l', state: {} as never })).not.toBeNull()
    expect(only({ type: 'deviceEvent', deviceId: 'p:unknown', event: 'chime' as never, at: 0 })).toBeNull()
    expect(only({ type: 'availability', deviceIds: ['p:car', 'p:l'], available: false })).toEqual({ type: 'availability', deviceIds: ['p:l'], available: false })
    expect(only({ type: 'availability', deviceIds: ['p:car'], available: false })).toBeNull()
    expect(only({ type: 'automations', automations: [] })).toBeNull()
    expect(only({ type: 'error', code: 'X', message: 'y' })).toEqual({ type: 'error', code: 'X', message: 'y' })
  })

  it('keeps out of the house plan the devices the rights do not grant', () => {
    const house = { devices: [
      { id: 'l', deviceId: 'p:l' }, { id: 'car', deviceId: 'p:car' }, { id: 'gate', deviceId: 'p:gate' },
      // not known to the registry: judged on its kind hint, or kept without one
      { id: 'tv', deviceId: 'gone:tv', kind: 'media_player' }, { id: 'lamp', kind: 'light' }, { id: 'x' },
    ] } as unknown as House
    const ids = (h: House) => h.devices.map((d) => d.id)
    expect(ids(filterHouse(house, ['lights'], rightOf))).toEqual(['l', 'lamp', 'x'])
    expect(ids(filterHouse(house, ['access', 'media'], rightOf))).toEqual(['gate', 'tv', 'x'])
    // an admin (whose rights are absent) edits the plan: it sees it whole, as an account without a list
    expect(filterHouse(house, undefined, rightOf)).toBe(house)
    expect(ids(filterHouse(house, [], rightOf))).toEqual(['x'])
    const msg = only({ type: 'house', house })
    expect(msg?.type === 'house' && ids(msg.house)).toEqual(['l', 'lamp', 'x'])
  })
})
