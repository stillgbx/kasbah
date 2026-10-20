import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Terrain relief set from the editor of the Home view: the route WRITES into house.json, so it is
// tested on a COPY of the demo house.

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

describe('PUT /api/house/relief', () => {
  let kasbah: KasbahApp
  let file: string
  beforeAll(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'kasbah-relief-')), 'house.json')
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

  const put = (payload: string) => kasbah.app.inject({ method: 'PUT', url: '/api/house/relief', payload, headers: { 'content-type': 'application/json' } })
  const written = async () => JSON.parse(await readFile(file, 'utf8')) as { site: { relief?: unknown } }
  const bump = { step: 2, origin: [0, 0], rows: ['0 0 0', '0 40 0', '0 0 0'] }

  it('writes the relief into the site and returns it in the response', async () => {
    const res = await put(JSON.stringify(bump))
    expect(res.statusCode).toBe(200)
    expect(res.json().house.site.relief).toEqual(bump)
    expect((await written()).site.relief).toEqual(bump)
  })

  it('a flat relief, or null, REMOVES the field', async () => {
    await put(JSON.stringify(bump))
    expect((await put(JSON.stringify({ ...bump, rows: ['0 0', '0 0'] }))).statusCode).toBe(200)
    expect((await written()).site.relief).toBeUndefined()
    await put(JSON.stringify(bump))
    const res = await put('null')
    expect(res.statusCode).toBe(200)
    expect(res.json().house.site.relief).toBeUndefined()
  })

  it('refuses rows of different lengths rather than writing them', async () => {
    expect((await put(JSON.stringify({ ...bump, rows: ['0 0 0', '0 0'] }))).statusCode).toBe(400)
  })
})
