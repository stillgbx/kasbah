import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { StateFor } from '@kasbah/shared'
import { ApiRequestError, createMockTransport, setTransport, type Transport } from '../api'
import { useDevicesStore } from './devices'
import { useNotificationsStore } from './notifications'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('devices store', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null) })

  it('receives the snapshot and pushes states through the mock transport', async () => {
    const mock = createMockTransport({ seed: 1 })
    setTransport(mock)
    const store = useDevicesStore()
    store.start()
    expect(store.connection).toBe('online')
    expect(store.count).toBeGreaterThan(15)
    const before = store.states['mock:cover-living'] as StateFor<'cover'>
    expect(before).toMatchObject({ position: 100, motion: 'stopped' })
    const ok = await store.sendCommand('mock:cover-living', { type: 'cover.close' })
    expect(ok).toBe(true)
    // l'état optimiste puis réel remplace l'objet (nouvelle référence)
    const after = store.states['mock:cover-living'] as StateFor<'cover'>
    expect(after).not.toBe(before)
    expect(after.motion).toBe('closing')
    expect(store.isPending('mock:cover-living')).toBe(false)
    store.stop()
  })

  it('applies an optimistic patch and rolls back on failure with a notification', async () => {
    const mock = createMockTransport({ seed: 1 })
    const failing: Transport = { ...mock, sendCommand: vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') }) }
    setTransport(failing)
    const store = useDevicesStore()
    const notifications = useNotificationsStore()
    store.start()
    const before = store.states['mock:light-living'] as StateFor<'light'>
    expect(before.on).toBe(false)
    const p = store.sendCommand('mock:light-living', { type: 'light.set', on: true })
    expect((store.states['mock:light-living'] as StateFor<'light'>).on).toBe(true)   // optimiste
    expect(store.isPending('mock:light-living')).toBe(true)
    expect(await p).toBe(false)
    expect(store.states['mock:light-living']).toBe(before)                           // retour arrière
    expect(notifications.queue).toHaveLength(1)
    expect(notifications.queue[0]!.color).toBe('error')
    store.stop()
  })

  it('applies availability and full-state messages', async () => {
    const mock = createMockTransport({ seed: 1 })
    setTransport(mock)
    const store = useDevicesStore()
    store.start()
    store.applyMessage({ type: 'availability', deviceIds: ['mock:light-living', 'mock:light-kitchen'], available: false })
    expect(store.states['mock:light-living']!.available).toBe(false)
    const s = { ...store.states['mock:light-living']!, available: true, updatedAt: 5 }
    store.applyMessage({ type: 'state', deviceId: 'mock:light-living', state: s })
    expect(store.states['mock:light-living']).toBe(s)
    await flush()
    store.stop()
  })
})
