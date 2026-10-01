import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import VehicleClimate from './VehicleClimate.vue'

// Le panneau COMMUN : il montre toujours le maximum et grise ce que le véhicule ne sait pas faire ;
// un réglage ne réveille jamais la voiture, la marche oui (c'est le plugin qui réveille).

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

  it('six emplacements toujours là ; ceux que la R5 n’a pas sont grisés avec leur raison', () => {
    const { seats } = setup(entry({ climateOn: true }))
    expect(seats()).toHaveLength(6)
    // ordre : AV G, volant, AV D, AR G, AR C, AR D
    expect(seats().map((s) => s.attributes('disabled') !== undefined)).toEqual([false, false, false, true, true, true])
    expect(seats()[3]!.attributes('title')).toBe('Pas disponible sur ce véhicule')
  })

  it('clim à l’arrêt : sièges et volant grisés, la consigne reste réglable', () => {
    const { seats, steps } = setup(entry())
    expect(seats().every((s) => s.attributes('disabled') !== undefined)).toBe(true)
    expect(steps().every((s) => s.attributes('disabled') === undefined)).toBe(true)
  })

  it('un siège à un seul cran bascule marche / arrêt', async () => {
    const { seats, sent } = setup(entry({ climateOn: true }))
    await seats()[0]!.trigger('click')
    expect(sent).toHaveBeenCalledWith(ID, { type: 'vehicle.climate_set', seatHeat: { fl: 1 } })
  })

  it('éveillée : la consigne part UNE fois, quand les clics s’arrêtent, bornée par le véhicule', async () => {
    const { steps, sent, w } = setup(entry({ climateTargetC: 25 }))
    await steps()[1]!.trigger('click')
    await steps()[1]!.trigger('click')
    expect(w.find('.clim__value').text()).toBe('26,0 °C')          // plafond de la R5 : 26
    expect(sent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(sent).toHaveBeenCalledTimes(1)
    expect(sent).toHaveBeenCalledWith(ID, { type: 'vehicle.climate_set', targetTempC: 26 })
  })

  it('endormie : la consigne est RETENUE, sans réveil, et part avec la marche', async () => {
    const { steps, sent, w } = setup(entry({ sleepState: 'asleep' }))
    await steps()[0]!.trigger('click')
    vi.advanceTimersByTime(1000)
    expect(sent).not.toHaveBeenCalled()
    await w.find('.clim__power').trigger('click')
    expect(sent).toHaveBeenCalledWith(ID, { type: 'vehicle.climate_start', targetTempC: 20 })
  })
})
