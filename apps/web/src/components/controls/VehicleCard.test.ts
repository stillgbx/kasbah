import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import type { Capability, DeviceDescriptor, StateFor } from '@kasbah/shared'
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
