import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CoverPill from './CoverPill.vue'

// Vignette de 40 × 100 px posée en (0, 0) : 1 px = 1 % de fermeture sur l'axe vertical.
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 40, height: 100, right: 40, bottom: 100, toJSON: () => ({}) }) as DOMRect
})

const pill = (props: Record<string, unknown> = {}) =>
  mount(CoverPill, { props: { closure: 20, interactive: true, deviceClass: 'shutter', label: 'Fermeture', ...props } })

describe('CoverPill', () => {
  it('un appui sans glisser envoie l’ouvrant là où tombe le doigt', async () => {
    const w = pill()
    await w.trigger('pointerdown', { pointerId: 1, clientX: 20, clientY: 70 })
    await w.trigger('pointerup', { pointerId: 1, clientX: 20, clientY: 70 })
    expect(w.emitted('commit')).toEqual([[70]])
    expect(w.emitted('drag')).toBeUndefined()
  })
  it('un portail se vise de côté', async () => {
    const w = pill({ deviceClass: 'gate' })
    await w.trigger('pointerdown', { pointerId: 1, clientX: 30, clientY: 10 })
    await w.trigger('pointerup', { pointerId: 1, clientX: 30, clientY: 10 })
    expect(w.emitted('commit')).toEqual([[75]])                 // 30 px sur 40
  })
  it('le glissement reste RELATIF : il part de la position actuelle, pas du doigt', async () => {
    const w = pill()
    await w.trigger('pointerdown', { pointerId: 1, clientX: 20, clientY: 70 })
    await w.trigger('pointermove', { pointerId: 1, clientX: 20, clientY: 80 })
    await w.trigger('pointerup', { pointerId: 1, clientX: 20, clientY: 80 })
    expect(w.emitted('commit')).toEqual([[30]])                 // 20 % + 10 px
  })
  it('ne commande rien sur un ouvrant qui ne sait pas viser', async () => {
    const w = pill({ interactive: false })
    await w.trigger('pointerdown', { pointerId: 1, clientX: 20, clientY: 70 })
    await w.trigger('pointerup', { pointerId: 1, clientX: 20, clientY: 70 })
    expect(w.emitted('commit')).toBeUndefined()
  })
})
