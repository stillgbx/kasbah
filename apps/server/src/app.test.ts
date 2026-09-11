import { resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from './app'
import { loadEnv } from './config/env'
import { loadHouse } from './config/house'

// Tests de l'application assemblée (routes réelles, `app.inject`), sans écoute ni matériel.

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../house/demo-house.json')

describe('app', () => {
  let kasbah: KasbahApp
  beforeAll(async () => {
    kasbah = await buildApp({
      env: loadEnv({ KASBAH_LOG_LEVEL: 'silent' }),
      logger: pino({ level: 'silent' }),
      house: await loadHouse(DEMO_HOUSE),
      envSource: {},
      serveStatic: false,
    })
    await kasbah.app.ready()
  })
  afterAll(async () => { await kasbah.close() })

  it('accepts device ids longer than Fastify’s default 100-character parameter limit', async () => {
    // id maison dérivé par l'auto-placement d'une caméra Nest : `auto.nest-` + 96 caractères = 104.
    // Le défaut de Fastify répondait 414 avant même d'atteindre la route (mode Déplacer en échec).
    const nestId = 'AVPHwEZ7RqKY7dM7hhrmxx8E7zZ53Yir7urY-0Lb9t3xM1PM0Bx2ZDsvKkWoCAwqNZlKPRyevEJwmmdtadoxc-zPRFu-Wp'
    const houseDeviceId = `auto.nest-${nestId}`
    expect(houseDeviceId.length).toBeGreaterThan(100)
    const res = await kasbah.app.inject({ method: 'GET', url: `/api/devices/${houseDeviceId}` })
    expect(res.statusCode).toBe(404)                    // la route a bien été atteinte : appareil inconnu
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
