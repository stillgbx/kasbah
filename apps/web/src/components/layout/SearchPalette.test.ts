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

  it('ignore un keydown sans touche (remplissage automatique de Chrome)', async () => {
    const { w } = await setup()
    expect(() => window.dispatchEvent(new Event('keydown'))).not.toThrow()
    await flushPromises()
    expect(w.find('.palette').exists()).toBe(false)
    w.unmount()
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

  describe('Demander à Kasbah', () => {
    afterEach(() => { setTransport(null) })

    it('Entrée sans résultat demande à Kasbah ; la réponse remplace la liste et survit à la fermeture', async () => {
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
      // fermer puis rouvrir : la réponse est toujours là, l'instruction dans le champ
      ctrlK(); await flushPromises()
      ctrlK(); await flushPromises()
      expect((w.find('input').element as HTMLInputElement).value).toBe('zzz mets la radio')
      expect(w.find('.reply__answer').exists()).toBe(true)
      // Échap ferme la réponse et efface l'instruction : la palette reste ouverte, vide
      await w.find('input').trigger('keydown', { key: 'Escape' })
      expect(w.find('.reply__answer').exists()).toBe(false)
      expect((w.find('input').element as HTMLInputElement).value).toBe('')
      expect(w.find('.palette').exists()).toBe(true)
      w.unmount()
    })
  })
})
