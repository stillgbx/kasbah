import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { StateFor, WeatherForecast } from '@kasbah/shared'
import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'
import { registerMusicSource } from '../music/sources'
import { createMockPlugin } from '../plugins/mock'
import { hashPassword } from './auth'
import { agendaDigest, schoolDigest, weatherDigest } from './server'
import { signIn, type TestOAuthProvider } from './test-oauth'

// `/mcp` servi par l'application assemblée, interrogé par le vrai client du SDK dans les DEUX
// versions du protocole : 2025 (ce que parlent les clients d'aujourd'hui) et 2026-07-28 (sans état).

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

let kasbah: KasbahApp
let url: URL
// Une source ytmusic factice : le vrai plugin demande un cookie et le réseau. Elle note pour quel
// compte chaque piste est résolue.
let unregister: () => void
const resolvedFor: (string | null)[] = []
// Un compte dans un fichier jetable ; chaque client passe par la vraie connexion OAuth.
const LOGIN = { username: 'lou', password: 'correct horse battery' }
let provider: TestOAuthProvider
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kasbah-mcp-'))
  const usersFile = join(dir, 'mcp-users.json')
  // une copie de la maison : ses automatisations s'écrivent à côté d'elle, pas dans le dépôt
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
    // les enceintes refusent localhost : le lecteur commun exige une base publiée
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

  it('expose les outils', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['add_shopping_items', 'control_music', 'finish_shopping', 'get_agenda', 'get_device', 'get_device_history', 'get_health', 'get_music', 'get_school', 'get_shopping_list', 'get_weather', 'list_automations', 'list_devices', 'list_scenes', 'play_music', 'play_radio', 'queue_music', 'recall_scene', 'remove_shopping_item', 'run_automation', 'search_music', 'send_command', 'set_automation_enabled', 'set_shopping_favorite', 'update_shopping_item'])
  })

  it('joue une piste par le lecteur commun, sur une enceinte', async () => {
    const speaker = kasbah.registry.list().find((e) => e.descriptor.capabilities.includes('play_url'))!
    const r = await client.callTool({ name: 'play_music', arguments: {
      deviceId: speaker.descriptor.id,
      tracks: [{ source: 'ytmusic', id: 'vid-1', title: 'Gymnopédie No.1', artist: 'Erik Satie', durationS: 281 }],
    } })
    expect(r.isError).toBeFalsy()
    const queue = (await kasbah.app.inject({ method: 'GET', url: `/api/music/queue?deviceId=${speaker.descriptor.id}` })).json()
    expect(JSON.stringify(queue)).toContain('Gymnopédie No.1')
    // au nom du compte du jeton : ce sont ses comptes musicaux qui jouent
    expect(resolvedFor.at(-1)).toBe(LOGIN.username)
  })

  it('lit et pilote la file du lecteur commun', async () => {
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

  it('dit pourquoi une source ne répond pas, au lieu d\'échouer en silence', async () => {
    const r = await client.callTool({ name: 'search_music', arguments: { query: 'erik satie', source: 'radio' } })
    expect(r.isError).toBe(true)
    const speaker = kasbah.registry.list().find((e) => e.descriptor.capabilities.includes('play_url'))!
    const off = await client.callTool({ name: 'play_music', arguments: { deviceId: speaker.descriptor.id, tracks: [{ source: 'mixcloud', id: '/u/mix/' }] } })
    expect(off.isError).toBe(true)
    expect(text(off)).toMatch(/mixcloud/)
  })

  it('liste les appareils filtrés par kind', async () => {
    const lights = JSON.parse(text(await client.callTool({ name: 'list_devices', arguments: { kind: 'light' } })))
    expect(lights.length).toBeGreaterThan(0)
    expect(lights.every((d: { kind: string }) => d.kind === 'light')).toBe(true)
  })

  it('commande un appareil et le registre suit', async () => {
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!
    for (const on of [true, false]) {
      const r = await client.callTool({ name: 'send_command', arguments: { deviceId: light.descriptor.id, command: { type: 'light.set', on } } })
      expect(r.isError).toBeFalsy()
      expect(kasbah.registry.get(light.descriptor.id)!.state).toMatchObject({ on })
    }
  })

  it('rend une erreur d\'outil, pas une exception, pour un appareil inconnu ou une commande refusée', async () => {
    const unknown = await client.callTool({ name: 'send_command', arguments: { deviceId: 'mock:nope', command: { type: 'cover.open' } } })
    expect(unknown.isError).toBe(true)
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!
    const refused = await client.callTool({ name: 'send_command', arguments: { deviceId: light.descriptor.id, command: { type: 'cover.open' } } })
    expect(refused.isError).toBe(true)
  })

  it('rend la météo de la maison avec ses prévisions', async () => {
    const r = await client.callTool({ name: 'get_weather', arguments: {} })
    expect(r.isError).toBeFalsy()
    const w = JSON.parse(text(r))
    expect(w.place).toEqual({ name: kasbah.house.house.name, home: true })
    expect(w.now.condition).toBeTypeOf('string')
    expect(w.hourly.length).toBeGreaterThan(0)
    expect(w.daily.length).toBeGreaterThan(0)
    expect(w.daily[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('dit pourquoi la météo d\'un autre lieu ne répond pas (plugin open meteo absent)', async () => {
    const r = await client.callTool({ name: 'get_weather', arguments: { place: 'Pornic' } })
    expect(r.isError).toBe(true)
  })

  it('lit, coupe et lance une automatisation', async () => {
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

  it('rend l\'historique d\'un appareil qui en garde un, et refuse les autres', async () => {
    // le plugin simulé du serveur ne tient ni journal ni consommation d'eau : l'énergie seule
    const site = kasbah.registry.list().find((e) => e.descriptor.kind === 'energy')!
    const h = JSON.parse(text(await client.callTool({ name: 'get_device_history', arguments: { id: site.descriptor.id, hours: 6 } })))
    expect(h).toMatchObject({ id: site.descriptor.id, energy: expect.any(Array) })
    const light = kasbah.registry.list().find((e) => e.descriptor.kind === 'light')!.descriptor.id
    expect((await client.callTool({ name: 'get_device_history', arguments: { id: light } })).isError).toBe(true)
  })

  it('tient la liste de courses : ajout, coche par le nom, habituels, fin des courses', async () => {
    // les deux versions du protocole partagent le serveur : un produit par passage
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

  it('sert la maison en ressource', async () => {
    const r = await client.readResource({ uri: 'kasbah://house' })
    expect(JSON.parse((r.contents[0] as { text: string }).text).name).toBe(kasbah.house.house.name)
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

  it('rend les devoirs à venir triés, filtres de la vue École appliqués', () => {
    const d = schoolDigest(data, opts)
    expect(d.homework!.map((h) => h.text)).toEqual(['texte 4', 'texte 3'])
    expect(d.homework![0]).toEqual({ date: '2026-10-05', class: 'CE1-CE2', title: 'devoirs', author: 'Mme Martin', text: 'texte 4', done: false })
  })

  it('rend les devoirs passés et masqués sur demande', () => {
    const d = schoolDigest(data, { ...opts, includePast: true, includeHidden: true })
    expect(d.homework!.map((h) => h.text)).toEqual(['texte 1', 'texte 2', 'texte 4', 'texte 3'])
  })

  it('marque messages lus et publications nouvelles, pièces jointes réduites', () => {
    const d = schoolDigest(data, opts)
    expect(d.messages).toEqual([{ at: '2026-09-08T17:09', class: 'CE1-CE2', title: 'sport', author: 'Mme Durand', text: 'baskets', read: false }])
    expect(d.posts!.map((p) => [p.title, p.new])).toEqual([['Photos', true], ['Vote', false]])
    expect(d.posts![0]!.files).toEqual([{ name: 'a.jpg', url: 'https://s3.example/a.jpg' }])
  })

  it('ne rend que la section demandée, et signale une session perdue', () => {
    const d = schoolDigest({ ...data, sessionLost: true }, { ...opts, section: 'messages' })
    expect(d.homework).toBeUndefined()
    expect(d.posts).toBeUndefined()
    expect(d.messages).toHaveLength(1)
    expect(d.error).toMatch(/session/)
  })
})

describe('agendaDigest', () => {
  it('trie, nomme l\'agenda et rend la fin incluse d\'une journée entière', () => {
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
  // 2026-10-09 12:00 UTC = 14:00 à Paris
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

  it('écrit les heures dans le fuseau du lieu et retire le bruit', () => {
    const d = weatherDigest(state, forecast, { tz: 'Europe/Paris' })
    expect(d.now).toMatchObject({ observedAt: '2026-10-09 14:00', sunrise: '08:05', sunset: '19:10', tempC: 14 })
    expect(d.now).not.toHaveProperty('kind')
    expect(d.now).not.toHaveProperty('vigilance')
    expect(d.hourly).toEqual([{ at: '2026-10-09 14:00', condition: 'rain', tempC: 14, precipMm: 1.2, windKmh: 20 }])
    expect(d.daily[0]).toMatchObject({ date: '2026-10-09', minC: 9, maxC: 15, sunrise: '08:05' })
  })

  it('prend la vigilance du département, sinon celle en cours de l\'état', () => {
    const area = { area: "Côte-d'Or", warnings: [{ type: 'wind', level: 'orange' as const, onset: T, expires: T + 7_200_000 }] }
    expect(weatherDigest(state, forecast, { tz: 'Europe/Paris', vigilance: area }).vigilance)
      .toEqual({ area: "Côte-d'Or", warnings: [{ type: 'wind', level: 'orange', from: '2026-10-09 14:00', to: '2026-10-09 16:00' }] })
    expect(weatherDigest(state, forecast, { tz: 'Europe/Paris' }).vigilance!.warnings[0]).toMatchObject({ type: 'thunderstorm', to: '2026-10-09 15:00' })
    expect(weatherDigest(state, forecast, { vigilance: null }).vigilance).toBeNull()
    expect(weatherDigest({ ...state, vigilance: undefined }, forecast, {})).not.toHaveProperty('vigilance')
  })
})

it('get_agenda sans le plugin rend une erreur d\'outil', async () => {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }))
  expect((await client.callTool({ name: 'get_agenda', arguments: {} })).isError).toBe(true)
  await client.close()
})

it('get_school sans le plugin rend une erreur d\'outil', async () => {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }))
  const r = await client.callTool({ name: 'get_school', arguments: {} })
  expect(r.isError).toBe(true)
  await client.close()
})

it('accepte le nom du poste sur le DNS local', async () => {
  const res = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: 'kasbah:8787', 'content-type': 'application/json' }, payload: {} })
  expect(res.statusCode).toBe(401)
})

it('exige un jeton, même en local, et dit où trouver le serveur d\'autorisation', async () => {
  const res = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: 'kasbah:8787', 'content-type': 'application/json' }, payload: {} })
  expect(res.statusCode).toBe(401)
  expect(res.headers['www-authenticate']).toBe('Bearer resource_metadata="http://kasbah:8787/.well-known/oauth-protected-resource/mcp"')
  const bad = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer nope', 'content-type': 'application/json' }, payload: {} })
  expect(bad.statusCode).toBe(401)
  expect(bad.headers['www-authenticate']).toContain('error="invalid_token"')
})

it('refuse un Host qui n\'est ni localhost ni le poste (DNS rebinding)', async () => {
  const res = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: 'evil.example:8787', 'content-type': 'application/json' }, payload: {} })
  expect(res.statusCode).toBe(403)
})

describe("agir au nom d'un compte", () => {
  it('ne se laisse pas réclamer depuis le réseau', async () => {
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
