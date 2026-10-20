import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import VehicleClimate from './VehicleClimate.vue'

// The COMMON panel: it always shows the maximum and grays out what the vehicle cannot do;
// a setting never wakes the car, the start does (it is the plugin that wakes).

const ID = 'mock:r5'
const R5_CLIMATE = { minC: 16, maxC: 26, stepC: 1, seats: ['fl', 'fr'], seatLevels: 1, steeringWheelHeat: true }
function entry(state: Partial<StateFor<'vehicle'>> = {}): DeviceEntry {
  return {
    descriptor: {
      id: ID, pluginId: 'mock', externalId: 'r5', kind: 'vehicle', name: 'R5',
      capabilities: ['soc', 'climate_precondition'], meta: { vehicle: { climate: R5_CLIMATE } },
    } as DeviceDescriptor,
    state: {
      kind: 'vehicle', updatedAt: 1, available: true, soc: 54, rangeKm: 234, pluggedIn: true, charging: false,
      sleepState: 'online', climateOn: false, climateTargetC: 21, seatHeat: { fl: 0, fr: 0 }, ...state,
    } as StateFor<'vehicle'>,
  }
}

function setup(e: DeviceEntry) {
  const devices = useDevicesStore()
  devices.setEntries([e])
  const sent = vi.spyOn(devices, 'sendCommand').mockResolvedValue(true)
  const w = mount(VehicleClimate, { props: { descriptor: e.descriptor, state: e.state as StateFor<'vehicle'> } })
  const seats = () => w.findAll('.clim__seat')
  const steps = () => w.findAll('.clim__step')
  return { w, sent, seats, steps }
}

describe('VehicleClimate', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('six slots always there; those the R5 lacks are grayed out with their reason', () => {
    const { seats } = setup(entry({ climateOn: true }))
    expect(seats()).toHaveLength(6)
    // order: front left, wheel, front right, rear left, rear center, rear right
    expect(seats().map((s) => s.attributes('disabled') !== undefined)).toEqual([false, false, false, true, true, true])
    expect(seats()[3]!.attributes('title')).toBe('Pas disponible sur ce véhicule')
  })

  it('R5: seats and steering wheel are preconditioning options, adjustable with the A/C OFF', () => {
    const e = entry()
    const r5 = { ...e, descriptor: { ...e.descriptor, meta: { vehicle: { climate: { ...R5_CLIMATE, heatWhileOff: true } } } } } as DeviceEntry
    const { seats } = setup(r5)
    expect(seats().map((s) => s.attributes('disabled') !== undefined)).toEqual([false, false, false, true, true, true])
  })

  it('A/C off: seats and steering wheel grayed out, the setpoint stays adjustable', () => {
    const { seats, steps } = setup(entry())
    expect(seats().every((s) => s.attributes('disabled') !== undefined)).toBe(true)
    expect(steps().every((s) => s.attributes('disabled') === undefined)).toBe(true)
  })

  it('a seat with a single level toggles on / off', async () => {
    const { seats, sent } = setup(entry({ climateOn: true }))
    await seats()[0]!.trigger('click')
    expect(sent).toHaveBeenCalledWith(ID, { type: 'vehicle.climate_set', seatHeat: { fl: 1 } })
  })

  it('awake: the setpoint goes out ONCE, when the clicks stop, bounded by the vehicle', async () => {
    const { steps, sent, w } = setup(entry({ climateTargetC: 25 }))
    await steps()[1]!.trigger('click')
    await steps()[1]!.trigger('click')
    expect(w.find('.clim__value').text()).toBe('26,0 °C')          // R5 ceiling: 26
    expect(sent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveBeenCalledTimes(1)
    expect(sent).toHaveBeenCalledWith(ID, { type: 'vehicle.climate_set', targetTempC: 26 })
  })

  it('asleep: the setpoint is HELD, without waking, and goes out with the start', async () => {
    const { steps, sent, w } = setup(entry({ sleepState: 'asleep' }))
    await steps()[0]!.trigger('click')
    vi.advanceTimersByTime(1000)
    expect(sent).not.toHaveBeenCalled()
    await w.find('.clim__power').trigger('click')
    expect(sent).toHaveBeenCalledWith(ID, { type: 'vehicle.climate_start', targetTempC: 20 })
  })
})
