import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Terrain outline set from the editor of the Home view: the route WRITES into house.json, so it is
// tested on a COPY of the demo house.

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

  it('writes the outline into the site and returns it in the response', async () => {
    const res = await put('/api/house/terrain', outline)
    expect(res.statusCode).toBe(200)
    expect(res.json().house.site.terrain).toEqual(outline)
    expect((await written()).site.terrain).toEqual(outline)
  })

  it('refuses a self-crossing outline, or one with fewer than three points, without writing anything', async () => {
    await put('/api/house/terrain', outline)
    expect((await put('/api/house/terrain', [[0, 0], [10, 10], [10, 0], [0, 10]])).statusCode).toBe(400)
    expect((await put('/api/house/terrain', [[0, 0], [10, 0]])).statusCode).toBe(400)
    expect((await written()).site.terrain).toEqual(outline)
  })

  it('enlarges a relief that no longer covers the outline, without changing its heights', async () => {
    await put('/api/house/terrain', outline)
    await put('/api/house/relief', { step: 2, origin: [0, 0], rows: ['0 0 0', '0 40 0', '0 0 0'] })
    expect((await put('/api/house/terrain', outline)).statusCode).toBe(200)
    const relief = (await written()).site.relief!
    expect(relief.origin).toEqual([-32, -32])       // one cell of margin beyond the south-west corner
    const cols = relief.rows[0]!.split(' ').length
    expect(cols).toBe(38)                           // from x = -32 to x = 42
    expect(relief.rows.length).toBe(36)             // from y = -32 to y = 38
    // node (1, 1) of the original relief is still at 40 cm, in its place
    expect(relief.rows[17]!.split(' ')[17]).toBe('40')
    expect(relief.rows[0]!.split(' ')[0]).toBe('0')
  })
})
