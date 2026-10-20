import { describe, expect, it } from 'vitest'
import { deviceAlerts } from './alerts'
import { defaultState } from './rules'
import type { StateFor } from './state'

const vehicle = (patch: Partial<StateFor<'vehicle'>> = {}): StateFor<'vehicle'> => ({ ...(defaultState('vehicle') as StateFor<'vehicle'>), available: true, readAt: 1, ...patch })
const mower = (patch: Partial<StateFor<'mower'>> = {}): StateFor<'mower'> => ({ ...(defaultState('mower') as StateFor<'mower'>), available: true, ...patch })

describe('deviceAlerts', () => {
  it('raises an info alert for a pending software update, keyed by its version', () => {
    const [a] = deviceAlerts('tesla:car', vehicle({ softwareUpdate: { status: 'available', version: '2026.38' } }))!
    expect(a).toMatchObject({ deviceId: 'tesla:car', severity: 'info', type: 'software_update' })
    // scheduled afterwards: the same update, the same alert
    const [b] = deviceAlerts('tesla:car', vehicle({ softwareUpdate: { status: 'scheduled', version: '2026.38' } }))!
    expect(b!.id).toBe(a!.id)
    // the next version is a new alert
    const [c] = deviceAlerts('tesla:car', vehicle({ softwareUpdate: { status: 'available', version: '2026.40' } }))!
    expect(c!.id).not.toBe(a!.id)
    expect(deviceAlerts('tesla:car', vehicle())).toEqual([])
  })

  it('cannot tell for an unavailable or never-read device', () => {
    expect(deviceAlerts('tesla:car', vehicle({ readAt: undefined, softwareUpdate: { status: 'available' } }))).toBeNull()
    // a mower in fault that lost the network is still in fault
    expect(deviceAlerts('m:1', mower({ available: false, activity: 'error', errorMessage: 'Stuck' }))).toMatchObject([{ type: 'device_error', detail: 'Stuck' }])
  })

  it('raises a problem for a robot in error, one per occurrence', () => {
    const first = deviceAlerts('m:1', mower({ activity: 'error', errorCode: 2, errorAt: 100 }))!
    expect(first).toMatchObject([{ severity: 'problem', type: 'device_error' }])
    const again = deviceAlerts('m:1', mower({ activity: 'error', errorCode: 2, errorAt: 900 }))!
    expect(again[0]!.id).not.toBe(first[0]!.id)
    expect(deviceAlerts('m:1', mower({ activity: 'parked' }))).toEqual([])
    expect(deviceAlerts('v:1', { ...(defaultState('vacuum') as StateFor<'vacuum'>), available: true, activity: 'error', errorMessage: 'Stuck' })).toHaveLength(1)
  })

  it('raises what is to be done on a pet feeder or fountain, the device fault first', () => {
    const feeder = (patch: Partial<StateFor<'pet_feeder'>> = {}): StateFor<'pet_feeder'> => ({ ...(defaultState('pet_feeder') as StateFor<'pet_feeder'>), available: true, ...patch })
    const fountain = (patch: Partial<StateFor<'pet_fountain'>> = {}): StateFor<'pet_fountain'> => ({ ...(defaultState('pet_fountain') as StateFor<'pet_fountain'>), available: true, ...patch })
    expect(deviceAlerts('pk:f', feeder({ foodLow: false, desiccantDays: 3 }))).toEqual([])
    expect(deviceAlerts('pk:f', feeder({ foodLow: true, desiccantDays: 0, errorMessage: 'Door blocked' }))!.map((a) => [a.type, a.detail]))
      .toEqual([['device_error', 'Door blocked'], ['supply_low', undefined], ['consumable', 'desiccant']])
    expect(deviceAlerts('pk:w', fountain({ waterLow: false, filterPct: 50, batteryPct: 80 }))).toEqual([])
    expect(deviceAlerts('pk:w', fountain({ waterLow: true, filterPct: 10, batteryPct: 15 }))!.map((a) => a.type))
      .toEqual(['supply_low', 'consumable', 'battery_low'])
    expect(deviceAlerts('pk:w', fountain({ waterLow: true }))!.every((a) => a.severity === 'problem' && a.kind === 'pet_fountain')).toBe(true)
  })

  it('flags orange and red weather warnings, not yellow; unknown without a reading', () => {
    const weather = (vigilance?: StateFor<'weather'>['vigilance']): StateFor<'weather'> =>
      ({ ...(defaultState('weather') as StateFor<'weather'>), available: true, ...(vigilance ? { vigilance } : {}) })
    const w = (level: 'yellow' | 'orange' | 'red', onset = 1) => ({ type: 'thunderstorm', level, onset, expires: 9 })
    expect(deviceAlerts('om:home', weather())).toBeNull()
    expect(deviceAlerts('om:home', weather([]))).toEqual([])
    expect(deviceAlerts('om:home', weather([w('yellow')]))).toEqual([])
    const [orange] = deviceAlerts('om:home', weather([w('orange')]))!
    const [red] = deviceAlerts('om:home', weather([w('red')]))!
    expect(orange).toMatchObject({ severity: 'problem', type: 'vigilance' })
    expect(red).toMatchObject({ severity: 'critical' })
    expect(red!.id).not.toBe(orange!.id)           // going to red: a new alert
  })
})
