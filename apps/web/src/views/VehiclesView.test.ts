import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'
import VehiclesView from './VehiclesView.vue'

// Ce que la vue doit tenir : le bouton « Réveiller » montre que la demande est en cours TANT QUE la
// voiture n'a pas ouvert les yeux — et non le seul aller-retour avec le serveur, qui dure une
// seconde là où le véhicule met une dizaine de secondes.

const VIN = 'tesla:5YJ'
const vehicle = (sleepState: StateFor<'vehicle'>['sleepState'], available = true): DeviceEntry => ({
  descriptor: {
    id: VIN, pluginId: 'tesla', externalId: '5YJ', kind: 'vehicle', name: 'Voiture 1',
    capabilities: ['soc', 'range', 'location'], meta: { manufacturer: 'Tesla' },
  } as DeviceDescriptor,
  state: {
    kind: 'vehicle', updatedAt: 1, available, soc: 54, rangeKm: 234, pluggedIn: true, charging: false,
    locked: true, sleepState,
  } as StateFor<'vehicle'>,
})

function setup(entry = vehicle('asleep')) {
  const devices = useDevicesStore()
  devices.setEntries([entry])
  const sent = vi.spyOn(devices, 'sendCommand').mockResolvedValue(true)
  // la carte tire MapLibre (WebGL) : hors sujet ici, et happy-dom n'en a pas
  const w = mount(VehiclesView, { global: { stubs: { VehicleMap: true, PageHeader: true } } })
  const button = (label: string) => w.findAll('button').find((b) => b.text().includes(label))
  const spinner = () => w.find('.v-progress-circular').exists()
  return { w, devices, sent, button, spinner }
}

describe('VehiclesView — réveil en cours', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('au repos : « Réveiller » proposé, sans indicateur', () => {
    const { button, spinner } = setup()
    expect(button('Réveiller')?.attributes('disabled')).toBeUndefined()
    expect(spinner()).toBe(false)
  })

  it('après le clic : indicateur affiché et bouton verrouillé, MÊME une fois la demande acquittée', async () => {
    const { w, sent, button, spinner } = setup()
    await button('Réveiller')!.trigger('click')
    await w.vm.$nextTick()
    expect(sent).toHaveBeenCalledWith(VIN, { type: 'vehicle.wake' })
    expect(spinner()).toBe(true)
    const b = button('Réveiller')!
    expect(b.attributes('disabled')).toBeDefined()
    expect(b.attributes('aria-busy')).toBe('true')
  })

  it('le véhicule ouvre les yeux : l’indicateur s’efface et « Actualiser » prend la place', async () => {
    const { w, devices, button, spinner } = setup()
    await button('Réveiller')!.trigger('click')
    await w.vm.$nextTick()
    expect(spinner()).toBe(true)
    devices.setEntries([vehicle('online')])
    await w.vm.$nextTick()
    expect(spinner()).toBe(false)
    expect(button('Réveiller')).toBeUndefined()
    expect(button('Actualiser')?.attributes('disabled')).toBeUndefined()
  })

  it('demande refusée : le bouton revient tout de suite', async () => {
    const { w, sent, button, spinner } = setup()
    sent.mockResolvedValue(false)
    await button('Réveiller')!.trigger('click')
    await w.vm.$nextTick()
    expect(spinner()).toBe(false)
    expect(button('Réveiller')?.attributes('disabled')).toBeUndefined()
  })
})
