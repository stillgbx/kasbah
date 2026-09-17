import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse, type DeviceDescriptor, type DeviceEntry } from '@kasbah/shared'
import demo from '../../../../../house/demo-house.json'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import SearchBar from './SearchBar.vue'

// Ce que la recherche doit tenir : la PIÈCE avant les appareils qui la nomment, les accents
// ignorés, un appareil qu'aucune pièce ne réclame quand même trouvable (dit « Non placé »), et
// choisir une ligne déplace la sélection du store — c'est elle qui cadre la scène.

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

/** Un appareil de plugin dont la pièce n'existe pas dans la maison : l'auto-placement le laisse dehors. */
const stray = (): DeviceEntry => ({
  descriptor: {
    id: 'mock:lampe-atelier', pluginId: 'mock', externalId: 'lampe-atelier', kind: 'light',
    name: 'Néon atelier', capabilities: ['on_off'], meta: { room: 'Atelier' },
  } as DeviceDescriptor,
  state: { kind: 'light', updatedAt: 0, available: true, on: false } as DeviceEntry['state'],
})

/** Deux appareils qu'on ne cherchera jamais par leur nom : on tape la marque ou le modèle. */
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
  const rows = () => w.findAll('.search__row').map((r) => ({
    label: r.find('.search__label').exists() ? r.find('.search__label').text() : '',
    sub: r.find('.search__sub').exists() ? r.find('.search__sub').text() : '',
    text: r.text(),
  }))
  return { w, house, type, rows }
}

describe('SearchBar', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('donne la pièce avant les appareils qui la nomment', async () => {
    const { type, rows } = await setup()
    await type('salon')
    const found = rows()
    expect(found[0]).toMatchObject({ label: 'Salon', sub: 'Rez-de-chaussée' })
    expect(found.slice(1).map((r) => r.label)).toContain('Plafonnier salon')
  })

  it('ignore les accents', async () => {
    const { type, rows } = await setup()
    await type('entree')
    expect(rows()[0]!.label).toBe('Entrée')
  })

  it('trouve un appareil par un mot au milieu de son nom', async () => {
    const { type, rows } = await setup()
    await type('filtration')
    expect(rows().map((r) => r.label)).toContain('Pression filtration')
  })

  it('montre les appareils non placés, et le dit', async () => {
    const { type, rows } = await setup()
    await type('atelier')
    expect(rows()[0]).toMatchObject({ label: 'Néon atelier', sub: 'Non placé' })
  })

  it('se laisse trouver par la marque ou le modèle, et le dit à la place du lieu', async () => {
    const { type, rows } = await setup()
    await type('proteo')
    expect(rows()[0]).toMatchObject({ label: "Traitement de l'eau", sub: 'COMAP Proteo V3' })
    await type('comap')
    expect(rows()[0]!.label).toBe("Traitement de l'eau")
  })

  it('classe le nom avant la marque', async () => {
    const { type, rows } = await setup()
    await type('tesla')
    // « Tesla » est le NOM d'une voiture de la maison ; la batterie n'est qu'une Tesla de marque
    expect(rows().map((r) => r.label)).toEqual(['Tesla', 'Batterie maison'])
  })

  it("focalise le NIVEAU de l'appareil, sinon l'étage au-dessus le cacherait", async () => {
    const { w, house, type } = await setup()
    expect(house.floorTab).toBe('all')                 // « Tout » : rien n'est masqué, le toit est posé dessus
    await type('plafonnier')
    await w.findAll('.search__row')[0]!.trigger('click')
    expect(house.selectedKey).toBe('light.salon')
    expect(house.focusedLevelId).toBe('rdc')           // la scène masque alors étage et toit
  })

  it("focalise le jardin pour un appareil de zone", async () => {
    const { w, house, type } = await setup()
    await type('piscine')
    const i = w.findAll('.search__label').findIndex((l) => l.text() === 'Température piscine')
    await w.findAll('.search__row')[i]!.trigger('click')
    expect(house.gardenFocus).toBe(true)
  })

  it('attend le deuxième caractère, puis répond même quand rien ne correspond', async () => {
    const { w, type, rows } = await setup()
    await type('s')
    expect(w.find('.search__list').exists()).toBe(false)
    await type('zzz')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.text).toBe('Aucun résultat')
  })

  it('choisir une ligne sélectionne dans le store et rend le champ vide', async () => {
    const { w, house, type } = await setup()
    await type('cuisine')
    await w.findAll('.search__row')[0]!.trigger('click')
    expect(house.selectedRoomId).toBe('cuisine')
    expect(w.find('input').element.value).toBe('')
    expect(w.emitted('picked')).toHaveLength(1)
  })
})
