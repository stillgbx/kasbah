import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'
import { ShoppingService } from '../core/shopping'

// Liste de courses : les routes ÉCRIVENT `<maison>.shopping.json`, elles se testent donc sur une
// COPIE de la maison de démo.

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

describe('/api/shopping', () => {
  let kasbah: KasbahApp
  let dir: string
  const broadcast: unknown[] = []
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kasbah-shopping-'))
    await copyFile(DEMO_HOUSE, join(dir, 'house.json'))
    kasbah = await buildApp({
      env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
      logger: pino({ level: 'silent' }),
      house: await loadHouse(join(dir, 'house.json')),
      envSource: {},
      serveStatic: false,
    })
    await kasbah.app.ready()
    const send = kasbah.hub.broadcast.bind(kasbah.hub)
    kasbah.hub.broadcast = (msg) => { broadcast.push(msg); send(msg) }
  })
  afterAll(async () => { await kasbah.close() })

  const inject = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: object) =>
    kasbah.app.inject({ method, url, ...(payload ? { payload } : {}) })
  const written = async () => JSON.parse(await readFile(join(dir, 'house.shopping.json'), 'utf8')) as { schemaVersion: number; items: { id: string; checked: boolean; quantity: number }[]; products: { id: string; favorite: boolean }[] }

  it('starts empty, then adds, checks, counts and finishes, writing next to the house', async () => {
    expect((await inject('GET', '/api/shopping')).json()).toEqual({ shopping: { items: [], products: [] } })
    expect((await inject('POST', '/api/shopping/items', { items: [{ name: 'Lait' }, { name: 'Pain' }] })).statusCode).toBe(200)
    expect((await inject('PATCH', '/api/shopping/items/lait', { checked: true })).json().shopping.items[0]).toMatchObject({ id: 'lait', checked: true })
    expect((await inject('PATCH', '/api/shopping/items/pain', { quantity: 3 })).json().shopping.items[1]).toMatchObject({ quantity: 3 })
    expect((await written()).items.map((i) => [i.id, i.checked, i.quantity])).toEqual([['lait', true, 1], ['pain', false, 3]])
    const done = (await inject('POST', '/api/shopping/finish')).json()
    expect(done.shopping.items.map((i: { id: string }) => i.id)).toEqual(['pain'])
    expect(broadcast.at(-1)).toEqual({ type: 'shopping', shopping: done.shopping })
  })

  it('stars a product and removes a line without forgetting the product', async () => {
    await inject('PUT', '/api/shopping/favorites', { name: 'pain', favorite: true })
    await inject('DELETE', '/api/shopping/items/pain')
    const f = await written()
    expect(f.items).toEqual([])
    expect(f.products.find((p) => p.id === 'pain')).toMatchObject({ favorite: true })
  })

  it('answers 404 for an unknown line and 400 for a bad body', async () => {
    expect((await inject('PATCH', '/api/shopping/items/riz', { checked: true })).statusCode).toBe(404)
    expect((await inject('DELETE', '/api/shopping/items/riz')).statusCode).toBe(404)
    expect((await inject('PATCH', '/api/shopping/items/riz', {})).statusCode).toBe(400)
    expect((await inject('POST', '/api/shopping/items', { items: [{ name: '  ' }] })).statusCode).toBe(400)
  })
})

describe('ShoppingService', () => {
  it('refuses an unreadable file instead of starting empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-shopping-'))
    const path = join(dir, 'house.shopping.json')
    await writeFile(path, JSON.stringify({ schemaVersion: 1, items: [{ id: 'x' }], products: [] }))
    await expect(new ShoppingService(path).load()).rejects.toThrow(/liste de courses invalide/)
  })

  it('runs concurrent operations one after the other', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-shopping-'))
    const s = new ShoppingService(join(dir, 'house.shopping.json'))
    await s.load()
    const add = (name: string) => s.update((l) => ({ ...l, items: [...l.items, { id: name, name, quantity: 1, checked: false, addedAt: 0 }] }))
    await Promise.all([add('a'), add('b'), add('c')])
    expect(s.get().items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('writes nothing on a demo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-shopping-'))
    const s = new ShoppingService(join(dir, 'house.shopping.json'), { readOnly: true })
    await expect(s.update((l) => l)).rejects.toMatchObject({ code: 'DEMO_READONLY' })
  })
})
