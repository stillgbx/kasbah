import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from './app'
import { loadEnv } from './config/env'
import { loadHouse } from './config/house'

// Tests of the assembled application (real routes, `app.inject`), without listening or hardware.

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

  it('compresses what is compressible, and only when the client asks for it', async () => {
    // The demo house weighs well above the 1 KB threshold below which compressing is not worth
    // the cost. What this test guards is the registration ORDER: the compression `onSend` hook
    // only applies to routes declared AFTER it, and nothing reports it.
    // A client that does not announce it gets the JSON as is: compression is never forced.
    const plain = await kasbah.app.inject({ method: 'GET', url: '/api/house' })
    expect(plain.statusCode).toBe(200)
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.rawPayload.length).toBeGreaterThan(1024)

    const sent = await kasbah.app.inject({ method: 'GET', url: '/api/house', headers: { 'accept-encoding': 'gzip' } })
    expect(sent.statusCode).toBe(200)
    expect(sent.headers['content-encoding']).toBe('gzip')
    expect(sent.rawPayload.length).toBeLessThan(plain.rawPayload.length)
    expect(gunzipSync(sent.rawPayload).toString()).toBe(plain.rawPayload.toString())
  })

  it('accepts device ids longer than Fastify’s default 100-character parameter limit', async () => {
    // house id derived by the auto-placement of a Nest camera: `auto.nest-` + 96 characters = 104.
    // Fastify's default answered 414 before even reaching the route (Move mode failing).
    const nestId = 'AVPHwEZ7RqKY7dM7hhrmxx8E7zZ53Yir7urY-0Lb9t3xM1PM0Bx2ZDsvKkWoCAwqNZlKPRyevEJwmmdtadoxc-zPRFu-Wp'
    const houseDeviceId = `auto.nest-${nestId}`
    expect(houseDeviceId.length).toBeGreaterThan(100)
    const res = await kasbah.app.inject({ method: 'GET', url: `/api/devices/${houseDeviceId}` })
    expect(res.statusCode).toBe(404)                    // the route was indeed reached: unknown device
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })
})
