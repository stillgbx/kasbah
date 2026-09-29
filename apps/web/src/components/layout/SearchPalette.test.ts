import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '../../../../../house/demo-house.json'
import { homePanelRequest } from '../../composables/useSearch'
import { useHouseStore } from '../../stores/house'
import SearchPalette from './SearchPalette.vue'

// Ce que la palette doit tenir : Ctrl+K l'ouvre et la referme, un résultat de la maison ramène
// d'abord sur la vue Maison puis sélectionne (dans cet ordre, sinon l'URL annule la navigation),
// et demande l'ouverture du panneau ; une page, elle, ne fait que naviguer.

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

  it('Ctrl+K ouvre la palette, un second Ctrl+K la referme', async () => {
    const { w } = await setup()
    expect(w.find('.palette').exists()).toBe(false)
    ctrlK(); await flushPromises()
    expect(w.find('.palette input').exists()).toBe(true)
    ctrlK(); await flushPromises()
    expect(w.find('.palette').exists()).toBe(false)
    w.unmount()
  })

  it('depuis une autre page, ramène sur la maison AVANT de sélectionner, puis ouvre le panneau', async () => {
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

  it('propose la page Maison, et une page ne demande pas le panneau', async () => {
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

  it('Échap efface d’abord, ferme ensuite', async () => {
    const { w } = await setup()
    ctrlK(); await flushPromises()
    const input = w.find('input')
    await input.setValue('salon')
    expect(w.find('.palette__list').exists()).toBe(true)
    await input.trigger('keydown.esc')
    expect(w.find('.palette__list').exists()).toBe(false)   // la requête est effacée…
    expect(w.find('.palette').exists()).toBe(true)          // …la palette reste ouverte
    await input.trigger('keydown.esc')
    expect(w.find('.palette').exists()).toBe(false)
    w.unmount()
  })
})
