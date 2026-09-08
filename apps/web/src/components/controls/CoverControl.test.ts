import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import type { Capability, DeviceDescriptor, StateFor } from '@kasbah/shared'
import CoverControl from './CoverControl.vue'
import fr from '../../i18n/locales/fr.json'
import { useDevicesStore } from '../../stores/devices'

const descriptor = (capabilities: Capability[]): DeviceDescriptor => ({
  id: 'tahoma:v', pluginId: 'tahoma', externalId: 'v', kind: 'cover', name: 'Volet', capabilities, meta: {},
})
const state = (over: Partial<StateFor<'cover'>> = {}): StateFor<'cover'> =>
  ({ kind: 'cover', updatedAt: 0, available: true, position: 100, motion: 'stopped', ...over })

const ALL: Capability[] = ['open_close', 'position', 'tilt', 'stop']

describe('CoverControl', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('shows a CLOSURE percentage: fully open reads 0 %', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ position: 100 }) } })
    expect(w.text()).toContain('0 %')
    expect(w.text()).not.toContain('100 %')
  })
  it('a cover 30 % open reads 70 %', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ position: 30 }) } })
    expect(w.text()).toContain('70 %')
  })
  it('offers position and tilt sliders when the device can aim', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state() } })
    expect(w.findAll('.v-slider')).toHaveLength(2)
    expect(w.findAll('button')).toHaveLength(3)                 // ouvrir · stop · fermer
  })
  it('drops the slider on a one-way device (volet RTS) but keeps open and close', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(['open_close', 'stop']), state: state() } })
    expect(w.findAll('.v-slider')).toHaveLength(0)
    expect(w.findAll('button')).toHaveLength(3)
  })
  it('drops the stop button when the device has no stop command', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(['open_close']), state: state() } })
    expect(w.findAll('button')).toHaveLength(2)
  })
  it('signale le mouvement SANS changer la hauteur de la ligne', () => {
    // le point et la ligne existent toujours : seul leur etat change, donc rien ne se decale
    const still = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state() } })
    expect(still.find('.line').attributes('data-moving')).toBe('0')
    expect(still.find('.pulse').attributes('data-on')).toBe('0')
    expect(still.find('.line__text').text()).toBe(fr.cover.open)          // 0 % de fermeture

    const moving = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ motion: 'closing' }) } })
    expect(moving.find('.line').attributes('data-moving')).toBe('1')
    expect(moving.find('.pulse').attributes('data-on')).toBe('1')
    expect(moving.find('.line__text').text()).toBe(fr.cover.closing)
    // meme nombre de lignes de part et d'autre : aucune n'apparait ni ne disparait
    expect(moving.findAll('.line')).toHaveLength(still.findAll('.line').length)
  })

  it('le texte ne repete jamais le pourcentage, deja au bout de la ligne', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ position: 30 }) } })
    expect(w.find('.line__text').text()).toBe(fr.cover.closure)
    expect(w.find('.line__pct').text()).toBe('70 %')
  })

  it('un ouvrant sans position garde la ligne, sans pourcentage', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(['open_close', 'stop']), state: state({ motion: 'opening' }) } })
    expect(w.find('.line__text').text()).toBe(fr.cover.opening)
    expect(w.find('.line__pct').exists()).toBe(false)
  })
  it('shows the position the store aims at, not the one the device still reports', () => {
    const devices = useDevicesStore()
    const d = descriptor(ALL)
    // l'appareil est encore ouvert (position 100 = 0 % de fermeture) mais on vise la fermeture
    devices.setEntries([{ descriptor: d, state: state({ position: 100 }) }])
    const w = mount(CoverControl, { props: { descriptor: d, state: state({ position: 100 }) } })
    expect(w.text()).toContain('0 %')
    devices.targets = { 'tahoma:v': { position: 0, moved: false, at: 0 } }
    return w.vm.$nextTick().then(() => { expect(w.text()).toContain('100 %') })
  })
})
