import { describe, expect, it } from 'vitest'
import { PropertyCatalog } from './catalog'
import type { ModeState, PropertyEntry } from './properties'

// The catalog: two modes, one property remembered in each, a single one live at a time.

const demo = (id: string): PropertyEntry => ({ id, name: id, kind: 'house', scenario: id, path: `demos/${id}.json`, demo: true })
const real = (id: string): PropertyEntry => ({ id, name: id, kind: 'house', path: `properties/${id}.json`, demo: false })

async function open(locals: PropertyEntry[], state: ModeState = {}) {
  const saved: ModeState[] = []
  let current = locals
  const catalog = await PropertyCatalog.open({
    demos: [demo('tilleuls'), demo('embruns')], locals, state,
    persist: async (s) => { saved.push(s) },
    reloadLocals: async () => current,
    create: async (body) => { current = [...current, real('neuve')]; return body.name === 'Neuve' ? 'neuve' : 'x' },
    duplicate: async (_s, name) => { current = [...current, real('copie')]; return name === 'Copie' ? 'copie' : 'x' },
  })
  return { catalog, saved }
}

describe('PropertyCatalog', () => {
  it('fresh install: demo mode, first demo, real unavailable', async () => {
    const { catalog } = await open([])
    expect(catalog.mode).toBe('demo')
    expect(catalog.active.id).toBe('tilleuls')
    expect(catalog.list()).toMatchObject({ mode: 'demo', realAvailable: false, activeId: 'tilleuls' })
    expect(catalog.list().properties.map((p) => p.id)).toEqual(['tilleuls', 'embruns'])
    expect(await catalog.chooseMode('real')).toBeNull()
  })

  it('a machine that has its own properties starts at home, and the list shows only the current mode', async () => {
    const { catalog } = await open([real('maison'), real('chalet')])
    expect(catalog.mode).toBe('real')
    expect(catalog.list().properties.map((p) => p.id)).toEqual(['maison', 'chalet'])
    expect(catalog.list().properties.some((p) => p.demo)).toBe(false)
  })

  it('each mode remembers its property: round trip demo ↔ real', async () => {
    const { catalog, saved } = await open([real('maison'), real('chalet')], { mode: 'real', real: 'chalet', demo: 'embruns' })
    expect(catalog.active.id).toBe('chalet')
    expect((await catalog.chooseMode('demo'))?.id).toBe('embruns')
    expect(catalog.list().properties.every((p) => p.demo)).toBe(true)
    expect((await catalog.chooseMode('real'))?.id).toBe('chalet')
    expect(saved.at(-1)).toEqual({ mode: 'real', real: 'chalet', demo: 'embruns' })
  })

  it('choosing a property of another mode switches to that mode', async () => {
    const { catalog } = await open([real('maison')], { mode: 'demo' })
    expect((await catalog.choose('maison'))?.id).toBe('maison')
    expect(catalog.mode).toBe('real')
    expect(await catalog.choose('inconnue')).toBeNull()
  })

  it('creating or duplicating adds a real property, which the real mode offers right away', async () => {
    const { catalog } = await open([])
    expect(await catalog.create({ name: 'Neuve', kind: 'house', origin: { lat: 45, lon: 5, heading: 0 }, levelName: 'R', roomName: 'P' })).toBe('neuve')
    expect(catalog.list().realAvailable).toBe(true)
    expect(await catalog.duplicate('tilleuls', 'Copie')).toBe('copie')
    await expect(catalog.duplicate('nope', 'X')).rejects.toMatchObject({ statusCode: 404 })
    expect((await catalog.choose('copie'))?.demo).toBe(false)
    expect(catalog.list().properties.map((p) => p.id)).toEqual(['neuve', 'copie'])
  })

  it('a remembered property that has disappeared: the first one of the mode', async () => {
    const { catalog } = await open([real('maison')], { mode: 'real', real: 'supprimee' })
    expect(catalog.active.id).toBe('maison')
  })
})
