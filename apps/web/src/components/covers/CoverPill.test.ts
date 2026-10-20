import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CoverPill from './CoverPill.vue'

// 40 × 100 px thumbnail placed at (0, 0): 1 px = 1 % of closure on the vertical axis.
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 40, height: 100, right: 40, bottom: 100, toJSON: () => ({}) }) as DOMRect
})

const pill = (props: Record<string, unknown> = {}) =>
  mount(CoverPill, { props: { closure: 20, interactive: true, deviceClass: 'shutter', label: 'Fermeture', ...props } })

describe('CoverPill', () => {
  it('a tap without dragging sends the cover to where the finger lands', async () => {
    const w = pill()
    await w.trigger('pointerdown', { pointerId: 1, clientX: 20, clientY: 70 })
    await w.trigger('pointerup', { pointerId: 1, clientX: 20, clientY: 70 })
    expect(w.emitted('commit')).toEqual([[70]])
    expect(w.emitted('drag')).toBeUndefined()
  })
  it('a gate is aimed from the side', async () => {
    const w = pill({ deviceClass: 'gate' })
    await w.trigger('pointerdown', { pointerId: 1, clientX: 30, clientY: 10 })
    await w.trigger('pointerup', { pointerId: 1, clientX: 30, clientY: 10 })
    expect(w.emitted('commit')).toEqual([[75]])                 // 30 px out of 40
  })
  it('dragging stays RELATIVE: it starts from the current position, not from the finger', async () => {
    const w = pill()
    await w.trigger('pointerdown', { pointerId: 1, clientX: 20, clientY: 70 })
    await w.trigger('pointermove', { pointerId: 1, clientX: 20, clientY: 80 })
    await w.trigger('pointerup', { pointerId: 1, clientX: 20, clientY: 80 })
    expect(w.emitted('commit')).toEqual([[30]])                 // 20 % + 10 px
  })
  it('commands nothing on a cover that cannot be aimed', async () => {
    const w = pill({ interactive: false })
    await w.trigger('pointerdown', { pointerId: 1, clientX: 20, clientY: 70 })
    await w.trigger('pointerup', { pointerId: 1, clientX: 20, clientY: 70 })
    expect(w.emitted('commit')).toBeUndefined()
  })
})
