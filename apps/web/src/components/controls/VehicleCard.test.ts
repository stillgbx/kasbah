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

describe('VehicleCard — repères de la jauge', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('pose la cible de charge et le plancher voulu quand le fabricant les donne', () => {
    const w = mount(VehicleCard, { props: { descriptor: descriptor(), state: state({ chargeLimit: 80, socMin: 20 }) } })
    expect(ticks(w)).toEqual([
      ['left: 20%;', 'Plancher voulu 20 %'],
      ['left: 80%;', 'Cible de charge 80 %'],
    ])
  })

  it('n’invente aucun repère : Tesla n’a pas de plancher, et un véhicule muet n’a rien à marquer', () => {
    const tesla = mount(VehicleCard, { props: { descriptor: descriptor(), state: state({ chargeLimit: 80 }) } })
    expect(ticks(tesla)).toEqual([['left: 80%;', 'Cible de charge 80 %']])
    const mute = mount(VehicleCard, { props: { descriptor: descriptor(['soc', 'range']), state: state() } })
    expect(ticks(mute)).toHaveLength(0)
  })

  /** Le repère est la CIBLE, pas l'état : il suit le palier qu'on vient de toucher, sans attendre la voiture. */
  it('le repère de cible suit le réglage en cours', async () => {
    const w = mount(VehicleCard, { props: { descriptor: descriptor(), state: state({ chargeLimit: 80 }) } })
    await w.findAll('.limit__step').find((b) => b.text() === '90')!.trigger('click')
    expect(ticks(w)).toEqual([['left: 90%;', 'Cible de charge 90 %']])
  })
})

describe('VehicleCard — tuiles', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('verrouiller et charger sont TOUJOURS là, grisés avec leur raison quand le véhicule ne sait pas', () => {
    const w = mount(VehicleCard, { props: { descriptor: descriptor(['soc', 'range']), state: state() } })
    const tiles = w.findAll('.tiles button')
    expect(tiles).toHaveLength(2)
    expect(tiles.every((t) => t.attributes('disabled') !== undefined)).toBe(true)
    expect(tiles.every((t) => t.attributes('title') === 'Pas disponible sur ce véhicule')).toBe(true)
  })
})

describe('VehicleCard — charge demandée', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null) })

  it('le bouton TOURNE tant que la voiture ne se dit pas en charge, puis devient « Arrêter la charge »', async () => {
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
