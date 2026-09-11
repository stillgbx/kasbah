import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PluginInfo } from '@kasbah/shared'
import { ApiRequestError, createMockTransport, setTransport, type Transport } from '../api'
import { useNotificationsStore } from './notifications'
import { usePluginsStore } from './plugins'

const info = (id: string, enabled: boolean, parts: { id: string; enabled: boolean }[] = []): PluginInfo => ({
  id, implemented: true, enabled,
  parts: parts.map((p) => ({ id: p.id, labelKey: `kinds.${p.id}`, enabled: p.enabled })),
  health: { status: enabled ? 'ok' : 'disabled' },
})

describe('plugins store', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('mirrors the server inventory and writes a switch through', async () => {
    let state = [info('mock', true, [{ id: 'light', enabled: true }]), info('hue', false)]
    const setPluginSettings = vi.fn(async (id: string, patch: Record<string, unknown>) => {
      state = state.map((p) => (p.id === id ? { ...p, ...patch } as PluginInfo : p))
      return state
    })
    setTransport({ ...createMockTransport({ seed: 1 }), getPlugins: async () => state, setPluginSettings } as Transport)
    const store = usePluginsStore()
    await store.load()
    expect(store.byId.hue!.enabled).toBe(false)

    expect(await store.setEnabled('hue', true)).toBe(true)
    expect(setPluginSettings).toHaveBeenCalledWith('hue', { enabled: true })
    expect(store.byId.hue!.enabled).toBe(true)
  })

  it('shows the sub-item straight away, and rolls back if the server refuses', async () => {
    const listed = [info('mock', true, [{ id: 'light', enabled: true }])]
    const failing = vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') })
    setTransport({ ...createMockTransport({ seed: 1 }), getPlugins: async () => listed, setPluginSettings: failing } as Transport)
    const store = usePluginsStore()
    await store.load()

    expect(await store.setPart('mock', 'light', false)).toBe(false)
    expect(failing).toHaveBeenCalledWith('mock', { parts: { light: false } })
    expect(store.byId.mock!.parts[0]!.enabled).toBe(true)                 // retour arrière
    expect(useNotificationsStore().queue).toHaveLength(1)
  })
})
