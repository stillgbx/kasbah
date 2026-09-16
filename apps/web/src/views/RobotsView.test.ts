import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'
import RobotsView from './RobotsView.vue'

// Ce que la vue doit tenir : rendre lisible l'ERREUR du fabricant (code et texte, tels que le
// support les connaît), garder chaque case en place quand une valeur manque, et ne proposer que les
// gestes que le descripteur déclare.

const ID = 'automower:c7233734'
const mower = (over: Partial<StateFor<'mower'>> = {}, capabilities: DeviceDescriptor['capabilities'] = ['mow', 'park', 'battery', 'schedule']): DeviceEntry => ({
  descriptor: {
    id: ID, pluginId: 'automower', externalId: 'c7233734', kind: 'mower', name: 'Tondeuse',
    capabilities, meta: { manufacturer: 'Husqvarna', model: 'AUTOMOWER 435X AWD' },
  } as DeviceDescriptor,
  state: { kind: 'mower', updatedAt: Date.now(), available: true, activity: 'parked', battery: 100, ...over } as StateFor<'mower'>,
})

function setup(entry = mower()) {
  const devices = useDevicesStore()
  devices.setEntries([entry])
  const sent = vi.spyOn(devices, 'sendCommand').mockResolvedValue(true)
  // la carte tire MapLibre (WebGL) : hors sujet ici, et happy-dom n'en a pas
  const w = mount(RobotsView, { global: { stubs: { VehicleMap: true, PageHeader: true } } })
  const button = (label: string) => w.findAll('button').find((b) => b.text().includes(label))
  return { w, devices, sent, button }
}

describe('RobotsView', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('une erreur de boucle se lit avec son code et le texte du fabricant', () => {
    const { w } = setup(mower({ activity: 'error', errorCode: 2, errorMessage: 'No loop signal', errorAt: Date.now() - 3 * 3600_000 }))
    const status = w.find('.rcard__status')
    expect(status.text()).toContain('Erreur 2')
    expect(status.text()).toContain('No loop signal')
    expect(status.attributes('data-error')).toBe('1')
    expect(w.find('.rcard__activity').text()).toBe('Erreur')
  })

  it('sans erreur, la ligne dit pourquoi le robot attend ; les cases sans valeur affichent « — »', () => {
    const { w } = setup(mower({ restrictedReason: 'week_schedule' }))
    expect(w.find('.rcard__status').text()).toBe('Attend son planning')
    const values = w.findAll('.stat__v').map((s) => s.text())
    expect(values[0]).toBe('—')                       // prochain départ inconnu
    expect(values[1]).toBe('—')                       // hauteur de coupe inconnue
    expect(w.findAll('.counter__v').map((c) => c.text())).toEqual(['—', '—', '—', '—'])
  })

  it('« Tondre 1 h » envoie un départ d’une heure, « Rentrer » un retour jusqu’au prochain créneau', async () => {
    const { button, sent } = setup(mower({ activity: 'stopped', cuttingHeight: 6 }))
    await button('Tondre')!.trigger('click')
    expect(sent).toHaveBeenCalledWith(ID, { type: 'mower.start', durationMin: 60 })
    await button('Rentrer')!.trigger('click')
    expect(sent).toHaveBeenCalledWith(ID, { type: 'mower.park', untilNextSchedule: true })
  })

  it('en tonte, le premier bouton devient « Pause » ; sans capacité, pas de bouton', () => {
    expect(setup(mower({ activity: 'mowing' })).button('Pause')).toBeDefined()
    const { w } = setup(mower({}, ['battery']))
    expect(w.findAll('.rcard__actions button')).toHaveLength(0)
  })
})
