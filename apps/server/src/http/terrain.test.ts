import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Contour du terrain posé depuis l'éditeur de la vue Maison : la route ÉCRIT dans house.json, elle se
// teste donc sur une COPIE de la maison de démo.

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

describe('PUT /api/house/terrain', () => {
  let kasbah: KasbahApp
  let file: string
  beforeAll(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'kasbah-terrain-')), 'house.json')
    await copyFile(DEMO_HOUSE, file)
    kasbah = await buildApp({
      env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
      logger: pino({ level: 'silent' }),
      house: await loadHouse(file),
      envSource: {},
      serveStatic: false,
    })
    await kasbah.app.ready()
  })
  afterAll(async () => { await kasbah.close() })

  const put = (path: string, body: unknown) => kasbah.app.inject({ method: 'PUT', url: path, payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  const written = async () => JSON.parse(await readFile(file, 'utf8')) as { site: { terrain: unknown; relief?: { origin: number[]; rows: string[] } } }
  const outline = [[-30, -30], [40, -30], [40, 35], [-30, 35]]

  it('écrit le contour dans le site et le rend dans la réponse', async () => {
    const res = await put('/api/house/terrain', outline)
    expect(res.statusCode).toBe(200)
    expect(res.json().house.site.terrain).toEqual(outline)
    expect((await written()).site.terrain).toEqual(outline)
  })

  it('refuse un contour qui se croise, ou de moins de trois points, sans rien écrire', async () => {
    await put('/api/house/terrain', outline)
    expect((await put('/api/house/terrain', [[0, 0], [10, 10], [10, 0], [0, 10]])).statusCode).toBe(400)
    expect((await put('/api/house/terrain', [[0, 0], [10, 0]])).statusCode).toBe(400)
    expect((await written()).site.terrain).toEqual(outline)
  })

  it('agrandit un relief qui ne couvre plus le contour, sans changer ses hauteurs', async () => {
    await put('/api/house/terrain', outline)
    await put('/api/house/relief', { step: 2, origin: [0, 0], rows: ['0 0 0', '0 40 0', '0 0 0'] })
    expect((await put('/api/house/terrain', outline)).statusCode).toBe(200)
    const relief = (await written()).site.relief!
    expect(relief.origin).toEqual([-32, -32])       // une maille de marge sous le coin sud-ouest
    const cols = relief.rows[0]!.split(' ').length
    expect(cols).toBe(38)                           // de x = -32 à x = 42
    expect(relief.rows.length).toBe(36)             // de y = -32 à y = 38
    // le nœud (1, 1) du relief d'origine est toujours à 40 cm, à sa place
    expect(relief.rows[17]!.split(' ')[17]).toBe('40')
    expect(relief.rows[0]!.split(' ')[0]).toBe('0')
  })
})
