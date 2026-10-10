import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from './env'
import { loadHouse } from './house'
import { parseHouse } from '@kasbah/shared'
import { createAutomationsFile } from '../core/automations/store'
import { DEMO_HOUSE_FILES, createLocalProperty, duplicateProperty, loadDemoProperties, loadLocalProperties, readModeState, writeModeState } from './properties'

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

  it('remembers the mode and the property of each mode across restarts, and takes over the old single choice once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-props-'))
    const file = join(dir, 'property-mode.json'), legacy = join(dir, 'demo-property.json')
    expect(await readModeState(file, legacy)).toEqual({})
    await writeFile(legacy, JSON.stringify({ active: 'embruns' }))
    expect(await readModeState(file, legacy)).toEqual({ demo: 'embruns', real: 'embruns' })
    await writeModeState({ mode: 'real', demo: 'tilleuls', real: 'maison' }, file)
    expect(await readModeState(file, legacy)).toEqual({ mode: 'real', demo: 'tilleuls', real: 'maison' })
    await rm(dir, { recursive: true, force: true })
  })
})

const NEW_BODY = {
  name: 'Maison du lac', kind: 'house' as const, origin: { lat: 45, lon: 5, heading: 20 },
  terrain: { width: 30, depth: 20 }, levelName: 'Rez-de-chaussée', roomName: 'Séjour',
}

describe('local properties', () => {
  it('creates a valid new house, duplicates a demo with its simulated park, and lists both by name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-local-'))
    const id = await createLocalProperty(NEW_BODY, ['tilleuls'], dir)
    expect(id).toBe('maison-du-lac')
    const house = parseHouse(JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8')))
    expect(house.plugins).toEqual({})
    expect(house.rooms.map((r) => r.name)).toEqual(['Séjour'])
    expect(house.origin).toMatchObject({ lat: 45, lon: 5, heading: 20 })
    const [demo] = await loadDemoProperties()
    const copy = await duplicateProperty({ ...demo!, demo: true }, 'Les Tilleuls', ['tilleuls', id], dir)
    expect(copy).toBe('les-tilleuls')
    const list = await loadLocalProperties(dir)
    expect(list.map(({ id: i, demo: d, scenario }) => ({ id: i, demo: d, scenario }))).toEqual([
      { id: 'les-tilleuls', demo: false, scenario: 'tilleuls' },
      { id: 'maison-du-lac', demo: false, scenario: undefined },
    ])
    expect(await loadLocalProperties(join(dir, 'absent'))).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  it('a read-only automations file refuses to write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-ro-'))
    await expect(createAutomationsFile(join(dir, 'x.automations.json'), { readOnly: true }).save([])).rejects.toMatchObject({ statusCode: 409, code: 'DEMO_READONLY' })
    await rm(dir, { recursive: true, force: true })
  })
})

describe('properties routes', () => {
  const build = async (properties?: Parameters<typeof buildApp>[0]['properties'], readOnly = false) => {
    const k = await buildApp({
      env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
      logger: pino({ level: 'silent' }),
      house: await loadHouse(DEMO_HOUSE_FILES[0]!),
      envSource: {},
      serveStatic: false,
      ...(properties ? { properties } : {}),
      ...(readOnly ? { readOnly } : {}),
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
      expect((await k.app.inject({ method: 'POST', url: '/api/properties', payload: NEW_BODY })).statusCode).toBe(409)
      expect((await k.app.inject({ method: 'POST', url: '/api/properties/mode', payload: { mode: 'demo' } })).statusCode).toBe(409)
    })
  })

  describe('demo server', () => {
    let k: KasbahApp
    const asked: string[] = []
    const made: string[] = []
    beforeAll(async () => {
      const list = { activeId: 'tilleuls', switchable: true, canCreate: true, mode: 'demo' as const, realAvailable: false, properties: [{ id: 'tilleuls', name: 'Les Tilleuls', kind: 'house' as const, demo: true }, { id: 'belvedere', name: 'Le Belvédère', kind: 'apartment' as const, demo: true }] }
      k = await build({
        list: () => list, select: (id) => { asked.push(id) },
        create: async (body) => { made.push(`new:${body.name}`); return 'maison-du-lac' },
        duplicate: async (id, name) => { made.push(`dup:${id}:${name}`); return 'copie' },
        setMode: (mode) => { asked.push(`mode:${mode}`) },
        // le catalogue connaît aussi les propriétés de l'AUTRE mode (une propriété réelle qu'on vient de créer en démo)
        has: (id) => list.properties.some((p) => p.id === id) || id === 'nouvelle',
      }, true)
    })
    afterAll(async () => { await k.close() })

    it('accepts a known property (202) and refuses an unknown one (404)', async () => {
      expect((await k.app.inject({ method: 'POST', url: '/api/properties/belvedere/select' })).statusCode).toBe(202)
      expect((await k.app.inject({ method: 'POST', url: '/api/properties/ailleurs/select' })).statusCode).toBe(404)
      expect(asked).toEqual(['belvedere'])
    })

    it('bascule vers une propriété de l’autre mode : celle qu’on vient de créer en démo (202)', async () => {
      expect((await k.app.inject({ method: 'POST', url: '/api/properties/nouvelle/select' })).statusCode).toBe(202)
      expect(asked).toContain('nouvelle')
    })

    it('switches to the demo mode (202), refuses the real one while it has no property (409)', async () => {
      expect((await k.app.inject({ method: 'POST', url: '/api/properties/mode', payload: { mode: 'demo' } })).statusCode).toBe(202)
      const real = await k.app.inject({ method: 'POST', url: '/api/properties/mode', payload: { mode: 'real' } })
      expect(real.statusCode).toBe(409)
      expect(real.json().error.code).toBe('NO_REAL_PROPERTY')
      expect((await k.app.inject({ method: 'POST', url: '/api/properties/mode', payload: { mode: 'other' } })).statusCode).toBe(400)
      expect(asked).toContain('mode:demo')
      expect(asked).not.toContain('mode:real')
    })

    it('creates (201), duplicates (201), and validates the body (400)', async () => {
      const created = await k.app.inject({ method: 'POST', url: '/api/properties', payload: NEW_BODY })
      expect(created.statusCode).toBe(201)
      expect(created.json()).toEqual({ id: 'maison-du-lac' })
      const dup = await k.app.inject({ method: 'POST', url: '/api/properties/tilleuls/duplicate', payload: { name: 'Copie' } })
      expect(dup.json()).toEqual({ id: 'copie' })
      expect((await k.app.inject({ method: 'POST', url: '/api/properties', payload: { ...NEW_BODY, name: '' } })).statusCode).toBe(400)
      expect(made).toEqual(['new:Maison du lac', 'dup:tilleuls:Copie'])
    })

    it('a demo refuses every write of the house (409 DEMO_READONLY), and the file is untouched', async () => {
      const before = await readFile(DEMO_HOUSE_FILES[0]!, 'utf8')
      const res = await k.app.inject({ method: 'PATCH', url: '/api/plugins/mock', payload: { enabled: false } })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe('DEMO_READONLY')
      expect(await readFile(DEMO_HOUSE_FILES[0]!, 'utf8')).toBe(before)
    })
  })
})
