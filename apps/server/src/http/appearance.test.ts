import { copyFile, mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type KasbahApp } from '../app'
import { loadEnv } from '../config/env'
import { loadHouse } from '../config/house'

// Apparence validée depuis le mode édition : la route ÉCRIT dans house.json, elle se teste donc sur
// une COPIE de la maison de démo — et chaque écriture laisse sa version précédente dans `history/`.

const DEMO_HOUSE = resolve(import.meta.dirname, '../../../../house/demo-house.json')

describe('PUT /api/house/appearance', () => {
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

  const put = (body: unknown) => kasbah.app.inject({ method: 'PUT', url: '/api/house/appearance', payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
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
})
