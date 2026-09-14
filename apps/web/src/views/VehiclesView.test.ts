import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse, type DeviceDescriptor, type DeviceEntry, type StateFor } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
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

/**
 * `houseDevice` : l'entrée de MAISON du véhicule, quand le cas en demande une — la capacité de la
 * batterie (qu'aucun fabricant ne donne) y vit, et une `position` y dit que la voiture a été placée
 * à la main plutôt que posée par son GPS.
 */
function setup(entry = vehicle('asleep'), houseDevice?: Record<string, unknown>) {
  const devices = useDevicesStore()
  devices.setEntries([entry])
  if (houseDevice) {
    const doc = JSON.parse(JSON.stringify(demo)) as { devices: unknown[] }
    doc.devices.push({ id: 'vehicle.sous-test', deviceId: VIN, ...houseDevice })
    useHouseStore().house = parseHouse(doc)
  }
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

  it('le véhicule ouvre les yeux : l’indicateur s’efface et « Réveiller » s’en va', async () => {
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

  /**
   * Relire une voiture endormie ne la réveille pas (le plugin s'arrête à la liste) : c'est ainsi
   * qu'on constate qu'elle s'est réveillée toute seule, sans payer le réveil.
   */
  it('endormie : « Actualiser » est proposé À CÔTÉ de « Réveiller »', async () => {
    const { sent, button } = setup()
    expect(button('Réveiller')).toBeDefined()
    const refresh = button('Actualiser')
    expect(refresh?.attributes('disabled')).toBeUndefined()
    await refresh!.trigger('click')
    expect(sent).toHaveBeenCalledWith(VIN, { type: 'vehicle.refresh' })
  })

  it('pendant un réveil, « Actualiser » reste cliquable : c’est ce qui dit si elle a ouvert les yeux', async () => {
    const { w, button } = setup()
    await button('Réveiller')!.trigger('click')
    await w.vm.$nextTick()
    expect(button('Réveiller')!.attributes('disabled')).toBeDefined()
    expect(button('Actualiser')!.attributes('disabled')).toBeUndefined()
  })
})

describe('VehiclesView — détail de la charge', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  const charging = (extra: Partial<StateFor<'vehicle'>>): DeviceEntry => {
    const e = vehicle('online')
    return { ...e, state: { ...e.state, charging: true, ...extra } as StateFor<'vehicle'> }
  }

  it('dit la puissance, la fin estimée et la cible — et rien d’autre', () => {
    const { w } = setup(charging({ chargePowerW: 7400, chargeMinutesRemaining: 80, chargeLimit: 80 }))
    expect(w.find('.vcard__charge').text()).toBe('7,4 kW · fin dans 1 h 20 · cible 80 %')
  })

  it('sans estimation du fabricant, rien n’est inventé', () => {
    const { w } = setup(charging({ chargeLimit: 80 }))
    expect(w.find('.vcard__charge').text()).toBe('cible 80 %')
  })

  /**
   * Le véhicule ne dit pas sa puissance (la R5) : elle se déduit de la capacité saisie et du temps
   * que la voiture annonce — et ne se présente PAS comme une mesure.
   */
  it('estime la puissance que le véhicule ne dit pas, et l’assume', () => {
    const { w } = setup(charging({ soc: 74, chargeMinutesRemaining: 43, chargeLimit: 80 }), { batteryKwh: 52 })
    expect(w.find('.vcard__charge').text()).toBe('~4,4 kW estimé · fin dans 43 min · cible 80 %')
  })

  it('sans capacité saisie, rien n’est estimé — il reste ce que la voiture dit', () => {
    const { w } = setup(charging({ soc: 74, chargeMinutesRemaining: 43, chargeLimit: 80 }))
    expect(w.find('.vcard__charge').text()).toBe('fin dans 43 min · cible 80 %')
  })

  it('la jauge porte les repères que le fabricant donne : la cible, et le plancher s’il existe', () => {
    const { w } = setup(charging({ chargeLimit: 80, socMin: 20 }))
    expect(w.findAll('.vcard__tick').map((t) => t.attributes('style'))).toEqual(['left: 20%;', 'left: 80%;'])
    // Tesla n'a pas de plancher : un seul repère, et rien d'inventé à 0 %
    const { w: tesla } = setup(charging({ chargeLimit: 80 }))
    expect(tesla.findAll('.vcard__tick')).toHaveLength(1)
  })

  /**
   * La capacité ne sert qu'à estimer une puissance que le véhicule ne dit pas : à qui la dit
   * (capacité `charge_power`, Tesla), on ne la demande pas — et s'il ne reste RIEN à régler, le
   * bouton lui-même s'en va.
   */
  it('un véhicule qui dit sa puissance ne se fait pas demander sa capacité', async () => {
    const e = vehicle('online')
    const says = { ...e, descriptor: { ...e.descriptor, capabilities: [...e.descriptor.capabilities, 'charge_power'] } } as DeviceEntry
    const { w, button } = setup(says)
    await button('Régler')!.trigger('click')                 // placé par son GPS : décalage et rotation restent à régler
    expect(w.findAll('.tune__row')).toHaveLength(2)
    expect(w.find('.tune').text()).toContain('Rotation')
    expect(w.find('.tune').text()).not.toContain('Capacité')

    // placé à la main ET bavard sur sa puissance : plus rien à régler, plus de bouton
    const { button: quiet } = setup(says, { position: [1, 2, 0] })
    expect(quiet('Régler')).toBeUndefined()
  })

  it('hors charge, la ligne reste en place et se tait', () => {
    const { w } = setup(vehicle('online'))
    expect(w.find('.vcard__charge').exists()).toBe(true)
    expect(w.find('.vcard__charge').text()).toBe('')
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
