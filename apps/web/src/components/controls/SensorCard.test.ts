import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import SensorCard from './SensorCard.vue'

const temp: DeviceDescriptor = {
  id: 'mock:t', pluginId: 'mock', externalId: 't', kind: 'sensor', name: 'Température',
  capabilities: [], meta: { sensor: { deviceClass: 'temperature', unit: '°C' } },
}
/** Panneau d'un volet solaire : un capteur de luminosité lié à son volet. */
const panel: DeviceDescriptor = {
  id: 'tahoma:lux', pluginId: 'tahoma', externalId: 'lux', kind: 'sensor', name: 'Panneau',
  capabilities: [], meta: { sensor: { deviceClass: 'illuminance', unit: 'lx' }, linkedTo: 'tahoma:v' },
}
const state: StateFor<'sensor'> = { kind: 'sensor', updatedAt: 0, available: true, value: 12 }

describe('SensorCard', () => {
  // le panneau garde ce composant d'un capteur à l'autre : la courbe suit le capteur AFFICHÉ
  it('montre la courbe de luminosité en passant d’un capteur ordinaire au panneau d’un volet', async () => {
    const w = mount(SensorCard, { props: { descriptor: temp, state }, global: { stubs: { LightHistoryChart: true } } })
    expect(w.findComponent({ name: 'LightHistoryChart' }).exists()).toBe(false)
    await w.setProps({ descriptor: panel })
    expect(w.findComponent({ name: 'LightHistoryChart' }).exists()).toBe(true)
  })
})
