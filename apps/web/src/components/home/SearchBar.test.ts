import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse, type DeviceDescriptor, type DeviceEntry } from '@kasbah/shared'
import demo from '../../../../../house/demo-house.json'
import { setTransport } from '../../api'
import { ApiRequestError, type AssistantEvent, type Transport } from '../../api/transport'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import SearchBar from './SearchBar.vue'

// What the search must hold: the ROOM before the devices that name it, accents
// ignored, a device that no room claims still findable (says "Not placed"), and
// choosing a row moves the store's selection — it is what frames the scene.

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

/** A plugin device whose room does not exist in the house: auto-placement leaves it outside. */
const stray = (): DeviceEntry => ({
  descriptor: {
    id: 'mock:lampe-atelier', pluginId: 'mock', externalId: 'lampe-atelier', kind: 'light',
    name: 'Néon atelier', capabilities: ['on_off'], meta: { room: 'Atelier' },
  } as DeviceDescriptor,
  state: { kind: 'light', updatedAt: 0, available: true, on: false } as DeviceEntry['state'],
})

/** Two devices one will never look up by name: one types the brand or the model. */
const station = (): DeviceEntry => ({
  descriptor: {
    id: 'comap:station', pluginId: 'comap', externalId: 'station', kind: 'water',
    name: "Traitement de l'eau", capabilities: [], meta: { manufacturer: 'COMAP', model: 'Proteo V3' },
  } as unknown as DeviceDescriptor,
  state: { kind: 'water', updatedAt: 0, available: true } as DeviceEntry['state'],
})
const powerwall = (): DeviceEntry => ({
  descriptor: {
    id: 'mock:batterie', pluginId: 'mock', externalId: 'batterie', kind: 'sensor',
    name: 'Batterie maison', capabilities: [], meta: { manufacturer: 'Tesla', model: 'Powerwall' },
  } as unknown as DeviceDescriptor,
  state: { kind: 'sensor', updatedAt: 0, available: true, sensorClass: 'battery', value: 50 } as DeviceEntry['state'],
})

async function setup() {
  const house = useHouseStore()
  house.house = parseHouse(demo)
  useDevicesStore().setEntries([stray(), station(), powerwall()])
  const w = mount(SearchBar)
  const input = w.find('input')
  await input.trigger('focus')
  const type = async (text: string) => { await input.setValue(text) }
  // the results; the assistant's row, always the last one, has its own tests
  const rows = () => w.findAll('.search__row:not(.search__row--ask)').map((r) => ({
    label: r.find('.search__label').exists() ? r.find('.search__label').text() : '',
    sub: r.find('.search__sub').exists() ? r.find('.search__sub').text() : '',
    text: r.text(),
  }))
  return { w, house, type, rows }
}

describe('SearchBar', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('puts the room before the devices that name it', async () => {
    const { type, rows } = await setup()
    await type('salon')
    const found = rows()
    expect(found[0]).toMatchObject({ label: 'Salon', sub: 'Rez-de-chaussée' })
    expect(found.slice(1).map((r) => r.label)).toContain('Plafonnier salon')
  })

  it('ignores accents', async () => {
    const { type, rows } = await setup()
    await type('entree')
    expect(rows()[0]!.label).toBe('Entrée')
  })

  it('finds a device by a word in the middle of its name', async () => {
    const { type, rows } = await setup()
    await type('filtration')
    expect(rows().map((r) => r.label)).toContain('Pression filtration')
  })

  it('shows unplaced devices, and says so', async () => {
    const { type, rows } = await setup()
    await type('atelier')
    expect(rows()[0]).toMatchObject({ label: 'Néon atelier', sub: 'Non placé' })
  })

  it('can be found by brand or model, and says so in place of the location', async () => {
    const { type, rows } = await setup()
    await type('proteo')
    expect(rows()[0]).toMatchObject({ label: "Traitement de l'eau", sub: 'COMAP Proteo V3' })
    await type('comap')
    expect(rows()[0]!.label).toBe("Traitement de l'eau")
  })

  it('ranks the name before the brand', async () => {
    const { type, rows } = await setup()
    await type('tesla')
    // "Tesla" is the NAME of a car in the house; the battery is only a Tesla by brand
    expect(rows().map((r) => r.label)).toEqual(['Tesla', 'Batterie maison'])
  })

  it("focuses the device's LEVEL, otherwise the floor above would hide it", async () => {
    const { w, house, type } = await setup()
    expect(house.floorTab).toBe('all')                 // "All": nothing is hidden, the roof is placed on top
    await type('plafonnier salon')
    await w.findAll('.search__row')[0]!.trigger('click')
    expect(house.selectedKey).toBe('light.salon')
    expect(house.focusedLevelId).toBe('rdc')           // the scene then hides the floor and the roof
  })

  it("focuses the garden for a zone device", async () => {
    const { w, house, type } = await setup()
    await type('piscine')
    const i = w.findAll('.search__label').findIndex((l) => l.text() === 'Température piscine')
    await w.findAll('.search__row')[i]!.trigger('click')
    expect(house.gardenFocus).toBe(true)
  })

  it('waits for the second character, then answers even when nothing matches', async () => {
    const { w, type, rows } = await setup()
    await type('s')
    expect(w.find('.search__list').exists()).toBe(false)
    await type('zzz')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.text).toBe('Aucun résultat')
  })

  it('choosing a row selects in the store and empties the field', async () => {
    const { w, house, type } = await setup()
    await type('cuisine')
    await w.findAll('.search__row')[0]!.trigger('click')
    expect(house.selectedRoomId).toBe('cuisine')
    expect(w.find('input').element.value).toBe('')
    expect(w.emitted('picked')).toHaveLength(1)
  })
})

describe('SearchBar — Ask Kasbah', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  /** A fake assistant: records the instruction and replays the given events. */
  function fakeAssistant(events: AssistantEvent[] | Error) {
    const asked: string[] = []
    setTransport({
      async assistantAsk(text: string, onEvent: (e: AssistantEvent) => void) {
        asked.push(text)
        if (events instanceof Error) throw events
        for (const e of events) onEvent(e)
      },
    } as unknown as Transport)
    return asked
  }

  it('offers to pass the input to the assistant, as the last row', async () => {
    const { w, type } = await setup()
    await type('allume le salon')
    const last = w.findAll('.search__row').at(-1)!
    expect(last.classes()).toContain('search__row--ask')
    expect(last.text()).toBe('Demander à Kasbahallume le salon')
  })

  it('Enter with no result asks Kasbah, and shows what it did then its answer', async () => {
    const asked = fakeAssistant([
      { type: 'tool', id: 't1', name: 'send_command', input: { deviceId: 'mock:lampe-atelier', command: { type: 'light.set', on: true } } },
      { type: 'tool_result', id: 't1', ok: true },
      { type: 'text', text: 'Le néon de l’atelier est allumé.' },
      { type: 'done', ms: 6000 },
    ])
    const { w, type } = await setup()
    await type('zzz allume le néon')
    await w.find('input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(asked).toEqual(['zzz allume le néon'])
    expect(w.find('.search__list').exists()).toBe(false)
    const reply = w.find('.search__reply')
    expect(reply.find('.reply__action').text()).toContain('Commande')
    expect(reply.find('.reply__target').text()).toBe('Néon atelier')
    expect(reply.find('.reply__answer').text()).toBe('Le néon de l’atelier est allumé.')
    // the cross clears the answer and the input
    await w.find('.search__clear').trigger('click')
    expect(w.find('.search__reply').exists()).toBe(false)
    expect(w.find('input').element.value).toBe('')
  })

  it('Escape closes the answer and clears the instruction from the field', async () => {
    fakeAssistant([{ type: 'text', text: 'Fait.' }, { type: 'done', ms: 1 }])
    const { w, type } = await setup()
    await type('zzz fais un truc')
    await w.find('.search__row--ask').trigger('click')
    await flushPromises()
    expect(w.find('.search__reply').exists()).toBe(true)
    await w.find('input').trigger('keydown.esc')
    expect(w.find('.search__reply').exists()).toBe(false)
    expect(w.find('input').element.value).toBe('')
  })

  it('the cross of the answer closes it and clears the instruction from the field', async () => {
    fakeAssistant([{ type: 'text', text: 'Fait.' }, { type: 'done', ms: 1 }])
    const { w, type } = await setup()
    await type('zzz fais un truc')
    await w.find('.search__row--ask').trigger('click')
    await flushPromises()
    await w.find('.reply__close').trigger('click')
    expect(w.find('.search__reply').exists()).toBe(false)
    expect(w.find('input').element.value).toBe('')
  })

  it('plainly states a refused instruction', async () => {
    fakeAssistant(new ApiRequestError(409, 'BUSY', 'an instruction is already running'))
    const { w, type } = await setup()
    await type('zzz éteins tout')
    await w.find('.search__row--ask').trigger('click')
    await flushPromises()
    expect(w.find('.reply__error').text()).toBe('Une instruction est déjà en cours.')
  })

  it('goes back to search when the instruction is edited after the answer', async () => {
    fakeAssistant([{ type: 'text', text: 'Fait.' }, { type: 'done', ms: 1 }])
    const { w, type } = await setup()
    await type('zzz fais un truc')
    await w.find('.search__row--ask').trigger('click')
    await flushPromises()
    expect(w.find('.search__reply').exists()).toBe(true)
    await w.find('input').trigger('focus')
    await type('salon')
    expect(w.find('.search__reply').exists()).toBe(false)
    expect(w.find('.search__list').exists()).toBe(true)
  })
})
