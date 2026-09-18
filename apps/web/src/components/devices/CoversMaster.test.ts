import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { CommandInput, DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { setTransport, type Transport } from '../../api'
import { useDevicesStore } from '../../stores/devices'
import CoversMaster from './CoversMaster.vue'

const cover = (id: string, position: number | undefined, deviceClass = 'shutter', available = true): DeviceEntry => ({
  descriptor: {
    id, pluginId: 'mock', externalId: id, kind: 'cover', name: id,
    capabilities: ['open_close'], meta: { cover: { deviceClass } },
  } as DeviceDescriptor,
  state: { kind: 'cover', updatedAt: 0, available, motion: 'stopped', ...(position === undefined ? {} : { position }) } as StateFor<'cover'>,
})

/** Le segment allumé, c'est-à-dire l'état montré ; chaîne vide quand le parc est partagé. */
const selected = (w: VueWrapper) => w.findAll('button').find((b) => b.attributes('data-on') === '1')?.text() ?? ''
const key = (w: VueWrapper, label: string) => w.findAll('button').find((b) => b.text() === label)!
const disabled = (w: VueWrapper, label: string) => (key(w, label).element as HTMLButtonElement).disabled

function setup(entries: DeviceEntry[]) {
  const devices = useDevicesStore()
  devices.setEntries(entries)
  const runScene = vi.spyOn(devices, 'runScene').mockResolvedValue()
  const w = mount(CoversMaster, { props: { entries, label: 'Tous les ouvrants' } })
  return { w, runScene }
}

describe('CoversMaster', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null) })

  it('montre le repos quand TOUT est au repos : volets et portail fermés, stores remontés', () => {
    expect(selected(setup([cover('v', 0), cover('p', 0, 'gate'), cover('s', 100, 'awning')]).w)).toBe('Tout fermer')
    // un volet ouvert : ni l'un ni l'autre, le parc est partagé
    expect(selected(setup([cover('v', 50), cover('s', 100, 'awning')]).w)).toBe('')
    // tous les volets grands ouverts : c'est l'autre geste qui est fait
    expect(selected(setup([cover('v', 100), cover('s', 100, 'awning')]).w)).toBe('Tout ouvrir')
    // un store DÉPLOYÉ (position 0 = baissé) n'est pas au repos, même si le contrat le dit « fermé »
    expect(selected(setup([cover('v', 0), cover('s', 0, 'awning')]).w)).toBe('')
    // position inconnue : supposée au repos, sinon un portail muet empêcherait à jamais de le montrer
    expect(selected(setup([cover('v', 0), cover('p', undefined, 'gate')]).w)).toBe('Tout fermer')
  })

  it('tout fermer : ferme ce qui se tient debout et REMONTE les stores', async () => {
    const { w, runScene } = setup([cover('v', 100), cover('p', undefined, 'gate'), cover('s', 0, 'awning'), cover('deja', 0)])
    await key(w, 'Tout fermer').trigger('click')
    expect(runScene).toHaveBeenCalledWith([
      { deviceId: 'v', command: { type: 'cover.close' } },   // volet ouvert : on ferme
      { deviceId: 'p', command: { type: 'cover.close' } },   // portail muet : on ferme quand même, ça ne coûte rien
      { deviceId: 's', command: { type: 'cover.open' } },    // store baissé : on le REMONTE, on ne le déploie pas
    ])
  })

  it("tout ouvrir ne touche QUE les volets : ni le portail, ni le garage, ni les stores", async () => {
    const { w, runScene } = setup([cover('v', 0), cover('p', 0, 'gate'), cover('g', 0, 'garage'), cover('s', 100, 'awning')])
    await key(w, 'Tout ouvrir').trigger('click')
    expect(runScene).toHaveBeenCalledWith([{ deviceId: 'v', command: { type: 'cover.open' } }])
  })

  it("ne promet pas un geste qu'il ne ferait pas : une terrasse et un portail, rien à ouvrir", () => {
    const { w } = setup([cover('p', 0, 'gate'), cover('s', 100, 'awning')])
    expect(disabled(w, 'Tout ouvrir')).toBe(true)
    expect(disabled(w, 'Tout fermer')).toBe(false)
  })

  // règle « rien ne doit bouger » : un pont muet ne doit pas faire disparaître la commande
  it('garde sa place, inactive, quand aucun ouvrant ne répond', () => {
    const { w } = setup([cover('a', 0, 'shutter', false)])
    expect(w.findAll('button')).toHaveLength(2)
    expect(disabled(w, 'Tout fermer')).toBe(true)
    expect(disabled(w, 'Tout ouvrir')).toBe(true)
  })

  // Le cœur du geste : on ferme par erreur, et on se ravise dans la seconde. Les moteurs n'ont
  // encore rien publié — c'est la position VISÉE qui doit être lue, sinon « tout ouvrir » croirait
  // les volets déjà ouverts et ne leur dirait rien.
  it('se raviser : la commande inverse repart aussitôt, avant que le moteur ait bougé', async () => {
    const sendCommand = vi.fn(async (_id: string, _command: CommandInput) => {})
    setTransport({ sendCommand } as unknown as Transport)
    const devices = useDevicesStore()
    const entries = [cover('v', 100), cover('w', 100)]
    devices.setEntries(entries)
    const w = mount(CoversMaster, { props: { entries, label: 'Tous les ouvrants' } })

    await key(w, 'Tout fermer').trigger('click')
    expect(selected(w)).toBe('Tout fermer')                          // la valeur cible, au doigt
    expect((entries[0]!.state as StateFor<'cover'>).position).toBe(100)   // le moteur, lui, n'a rien dit

    await key(w, 'Tout ouvrir').trigger('click')
    expect(sendCommand.mock.calls.map((c) => [c[0], c[1].type])).toEqual([
      ['v', 'cover.close'], ['w', 'cover.close'],
      ['v', 'cover.open'], ['w', 'cover.open'],
    ])
    expect(selected(w)).toBe('Tout ouvrir')
  })
})
