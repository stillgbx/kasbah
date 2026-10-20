import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '../../../../../house/demo-house.json'
import { setTransport } from '../../api'
import type { AssistantEvent, Transport } from '../../api/transport'
import { homePanelRequest } from '../../composables/useSearch'
import { useHouseStore } from '../../stores/house'
import SearchPalette from './SearchPalette.vue'

// What the palette must hold: Ctrl+K opens and closes it, a house result first brings back
// to the House view then selects (in that order, otherwise the URL cancels the navigation),
// and requests the panel to open; a page, for its part, only navigates.

const route = { name: 'music' as string }
const calls: string[] = []
const push = vi.fn(async (to: { name: string }) => { calls.push(`push:${to.name}`); route.name = to.name })
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => route }))

const ctrlK = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))

async function setup() {
  const house = useHouseStore()
  house.house = parseHouse(demo)
  const w = mount(SearchPalette, { global: { stubs: { teleport: true } } })
  return { w, house }
}

describe('SearchPalette', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    route.name = 'music'
    calls.length = 0
    push.mockClear()
  })

  it('ignores a keydown without a key (Chrome autofill)', async () => {
    const { w } = await setup()
    expect(() => window.dispatchEvent(new Event('keydown'))).not.toThrow()
    await flushPromises()
    expect(w.find('.palette').exists()).toBe(false)
    w.unmount()
  })

  it('Ctrl+K opens the palette, a second Ctrl+K closes it', async () => {
    const { w } = await setup()
    expect(w.find('.palette').exists()).toBe(false)
    ctrlK(); await flushPromises()
    expect(w.find('.palette input').exists()).toBe(true)
    ctrlK(); await flushPromises()
    expect(w.find('.palette').exists()).toBe(false)
    w.unmount()
  })

  it('from another page, goes back to the house BEFORE selecting, then opens the panel', async () => {
    const { w, house } = await setup()
    const orig = house.selectRoom.bind(house)
    house.selectRoom = (id) => { calls.push(`select:${id}`); orig(id) }
    const before = homePanelRequest.value
    ctrlK(); await flushPromises()
    await w.find('input').setValue('cuisine')
    await w.findAll('.palette__row')[0]!.trigger('click')
    await flushPromises()
    expect(calls).toEqual(['push:home', 'select:cuisine'])
    expect(house.selectedRoomId).toBe('cuisine')
    expect(homePanelRequest.value).toBe(before + 1)
    expect(w.find('.palette').exists()).toBe(false)
    w.unmount()
  })

  it('offers the House page, and a page does not request the panel', async () => {
    const { w } = await setup()
    const before = homePanelRequest.value
    ctrlK(); await flushPromises()
    await w.find('input').setValue('maison')
    const rows = w.findAll('.palette__row')
    const i = rows.findIndex((r) => r.find('.palette__sub').text() === 'Page')
    expect(i).toBeGreaterThanOrEqual(0)
    await rows[i]!.trigger('click')
    await flushPromises()
    expect(push).toHaveBeenCalledWith({ name: 'home' })
    expect(homePanelRequest.value).toBe(before)
    w.unmount()
  })

  it('Escape clears first, then closes', async () => {
    const { w } = await setup()
    ctrlK(); await flushPromises()
    const input = w.find('input')
    await input.setValue('salon')
    expect(w.find('.palette__list').exists()).toBe(true)
    await input.trigger('keydown.esc')
    expect(w.find('.palette__list').exists()).toBe(false)   // the query is cleared…
    expect(w.find('.palette').exists()).toBe(true)          // …the palette stays open
    await input.trigger('keydown.esc')
    expect(w.find('.palette').exists()).toBe(false)
    w.unmount()
  })

  describe('Ask Kasbah', () => {
    afterEach(() => { setTransport(null) })

    it('Enter without a result asks Kasbah; the answer replaces the list and survives closing', async () => {
      const asked: string[] = []
      setTransport({
        async assistantAsk(text: string, onEvent: (e: AssistantEvent) => void) {
          asked.push(text)
          onEvent({ type: 'text', text: 'La radio joue dans la cuisine.' })
          onEvent({ type: 'done', ms: 1 })
        },
      } as unknown as Transport)
      const { w } = await setup()
      ctrlK(); await flushPromises()
      await w.find('input').setValue('zzz mets la radio')
      await w.find('input').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(asked).toEqual(['zzz mets la radio'])
      expect(w.find('.palette__list').exists()).toBe(false)
      expect(w.find('.reply__answer').text()).toBe('La radio joue dans la cuisine.')
      // close then reopen: the answer is still there, the instruction in the field
      ctrlK(); await flushPromises()
      ctrlK(); await flushPromises()
      expect((w.find('input').element as HTMLInputElement).value).toBe('zzz mets la radio')
      expect(w.find('.reply__answer').exists()).toBe(true)
      // Escape closes the answer and clears the instruction: the palette stays open, empty
      await w.find('input').trigger('keydown', { key: 'Escape' })
      expect(w.find('.reply__answer').exists()).toBe(false)
      expect((w.find('input').element as HTMLInputElement).value).toBe('')
      expect(w.find('.palette').exists()).toBe(true)
      w.unmount()
    })
  })
})
