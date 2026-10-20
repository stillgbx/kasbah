import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import type { Capability, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { createMockTransport, setTransport } from '../../api'
import { useDevicesStore } from '../../stores/devices'
import VehicleCard from './VehicleCard.vue'

const descriptor = (capabilities: Capability[] = ['soc', 'range', 'charge_limit']): DeviceDescriptor => ({
  id: 'mock:r5', pluginId: 'mock', externalId: 'r5', kind: 'vehicle', name: 'R5', capabilities, meta: {},
})
const state = (over: Partial<StateFor<'vehicle'>> = {}): StateFor<'vehicle'> =>
  ({ kind: 'vehicle', updatedAt: 0, available: true, soc: 55, rangeKm: 226, pluggedIn: true, charging: false, ...over })

const ticks = (w: ReturnType<typeof mount>) =>
  w.findAll('.soc__tick').map((t) => [t.attributes('style'), t.attributes('title')])

describe('VehicleCard — gauge marks', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('places the charge target and the desired floor when the vendor gives them', () => {
    const w = mount(VehicleCard, { props: { descriptor: descriptor(), state: state({ chargeLimit: 80, socMin: 20 }) } })
    expect(ticks(w)).toEqual([
      ['left: 20%;', 'Plancher voulu 20 %'],
      ['left: 80%;', 'Cible de charge 80 %'],
    ])
  })

  it('invents no mark: Tesla has no floor, and a silent vehicle has nothing to mark', () => {
    const tesla = mount(VehicleCard, { props: { descriptor: descriptor(), state: state({ chargeLimit: 80 }) } })
    expect(ticks(tesla)).toEqual([['left: 80%;', 'Cible de charge 80 %']])
    const mute = mount(VehicleCard, { props: { descriptor: descriptor(['soc', 'range']), state: state() } })
    expect(ticks(mute)).toHaveLength(0)
  })

  /** The mark is the TARGET, not the state: it follows the step just touched, without waiting for the car. */
  it('the target mark follows the current setting', async () => {
    const w = mount(VehicleCard, { props: { descriptor: descriptor(), state: state({ chargeLimit: 80 }) } })
    await w.findAll('.limit__step').find((b) => b.text() === '90')!.trigger('click')
    expect(ticks(w)).toEqual([['left: 90%;', 'Cible de charge 90 %']])
  })
})

describe('VehicleCard — tiles', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('lock and charge are ALWAYS there, greyed out with their reason when the vehicle cannot', () => {
    const w = mount(VehicleCard, { props: { descriptor: descriptor(['soc', 'range']), state: state() } })
    const tiles = w.findAll('.tiles button')
    expect(tiles).toHaveLength(2)
    expect(tiles.every((t) => t.attributes('disabled') !== undefined)).toBe(true)
    expect(tiles.every((t) => t.attributes('title') === 'Pas disponible sur ce véhicule')).toBe(true)
  })
})

describe('VehicleCard — requested charge', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null) })

  it('the button SPINS as long as the car does not report charging, then becomes "Stop charging"', async () => {
    setTransport({ ...createMockTransport({ seed: 1 }), sendCommand: async () => {} })
    const d = descriptor(['soc', 'range', 'charging'])
    const devices = useDevicesStore()
    devices.setEntries([{ descriptor: d, state: state() }])
    const w = mount(VehicleCard, { props: { descriptor: d, state: state() } })
    const button = () => w.findAll('button').find((b) => /charge/i.test(b.text()))!
    expect(button().attributes('aria-busy')).toBe('false')
    await devices.sendCommand(d.id, { type: 'vehicle.start_charge' })
    await w.vm.$nextTick()
    expect(button().attributes('aria-busy')).toBe('true')
    expect(button().find('.v-progress-circular').exists()).toBe(true)
    expect(button().attributes('disabled')).toBeDefined()
    devices.applyMessage({ type: 'state', deviceId: d.id, state: state({ updatedAt: 1, charging: true }) })
    await w.setProps({ state: state({ updatedAt: 1, charging: true }) })
    expect(button().attributes('aria-busy')).toBe('false')
    expect(button().text()).toBe('Arrêter la charge')
  })
})
