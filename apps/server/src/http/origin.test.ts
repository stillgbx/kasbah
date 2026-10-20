import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// GPS origin aligned on the photo from Settings: the route WRITES into house.json, so it is tested
// on a COPY of the demo house.

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

describe('PUT /api/house/origin', () => {
  let kasbah: KasbahApp
  let file: string
  beforeAll(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'kasbah-origin-')), 'house.json')
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

  const put = (body: unknown) => kasbah.app.inject({ method: 'PUT', url: '/api/house/origin', payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  const written = async () => JSON.parse(await readFile(file, 'utf8')) as { origin: unknown; site: { terrain: unknown } }
  const origin = { lat: 45.5, lon: 4.25, alt: 210, heading: 24 }

  it('writes the origin and returns it in the response, without touching the rest', async () => {
    const before = await written()
    const res = await put(origin)
    expect(res.statusCode).toBe(200)
    expect(res.json().house.origin).toEqual(origin)
    const after = await written()
    expect(after.origin).toEqual(origin)
    expect(after.site.terrain).toEqual(before.site.terrain)
  })

  it('refuses an impossible latitude, without writing anything', async () => {
    await put(origin)
    expect((await put({ ...origin, lat: 120 })).statusCode).toBe(400)
    expect((await written()).origin).toEqual(origin)
  })
})
