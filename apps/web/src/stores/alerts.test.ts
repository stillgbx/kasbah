import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { defaultState, type DeviceDescriptor, type DeviceState, type PluginHealth, type StateFor } from '@kasbah/shared'
import { useDevicesStore } from './devices'
import { DEGRADED_GRACE_MS, useAlertsStore } from './alerts'

const car: DeviceDescriptor = { id: 'tesla:car', pluginId: 'tesla', externalId: 'car', kind: 'vehicle', name: 'Model S', capabilities: [], meta: {} }
const robot: DeviceDescriptor = { id: 'aut:m', pluginId: 'aut', externalId: 'm', kind: 'mower', name: 'Robby', capabilities: [], meta: {} }
const carState = (patch: Partial<StateFor<'vehicle'>> = {}): DeviceState => ({ ...(defaultState('vehicle') as StateFor<'vehicle'>), available: true, readAt: 1, ...patch })
const mowerState = (patch: Partial<StateFor<'mower'>> = {}): DeviceState => ({ ...(defaultState('mower') as StateFor<'mower'>), available: true, ...patch })
const update = { softwareUpdate: { status: 'available' as const, version: '2026.38' } }

describe('alerts store', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear() })

  it('flags the view, and an info alert is seen by opening it', async () => {
    const devices = useDevicesStore()
    devices.setEntries([{ descriptor: car, state: carState(update) }])
    const alerts = useAlertsStore()
    expect(alerts.viewSeverity('vehicles')).toBe('info')
    expect(alerts.viewSeverity('robots')).toBeNull()
    alerts.markViewSeen('vehicles')
    expect(alerts.viewSeverity('vehicles')).toBeNull()
    // another version comes back by itself
    devices.applyMessage({ type: 'state', deviceId: 'tesla:car', state: carState({ softwareUpdate: { status: 'available', version: '2026.40' } }) })
    await nextTick()
    expect(alerts.viewSeverity('vehicles')).toBe('info')
  })

  it('keeps a problem flagged as long as it lasts, opening the view is not enough', async () => {
    const devices = useDevicesStore()
    devices.setEntries([{ descriptor: robot, state: mowerState({ activity: 'error', errorCode: 2 }) }])
    const alerts = useAlertsStore()
    alerts.markViewSeen('robots')
    expect(alerts.viewSeverity('robots')).toBe('problem')
    devices.applyMessage({ type: 'state', deviceId: 'aut:m', state: mowerState({ activity: 'parked' }) })
    await nextTick()
    expect(alerts.viewSeverity('robots')).toBeNull()
  })

  it('flags the pets view for a feeder that needs food', () => {
    const feeder: DeviceDescriptor = { id: 'pk:f', pluginId: 'pk', externalId: 'f', kind: 'pet_feeder', name: 'Feeder', capabilities: [], meta: {} }
    useDevicesStore().setEntries([{ descriptor: feeder, state: { ...(defaultState('pet_feeder') as StateFor<'pet_feeder'>), available: true, foodLow: true } }])
    expect(useAlertsStore().viewSeverity('pets')).toBe('problem')
  })

  it('lists the most severe alerts first', () => {
    const wx: DeviceDescriptor = { id: 'om:home', pluginId: 'om', externalId: 'home', kind: 'weather', name: 'Home', capabilities: [], meta: {} }
    const red = { type: 'wind', level: 'red' as const, onset: 1, expires: 9 }
    useDevicesStore().setEntries([
      { descriptor: car, state: carState(update) },
      { descriptor: wx, state: { ...(defaultState('weather') as StateFor<'weather'>), available: true, vigilance: [red] } },
    ])
    expect(useAlertsStore().active.map((a) => a.severity)).toEqual(['critical', 'info'])
  })

  it('forgets a dismissed alert once a reading says it is over, not before', async () => {
    // startup: nothing received, the storage keeps everything
    localStorage.setItem('kasbah.alerts.dismissed', JSON.stringify({ 'tesla:car|software_update|2026.38': 'tesla:car' }))
    const fresh = useAlertsStore()
    await nextTick()
    expect(fresh.isDismissed('tesla:car|software_update|2026.38')).toBe(true)

    const d = useDevicesStore()
    d.setEntries([{ descriptor: car, state: carState({ ...update, available: false }) }])
    await nextTick()
    expect(fresh.isDismissed('tesla:car|software_update|2026.38')).toBe(true) // unreachable: unknown
    d.applyMessage({ type: 'state', deviceId: 'tesla:car', state: carState() })
    await nextTick()
    expect(fresh.isDismissed('tesla:car|software_update|2026.38')).toBe(false) // installed: forgotten
  })

  it('forgets the alerts of a device that no longer exists', async () => {
    localStorage.setItem('kasbah.alerts.dismissed', JSON.stringify({ 'gone:x|device_error|1@': 'gone:x' }))
    const alerts = useAlertsStore()
    useDevicesStore().setEntries([{ descriptor: car, state: carState() }])
    await nextTick()
    expect(alerts.isDismissed('gone:x|device_error|1@')).toBe(false)
  })
})

describe('plugin alerts', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const health = (plugins: Record<string, PluginHealth>) => ({ ok: true, uptimeS: 1, clients: 1, plugins })

  it('flags an account to link again on the settings, at once', async () => {
    const devices = useDevicesStore()
    const alerts = useAlertsStore()
    devices.health = health({ nest: { status: 'error', detail: 'link the account again' }, hue: { status: 'ok' }, sonos: { status: 'disabled' } })
    await nextTick()
    expect(alerts.plugins).toEqual([{ pluginId: 'nest', status: 'error', detail: 'link the account again', severity: 'problem', view: 'settings' }])
    expect(alerts.viewSeverity('settings')).toBe('problem')
    devices.health = health({ nest: { status: 'ok' } })
    await nextTick()
    expect(alerts.viewSeverity('settings')).toBeNull()
  })

  it('flags a degraded plugin only once it has lasted, and forgets a recovery', async () => {
    const devices = useDevicesStore()
    const alerts = useAlertsStore()
    const read = async (status: PluginHealth['status']) => { devices.health = health({ ytmusic: { status } }); await nextTick() }
    await read('degraded')
    expect(alerts.plugins).toEqual([])
    vi.advanceTimersByTime(DEGRADED_GRACE_MS - 1000)
    await read('degraded')
    expect(alerts.plugins).toEqual([])
    vi.advanceTimersByTime(1000)
    await read('degraded')
    expect(alerts.plugins.map((a) => a.pluginId)).toEqual(['ytmusic'])
    // a server that does not answer says nothing: the alert holds
    devices.health = null
    await nextTick()
    expect(alerts.plugins.map((a) => a.pluginId)).toEqual(['ytmusic'])
    // recovered, then degraded again: the wait starts over
    await read('ok')
    await read('degraded')
    expect(alerts.plugins).toEqual([])
  })
})
