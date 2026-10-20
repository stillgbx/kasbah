import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, PlacedHouseDevice, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import PlacementControl from './PlacementControl.vue'

// Direct input of the "Move" mode values: what matters is WHEN we write to house.json
// (on validation, never while typing) and what we write (bounded, French decimal comma accepted).

const gate: DeviceEntry = {
  descriptor: {
    id: 'tahoma:portail', pluginId: 'tahoma', externalId: 'portail', kind: 'cover', name: 'Portail',
    capabilities: ['open_close'], meta: { cover: { deviceClass: 'gate' } },
  } as DeviceDescriptor,
  state: { kind: 'cover', updatedAt: 0, available: true, motion: 'stopped', position: 0 } as StateFor<'cover'>,
}
const device: PlacedHouseDevice = {
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

  it('writes on VALIDATION, not while typing', async () => {
    const { save, field } = setup()
    const width = field('Largeur')
    await width.trigger('focus')
    await width.setValue('3')
    expect(save).not.toHaveBeenCalled()      // one house per character: no
    await width.trigger('blur')
    expect(save).toHaveBeenCalledWith({ size: { width: 3, height: 1.5 } })
  })

  it('accepts the decimal comma and bounds the value', async () => {
    const { save, field } = setup()
    const height = field('Hauteur')
    await height.trigger('focus')
    await height.setValue('2,25')
    await height.trigger('blur')
    expect(save).toHaveBeenCalledWith({ size: { width: 4, height: 2.25 } })

    const width = field('Largeur')
    await width.trigger('focus')
    await width.setValue('99')               // beyond the widest gate
    await width.trigger('blur')
    expect(save).toHaveBeenLastCalledWith({ size: { width: 12, height: 1.5 } })
  })

  it('brings an orientation back into the turn, and ignores unreadable input', async () => {
    const { save, field } = setup()
    const yaw = field('Orientation')
    await yaw.trigger('focus')
    await yaw.setValue('-45')
    await yaw.trigger('blur')
    expect(save).toHaveBeenCalledWith({ yaw: 315 })

    await yaw.trigger('focus')
    await yaw.setValue('vers la rue')
    await yaw.trigger('blur')
    expect(save).toHaveBeenCalledTimes(1)    // nothing written: we keep what was there
  })

  it('Escape abandons the input', async () => {
    const { save, field } = setup()
    const width = field('Largeur')
    await width.trigger('focus')
    await width.setValue('7')
    await width.trigger('keydown.esc')
    await width.trigger('blur')
    expect(save).not.toHaveBeenCalled()
  })

  it("does not write a value identical to the one already set", async () => {
    const { save, field } = setup()
    const width = field('Largeur')
    await width.trigger('focus')
    await width.setValue('4.00')
    await width.trigger('blur')
    expect(save).not.toHaveBeenCalled()
  })
})
