import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, HouseDevice, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import PlacementControl from './PlacementControl.vue'

// Saisie directe des valeurs du mode « Déplacer » : ce qui compte est QUAND on écrit dans house.json
// (à la validation, jamais à la frappe) et ce qu'on écrit (borné, virgule française acceptée).

const gate: DeviceEntry = {
  descriptor: {
    id: 'tahoma:portail', pluginId: 'tahoma', externalId: 'portail', kind: 'cover', name: 'Portail',
    capabilities: ['open_close'], meta: { cover: { deviceClass: 'gate' } },
  } as DeviceDescriptor,
  state: { kind: 'cover', updatedAt: 0, available: true, motion: 'stopped', position: 0 } as StateFor<'cover'>,
}
const device: HouseDevice = {
  id: 'cover.portail', deviceId: 'tahoma:portail', position: [1, 2, 0.75],
  size: { width: 4, height: 1.5 }, yaw: 90, meta: {},
}

function setup() {
  const devices = useDevicesStore()
  devices.setEntries([gate])
  const house = useHouseStore()
  house.placing = true
  const save = vi.spyOn(house, 'savePlacement').mockResolvedValue(true)
  const w = mount(PlacementControl, { props: { device } })
  const field = (label: string) => w.findAll('input').find((i) => i.attributes('aria-label') === label)!
  return { w, save, field }
}

describe('PlacementControl — saisie directe', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('écrit à la VALIDATION, pas à la frappe', async () => {
    const { save, field } = setup()
    const width = field('Largeur')
    await width.trigger('focus')
    await width.setValue('3')
    expect(save).not.toHaveBeenCalled()      // une maison par caractère : non
    await width.trigger('blur')
    expect(save).toHaveBeenCalledWith({ size: { width: 3, height: 1.5 } })
  })

  it('accepte la virgule décimale et borne la valeur', async () => {
    const { save, field } = setup()
    const height = field('Hauteur')
    await height.trigger('focus')
    await height.setValue('2,25')
    await height.trigger('blur')
    expect(save).toHaveBeenCalledWith({ size: { width: 4, height: 2.25 } })

    const width = field('Largeur')
    await width.trigger('focus')
    await width.setValue('99')               // au-delà du portail le plus large
    await width.trigger('blur')
    expect(save).toHaveBeenLastCalledWith({ size: { width: 12, height: 1.5 } })
  })

  it('ramène une orientation dans le tour, et ignore une saisie illisible', async () => {
    const { save, field } = setup()
    const yaw = field('Orientation')
    await yaw.trigger('focus')
    await yaw.setValue('-45')
    await yaw.trigger('blur')
    expect(save).toHaveBeenCalledWith({ yaw: 315 })

    await yaw.trigger('focus')
    await yaw.setValue('vers la rue')
    await yaw.trigger('blur')
    expect(save).toHaveBeenCalledTimes(1)    // rien d'écrit : on garde ce qui était là
  })

  it('Échap abandonne la saisie', async () => {
    const { save, field } = setup()
    const width = field('Largeur')
    await width.trigger('focus')
    await width.setValue('7')
    await width.trigger('keydown.esc')
    await width.trigger('blur')
    expect(save).not.toHaveBeenCalled()
  })

  it("n'écrit pas une valeur identique à celle déjà posée", async () => {
    const { save, field } = setup()
    const width = field('Largeur')
    await width.trigger('focus')
    await width.setValue('4.00')
    await width.trigger('blur')
    expect(save).not.toHaveBeenCalled()
  })
})
