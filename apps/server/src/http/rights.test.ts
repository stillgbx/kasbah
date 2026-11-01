import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { EMPTY_SHOPPING_LIST, type DeviceEntry, type Right, type ServerMessage } from '@kasbah/shared'
import { filterMessage, PLUGIN_RIGHTS, registerRights, routeRight } from './rights'

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

  it('guards the core writes by domain', () => {
    expect(routeRight('PUT', '/api/house/edit')).toBe('settings')
    expect(routeRight('POST', '/api/properties/:id/select')).toBe('settings')
    expect(routeRight('PATCH', '/api/plugins/:id')).toBe('settings')
    expect(routeRight('POST', '/api/scenes/:id/recall')).toBe('lights')
    expect(routeRight('POST', '/api/automations/:id/run')).toBe('automations')
    expect(routeRight('PUT', '/api/automation-order')).toBe('automations')
    expect(routeRight('POST', '/api/shopping/items')).toBe('shopping')
    expect(routeRight('PUT', '/api/push/subscription')).toBeNull()
  })

  it("gives a plugin's routes its domain, and its account linking to settings", () => {
    expect(routeRight('GET', '/api/plugins/nest/cameras/:id/stream')).toBe('cameras')
    expect(routeRight('GET', '/api/plugins/agenda/calendars')).toBe('agenda')
    expect(routeRight('POST', '/api/plugins/agenda/calendars')).toBe('settings')
    expect(routeRight('POST', '/api/plugins/hue/pair')).toBe('settings')
    expect(routeRight('POST', '/api/plugins/renault/login')).toBe('settings')
    expect(routeRight('GET', '/api/plugins/renault/status')).toBe('vehicles')
    expect(routeRight('GET', '/api/plugins/nest/auth/callback')).toBe('settings')
    expect(routeRight('GET', '/api/plugins/enphase/ev/raw')).toBe('settings')
    // each person's own music account and Claude token
    expect(routeRight('PUT', '/api/plugins/ytmusic/cookie')).toBe('media')
    expect(routeRight('PUT', '/api/plugins/claude/account')).toBeNull()
    expect(routeRight('POST', '/api/music/play')).toBe('media')
  })

  it('needs settings for a plugin or a core write it does not know', () => {
    expect(routeRight('GET', '/api/plugins/newcomer/status')).toBe('settings')
    expect(routeRight('POST', '/api/somewhere')).toBe('settings')
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
})
