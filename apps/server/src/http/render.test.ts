import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NEUTRAL_TUNING } from '@kasbah/shared'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Réglage de la lumière posé depuis le banc de la vue Maison : la route ÉCRIT dans house.json, elle
// se teste donc sur une COPIE de la maison de démo — sinon chaque exécution modifierait le dépôt.

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

  it('écrit le réglage dans la maison et le rend dans la réponse', async () => {
    const res = await put({ ...NEUTRAL_TUNING, bloomThreshold: 1.45, glowOpacity: 0.5, toneMapping: 'agx' })
    expect(res.statusCode).toBe(200)
    expect(res.json().house.render.tuning).toMatchObject({ bloomThreshold: 1.45, glowOpacity: 0.5, toneMapping: 'agx' })
    expect((await written()).render!.tuning).toMatchObject({ bloomThreshold: 1.45 })
  })

  it('un réglage neutre RETIRE la section : une maison sans retouche n’en porte pas', async () => {
    await put({ ...NEUTRAL_TUNING, exposure: 0.8 })
    const res = await put(NEUTRAL_TUNING)
    expect(res.statusCode).toBe(200)
    expect(res.json().house.render).toBeUndefined()
    expect((await written()).render).toBeUndefined()
  })

  it('refuse un réglage hors bornes plutôt que de l’écrire', async () => {
    expect((await put({ ...NEUTRAL_TUNING, ringWidth: 12 })).statusCode).toBe(400)
  })
})
