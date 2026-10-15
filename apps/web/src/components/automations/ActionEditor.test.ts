import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ActionEditor from './ActionEditor.vue'
import type { ActionDraft } from '../../lib/automations'

const open = (forMin?: number): ActionDraft =>
  ({ type: 'command', target: { type: 'devices', deviceIds: ['mock:cover-living'] }, command: { type: 'cover.open' }, ...(forMin ? { forMin } : {}) })

function forField(w: ReturnType<typeof mount>) {
  const inputs = w.findAll('input.act__input--num')
  return inputs[inputs.length - 1]!                              // « pendant » ferme la carte
}
const lastForMin = (w: ReturnType<typeof mount>) => (w.emitted('update:modelValue')!.at(-1)![0] as { forMin?: number }).forMin

describe('ActionEditor — pendant N min', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('a re-render while typing does not put the model value back in the field', async () => {
    const w = mount(ActionEditor, { props: { modelValue: open(20) } })
    const input = forField(w)
    ;(input.element as HTMLInputElement).value = '60'
    await input.trigger('input')
    w.vm.$forceUpdate()                                          // un état d'appareil redessine la carte avant la validation
    await w.vm.$nextTick()
    expect((input.element as HTMLInputElement).value).toBe('60')
  })

  it('clamps to the accepted range and shows it', async () => {
    const w = mount(ActionEditor, { props: { modelValue: open(20) } })
    expect(w.text()).toContain('min (1 à 1440)')
    await forField(w).setValue('2000')
    expect(lastForMin(w)).toBe(1440)
    await forField(w).setValue('0')
    expect(lastForMin(w)).toBe(1)
  })

  it('the field shows the bound when the clamped value equals the model', async () => {
    const w = mount(ActionEditor, { props: { modelValue: open(1440) } })
    const input = forField(w)
    await input.setValue('5000')
    await w.vm.$nextTick()
    expect((input.element as HTMLInputElement).value).toBe('1440')
  })
})
