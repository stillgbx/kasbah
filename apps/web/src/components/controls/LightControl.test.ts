import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import LightControl from './LightControl.vue'

const descriptor: DeviceDescriptor = {
  id: 'mock:l', pluginId: 'mock', externalId: 'l', kind: 'light', name: 'Lampe',
  capabilities: ['on_off', 'brightness', 'color_temp'], meta: { colorTempMirek: [153, 500] },
}
const state: StateFor<'light'> = { kind: 'light', updatedAt: 0, available: true, on: false, brightness: 40, colorTempMirek: 300 }

describe('LightControl', () => {
  it('renders brightness and temperature sliders without its own switch (the panel header owns it)', () => {
    const w = mount(LightControl, { props: { descriptor, state } })
    expect(w.findAll('.v-slider')).toHaveLength(2)
    expect(w.find('.v-color-picker').exists()).toBe(false)
    expect(w.find('input[type="checkbox"]').exists()).toBe(false)
    expect(w.text()).toContain('3300 K')   // 300 mirek ≈ 3333 K arrondi à la centaine
  })
  it('shows a color picker when the light supports color', () => {
    const w = mount(LightControl, { props: { descriptor: { ...descriptor, capabilities: ['on_off', 'color'] }, state } })
    expect(w.find('.v-color-picker').exists()).toBe(true)
  })
})
