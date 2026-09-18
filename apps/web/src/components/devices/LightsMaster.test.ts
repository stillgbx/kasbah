import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, DeviceState, StateFor } from '@kasbah/shared'
import { ApiRequestError, setTransport, type Transport } from '../../api'
import { useDevicesStore } from '../../stores/devices'
import LightsMaster from './LightsMaster.vue'

const light = (id: string, on: boolean, available = true): DeviceEntry => ({
  descriptor: { id, pluginId: 'mock', externalId: id, kind: 'light', name: id, capabilities: ['on_off'], meta: {} } as DeviceDescriptor,
  state: { kind: 'light', updatedAt: 0, available, on } as StateFor<'light'>,
})
const cover: DeviceEntry = {
  descriptor: { id: 'c', pluginId: 'mock', externalId: 'c', kind: 'cover', name: 'c', capabilities: ['open_close'], meta: {} } as DeviceDescriptor,
  state: { kind: 'cover', updatedAt: 0, available: true, position: 100, motion: 'stopped' } as DeviceState,
}

const flush = () => new Promise((r) => setTimeout(r, 0))
/** Le segment allumé, c'est-à-dire l'état montré ; chaîne vide quand les lampes sont partagées. */
const selected = (w: VueWrapper) => w.findAll('button').find((b) => b.attributes('data-on') === '1')?.text() ?? ''
const key = (w: VueWrapper, label: string) => w.findAll('button').find((b) => b.text() === label)!

function setup(entries: DeviceEntry[]) {
  const devices = useDevicesStore()
  devices.setEntries(entries)
  const runScene = vi.spyOn(devices, 'runScene').mockResolvedValue()
  const w = mount(LightsMaster, { props: { deviceIds: entries.map((e) => e.descriptor.id), label: 'Toutes les lumières' } })
  return { w, runScene }
}

describe('LightsMaster', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null) })

  it('reste en dehors d\'une vue sans lampes', () => {
    expect(setup([cover]).w.findAll('button')).toHaveLength(0)
  })

  it('montre l\'état, et rien du tout quand les lampes sont partagées', () => {
    expect(selected(setup([light('a', false), light('b', false), cover]).w)).toBe('Tout éteindre')
    expect(selected(setup([light('a', true), light('b', true)]).w)).toBe('Tout allumer')
    expect(selected(setup([light('a', true), light('b', false)]).w)).toBe('')
  })

  // ce que l'interrupteur ne savait pas faire : rallumer une pièce à moitié allumée d'un seul appui
  it('les deux gestes restent à portée, et n\'écrivent que sur les lampes qui doivent changer', async () => {
    const { w, runScene } = setup([light('a', true), light('b', false), light('c', false, false)])
    await key(w, 'Tout allumer').trigger('click')
    expect(runScene).toHaveBeenCalledWith([{ deviceId: 'b', command: { type: 'light.set', on: true } }])
    await key(w, 'Tout éteindre').trigger('click')
    expect(runScene).toHaveBeenLastCalledWith([{ deviceId: 'a', command: { type: 'light.set', on: false } }])
  })

  it('prend sa valeur cible au doigt, et revient si le serveur refuse', async () => {
    // le serveur ne répond pas tout de suite : c'est entre l'appui et sa réponse que le segment
    // doit déjà montrer la cible — avec un refus immédiat, il n'y aurait rien à observer
    const refus: ((err: unknown) => void)[] = []
    setTransport({ sendCommand: vi.fn(() => new Promise((_, rj) => refus.push(rj))) } as unknown as Transport)
    const devices = useDevicesStore()
    devices.setEntries([light('a', false), light('b', false)])
    const w = mount(LightsMaster, { props: { deviceIds: ['a', 'b'], label: 'Toutes les lumières' } })
    expect(selected(w)).toBe('Tout éteindre')
    await key(w, 'Tout allumer').trigger('click')
    expect(selected(w)).toBe('Tout allumer')        // mise à jour optimiste : la cible, au doigt
    for (const rj of refus) rj(new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom'))
    await flush()
    await w.vm.$nextTick()
    expect(selected(w)).toBe('Tout éteindre')       // refus du serveur : retour arrière
  })

  // règle « rien ne doit bouger » : un pont muet ne doit pas faire disparaître la commande
  it('garde sa place, inactive, quand aucune lampe ne répond', () => {
    const { w } = setup([light('a', false, false)])
    const keys = w.findAll('button')
    expect(keys).toHaveLength(2)
    expect(keys.every((b) => (b.element as HTMLButtonElement).disabled)).toBe(true)
  })
})
