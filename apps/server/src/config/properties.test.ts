import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from './env'
import { loadHouse } from './house'
import { DEMO_HOUSE_FILES, loadDemoProperties, readActiveDemo, writeActiveDemo } from './properties'

// Les propriétés de démonstration et leurs routes : liste, bascule demandée, refus d'un serveur à
// une seule maison. La reconstruction du serveur elle-même vit dans `main.ts`.

describe('demo properties', () => {
  it('reads the three demo houses with their kind and simulated park', async () => {
    const all = await loadDemoProperties()
    expect(all.map(({ id, kind, scenario }) => ({ id, kind, scenario }))).toEqual([
      { id: 'tilleuls', kind: 'house', scenario: 'tilleuls' },
      { id: 'embruns', kind: 'house', scenario: 'embruns' },
      { id: 'belvedere', kind: 'apartment', scenario: 'belvedere' },
    ])
  })

  it('remembers the active one across restarts, and reads nothing from a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-props-'))
    const file = join(dir, 'demo-property.json')
    expect(await readActiveDemo(file)).toBeNull()
    await writeActiveDemo('embruns', file)
    expect(await readActiveDemo(file)).toBe('embruns')
    await rm(dir, { recursive: true, force: true })
  })
})

describe('properties routes', () => {
  const build = async (properties?: Parameters<typeof buildApp>[0]['properties']) => {
    const k = await buildApp({
      env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
      logger: pino({ level: 'silent' }),
      house: await loadHouse(DEMO_HOUSE_FILES[0]!),
      envSource: {},
      serveStatic: false,
      ...(properties ? { properties } : {}),
    })
    await k.app.ready()
    return k
  }

  describe('single house', () => {
    let k: KasbahApp
    beforeAll(async () => { k = await build() })
    afterAll(async () => { await k.close() })

    it('lists the only property, not switchable, and refuses a switch', async () => {
      const list = await k.app.inject({ method: 'GET', url: '/api/properties' })
      expect(list.json()).toEqual({ activeId: 'tilleuls', switchable: false, properties: [{ id: 'tilleuls', name: 'Les Tilleuls', kind: 'house' }] })
      const sel = await k.app.inject({ method: 'POST', url: '/api/properties/embruns/select' })
      expect(sel.statusCode).toBe(409)
    })
  })

  describe('demo server', () => {
    let k: KasbahApp
    const asked: string[] = []
    beforeAll(async () => {
      const list = { activeId: 'tilleuls', switchable: true, properties: [{ id: 'tilleuls', name: 'Les Tilleuls', kind: 'house' as const }, { id: 'belvedere', name: 'Le Belvédère', kind: 'apartment' as const }] }
      k = await build({ list: () => list, select: (id) => { asked.push(id) } })
    })
    afterAll(async () => { await k.close() })

    it('accepts a known property (202) and refuses an unknown one (404)', async () => {
      expect((await k.app.inject({ method: 'POST', url: '/api/properties/belvedere/select' })).statusCode).toBe(202)
      expect((await k.app.inject({ method: 'POST', url: '/api/properties/ailleurs/select' })).statusCode).toBe(404)
      expect(asked).toEqual(['belvedere'])
    })
  })
})
