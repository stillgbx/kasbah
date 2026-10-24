import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { AutomationAction, StateFor, WeatherForecast } from '@kasbah/shared'
import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'
import { registerMusicSource } from '../music/sources'
import { createMockPlugin } from '../plugins/mock'
import { hashPassword } from './auth'
import { agendaDigest, AUTOMATION_CREATE_LIMIT, schoolDigest, sensitiveActions, weatherDigest } from './server'
import { signIn, type TestOAuthProvider } from './test-oauth'

// `/mcp` served by the assembled application, queried by the real SDK client in BOTH protocol
// versions: 2025 (what today's clients speak) and 2026-07-28 (stateless).

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

let kasbah: KasbahApp
let url: URL
// A fake ytmusic source: the real plugin needs a cookie and the network. It records which account
// each track is resolved for.
let unregister: () => void
const resolvedFor: (string | null)[] = []
// An account in a throwaway file; each client goes through the real OAuth sign-in.
const LOGIN = { username: 'lou', password: 'correct horse battery' }
let provider: TestOAuthProvider
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kasbah-mcp-'))
  const usersFile = join(dir, 'mcp-users.json')
  // a copy of the house: its automations are written next to it, not in the repo
  const housePath = join(dir, 'demo-house.json')
  copyFileSync(DEMO_HOUSE, housePath)
  writeFileSync(usersFile, JSON.stringify({ users: [{ name: LOGIN.username, password: await hashPassword(LOGIN.password) }] }))
  unregister = registerMusicSource({
    id: 'ytmusic', label: 'YouTube Music',
    resolve: async (_id, user) => {
      resolvedFor.push(user)
      return { url: 'http://192.0.2.9/audio.m4a', formatId: '140', ext: 'm4a', abrKbps: 128, sizeBytes: 4_500_000, durationS: 281 }
    },
  })
  kasbah = await buildApp({
    env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
    logger: pino({ level: 'silent' }),
    house: await loadHouse(housePath),
    factories: { mock: createMockPlugin },
    // speakers refuse localhost: the shared player requires a published base
    envSource: { MUSIC_PUBLISH_BASE: 'http://192.0.2.1:8787', MCP_USERS_FILE: usersFile },
    serveStatic: false,
  })
  await kasbah.app.listen({ port: 0, host: '127.0.0.1' })
  await kasbah.startPlugins()
  url = new URL(`http://127.0.0.1:${(kasbah.app.server.address() as AddressInfo).port}/mcp`)
  provider = (await signIn(url, LOGIN))!
})
afterAll(async () => { unregister(); await kasbah.close() })

const text = (r: { content: unknown }) => (r.content as { text: string }[])[0]!.text

describe.each<[string, VersionNegotiationMode]>([['2025', 'legacy'], ['2026-07-28', { pin: '2026-07-28' }]])('MCP (%s)', (_label, mode) => {
  let client: Client
  beforeAll(async () => {
    client = new Client({ name: 'test', version: '0' }, { versionNegotiation: { mode } })
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }))
  })
  afterAll(async () => { await client.close() })

  it('exposes the tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['add_shopping_items', 'control_music', 'create_automation', 'finish_shopping', 'get_agenda', 'get_device', 'get_device_history', 'get_health', 'get_music', 'get_school', 'get_shopping_list', 'get_weather', 'list_automations', 'list_devices', 'list_scenes', 'play_music', 'play_radio', 'queue_music', 'recall_scene', 'remove_shopping_item', 'run_automation', 'search_music', 'send_command', 'set_automation_enabled', 'set_shopping_favorite', 'update_automation', 'update_shopping_item'])
  })

  it('plays a track through the shared player, on a speaker', async () => {
    const speaker = kasbah.registry.list().find((e) => e.descriptor.capabilities.includes('play_url'))!
    const r = await client.callTool({ name: 'play_music', arguments: {
      deviceId: speaker.descriptor.id,
      tracks: [{ source: 'ytmusic', id: 'vid-1', title: 'Gymnopédie No.1', artist: 'Erik Satie', durationS: 281 }],
    } })
    expect(r.isError).toBeFalsy()
    const queue = (await kasbah.app.inject({ method: 'GET', url: `/api/music/queue?deviceId=${speaker.descriptor.id}` })).json()
    expect(JSON.stringify(queue)).toContain('Gymnopédie No.1')
    // in the name of the token's account: its music accounts are the ones playing
    expect(resolvedFor.at(-1)).toBe(LOGIN.username)
  })

  it('reads and drives the shared player\'s queue', async () => {
    const speaker = kasbah.registry.list().find((e) => e.descriptor.capabilities.includes('play_url'))!.descriptor.id
    const json = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args })
      expect(r.isError, text(r)).toBeFalsy()
      return JSON.parse(text(r))
    }
    const added = await json('queue_music', { deviceId: speaker, tracks: [{ source: 'ytmusic', id: 'vid-a', title: 'A' }, { source: 'ytmusic', id: 'vid-b', title: 'B' }] })
    expect(added).toMatchObject({ started: false, queued: 2, queue: { index: 0, length: 3, current: { title: 'Gymnopédie No.1' } } })
    const music = await json('get_music', { deviceId: speaker })
    expect(music.playing.find((p: { deviceId: string }) => p.deviceId === speaker)).toMatchObject({ device: expect.any(String), title: 'Gymnopédie No.1' })
    expect(music.queue.items.map((t: { index: number; title: string }) => [t.index, t.title])).toEqual([[0, 'Gymnopédie No.1'], [1, 'A'], [2, 'B']])
    expect((await json('control_music', { deviceId: speaker, action: 'repeat', mode: 'loop' })).queue.repeat).toBe('loop')
    expect((await json('control_music', { deviceId: speaker, action: 'jump', index: 2 })).queue).toMatchObject({ index: 2, current: { title: 'B' } })
    const missing = await client.callTool({ name: 'control_music', arguments: { deviceId: speaker, action: 'remove' } })
    expect(missing.isError).toBe(true)
    expect((await json('control_music', { deviceId: speaker, action: 'clear' })).queue).toMatchObject({ index: 0, length: 1 })
  })

  it('says why a source does not answer, instead of failing silently', async () => {
    const r = await client.callTool({ name: 'search_music', arguments: { query: 'erik satie', source: 'radio' } })
    expect(r.isError).toBe(true)
    const speaker = kasbah.registry.list().find((e) => e.descriptor.capabilities.includes('play_url'))!
    const off = await client.callTool({ name: 'play_music', arguments: { deviceId: speaker.descriptor.id, tracks: [{ source: 'mixcloud', id: '/u/mix/' }] } })
    expect(off.isError).toBe(true)
    expect(text(off)).toMatch(/mixcloud/)
  })

  it('lists devices filtered by kind', async () => {
    const lights = JSON.parse(text(await client.callTool({ name: 'list_devices', arguments: { kind: 'light' } })))
    expect(lights.length).toBeGreaterThan(0)
    expect(lights.every((d: { kind: string }) => d.kind === 'light')).toBe(true)
  })

  it('commands a device and the registry follows', async () => {
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!
    for (const on of [true, false]) {
      const r = await client.callTool({ name: 'send_command', arguments: { deviceId: light.descriptor.id, command: { type: 'light.set', on } } })
      expect(r.isError).toBeFalsy()
      expect(kasbah.registry.get(light.descriptor.id)!.state).toMatchObject({ on })
    }
  })

  it('returns a tool error, not an exception, for an unknown device or a refused command', async () => {
    const unknown = await client.callTool({ name: 'send_command', arguments: { deviceId: 'mock:nope', command: { type: 'cover.open' } } })
    expect(unknown.isError).toBe(true)
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!
    const refused = await client.callTool({ name: 'send_command', arguments: { deviceId: light.descriptor.id, command: { type: 'cover.open' } } })
    expect(refused.isError).toBe(true)
  })

  it('returns the house weather with its forecasts', async () => {
    const r = await client.callTool({ name: 'get_weather', arguments: {} })
    expect(r.isError).toBeFalsy()
    const w = JSON.parse(text(r))
    expect(w.place).toEqual({ name: kasbah.house.house.name, home: true })
    expect(w.now.condition).toBeTypeOf('string')
    expect(w.hourly.length).toBeGreaterThan(0)
    expect(w.daily.length).toBeGreaterThan(0)
    expect(w.daily[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('says why the weather of another place does not answer (open meteo plugin absent)', async () => {
    const r = await client.callTool({ name: 'get_weather', arguments: { place: 'Pornic' } })
    expect(r.isError).toBe(true)
  })

  it('reads, disables and runs an automation', async () => {
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!.descriptor.id
    await kasbah.app.inject({ method: 'PUT', url: '/api/automations/nuit', payload: {
      name: 'Nuit', enabled: true, trigger: { type: 'time', at: { kind: 'clock', time: '03:00' } }, unless: [],
      actions: [{ type: 'command', target: { type: 'devices', deviceIds: [light] }, command: { type: 'light.set', on: true } }],
    } })
    const list = JSON.parse(text(await client.callTool({ name: 'list_automations', arguments: { query: 'nui' } })))
    expect(list).toEqual([expect.objectContaining({ id: 'nuit', enabled: true, status: expect.objectContaining({ health: 'ok', nextRun: expect.stringMatching(/ 03:00$/) }) })])
    const off = await client.callTool({ name: 'set_automation_enabled', arguments: { id: 'nuit', enabled: false } })
    expect(JSON.parse(text(off))).toEqual({ ok: true, id: 'nuit', enabled: false })
    expect(kasbah.automations.list().find((e) => e.automation.id === 'nuit')!.automation.enabled).toBe(false)
    await kasbah.app.inject({ method: 'POST', url: `/api/devices/${light}/command`, payload: { type: 'light.set', on: false } })
    const run = await client.callTool({ name: 'run_automation', arguments: { id: 'nuit' } })
    expect(JSON.parse(text(run))).toEqual({ outcome: 'ok' })
    expect(kasbah.registry.get(light)!.state).toMatchObject({ on: true })
    expect((await client.callTool({ name: 'run_automation', arguments: { id: 'inconnue' } })).isError).toBe(true)
  })

  it('creates then updates an automation, field by field', async () => {
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!.descriptor.id
    const actions = [{ type: 'command', target: { type: 'devices', deviceIds: [light] }, command: { type: 'light.set', on: true } }]
    const created = await client.callTool({ name: 'create_automation', arguments: {
      name: 'Réveil', trigger: { type: 'time', at: { kind: 'clock', time: '07:00' } }, actions,
    } })
    expect(created.isError, text(created)).toBeFalsy()
    const rule = JSON.parse(text(created))
    // enabled by default, without "Unless", and saved by the engine under an id drawn by the server
    expect(rule).toMatchObject({ name: 'Réveil', enabled: true, status: { health: 'ok', nextRun: expect.stringMatching(/ 07:00$/) } })
    expect(kasbah.automations.list().find((e) => e.automation.id === rule.id)!.automation.unless).toEqual([])

    // marked "written by the assistant", in the name of the token's account
    expect(kasbah.automations.get(rule.id)!.automation.byAssistant).toEqual({ user: LOGIN.username, at: expect.any(Number) })

    const updated = await client.callTool({ name: 'update_automation', arguments: { id: rule.id, name: 'Réveil doux', enabled: false } })
    expect(updated.isError, text(updated)).toBeFalsy()
    const stored = kasbah.automations.list().find((e) => e.automation.id === rule.id)!.automation
    // the fields not passed stay as they were
    expect(stored).toMatchObject({ name: 'Réveil doux', enabled: false, trigger: { at: { time: '07:00' } }, actions })
    // the previous version comes back, ready to be passed again to undo
    const { previous } = JSON.parse(text(updated))
    expect(previous).toEqual({ name: 'Réveil', enabled: true, trigger: { type: 'time', at: { kind: 'clock', time: '07:00' } }, unless: [], actions })
    await client.callTool({ name: 'update_automation', arguments: { id: rule.id, ...previous } })
    expect(kasbah.automations.get(rule.id)!.automation).toMatchObject({ name: 'Réveil', enabled: true })

    // a write from the app clears the mark
    const { id: _i, updatedAt: _u, byAssistant: _b, ...body } = kasbah.automations.get(rule.id)!.automation
    await kasbah.app.inject({ method: 'PUT', url: `/api/automations/${rule.id}`, payload: body })
    expect(kasbah.automations.get(rule.id)!.automation.byAssistant).toBeUndefined()

    const missing = await client.callTool({ name: 'update_automation', arguments: { id: 'inconnue', name: 'X' } })
    expect(missing.isError).toBe(true)
    // a missing reference does not prevent the write: the status reports it
    const broken = JSON.parse(text(await client.callTool({ name: 'update_automation', arguments: {
      id: rule.id, actions: [{ ...actions[0], target: { type: 'devices', deviceIds: ['mock:absente'] } }],
    } })))
    expect(broken.status).toMatchObject({ health: 'incomplete', missing: [{ kind: 'device', id: 'mock:absente' }] })
  })

  it('saves an automation that opens the gate as DISABLED', async () => {
    const gate = kasbah.registry.list().find((e) => e.descriptor.kind === 'cover' && e.descriptor.meta.cover?.deviceClass === 'gate')!.descriptor.id
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!.descriptor.id
    const opens = [{ type: 'command', target: { type: 'devices', deviceIds: [light] }, command: { type: 'light.set', on: true } },
      { type: 'command', target: { type: 'devices', deviceIds: [gate] }, command: { type: 'cover.open' } }]
    const r = JSON.parse(text(await client.callTool({ name: 'create_automation', arguments: {
      name: 'Arrivée', trigger: { type: 'time', at: { kind: 'clock', time: '18:00' } }, actions: opens,
    } })))
    expect(r).toMatchObject({ enabled: false, safety: { disabled: true, actions: [1] } })
    // renaming does not touch the safeguard; the MCP can neither switch it on nor run it: the app can
    expect(JSON.parse(text(await client.callTool({ name: 'update_automation', arguments: { id: r.id, name: 'Arrivée du soir' } }))).enabled).toBe(false)
    expect((await client.callTool({ name: 'set_automation_enabled', arguments: { id: r.id, enabled: true } })).isError).toBe(true)
    expect(JSON.parse(text(await client.callTool({ name: 'update_automation', arguments: { id: r.id, enabled: true } }))).enabled).toBe(false)
    expect((await client.callTool({ name: 'run_automation', arguments: { id: r.id } })).isError).toBe(true)
    expect(kasbah.automations.get(r.id)!.automation.enabled).toBe(false)
    await kasbah.app.inject({ method: 'PATCH', url: `/api/automations/${r.id}`, payload: { enabled: true } })
    expect(kasbah.automations.get(r.id)!.automation.enabled).toBe(true)
    // changing what it does disables it again
    const moved = JSON.parse(text(await client.callTool({ name: 'update_automation', arguments: { id: r.id, trigger: { type: 'time', at: { kind: 'clock', time: '19:00' } } } })))
    expect(moved).toMatchObject({ enabled: false, safety: { actions: [1] } })
    // closing the gate is not sensitive
    const closes = JSON.parse(text(await client.callTool({ name: 'update_automation', arguments: {
      id: r.id, enabled: true, actions: [{ ...opens[1], command: { type: 'cover.close' } }],
    } })))
    expect(closes.enabled).toBe(true)
    expect(closes.safety).toBeUndefined()
  })

  it('returns the history of a device that keeps one, and refuses the others', async () => {
    // the server's simulated plugin keeps neither a log nor water consumption: energy only
    const site = kasbah.registry.list().find((e) => e.descriptor.kind === 'energy')!
    const h = JSON.parse(text(await client.callTool({ name: 'get_device_history', arguments: { id: site.descriptor.id, hours: 6 } })))
    expect(h).toMatchObject({ id: site.descriptor.id, energy: expect.any(Array) })
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!.descriptor.id
    expect((await client.callTool({ name: 'get_device_history', arguments: { id: light } })).isError).toBe(true)
  })

  it('keeps the shopping list: adding, checking by name, usual items, finishing shopping', async () => {
    // both protocol versions share the server: one product per pass
    const milk = `Lait ${_label}`
    type View = { items: { id: string; name: string; quantity: number; checked: boolean }[]; favorites: string[] }
    const view = (r: { content: unknown }) => JSON.parse(text(r)) as View
    const line = (v: View) => v.items.find((i) => i.name === milk)
    let v = view(await client.callTool({ name: 'add_shopping_items', arguments: { items: [{ name: milk }, { name: milk.toUpperCase(), quantity: 2 }] } }))
    expect(line(v)).toMatchObject({ quantity: 3, checked: false })
    v = view(await client.callTool({ name: 'update_shopping_item', arguments: { item: milk.toLowerCase(), checked: true } }))
    expect(line(v)).toMatchObject({ checked: true })
    v = view(await client.callTool({ name: 'set_shopping_favorite', arguments: { name: milk, favorite: true } }))
    expect(v.favorites).toContain(milk)
    v = view(await client.callTool({ name: 'finish_shopping', arguments: {} }))
    expect(line(v)).toBeUndefined()
    expect(view(await client.callTool({ name: 'get_shopping_list', arguments: {} })).favorites).toContain(milk)
    expect((await client.callTool({ name: 'remove_shopping_item', arguments: { item: milk } })).isError).toBe(true)
    expect((await client.callTool({ name: 'update_shopping_item', arguments: { item: milk } })).isError).toBe(true)
  })

  it('removes the shopping list tools when it is turned off in Settings', async () => {
    const plugins = kasbah.house.house.plugins
    plugins.shopping = { enabled: false, parts: {}, autoDynamicForNewScenes: false }
    try {
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).filter((n) => n.includes('shopping'))).toEqual([])
    } finally { delete plugins.shopping }
  })

  it('serves the house as a resource', async () => {
    const r = await client.readResource({ uri: 'kasbah://house' })
    expect(JSON.parse((r.contents[0] as { text: string }).text).name).toBe(kasbah.house.house.name)
  })
})

// The calendar, the school and music titles are written by third parties: after reading them, the
// same token may not open an access to the house. A new token (the assistant's next request) may.
describe('opening an access after reading third-party content', () => {
  const connect = async () => {
    const client = new Client({ name: 'test', version: '0' }, { versionNegotiation: { mode: 'legacy' } })
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: (await signIn(url, LOGIN))! }))
    return client
  }

  it('refuses to open the gate with the token that read the agenda, the school or a music search', async () => {
    const gate = kasbah.registry.list().find((e) => e.descriptor.kind === 'cover' && e.descriptor.meta.cover?.deviceClass === 'gate')!.descriptor.id
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!.descriptor.id
    const open = { name: 'send_command', arguments: { deviceId: gate, command: { type: 'cover.open' } } }
    for (const read of [
      { name: 'get_agenda', arguments: {} }, { name: 'get_school', arguments: {} },
      { name: 'search_music', arguments: { query: 'jazz', source: 'radio' } },
    ]) {
      const client = await connect()
      expect((await client.callTool(open)).isError, read.name).toBeFalsy()
      await client.callTool(read) // read, whether it succeeds or not
      const refused = await client.callTool(open)
      expect(refused.isError, read.name).toBe(true)
      expect(text(refused), read.name).toMatch(/contenu extérieur/)
      // the rest still works, closing included
      expect((await client.callTool({ name: 'send_command', arguments: { deviceId: light, command: { type: 'light.set', on: true } } })).isError).toBeFalsy()
      expect((await client.callTool({ name: 'send_command', arguments: { deviceId: gate, command: { type: 'cover.close' } } })).isError).toBeFalsy()
      await client.close()
      // another token: a new request
      const next = await connect()
      expect((await next.callTool(open)).isError, read.name).toBeFalsy()
      await next.close()
    }
  })
})

// After both passes: the cap counts all the server's creations.
describe('cap on automation creations', () => {
  it(`refuses beyond ${AUTOMATION_CREATE_LIMIT} creations within the hour`, async () => {
    const client = new Client({ name: 'test', version: '0' }, { versionNegotiation: { mode: 'legacy' } })
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }))
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!.descriptor.id
    const before = kasbah.automations.list().length
    let refused: { isError?: unknown; content: unknown } | undefined
    for (let i = 0; i <= AUTOMATION_CREATE_LIMIT && !refused; i++) {
      const r = await client.callTool({ name: 'create_automation', arguments: {
        name: `Boucle ${i}`, trigger: { type: 'time', at: { kind: 'clock', time: '05:00' } },
        actions: [{ type: 'command', target: { type: 'devices', deviceIds: [light] }, command: { type: 'light.set', on: false } }],
      } })
      if (r.isError) refused = r
    }
    await client.close()
    expect(refused && text(refused)).toMatch(/dans l'heure/)
    expect(kasbah.automations.list().length - before).toBeLessThan(AUTOMATION_CREATE_LIMIT)
  })
})

describe('sensitiveActions', () => {
  const cmd = (target: object, command: object) => ({ type: 'command', target, command }) as AutomationAction
  const classes: Record<string, string | undefined> = { portail: 'gate', volet: 'shutter', lampe: undefined }
  const classOf = (id: string) => (id in classes ? classes[id] : null)
  const devices = (...deviceIds: string[]) => ({ type: 'devices', deviceIds })
  it('spots what opens an access or touches the car, nothing else', () => {
    expect(sensitiveActions([
      cmd(devices('volet'), { type: 'cover.open' }),
      cmd(devices('portail'), { type: 'cover.set_position', position: 0 }),
      cmd(devices('portail'), { type: 'cover.set_position', position: 40 }),
      cmd(devices('inconnu'), { type: 'cover.open' }),
      cmd({ type: 'selector', kind: 'cover', deviceClass: 'shutter' }, { type: 'cover.open' }),
      cmd({ type: 'selector', kind: 'cover' }, { type: 'cover.open' }),
      cmd(devices('voiture'), { type: 'vehicle.unlock' }),
      cmd(devices('voiture'), { type: 'vehicle.lock' }),
      cmd(devices('lampe'), { type: 'light.set', on: true }),
    ], classOf)).toEqual([2, 3, 5, 6])
  })
})

describe('schoolDigest', () => {
  const J = 'j-ce1-ce2'
  const hw = (id: number, date: string, levels: string[]) => ({
    id, journalId: J, date, title: 'devoirs', subject: null, author: 'Mme Martin', text: `texte ${id}`, levels, files: [], done: false, siteAck: null,
  })
  const data = {
    linked: true, sessionLost: false, fetchedAt: Date.UTC(2026, 9, 4, 14), error: null,
    journals: [{ id: J, name: 'CE1-CE2', years: '2026-2027', students: ['ÉLÈVE Lou'] }],
    homework: [hw(3, '2026-10-06', ['CE2']), hw(2, '2026-10-05', ['CE1']), hw(1, '2026-10-01', []), hw(4, '2026-10-05', [])],
    messages: [{ id: 10, journalId: J, at: '2026-09-08T17:09', title: 'sport', author: 'Mme Durand', text: 'baskets', levels: [], files: [], read: false, responses: 0 }],
    posts: [
      { id: 20, journalId: J, at: '2026-10-01T10:48', title: 'Photos', author: null, text: 'prêtes', levels: [], files: [{ type: 'image', url: 'https://s3.example/a.jpg', thumb: null, name: 'a.jpg' }], comments: 2 },
      { id: 19, journalId: J, at: '2026-09-30T08:00', title: 'Vote', author: null, text: 'pochette', levels: [], files: [], comments: 0 },
    ],
    filters: { hiddenJournals: [], hiddenLevels: ['CE1'] },
    postsSeen: 19,
  }
  const opts = { today: '2026-10-04', section: 'all' as const, includePast: false, includeHidden: false }

  it('returns upcoming homework sorted, with the School view filters applied', () => {
    const d = schoolDigest(data, opts)
    expect(d.homework!.map((h) => h.text)).toEqual(['texte 4', 'texte 3'])
    expect(d.homework![0]).toEqual({ date: '2026-10-05', class: 'CE1-CE2', title: 'devoirs', author: 'Mme Martin', text: 'texte 4', done: false })
  })

  it('returns past and hidden homework on request', () => {
    const d = schoolDigest(data, { ...opts, includePast: true, includeHidden: true })
    expect(d.homework!.map((h) => h.text)).toEqual(['texte 1', 'texte 2', 'texte 4', 'texte 3'])
  })

  it('flags read messages and new posts, attachments trimmed down', () => {
    const d = schoolDigest(data, opts)
    expect(d.messages).toEqual([{ at: '2026-09-08T17:09', class: 'CE1-CE2', title: 'sport', author: 'Mme Durand', text: 'baskets', read: false }])
    expect(d.posts!.map((p) => [p.title, p.new])).toEqual([['Photos', true], ['Vote', false]])
    expect(d.posts![0]!.files).toEqual([{ name: 'a.jpg', url: 'https://s3.example/a.jpg' }])
  })

  it('returns only the requested section, and reports a lost session', () => {
    const d = schoolDigest({ ...data, sessionLost: true }, { ...opts, section: 'messages' })
    expect(d.homework).toBeUndefined()
    expect(d.posts).toBeUndefined()
    expect(d.messages).toHaveLength(1)
    expect(d.error).toMatch(/session/)
  })
})

describe('agendaDigest', () => {
  it('sorts, names the calendar and returns the inclusive end of an all-day event', () => {
    const T = Date.UTC(2026, 9, 9, 12)
    const events = [
      { id: '1', calendarId: 'c', title: 'Dentiste', allDay: false as const, start: T, end: T + 1_800_000, location: 'Dijon' },
      { id: '2', calendarId: 'c', title: 'Vacances', allDay: true as const, start: '2026-10-08', end: '2026-10-11' },
      { id: '3', calendarId: 'c', title: 'Anniversaire', allDay: true as const, start: '2026-10-10', end: '2026-10-11' },
    ]
    expect(agendaDigest(events, [{ id: 'c', name: 'Famille' }], 'Europe/Paris')).toEqual([
      { calendar: 'Famille', title: 'Vacances', allDay: true, date: '2026-10-08', until: '2026-10-10' },
      { calendar: 'Famille', title: 'Dentiste', start: '2026-10-09 14:00', end: '2026-10-09 14:30', location: 'Dijon' },
      { calendar: 'Famille', title: 'Anniversaire', allDay: true, date: '2026-10-10' },
    ])
  })
})

describe('weatherDigest', () => {
  // 2026-10-09 12:00 UTC = 14:00 in Paris
  const T = Date.UTC(2026, 9, 9, 12)
  const state: StateFor<'weather'> = {
    kind: 'weather', updatedAt: T, available: true, condition: 'rain', tempC: 14, humidity: 80, windKmh: 20, windDirDeg: 250,
    cloudCover: 90, isDay: true, sunrise: Date.UTC(2026, 9, 9, 6, 5), sunset: Date.UTC(2026, 9, 9, 17, 10), observedAt: T,
    vigilance: [{ type: 'thunderstorm', level: 'yellow', onset: T, expires: T + 3_600_000 }],
  }
  const forecast: Pick<WeatherForecast, 'hourly' | 'daily'> = {
    hourly: [{ t: T, condition: 'rain', tempC: 14, precipMm: 1.2, windKmh: 20, isDay: true }],
    daily: [{ t: Date.UTC(2026, 9, 8, 22), condition: 'rain', minC: 9, maxC: 15, precipMm: 6, sunrise: state.sunrise, sunset: state.sunset }],
  }

  it('writes times in the place\'s time zone and strips the noise', () => {
    const d = weatherDigest(state, forecast, { tz: 'Europe/Paris' })
    expect(d.now).toMatchObject({ observedAt: '2026-10-09 14:00', sunrise: '08:05', sunset: '19:10', tempC: 14 })
    expect(d.now).not.toHaveProperty('kind')
    expect(d.now).not.toHaveProperty('vigilance')
    expect(d.hourly).toEqual([{ at: '2026-10-09 14:00', condition: 'rain', tempC: 14, precipMm: 1.2, windKmh: 20 }])
    expect(d.daily[0]).toMatchObject({ date: '2026-10-09', minC: 9, maxC: 15, sunrise: '08:05' })
  })

  it('takes the department\'s weather warnings, otherwise the current ones from the state', () => {
    const area = { area: "Côte-d'Or", warnings: [{ type: 'wind', level: 'orange' as const, onset: T, expires: T + 7_200_000 }] }
    expect(weatherDigest(state, forecast, { tz: 'Europe/Paris', vigilance: area }).vigilance)
      .toEqual({ area: "Côte-d'Or", warnings: [{ type: 'wind', level: 'orange', from: '2026-10-09 14:00', to: '2026-10-09 16:00' }] })
    expect(weatherDigest(state, forecast, { tz: 'Europe/Paris' }).vigilance!.warnings[0]).toMatchObject({ type: 'thunderstorm', to: '2026-10-09 15:00' })
    expect(weatherDigest(state, forecast, { vigilance: null }).vigilance).toBeNull()
    expect(weatherDigest({ ...state, vigilance: undefined }, forecast, {})).not.toHaveProperty('vigilance')
  })
})

it('get_agenda without the plugin returns a tool error', async () => {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }))
  expect((await client.callTool({ name: 'get_agenda', arguments: {} })).isError).toBe(true)
  await client.close()
})

it('get_school without the plugin returns a tool error', async () => {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }))
  const r = await client.callTool({ name: 'get_school', arguments: {} })
  expect(r.isError).toBe(true)
  await client.close()
})

it('accepts the machine\'s name on the local DNS', async () => {
  const res = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: 'kasbah:8787', 'content-type': 'application/json' }, payload: {} })
  expect(res.statusCode).toBe(401)
})

it('requires a token, even locally, and says where to find the authorization server', async () => {
  const res = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: 'kasbah:8787', 'content-type': 'application/json' }, payload: {} })
  expect(res.statusCode).toBe(401)
  expect(res.headers['www-authenticate']).toBe('Bearer resource_metadata="http://kasbah:8787/.well-known/oauth-protected-resource/mcp"')
  const bad = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer nope', 'content-type': 'application/json' }, payload: {} })
  expect(bad.statusCode).toBe(401)
  expect(bad.headers['www-authenticate']).toContain('error="invalid_token"')
})

it('refuses a Host that is neither localhost nor the machine (DNS rebinding)', async () => {
  const res = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: 'evil.example:8787', 'content-type': 'application/json' }, payload: {} })
  expect(res.statusCode).toBe(403)
})

describe("acting in the name of an account", () => {
  it('cannot be claimed from the network', async () => {
    const speaker = kasbah.registry.list().find((e) => e.descriptor.capabilities.includes('play_url'))!
    const res = await fetch(new URL('/api/music/play', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-kasbah-internal': 'guess', 'x-kasbah-user': 'mallory' },
      body: JSON.stringify({ source: 'ytmusic', id: 'vid-2', deviceId: speaker.descriptor.id }),
    })
    expect(res.status).toBe(200)
    expect(resolvedFor.at(-1)).toBeNull()
  })
})
