import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { defaultState, type DeviceDescriptor, type DeviceState, type StateFor } from '@kasbah/shared'
import { useDevicesStore } from './devices'
import { useAlertsStore } from './alerts'

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
    // une autre version revient d'elle-même
    devices.applyMessage({ type: 'state', deviceId: 'tesla:car', state: carState({ softwareUpdate: { status: 'available', version: '2026.40' } }) })
    await nextTick()
    expect(alerts.viewSeverity('vehicles')).toBe('info')
  })

  it('keeps a problem until it is dismissed, opening the view is not enough', () => {
    useDevicesStore().setEntries([{ descriptor: robot, state: mowerState({ activity: 'error', errorCode: 2 }) }])
    const alerts = useAlertsStore()
    alerts.markViewSeen('robots')
    expect(alerts.viewSeverity('robots')).toBe('problem')
    alerts.dismiss(alerts.closableFor('aut:m'))
    expect(alerts.viewSeverity('robots')).toBeNull()
    expect(alerts.closableFor('aut:m')).toEqual([])
  })

  it('forgets a dismissed alert once a reading says it is over, not before', async () => {
    // démarrage : rien de reçu, le stockage garde tout
    localStorage.setItem('kasbah.alerts.dismissed', JSON.stringify({ 'tesla:car|software_update|2026.38': 'tesla:car' }))
    const fresh = useAlertsStore()
    await nextTick()
    expect(fresh.isDismissed('tesla:car|software_update|2026.38')).toBe(true)

    const d = useDevicesStore()
    d.setEntries([{ descriptor: car, state: carState({ ...update, available: false }) }])
    await nextTick()
    expect(fresh.isDismissed('tesla:car|software_update|2026.38')).toBe(true) // injoignable : inconnu
    d.applyMessage({ type: 'state', deviceId: 'tesla:car', state: carState() })
    await nextTick()
    expect(fresh.isDismissed('tesla:car|software_update|2026.38')).toBe(false) // installée : oubliée
  })

  it('forgets the alerts of a device that no longer exists', async () => {
    localStorage.setItem('kasbah.alerts.dismissed', JSON.stringify({ 'gone:x|device_error|1@': 'gone:x' }))
    const alerts = useAlertsStore()
    useDevicesStore().setEntries([{ descriptor: car, state: carState() }])
    await nextTick()
    expect(alerts.isDismissed('gone:x|device_error|1@')).toBe(false)
  })
})
