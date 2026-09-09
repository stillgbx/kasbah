import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import type { Capability, DeviceDescriptor, StateFor } from '@kasbah/shared'
import CoverControl from './CoverControl.vue'
import fr from '../../i18n/locales/fr.json'
import { useDevicesStore } from '../../stores/devices'

const descriptor = (capabilities: Capability[], deviceClass?: 'shutter' | 'awning'): DeviceDescriptor => ({
  id: 'tahoma:v', pluginId: 'tahoma', externalId: 'v', kind: 'cover', name: 'Volet', capabilities,
  meta: deviceClass ? { cover: { deviceClass } } : {},
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
    expect(still.find('.line__text').text()).toBe(fr.cover.openClose.open)          // 0 % de fermeture

    const moving = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ motion: 'closing' }) } })
    expect(moving.find('.line').attributes('data-moving')).toBe('1')
    expect(moving.find('.pulse').attributes('data-on')).toBe('1')
    expect(moving.find('.line__text').text()).toBe(fr.cover.openClose.closing)
    // meme nombre de lignes de part et d'autre : aucune n'apparait ni ne disparait
    expect(moving.findAll('.line')).toHaveLength(still.findAll('.line').length)
  })

  it('le texte ne repete jamais le pourcentage, deja au bout de la ligne', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ position: 30 }) } })
    expect(w.find('.line__text').text()).toBe(fr.cover.openClose.level)
    expect(w.find('.line__pct').text()).toBe('70 %')
  })

  it('un ouvrant sans position garde la ligne, sans pourcentage', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(['open_close', 'stop']), state: state({ motion: 'opening' }) } })
    expect(w.find('.line__text').text()).toBe(fr.cover.openClose.opening)
    expect(w.find('.line__pct').exists()).toBe(false)
  })
  it('un STORE parle de remonte / baisse, pas d ouvert / ferme', () => {
    // meme kind, memes commandes : seul le vocabulaire change (meta.cover.deviceClass)
    const store = mount(CoverControl, { props: { descriptor: descriptor(ALL, 'awning'), state: state({ position: 0 }) } })
    expect(store.find('.line__text').text()).toBe(fr.cover.upDown.closed)          // « Baissé »
    expect(store.findAll('button').map((b) => b.text())).toEqual([
      fr.cover.upDown.actionOpen, fr.common.stop, fr.cover.upDown.actionClose,     // Remonter / Stop / Baisser
    ])
    const volet = mount(CoverControl, { props: { descriptor: descriptor(ALL, 'shutter'), state: state({ position: 0 }) } })
    expect(volet.find('.line__text').text()).toBe(fr.cover.openClose.closed)       // « Fermé »
  })

  it('position inconnue : aucun pourcentage invente', () => {
    // store RTS jamais commande : `position` absente. Le curseur reste (la capacite est la), mais
    // le pourcentage disparait plutot que d'afficher un 0 %. La ligne ne redit pas « Inconnu »,
    // deja affiche en grand par le panneau — elle garde juste sa hauteur.
    const unknown: StateFor<'cover'> = { kind: 'cover', updatedAt: 0, available: true, motion: 'stopped' }
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL, 'awning'), state: unknown } })
    const line = w.findAll('.line')[0]!                          // la 2e ligne est l'inclinaison
    expect(line.find('.line__text').text()).toBe('—')
    expect(line.find('.line__pct').exists()).toBe(false)
    expect(w.findAll('button')).toHaveLength(3)                 // remonter · stop · baisser

    // des qu'un mouvement est annonce, la ligne reprend la parole
    const moving = mount(CoverControl, { props: { descriptor: descriptor(ALL, 'awning'), state: { ...unknown, motion: 'closing' } } })
    expect(moving.findAll('.line')[0]!.find('.line__text').text()).toBe(fr.cover.upDown.closing)
  })

  it('position perso : touche de rappel large, valeur ecrite, repere sur le curseur', () => {
    // deux notions distinctes : la CAPACITE dit qu'on peut rappeler la position favorite du moteur,
    // la VALEUR seulement qu'on peut la montrer. Un moteur RTS a la premiere sans la seconde.
    const w = mount(CoverControl, {
      props: { descriptor: descriptor([...ALL, 'preset']), state: state({ position: 30, presetPosition: 27 }) },
    })
    const key = w.findAll('button').at(-1)!
    expect(key.text()).toContain(fr.cover.preset)
    expect(key.find('.key__pct').text()).toBe('73 %')            // 27 d'ouverture = 73 de fermeture
    expect(key.classes()).toContain('preset__recall')
    // le repere est place par Vuetify sur la piste, donc a la bonne geometrie
    expect(w.find('.v-slider-track__tick').exists()).toBe(true)

    // valeur inconnue (RTS) : la touche reste, le chiffre disparait, aucun repere invente
    const rts = mount(CoverControl, {
      props: { descriptor: descriptor(['open_close', 'stop', 'preset'], 'awning'), state: state({ position: 0 }) },
    })
    expect(rts.findAll('button').at(-1)!.text()).toContain(fr.cover.preset)
    expect(rts.find('.key__pct').exists()).toBe(false)
    expect(rts.find('.v-slider-track__tick').exists()).toBe(false)

    // sans la capacite, pas de touche du tout
    const plain = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state() } })
    expect(plain.text()).not.toContain(fr.cover.preset)
  })

  it('memoriser la position : grave l ACTUELLE, et jamais en pleine course', async () => {
    // le geste de la telecommande Somfy : on amene l'ouvrant au bon endroit, puis on memorise —
    // donc on n'enregistre jamais une position qu'on n'a pas vue.
    const d = descriptor([...ALL, 'preset', 'preset_set'])
    const w = mount(CoverControl, { props: { descriptor: d, state: state({ position: 40, presetPosition: 27 }) } })
    const save = w.find('.preset__save')
    // icone seule : le libelle passe par le title et l'aria-label, obligatoires sans texte
    expect(save.attributes('aria-label')).toBe(fr.cover.presetSave)
    expect(save.attributes('title')).toBe(fr.cover.presetSave)
    await save.trigger('click')
    expect(w.emitted('command')).toEqual([[{ type: 'cover.set_preset', position: 40 }]])

    // en mouvement, la position affichee est celle du depart : la touche est verrouillee
    const moving = mount(CoverControl, { props: { descriptor: d, state: state({ position: 40, motion: 'closing' }) } })
    expect(moving.find('.preset__save').attributes('disabled')).toBeDefined()

    // sans la capacite d'ecriture, la touche n'existe pas — un RTS rappelle sans reecrire
    const recallOnly = mount(CoverControl, { props: { descriptor: descriptor(['open_close', 'stop', 'preset']), state: state() } })
    expect(recallOnly.find('.preset__save').exists()).toBe(false)
    expect(recallOnly.text()).toContain(fr.cover.preset)
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
