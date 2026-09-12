import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import CoversToggle from './CoversToggle.vue'

const cover = (id: string, position: number | undefined, deviceClass = 'shutter', available = true): DeviceEntry => ({
  descriptor: {
    id, pluginId: 'mock', externalId: id, kind: 'cover', name: id,
    capabilities: ['open_close'], meta: { cover: { deviceClass } },
  } as DeviceDescriptor,
  state: { kind: 'cover', updatedAt: 0, available, motion: 'stopped', ...(position === undefined ? {} : { position }) } as StateFor<'cover'>,
})

function setup(entries: DeviceEntry[]) {
  const devices = useDevicesStore()
  devices.setEntries(entries)
  const runScene = vi.spyOn(devices, 'runScene').mockResolvedValue()
  const w = mount(CoversToggle, { props: { entries, label: 'Tous les ouvrants' } })
  return { w, runScene }
}

describe('CoversToggle', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('coché seulement quand TOUT ce qu on sait est fermé', () => {
    expect((setup([cover('a', 0), cover('b', 0)]).w.find('input').element as HTMLInputElement).checked).toBe(true)
    // un seul ouvert suffit à décocher : « tout fermer » reste à un appui
    expect((setup([cover('a', 0), cover('b', 100)]).w.find('input').element as HTMLInputElement).checked).toBe(false)
    // position inconnue (RTS) : elle ne vote pas, et seule elle ne coche rien
    expect((setup([cover('a', undefined)]).w.find('input').element as HTMLInputElement).checked).toBe(false)
    expect((setup([cover('a', 0), cover('b', undefined)]).w.find('input').element as HTMLInputElement).checked).toBe(true)
  })

  it('ferme ce qui ne l est pas, sans réveiller ce qui l est déjà', async () => {
    const { w, runScene } = setup([cover('a', 100), cover('b', 0), cover('c', undefined), cover('d', 100, 'shutter', false)])
    await w.find('input').setValue(true)
    expect(runScene).toHaveBeenCalledWith([
      { deviceId: 'a', command: { type: 'cover.close' } },   // ouvert : à fermer
      { deviceId: 'c', command: { type: 'cover.close' } },   // position inconnue : on envoie
    ])
  })

  it('un store suit le MÊME geste : fermer, c est baisser (le plugin traduit)', async () => {
    // store déployé (position 0) = fermé : l'interrupteur est coché, et l'appui suivant remonte
    const { w, runScene } = setup([cover('store', 0, 'awning')])
    expect((w.find('input').element as HTMLInputElement).checked).toBe(true)
    await w.find('input').setValue(false)
    expect(runScene).toHaveBeenCalledWith([{ deviceId: 'store', command: { type: 'cover.open' } }])
  })

  // règle « rien ne doit bouger » : un pont muet ne doit pas faire disparaître l'interrupteur
  it('garde sa place, inactif, quand aucun ouvrant ne répond', () => {
    const { w } = setup([cover('a', 0, 'shutter', false)])
    expect(w.find('input').exists()).toBe(true)
    expect((w.find('input').element as HTMLInputElement).disabled).toBe(true)
  })
})
