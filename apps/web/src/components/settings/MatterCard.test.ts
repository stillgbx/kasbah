import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { MatterStatus } from '@kasbah/shared'
import { setTransport } from '../../api'
import type { Transport } from '../../api/transport'
import MatterCard from './MatterCard.vue'

// The Matter card: the pairing code while no assistant holds the bridge, the devices grouped by
// plugin, and each switch writing the WHOLE list of published devices.

const base: MatterStatus = {
  enabled: true, running: true, commissioned: false,
  pairing: { manualCode: '06252306146', qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
  candidates: [
    { id: 'mock:light-living', name: 'Plafonnier salon', pluginId: 'mock', type: 'dimmable_light', listed: true, published: true },
    { id: 'mock:cover-gate', name: 'Portail', pluginId: 'mock', type: 'window_covering', listed: false, published: false },
    { id: 'tesla:car1', name: 'Voiture 1', pluginId: 'tesla', type: 'door_lock', listed: false, published: false },
  ],
  skipped: [],
}

/** `v-show`: folded = `display: none` on the list. */
const shown = (e: Element) => (e as HTMLElement).style.display !== 'none'

function fake(status: MatterStatus) {
  const setMatter = vi.fn(async () => status)
  setTransport({ matterStatus: async () => status, setMatter } as unknown as Transport)
  return setMatter
}

describe('MatterCard', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  it('shows the QR code and the manual code in 4-3-4 groups while waiting to be paired', async () => {
    fake(base)
    const w = mount(MatterCard)
    await flushPromises()
    expect(w.find('.mc__qr img').attributes('src')).toMatch(/^data:image\/svg\+xml/)
    expect(w.find('.mc__code').text()).toBe('0625-230-6146')
    w.unmount()
  })

  it('keeps the pairing box once paired, with a note instead of the code', async () => {
    fake({ ...base, commissioned: true, pairing: undefined })
    const w = mount(MatterCard)
    await flushPromises()
    expect(w.find('.mc__qr').exists()).toBe(true)
    expect(w.find('.mc__qr img').exists()).toBe(false)
    expect(w.find('.mc__code').exists()).toBe(false)
    w.unmount()
  })

  it('groups the devices by plugin and sends the whole list when one is ticked', async () => {
    const setMatter = fake(base)
    const w = mount(MatterCard)
    await flushPromises()
    expect(w.findAll('.mc__plugin').map((p) => p.text())).toEqual(['mock', 'tesla'])
    await w.findAll('.mc__toggle')[0]!.trigger('click')
    const gate = w.findAll('.mc__device').find((d) => d.text().includes('Portail'))!
    await gate.find('input').setValue(true)
    await flushPromises()
    expect(setMatter).toHaveBeenCalledWith({ devices: ['mock:light-living', 'mock:cover-gate'] })
    w.unmount()
  })

  it('folds each plugin by default, with its count of published devices', async () => {
    fake(base)
    const w = mount(MatterCard)
    await flushPromises()
    const groups = w.findAll('.mc__group')
    expect(groups.map((g) => shown(g.find('.mc__devices').element))).toEqual([false, false])
    expect(groups[0]!.find('.mc__count').text()).toBe('Publiés : 1 / 2')
    await groups[1]!.find('.mc__toggle').trigger('click')
    expect(shown(groups[1]!.find('.mc__devices').element)).toBe(true)
    expect(groups[1]!.find('.mc__toggle').attributes('aria-expanded')).toBe('true')
    w.unmount()
  })

  it('opens the only plugin when there is just one', async () => {
    fake({ ...base, candidates: base.candidates.filter((c) => c.pluginId === 'mock') })
    const w = mount(MatterCard)
    await flushPromises()
    expect(shown(w.find('.mc__devices').element)).toBe(true)
    w.unmount()
  })

  it('publishes a whole plugin at once', async () => {
    const setMatter = fake(base)
    const w = mount(MatterCard)
    await flushPromises()
    await w.findAll('.mc__group')[1]!.find('.pill').trigger('click')
    expect(setMatter).toHaveBeenCalledWith({ devices: ['mock:light-living', 'tesla:car1'] })
    w.unmount()
  })
})
