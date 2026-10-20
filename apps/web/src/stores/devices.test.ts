import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
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
    // the optimistic then real state replaces the object (new reference)
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
    expect((store.states['mock:light-living'] as StateFor<'light'>).on).toBe(true)   // optimistic
    expect(store.isPending('mock:light-living')).toBe(true)
    expect(await p).toBe(false)
    expect(store.states['mock:light-living']).toBe(before)                           // rollback
    expect(notifications.queue).toHaveLength(1)
    expect(notifications.queue[0]!.color).toBe('error')
    store.stop()
  })

  // ---- targeted position of a cover -----------------------------------------------------------
  // The need: a box that only publishes the position at the END of the travel re-emits the old
  // value during the whole movement. The slider must stay on the target, and only give up if
  // the cover stops elsewhere.
  describe('requested charge', () => {
    const ID = 'tesla:v'
    const DESC: DeviceDescriptor = { id: ID, pluginId: 'tesla', externalId: 'v', kind: 'vehicle', name: 'Voiture', capabilities: ['soc', 'charging'], meta: {} }
    const car = (charging: boolean, updatedAt = 1, pluggedIn = true): StateFor<'vehicle'> =>
      ({ kind: 'vehicle', updatedAt, available: true, soc: 20, rangeKm: 80, pluggedIn, charging })
    const seeded = (send: Transport['sendCommand'] = vi.fn(async () => {})) => {
      setTransport({ ...createMockTransport({ seed: 1 }), sendCommand: send })
      const store = useDevicesStore()
      store.setEntries([{ descriptor: DESC, state: car(false) }])
      return store
    }

    it("held after the acknowledgment, until the car SAYS it is charging", async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'vehicle.start_charge' })
      expect(store.isPending(ID)).toBe(false)
      expect(store.isChargeRequested(ID)).toBe(true)
      store.applyMessage({ type: 'state', deviceId: ID, state: car(false, 2) })
      expect(store.isChargeRequested(ID)).toBe(true)
      store.applyMessage({ type: 'state', deviceId: ID, state: car(true, 3) })
      expect(store.isChargeRequested(ID)).toBe(false)
    })

    it('released on a refusal, on an unplugging, or after three minutes', async () => {
      const refused = seeded(vi.fn(async () => { throw new ApiRequestError(409, 'DEVICE_UNAVAILABLE', 'not plugged') }))
      await refused.sendCommand(ID, { type: 'vehicle.start_charge' })
      expect(refused.isChargeRequested(ID)).toBe(false)

      setActivePinia(createPinia())
      const unplugged = seeded()
      await unplugged.sendCommand(ID, { type: 'vehicle.start_charge' })
      unplugged.applyMessage({ type: 'state', deviceId: ID, state: car(false, 2, false) })
      expect(unplugged.isChargeRequested(ID)).toBe(false)

      vi.useFakeTimers()
      try {
        setActivePinia(createPinia())
        const slow = seeded()
        await slow.sendCommand(ID, { type: 'vehicle.start_charge' })
        vi.advanceTimersByTime(179_000)
        expect(slow.isChargeRequested(ID)).toBe(true)
        vi.advanceTimersByTime(2_000)
        expect(slow.isChargeRequested(ID)).toBe(false)
      } finally { vi.useRealTimers() }
    })
  })

  describe('target of a cover', () => {
    const ID = 'tahoma:v'
    const DESC: DeviceDescriptor = {
      id: ID, pluginId: 'tahoma', externalId: 'v', kind: 'cover', name: 'Volet',
      capabilities: ['open_close', 'position', 'stop'], meta: {},
    }
    const cover = (position: number, motion: StateFor<'cover'>['motion'], updatedAt = 1): StateFor<'cover'> =>
      ({ kind: 'cover', updatedAt, available: true, position, motion })

    /** Silent transport: the test decides EVERY state, not the simulation. */
    const seeded = (send: Transport['sendCommand'] = vi.fn(async () => {})) => {
      setTransport({ ...createMockTransport({ seed: 1 }), sendCommand: send })
      const store = useDevicesStore()
      store.setEntries([{ descriptor: DESC, state: cover(100, 'stopped') }])
      return store
    }
    const push = (store: ReturnType<typeof useDevicesStore>, state: StateFor<'cover'>) =>
      store.applyMessage({ type: 'state', deviceId: ID, state })

    it('sets the target on the command and holds it despite a stale position', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.set_position', position: 40 })
      expect(store.targetPosition(ID)).toBe(40)
      push(store, cover(100, 'closing', 2))   // the box moves without publishing a position
      expect(store.targetPosition(ID)).toBe(40)
    })

    it('drops the target when the position is reached', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      expect(store.targetPosition(ID)).toBe(0)
      push(store, cover(60, 'closing', 2))
      expect(store.targetPosition(ID)).toBe(0)
      push(store, cover(0, 'stopped', 3))
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('gives control back when the cover stops elsewhere (obstacle, stop, motor refusal)', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      push(store, cover(80, 'closing', 2))    // the movement did start
      push(store, cover(55, 'stopped', 3))    // then it stops halfway
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('a stopped received BEFORE the start does not erase the target', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      // typical frame from a TaHoma box: the target arrives alone, the motor has not started yet
      push(store, cover(100, 'stopped', 2))
      expect(store.targetPosition(ID)).toBe(0)
    })

    it('aiming at the already reached position sets no target', async () => {
      const store = seeded()                       // open shutter (position 100)
      await store.sendCommand(ID, { type: 'cover.open' })
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    // Sequence reported by the user: the slider went back to its position from BEFORE the gesture
    // before settling on the real one. The stop therefore freezes the display until the first frame.
    it('stop mid-travel: the slider never goes backward', async () => {
      const store = seeded()
      // starting position: 40 (that is 60 % closure on screen)
      push(store, cover(40, 'stopped', 1))
      expect(store.targetPosition(ID)).toBeUndefined()

      // we aim at 70 (30 % closure)
      await store.sendCommand(ID, { type: 'cover.set_position', position: 70 })
      expect(store.targetPosition(ID)).toBe(70)
      push(store, cover(40, 'closing', 2))       // the box moves, without publishing a position
      expect(store.targetPosition(ID)).toBe(70)

      // stop: the SHOWN value (70) is frozen, not replaced by the stale position (40)
      await store.sendCommand(ID, { type: 'cover.stop' })
      expect(store.targetPosition(ID)).toBe(70)

      // the first frame lifts the freeze, whatever it says
      push(store, cover(53, 'stopped', 3))
      expect(store.targetPosition(ID)).toBeUndefined()
      expect((store.states[ID] as StateFor<'cover'>).position).toBe(53)
    })

    it('stop lifts the freeze even if the frame still says it is moving', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      push(store, cover(80, 'closing', 2))
      await store.sendCommand(ID, { type: 'cover.stop' })
      push(store, cover(61, 'closing', 3))       // the box has not yet said `stopped`
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    // Reported by the user: the slider only reached the custom position at the END of the
    // travel. The recall aims at the motor's memory like any other position.
    it('recalling the custom position sets the target right away', async () => {
      const store = seeded()
      push(store, { ...cover(100, 'stopped', 1), presetPosition: 35 })
      await store.sendCommand(ID, { type: 'cover.preset' })
      expect(store.targetPosition(ID)).toBe(35)
      push(store, { ...cover(100, 'closing', 2), presetPosition: 35 })   // position still stale
      expect(store.targetPosition(ID)).toBe(35)
      push(store, { ...cover(35, 'stopped', 3), presetPosition: 35 })
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('recall without a published value: no target to aim at', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.preset' })
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('a refused command clears the target', async () => {
      const store = seeded(vi.fn(async () => { throw new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom') }))
      expect(await store.sendCommand(ID, { type: 'cover.open' })).toBe(false)
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('losing availability clears the target', async () => {
      const store = seeded()
      await store.sendCommand(ID, { type: 'cover.close' })
      store.applyMessage({ type: 'availability', deviceIds: [ID], available: false })
      expect(store.targetPosition(ID)).toBeUndefined()
    })

    it('a target that is too old is dropped', async () => {
      vi.useFakeTimers()
      try {
        const store = seeded()
        await store.sendCommand(ID, { type: 'cover.close' })
        expect(store.targetPosition(ID)).toBe(0)
        vi.advanceTimersByTime(120_000)          // CLIENT clock, not `updatedAt`
        push(store, cover(90, 'closing', 2))
        expect(store.targetPosition(ID)).toBeUndefined()
      } finally { vi.useRealTimers() }
    })
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
