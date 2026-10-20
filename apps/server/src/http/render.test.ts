import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NEUTRAL_TUNING } from '@kasbah/shared'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Lighting tuning set from the bench of the Home view: the route WRITES into house.json, so it is
// tested on a COPY of the demo house — otherwise each run would modify the repo.

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

describe('PUT /api/house/render', () => {
  let kasbah: KasbahApp
  let file: string
  beforeAll(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'kasbah-render-')), 'house.json')
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

  const put = (payload: object) => kasbah.app.inject({ method: 'PUT', url: '/api/house/render', payload })
  const written = async () => JSON.parse(await readFile(file, 'utf8')) as { render?: { tuning?: Record<string, unknown> } }

  it('writes the tuning into the house and returns it in the response', async () => {
    const res = await put({ ...NEUTRAL_TUNING, bloomThreshold: 1.45, glowOpacity: 0.5, toneMapping: 'agx' })
    expect(res.statusCode).toBe(200)
    expect(res.json().house.render.tuning).toMatchObject({ bloomThreshold: 1.45, glowOpacity: 0.5, toneMapping: 'agx' })
    expect((await written()).render!.tuning).toMatchObject({ bloomThreshold: 1.45 })
  })

  it('a neutral tuning REMOVES the section: a house without adjustments carries none', async () => {
    await put({ ...NEUTRAL_TUNING, exposure: 0.8 })
    const res = await put(NEUTRAL_TUNING)
    expect(res.statusCode).toBe(200)
    expect(res.json().house.render).toBeUndefined()
    expect((await written()).render).toBeUndefined()
  })

  it('refuses an out-of-bounds tuning rather than writing it', async () => {
    expect((await put({ ...NEUTRAL_TUNING, ringWidth: 12 })).statusCode).toBe(400)
  })
})
