import { copyFile, mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Séance d'édition validée depuis le mode édition (apparence, forme des pièces) : la route ÉCRIT dans house.json, elle se teste donc sur
// une COPIE de la maison de démo — et chaque écriture laisse sa version précédente dans `history/`.

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

describe('PUT /api/house/edit', () => {
  let kasbah: KasbahApp
  let dir: string
  let file: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kasbah-appearance-'))
    file = join(dir, 'house.json')
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

  const put = (appearance: unknown) => kasbah.app.inject({ method: 'PUT', url: '/api/house/edit', payload: JSON.stringify({ appearance }), headers: { 'content-type': 'application/json' } })
  type Written = { rooms: { id: string; style?: Record<string, unknown> }[]; style?: Record<string, unknown> }
  const written = async () => JSON.parse(await readFile(file, 'utf8')) as Written

  it('écrit les finitions de pièce et de façade, et garde la version précédente dans history/', async () => {
    const before = await readFile(file, 'utf8')
    const res = await put({ rooms: { salon: { floor: { id: 'walnut' }, walls: { id: 'matte-paint', tint: '#336699' } } }, facade: { id: 'red-brick' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().house.style).toEqual({ facade: { id: 'red-brick' } })
    const doc = await written()
    expect(doc.rooms.find((r) => r.id === 'salon')!.style).toMatchObject({ floorFinish: { id: 'walnut' }, wallFinish: { id: 'matte-paint', tint: '#336699' } })
    const history = await readdir(join(dir, 'history'))
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(await readFile(join(dir, 'history', history.sort()[0]!), 'utf8')).toBe(before)
  })

  it('refuse une finition hors de sa surface, une pièce inconnue, sans rien écrire', async () => {
    const before = await readFile(file, 'utf8')
    expect((await put({ facade: { id: 'beige-carpet' } })).statusCode).toBe(400)
    expect((await put({ rooms: { nope: { floor: { id: 'oak' } } } })).statusCode).toBe(400)
    expect((await put({ rooms: { salon: { floor: { id: 'oak', tint: '#ff0000' } } } })).statusCode).toBe(400)
    expect(await readFile(file, 'utf8')).toBe(before)
  })

  const putShapes = (shapes: unknown) => kasbah.app.inject({ method: 'PUT', url: '/api/house/edit', payload: JSON.stringify({ shapes }), headers: { 'content-type': 'application/json' } })
  type Shaped = { rooms: { id: string; polygon: number[][]; meta?: { survey?: { points: number[][] } } }[] }

  it('écrit des cotes : la maison est convertie en relevé et le polygone recalculé', async () => {
    const res = await putShapes({ salon: [[310, -50], [1000, -50], [1000, 500], [310, 500]] })
    expect(res.statusCode).toBe(200)
    const doc = (await written()) as unknown as Shaped
    const salon = doc.rooms.find((r) => r.id === 'salon')!
    expect(salon.polygon[0]).toEqual([3.2, -0.5])
    expect(salon.meta!.survey!.points[0]).toEqual([310, -50])
    expect(doc.rooms.every((r) => r.meta?.survey?.points)).toBe(true)
  })

  it('refuse des pièces qui se chevauchent, sans rien écrire', async () => {
    const before = await readFile(file, 'utf8')
    const res = await putShapes({ entree: [[0, 0], [360, 0], [360, 800], [0, 800]] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVALID_SURVEY')
    expect(await readFile(file, 'utf8')).toBe(before)
  })
})
