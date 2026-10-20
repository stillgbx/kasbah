import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import SensorCard from './SensorCard.vue'

const temp: DeviceDescriptor = {
  id: 'mock:t', pluginId: 'mock', externalId: 't', kind: 'sensor', name: 'Température',
  capabilities: [], meta: { sensor: { deviceClass: 'temperature', unit: '°C' } },
}
/** Panel of a solar shutter: a brightness sensor linked to its shutter. */
const panel: DeviceDescriptor = {
  id: 'tahoma:lux', pluginId: 'tahoma', externalId: 'lux', kind: 'sensor', name: 'Panneau',
  capabilities: [], meta: { sensor: { deviceClass: 'illuminance', unit: 'lx' }, linkedTo: 'tahoma:v' },
}
const state: StateFor<'sensor'> = { kind: 'sensor', updatedAt: 0, available: true, value: 12 }

describe('SensorCard', () => {
  // the panel keeps this component from one sensor to another: the curve follows the DISPLAYED sensor
  it('shows the brightness curve when going from an ordinary sensor to a shutter\'s panel', async () => {
    const w = mount(SensorCard, { props: { descriptor: temp, state }, global: { stubs: { LightHistoryChart: true } } })
    expect(w.findComponent({ name: 'LightHistoryChart' }).exists()).toBe(false)
    await w.setProps({ descriptor: panel })
    expect(w.findComponent({ name: 'LightHistoryChart' }).exists()).toBe(true)
  })
})
