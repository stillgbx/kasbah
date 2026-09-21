import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import LightControl from './LightControl.vue'

const descriptor: DeviceDescriptor = {
  id: 'mock:l', pluginId: 'mock', externalId: 'l', kind: 'light', name: 'Lampe',
  capabilities: ['on_off', 'brightness', 'color_temp'], meta: { colorTempMirek: [153, 500] },
}
const state: StateFor<'light'> = { kind: 'light', updatedAt: 0, available: true, on: false, brightness: 40, colorTempMirek: 300 }

const mountLight = (props: { descriptor: DeviceDescriptor; state: StateFor<'light'> }) =>
  mount(LightControl, { global: { plugins: [createPinia()] }, props })

describe('LightControl', () => {
  it('renders brightness and temperature sliders without its own switch (the panel header owns it)', () => {
    const w = mountLight({ descriptor, state })
    expect(w.findAll('.v-slider')).toHaveLength(2)
    expect(w.find('.v-color-picker').exists()).toBe(false)
    expect(w.find('input[type="checkbox"]').exists()).toBe(false)
    expect(w.text()).toContain('3300 K')   // 300 mirek ≈ 3333 K arrondi à la centaine
  })
  it('shows a color picker when the light supports color', () => {
    const w = mountLight({ descriptor: { ...descriptor, capabilities: ['on_off', 'color'] }, state })
    expect(w.find('.v-color-picker').exists()).toBe(true)
  })
  it('shows three temperature segments when colorTempMirekSteps is set', () => {
    const w = mountLight({
      descriptor: {
        ...descriptor,
        meta: { colorTempMirekSteps: [370, 303, 250] },
      },
      state: { ...state, colorTempMirek: 303 },
    })
    expect(w.findAll('.v-slider')).toHaveLength(1) // brightness only
    expect(w.findAll('.segmented__item')).toHaveLength(3)
    expect(w.text()).toContain('Chaud')
    expect(w.text()).toContain('2700 K')
    expect(w.text()).toContain('Neutre')
    expect(w.text()).toContain('4000 K')
  })
})
