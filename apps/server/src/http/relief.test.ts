import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Relief du terrain posé depuis l'éditeur de la vue Maison : la route ÉCRIT dans house.json, elle se
// teste donc sur une COPIE de la maison de démo.

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

  it('écrit le relief dans le site et le rend dans la réponse', async () => {
    const res = await put(JSON.stringify(bump))
    expect(res.statusCode).toBe(200)
    expect(res.json().house.site.relief).toEqual(bump)
    expect((await written()).site.relief).toEqual(bump)
  })

  it('un relief plat, ou null, RETIRE le champ', async () => {
    await put(JSON.stringify(bump))
    expect((await put(JSON.stringify({ ...bump, rows: ['0 0', '0 0'] }))).statusCode).toBe(200)
    expect((await written()).site.relief).toBeUndefined()
    await put(JSON.stringify(bump))
    const res = await put('null')
    expect(res.statusCode).toBe(200)
    expect(res.json().house.site.relief).toBeUndefined()
  })

  it('refuse des rangées de longueurs différentes plutôt que de les écrire', async () => {
    expect((await put(JSON.stringify({ ...bump, rows: ['0 0 0', '0 0'] }))).statusCode).toBe(400)
  })
})
