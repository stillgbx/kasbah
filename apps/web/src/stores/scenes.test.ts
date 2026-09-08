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
  // localStorage survit entre les tests (préférences persistées) : on le vide pour les isoler
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null); localStorage.clear() })

  it('groups scenes by room name (accents and case ignored) and sends the rest to the house level', () => {
    const store = useScenesStore()
    store.apply({ type: 'snapshot', serverTime: 0, devices: [], scenes: SCENES })
    expect(store.count).toBe(3)
    expect(store.forRoom('salon').map((e) => e.scene.name)).toEqual(['Détente', 'Starlight'])
    expect(store.forRoom('Cuisine')).toEqual([])
    // la zone n'est pas une pièce de la maison, la pièce Hue inconnue non plus
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
    expect(store.entries['hue:evening']!.state.active).toBe('inactive')   // autre groupe : intact
  })

  it('tap mode follows the vendor auto-dynamic flag', () => {
    const store = useScenesStore()
    store.apply({ type: 'scenes', scenes: SCENES })
    const of = (id: string) => store.entries[id]!
    expect(store.tapMode(of('hue:starlight'))).toBe('dynamic')   // palette animée + réglé « auto »
    expect(store.tapMode(of('hue:evening'))).toBe('static')      // palette animée mais pas « auto »
    expect(store.tapMode(of('hue:relax'))).toBe('static')        // pas de palette animée
    // les réglages vivent par plugin : le regroupement l'est aussi
    expect(store.animatedByPlugin).toHaveLength(1)
    expect(store.animatedByPlugin[0]!.pluginId).toBe('hue')
    expect(store.animatedByPlugin[0]!.scenes.map((e) => e.scene.externalId).sort()).toEqual(['evening', 'starlight'])
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

  it('per-plugin settings come from the server, with a default and a rollback', async () => {
    const mock = createMockTransport({ seed: 1 })
    const ok: Transport = {
      ...mock,
      getPluginSettings: vi.fn(async () => ({ hue: { autoDynamicForNewScenes: true } })),
      setPluginSettings: vi.fn(async (_p, s) => s),
    }
    setTransport(ok)
    const store = useScenesStore()
    expect(store.settingsOf('hue').autoDynamicForNewScenes).toBe(false)   // défaut avant chargement
    await store.loadPluginSettings()
    expect(store.settingsOf('hue').autoDynamicForNewScenes).toBe(true)
    expect(store.settingsOf('somfy').autoDynamicForNewScenes).toBe(false)
    expect(await store.setAutoDynamicForNewScenes('hue', false)).toBe(true)
    expect(ok.setPluginSettings).toHaveBeenCalledWith('hue', { autoDynamicForNewScenes: false })
    expect(store.settingsOf('hue').autoDynamicForNewScenes).toBe(false)

    const failing: Transport = { ...ok, setPluginSettings: vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') }) }
    setTransport(failing)
    expect(await store.setAutoDynamicForNewScenes('hue', true)).toBe(false)
    expect(store.settingsOf('hue').autoDynamicForNewScenes).toBe(false)   // retour arrière
    expect(useNotificationsStore().queue).toHaveLength(1)
  })

  it('switching scenes: the deactivation of the previous one does not cancel the new one', () => {
    const store = useScenesStore()
    store.apply({ type: 'scenes', scenes: SCENES })
    store.apply({ type: 'scene', sceneId: 'hue:starlight', state: { active: 'dynamic', updatedAt: 1 } })
    // le pont envoie les deux messages dans le même lot quand on passe d'une ambiance à l'autre
    store.apply({ type: 'scene', sceneId: 'hue:relax', state: { active: 'static', updatedAt: 2 } })
    store.apply({ type: 'scene', sceneId: 'hue:starlight', state: { active: 'inactive', updatedAt: 2 } })
    expect(store.entries['hue:relax']!.state.active).toBe('static')
    expect(store.entries['hue:starlight']!.state.active).toBe('inactive')
    // ordre inverse : même résultat
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
    expect(store.entries['hue:starlight']!.state.active).toBe('dynamic')   // optimiste
    expect(store.entries['hue:relax']!.state.active).toBe('inactive')
    expect(store.isPending('hue:starlight')).toBe(true)
    expect(await p).toBe(true)
    expect(ok.recallScene).toHaveBeenCalledWith('hue:starlight', { mode: 'dynamic' })
    expect(store.isPending('hue:starlight')).toBe(false)

    // `off` est le retour de bascule : la scène s'éteint, ses sœurs ne bougent pas
    expect(await store.recall('hue:starlight', 'off')).toBe(true)
    expect(ok.recallScene).toHaveBeenLastCalledWith('hue:starlight', { mode: 'off' })
    expect(store.entries['hue:starlight']!.state.active).toBe('inactive')
    expect(store.entries['hue:relax']!.state.active).toBe('inactive')

    const failing: Transport = { ...mock, recallScene: vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') }) }
    setTransport(failing)
    const before = store.entries
    expect(await store.recall('hue:relax')).toBe(false)
    expect(store.entries).toBe(before)                                     // retour arrière
    expect(useNotificationsStore().queue).toHaveLength(1)
    expect(await store.recall('hue:unknown')).toBe(false)
  })
})
