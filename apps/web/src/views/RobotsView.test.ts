import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'
import RobotsView from './RobotsView.vue'

// le journal vient du serveur, à la demande : ici deux lignes, une erreur et un avertissement
const getJournal = vi.fn().mockResolvedValue({ deviceId: 'automower:c7233734', entries: [
  { at: Date.UTC(2026, 8, 16, 16, 22, 15), severity: 'error', code: 2, message: 'No loop signal', location: { lat: 47.3, lon: 5.04 } },
  { at: Date.UTC(2026, 8, 10, 8), severity: 'warning', code: 62, message: 'Battery restriction due to ambient temperature' },
] })
vi.mock('../api', () => ({ getTransport: () => ({ getJournal }) }))

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

  it('« Reprendre le programme » envoie un départ SANS durée : le robot suit son planning', async () => {
    const { button, sent } = setup(mower({ activity: 'paused' }))
    await button('Reprendre le programme')!.trigger('click')
    expect(sent).toHaveBeenCalledWith(ID, { type: 'mower.start' })
  })

  it('« Effacer l’erreur » sur la ligne d’état, seulement pour une erreur que le fabricant lève à distance', async () => {
    const error = { activity: 'error' as const, errorCode: 18, errorMessage: 'Collision sensor problem, rear' }
    const caps: DeviceDescriptor['capabilities'] = ['mow', 'park', 'battery', 'schedule', 'confirm_error']
    expect(setup(mower({ ...error, errorConfirmable: false }, caps)).button("Effacer l'erreur")).toBeUndefined()
    expect(setup(mower({ ...error, errorConfirmable: true })).button("Effacer l'erreur")).toBeUndefined()
    const { w, button, sent } = setup(mower({ ...error, errorConfirmable: true }, caps))
    expect(w.find('.rcard__status').text()).toContain("Effacer l'erreur")
    await button("Effacer l'erreur")!.trigger('click')
    expect(sent).toHaveBeenCalledWith(ID, { type: 'mower.confirm_error' })
  })

  it('le journal se SIGNALE (compte et gravité sur la pilule), se déplie au clic, et une ligne positionnée est un bouton', async () => {
    const { w, button } = setup(mower({}, ['mow', 'park', 'battery', 'schedule', 'journal']))
    await flushPromises()
    expect(getJournal).toHaveBeenCalledWith(ID)
    // replié : rien de plus que la pilule, la carte garde sa hauteur
    expect(w.find('.jl').exists()).toBe(false)
    const pill = button('Journal')!
    expect(pill.find('.rcard__count').text()).toBe('2')
    expect(pill.find('.rcard__count').attributes('data-severity')).toBe('error')
    await pill.trigger('click')
    const rows = w.findAll('.jl__row')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('No loop signal')
    expect(rows[0]!.text()).toContain('2')
    expect(rows[0]!.find('.jl__dot').attributes('data-severity')).toBe('error')
    expect(rows[1]!.find('.jl__dot').attributes('data-severity')).toBe('warning')
    // la ligne qui sait où elle s'est produite mène à la carte ; l'autre non — et l'infobulle dit tout
    expect(rows[0]!.find('button.jl__pick').exists()).toBe(true)
    expect(rows[1]!.find('button.jl__pick').exists()).toBe(false)
    expect(rows[0]!.attributes('title')).toContain('No loop signal · 2')
    expect(rows[0]!.attributes('title')).toContain('Voir où c’est arrivé'.replace('’', "'"))
    expect(rows[1]!.attributes('title')).toContain('Sans position')
    await rows[0]!.find('button.jl__pick').trigger('click')
    expect(rows[0]!.attributes('data-active')).toBe('1')
  })

  it('sans la capacité, pas de section journal ni de demande', async () => {
    getJournal.mockClear()
    const { w } = setup(mower({}, ['mow', 'park', 'battery', 'schedule']))
    await flushPromises()
    expect(w.find('.jl').exists()).toBe(false)
    expect(w.findAll('button').some((b) => b.text().includes('Journal'))).toBe(false)
    expect(getJournal).not.toHaveBeenCalled()
  })

  it('en tonte, le premier bouton devient « Pause » ; sans capacité, pas de bouton', () => {
    expect(setup(mower({ activity: 'mowing' })).button('Pause')).toBeDefined()
    const { w } = setup(mower({}, ['battery']))
    expect(w.findAll('.rcard__actions button')).toHaveLength(0)
  })
})
