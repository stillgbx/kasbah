import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'
import { registerMusicSource } from '../music/sources'
import { createMockPlugin } from '../plugins/mock'

// `/mcp` servi par l'application assemblée, interrogé par le vrai client du SDK dans les DEUX
// versions du protocole : 2025 (ce que parlent les clients d'aujourd'hui) et 2026-07-28 (sans état).

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

let kasbah: KasbahApp
let url: URL
// Une source ytmusic factice : le vrai plugin demande un cookie et le réseau.
let unregister: () => void
beforeAll(async () => {
  unregister = registerMusicSource({
    id: 'ytmusic', label: 'YouTube Music',
    resolve: async () => ({ url: 'http://192.0.2.9/audio.m4a', formatId: '140', ext: 'm4a', abrKbps: 128, sizeBytes: 4_500_000, durationS: 281 }),
  })
  kasbah = await buildApp({
    env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
    logger: pino({ level: 'silent' }),
    house: await loadHouse(DEMO_HOUSE),
    factories: { mock: createMockPlugin },
    // les enceintes refusent localhost : le lecteur commun exige une base publiée
    envSource: { MUSIC_PUBLISH_BASE: 'http://192.0.2.1:8787' },
    serveStatic: false,
  })
  await kasbah.app.listen({ port: 0, host: '127.0.0.1' })
  await kasbah.startPlugins()
  url = new URL(`http://127.0.0.1:${(kasbah.app.server.address() as AddressInfo).port}/mcp`)
})
afterAll(async () => { unregister(); await kasbah.close() })

const text = (r: { content: unknown }) => (r.content as { text: string }[])[0]!.text

describe.each<[string, VersionNegotiationMode]>([['2025', 'legacy'], ['2026-07-28', { pin: '2026-07-28' }]])('MCP (%s)', (_label, mode) => {
  let client: Client
  beforeAll(async () => {
    client = new Client({ name: 'test', version: '0' }, { versionNegotiation: { mode } })
    await client.connect(new StreamableHTTPClientTransport(url))
  })
  afterAll(async () => { await client.close() })

  it('expose les outils', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['get_device', 'get_health', 'list_devices', 'list_scenes', 'play_music', 'play_radio', 'recall_scene', 'search_music', 'send_command'])
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

  it('sert la maison en ressource', async () => {
    const r = await client.readResource({ uri: 'kasbah://house' })
    expect(JSON.parse((r.contents[0] as { text: string }).text).name).toBe(kasbah.house.house.name)
  })
})

it('accepte le nom du poste sur le DNS local', async () => {
  const res = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: 'kasbah:8787', 'content-type': 'application/json' }, payload: {} })
  expect(res.statusCode).not.toBe(403)
})

it('refuse un Host qui n\'est ni localhost ni le poste (DNS rebinding)', async () => {
  const res = await kasbah.app.inject({ method: 'POST', url: '/mcp', headers: { host: 'evil.example:8787', 'content-type': 'application/json' }, payload: {} })
  expect(res.statusCode).toBe(403)
})
