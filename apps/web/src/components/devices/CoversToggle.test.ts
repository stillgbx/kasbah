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
  const input = () => w.find('input').element as HTMLInputElement
  return { w, runScene, input }
}

describe('CoversToggle', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('coché quand tout est AU REPOS : volets et portail fermés, stores remontés', () => {
    expect(setup([cover('v', 0), cover('p', 0, 'gate'), cover('s', 100, 'awning')]).input().checked).toBe(true)
    // un volet ouvert décoche
    expect(setup([cover('v', 100), cover('s', 100, 'awning')]).input().checked).toBe(false)
    // un store DÉPLOYÉ (position 0 = baissé) n'est pas au repos, même si le contrat le dit « fermé »
    expect(setup([cover('v', 0), cover('s', 0, 'awning')]).input().checked).toBe(false)
    // position inconnue : supposée au repos, sinon un portail muet décocherait en permanence
    expect(setup([cover('v', 0), cover('p', undefined, 'gate')]).input().checked).toBe(true)
  })

  it('sécuriser : ferme ce qui se tient debout et REMONTE les stores', async () => {
    const { w, runScene } = setup([cover('v', 100), cover('p', undefined, 'gate'), cover('s', 0, 'awning'), cover('deja', 0)])
    expect((w.find('input').element as HTMLInputElement).checked).toBe(false)
    await w.find('input').setValue(true)
    expect(runScene).toHaveBeenCalledWith([
      { deviceId: 'v', command: { type: 'cover.close' } },   // volet ouvert : on ferme
      { deviceId: 'p', command: { type: 'cover.close' } },   // portail muet : on ferme quand même, ça ne coûte rien
      { deviceId: 's', command: { type: 'cover.open' } },    // store baissé : on le REMONTE, on ne le déploie pas
    ])
  })

  it("ouvrir ne touche QUE les volets : ni le portail, ni le garage, ni les stores", async () => {
    const { w, runScene } = setup([cover('v', 0), cover('p', 0, 'gate'), cover('g', 0, 'garage'), cover('s', 100, 'awning')])
    expect((w.find('input').element as HTMLInputElement).checked).toBe(true)
    await w.find('input').setValue(false)
    expect(runScene).toHaveBeenCalledWith([{ deviceId: 'v', command: { type: 'cover.open' } }])
  })

  it("ne promet pas un geste qu'il ne ferait pas : une terrasse et un portail au repos, rien à ouvrir", () => {
    const { input } = setup([cover('p', 0, 'gate'), cover('s', 100, 'awning')])
    expect(input().checked).toBe(true)
    expect(input().disabled).toBe(true)
  })

  // règle « rien ne doit bouger » : un pont muet ne doit pas faire disparaître l'interrupteur
  it('garde sa place, inactif, quand aucun ouvrant ne répond', () => {
    const { w } = setup([cover('a', 0, 'shutter', false)])
    expect(w.find('input').exists()).toBe(true)
    expect((w.find('input').element as HTMLInputElement).disabled).toBe(true)
  })
})
