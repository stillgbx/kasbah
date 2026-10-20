import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PluginSceneEntry } from '@kasbah/shared'
import { ApiRequestError, createMockTransport, setTransport, type Transport } from '../api'
import { useNotificationsStore } from './notifications'
import { useScenesStore } from './scenes'

const entry = (id: string, name: string, group?: { name: string; kind: 'room' | 'zone' }, dynamic = false, autoDynamic = false): PluginSceneEntry => ({
  scene: { id: `hue:${id}`, pluginId: 'hue', externalId: id, name, dynamic, autoDynamic, swatches: ['#ff8800'], ...(group ? { group } : {}) },
  state: { active: 'inactive', updatedAt: 0 },
})

const SCENES = [
  entry('relax', 'Détente', { name: 'Salon', kind: 'room' }),
  entry('starlight', 'Starlight', { name: 'Salon', kind: 'room' }, true, true),
  entry('evening', 'Soirée', { name: 'Véranda', kind: 'zone' }, true),
]

describe('scenes store', () => {
  // localStorage survives between tests (persisted preferences): we clear it to isolate them
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null); localStorage.clear() })

  it('groups scenes by room name (accents and case ignored) and sends the rest to the house level', () => {
    const store = useScenesStore()
    store.apply({ type: 'snapshot', serverTime: 0, devices: [], scenes: SCENES, automations: [] })
    expect(store.count).toBe(3)
    expect(store.forRoom('salon').map((e) => e.scene.name)).toEqual(['Détente', 'Starlight'])
    expect(store.forRoom('Cuisine')).toEqual([])
    // the zone is not a room of the house, nor is the unknown Hue room
    expect(store.forHouse(['Salon']).map((e) => e.scene.name)).toEqual(['Soirée'])
    expect(store.forHouse([]).map((e) => e.scene.name)).toEqual(['Détente', 'Soirée', 'Starlight'])
  })

  it('a scene message activates one scene and deactivates its group siblings', () => {
    const store = useScenesStore()
    store.apply({ type: 'scenes', scenes: SCENES })
    store.apply({ type: 'scene', sceneId: 'hue:relax', state: { active: 'static', updatedAt: 1 } })
    expect(store.entries['hue:relax']!.state.active).toBe('static')
    store.apply({ type: 'scene', sceneId: 'hue:starlight', state: { active: 'dynamic', updatedAt: 2 } })
    expect(store.entries['hue:starlight']!.state.active).toBe('dynamic')
    expect(store.entries['hue:relax']!.state.active).toBe('inactive')
    expect(store.entries['hue:evening']!.state.active).toBe('inactive')   // other group: untouched
  })

  it('tap mode follows the vendor auto-dynamic flag', () => {
    const store = useScenesStore()
    store.apply({ type: 'scenes', scenes: SCENES })
    const of = (id: string) => store.entries[id]!
    expect(store.tapMode(of('hue:starlight'))).toBe('dynamic')   // animated palette + set to "auto"
    expect(store.tapMode(of('hue:evening'))).toBe('static')      // animated palette but not "auto"
    expect(store.tapMode(of('hue:relax'))).toBe('static')        // no animated palette
    // settings live per plugin: the grouping does too, and it lists EVERYTHING (management)
    expect(store.scenesByPlugin).toHaveLength(1)
    expect(store.scenesByPlugin[0]!.pluginId).toBe('hue')
    // arranged by group then by name
    expect(store.scenesByPlugin[0]!.scenes.map((e) => `${e.scene.group?.name}/${e.scene.name}`))
      .toEqual(['Salon/Détente', 'Salon/Starlight', 'Véranda/Soirée'])
  })

  it('setAutoDynamic writes the vendor setting, optimistically, and rolls back on refusal', async () => {
    const mock = createMockTransport({ seed: 1 })
    const ok: Transport = { ...mock, updateScene: vi.fn(async () => undefined) }
    setTransport(ok)
    const store = useScenesStore()
    store.apply({ type: 'scenes', scenes: SCENES })
    expect(await store.setAutoDynamic('hue:evening', true)).toBe(true)
    expect(ok.updateScene).toHaveBeenCalledWith('hue:evening', { autoDynamic: true })
    expect(store.entries['hue:evening']!.scene.autoDynamic).toBe(true)
    expect(store.tapMode(store.entries['hue:evening']!)).toBe('dynamic')

    const failing: Transport = { ...mock, updateScene: vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') }) }
    setTransport(failing)
    const before = store.entries
    expect(await store.setAutoDynamic('hue:starlight', false)).toBe(false)
    expect(store.entries).toBe(before)
    expect(store.entries['hue:starlight']!.scene.autoDynamic).toBe(true)
    expect(useNotificationsStore().queue).toHaveLength(1)
  })

  it('clonable scenes: what exists elsewhere and not here, one source per name', () => {
    const store = useScenesStore()
    store.apply({ type: 'scenes', scenes: [
      ...SCENES,
      entry('relax-veranda', 'Détente', { name: 'Véranda', kind: 'zone' }),
      entry('starlight-hall', 'Starlight', { name: 'Entrée', kind: 'room' }),        // same name, static source
    ] })
    // the Salon already has Détente and Starlight: Soirée (from the Véranda) is left
    expect(store.clonableFor('salon').map((e) => e.scene.name)).toEqual(['Soirée'])
    // the Entrée only has Starlight: Détente and Soirée can be offered
    expect(store.clonableFor('Entrée').map((e) => e.scene.name)).toEqual(['Détente', 'Soirée'])
    // for Détente, two possible sources: neither is animated, the first one is enough
    expect(store.clonableFor('Entrée')[0]!.scene.group?.name).toBe('Salon')
    // a room with no light scene at all is offered everything, a name only once
    expect(store.clonableFor('Cuisine').map((e) => e.scene.name)).toEqual(['Détente', 'Soirée', 'Starlight'])
  })

  it('delete removes the scene right away and puts it back if the vendor refuses', async () => {
    const mock = createMockTransport({ seed: 1 })
    const ok: Transport = { ...mock, deleteScene: vi.fn(async () => undefined) }
    setTransport(ok)
    const store = useScenesStore()
    store.apply({ type: 'scenes', scenes: SCENES })
    expect(await store.deleteScene('hue:evening')).toBe(true)
    expect(ok.deleteScene).toHaveBeenCalledWith('hue:evening')
    expect(store.entries['hue:evening']).toBeUndefined()
    expect(store.count).toBe(2)

    const failing: Transport = { ...mock, deleteScene: vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') }) }
    setTransport(failing)
    const before = store.entries
    expect(await store.deleteScene('hue:relax')).toBe(false)
    expect(store.entries).toBe(before)                       // put back in place
    expect(store.entries['hue:relax']).toBeDefined()
    expect(useNotificationsStore().queue).toHaveLength(1)
    expect(await store.deleteScene('hue:unknown')).toBe(false)
  })

  it('switching scenes: the deactivation of the previous one does not cancel the new one', () => {
    const store = useScenesStore()
    store.apply({ type: 'scenes', scenes: SCENES })
    store.apply({ type: 'scene', sceneId: 'hue:starlight', state: { active: 'dynamic', updatedAt: 1 } })
    // the bridge sends both messages in the same batch when going from one light scene to the other
    store.apply({ type: 'scene', sceneId: 'hue:relax', state: { active: 'static', updatedAt: 2 } })
    store.apply({ type: 'scene', sceneId: 'hue:starlight', state: { active: 'inactive', updatedAt: 2 } })
    expect(store.entries['hue:relax']!.state.active).toBe('static')
    expect(store.entries['hue:starlight']!.state.active).toBe('inactive')
    // reverse order: same result
    store.apply({ type: 'scene', sceneId: 'hue:relax', state: { active: 'inactive', updatedAt: 3 } })
    store.apply({ type: 'scene', sceneId: 'hue:starlight', state: { active: 'static', updatedAt: 3 } })
    expect(store.entries['hue:starlight']!.state.active).toBe('static')
    expect(store.entries['hue:relax']!.state.active).toBe('inactive')
  })

  it('recall is optimistic and rolls back with a notification when the bridge refuses', async () => {
    const mock = createMockTransport({ seed: 1 })
    const ok: Transport = { ...mock, recallScene: vi.fn(async () => undefined) }
    setTransport(ok)
    const store = useScenesStore()
    store.apply({ type: 'scenes', scenes: SCENES })
    store.apply({ type: 'scene', sceneId: 'hue:relax', state: { active: 'static', updatedAt: 1 } })

    const p = store.recall('hue:starlight', 'dynamic')
    expect(store.entries['hue:starlight']!.state.active).toBe('dynamic')   // optimistic
    expect(store.entries['hue:relax']!.state.active).toBe('inactive')
    expect(store.isPending('hue:starlight')).toBe(true)
    expect(await p).toBe(true)
    expect(ok.recallScene).toHaveBeenCalledWith('hue:starlight', { mode: 'dynamic' })
    expect(store.isPending('hue:starlight')).toBe(false)

    // `off` is the toggle's return: the scene turns off, its sibling scenes do not move
    expect(await store.recall('hue:starlight', 'off')).toBe(true)
    expect(ok.recallScene).toHaveBeenLastCalledWith('hue:starlight', { mode: 'off' })
    expect(store.entries['hue:starlight']!.state.active).toBe('inactive')
    expect(store.entries['hue:relax']!.state.active).toBe('inactive')

    const failing: Transport = { ...mock, recallScene: vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') }) }
    setTransport(failing)
    const before = store.entries
    expect(await store.recall('hue:relax')).toBe(false)
    expect(store.entries).toBe(before)                                     // rollback
    expect(useNotificationsStore().queue).toHaveLength(1)
    expect(await store.recall('hue:unknown')).toBe(false)
  })
})
