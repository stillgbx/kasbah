import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse, type DeviceDescriptor, type DeviceEntry, type DeviceKind, type DeviceState } from '@kasbah/shared'
import demo from '../../../../../house/demo-house.json'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import RoomPanel from './RoomPanel.vue'

function stateOf(kind: DeviceKind): DeviceState {
  if (kind === 'light') return { kind: 'light', updatedAt: 0, available: true, on: false }
  if (kind === 'cover') return { kind: 'cover', updatedAt: 0, available: true, position: 0, motion: 'stopped' }
  if (kind === 'media_player') return { kind: 'media_player', updatedAt: 0, available: true, playback: 'idle', volume: 20, muted: false }
  if (kind === 'sensor') return { kind: 'sensor', updatedAt: 0, available: true, value: 21 }
  return { kind: 'camera', updatedAt: 0, available: true }
}

const entry = (id: string, kind: DeviceKind, name: string): DeviceEntry => ({
  descriptor: {
    id, pluginId: 'mock', externalId: id, kind, name, capabilities: kind === 'sensor' ? ['measure'] : [],
    meta: kind === 'sensor' ? { sensor: { unit: '°C', deviceClass: 'temperature', precision: 1 } } : {},
  } as DeviceDescriptor,
  state: stateOf(kind),
})

function setup() {
  const house = useHouseStore()
  house.house = parseHouse(demo)
  useDevicesStore().setEntries([
    entry('mock:light-living', 'light', 'Plafonnier salon'),
    entry('mock:cover-living', 'cover', 'Volet baie'),
    entry('mock:speaker-living', 'media_player', 'Enceinte salon'),
    entry('mock:light-bedroom1', 'light', 'Lampe chambre 1'),
    entry('mock:cover-bedroom1', 'cover', 'Volet chambre 1'),
    entry('mock:sensor-bedroom1-temp', 'sensor', 'Température chambre 1'),
  ])
  return { house, w: mount(RoomPanel) }
}

const tabs = (w: ReturnType<typeof mount>) => w.findAll('[role="tab"]').map((b) => b.attributes('title'))
const names = (w: ReturnType<typeof mount>) => w.findAll('.dev-row__name').map((n) => n.text())

describe('RoomPanel filtre', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('shows All then the categories present, and filters the list', async () => {
    const { house, w } = setup()
    house.selectRoom('salon')
    await w.vm.$nextTick()
    expect(tabs(w)).toEqual(['Tout', 'Lumière', 'Volet', 'Média'])
    expect(w.findAll('[role="tab"] svg')).toHaveLength(4)
    expect(names(w)).toEqual(['Plafonnier salon', 'Volet baie', 'Enceinte salon'])

    await w.findAll('[role="tab"]')[2]!.trigger('click')
    expect(names(w)).toEqual(['Volet baie'])
    expect(w.find('.sub').text()).toContain('3 appareils')

    await w.findAll('[role="tab"]')[0]!.trigger('click')
    expect(names(w)).toEqual(['Plafonnier salon', 'Volet baie', 'Enceinte salon'])
  })

  it('goes back to All when changing room, and stays silent if there is only one category', async () => {
    const { house, w } = setup()
    house.selectRoom('salon')
    await w.vm.$nextTick()
    await w.findAll('[role="tab"]')[1]!.trigger('click')
    expect(names(w)).toEqual(['Plafonnier salon'])

    house.selectRoom('chambre1')
    await w.vm.$nextTick()
    expect(tabs(w)).toEqual(['Tout', 'Lumière', 'Volet', 'Température'])
    expect(names(w)).toEqual(['Lampe chambre 1', 'Volet chambre 1', 'Température chambre 1'])

    house.selectRoom('pelouse')
    await w.vm.$nextTick()
    expect(tabs(w)).toEqual([])
    expect(names(w)).toEqual(['Tondeuse'])
  })
})
