import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { setTransport } from '../api'
import type { HaEntities, Transport } from '../api/transport'
import HomeAssistantCard from './HomeAssistantCard.vue'

// The Home Assistant card: the entities grouped by HA integration, a duplicate hidden by default,
// and a switch back to the default sending `null` rather than a choice.

const data: HaEntities = {
  connected: true,
  entities: [
    { entityId: 'light.lampe_1', name: 'Lampe 1', kind: 'light', integration: 'hue', room: 'Salon', shown: false, chosen: false, duplicateOf: 'hue' },
    { entityId: 'light.lampe_2', name: 'Lampe 2', kind: 'light', integration: 'hue', shown: false, chosen: false, duplicateOf: 'hue' },
    { entityId: 'cover.volet_1', name: 'Volet 1', kind: 'cover', integration: 'overkiz', room: 'Salon', shown: true, chosen: false },
  ],
}

function fake(d: HaEntities) {
  const setHomeAssistantEntities = vi.fn(async () => d)
  setTransport({ homeAssistantEntities: async () => d, setHomeAssistantEntities } as unknown as Transport)
  return setHomeAssistantEntities
}

describe('HomeAssistantCard', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  it('groups by integration and says why a duplicate is hidden', async () => {
    fake(data)
    const w = mount(HomeAssistantCard)
    await flushPromises()
    expect(w.findAll('.ha__integration').map((e) => e.text())).toEqual(['hue', 'overkiz'])
    expect(w.find('.ha__status').text()).toContain('1')
    expect(w.findAll('.ha__dup')).toHaveLength(1)
    w.unmount()
  })

  it('a choice equal to the default goes back to it; the group button sets them all', async () => {
    const set = fake(data)
    const w = mount(HomeAssistantCard)
    await flushPromises()
    const [hue, overkiz] = w.findAll('.ha__all')
    await hue!.trigger('click')
    expect(set).toHaveBeenLastCalledWith({ 'light.lampe_1': true, 'light.lampe_2': true })
    await overkiz!.trigger('click')
    expect(set).toHaveBeenLastCalledWith({ 'cover.volet_1': false })
    w.unmount()
  })

  it('says it is connecting while the plugin has not reached Home Assistant', async () => {
    fake({ connected: false, entities: [] })
    const w = mount(HomeAssistantCard)
    await flushPromises()
    expect(w.findAll('.ha__group')).toHaveLength(0)
    expect(w.find('.ha__status').text()).not.toBe('')
    w.unmount()
  })
})
