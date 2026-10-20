import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { setTransport } from '../../api'
import { useDevicesStore } from '../../stores/devices'
import RoomShutterKeys from './RoomShutterKeys.vue'

const cover = (id: string, position: number | undefined, deviceClass: string | undefined = 'shutter', opts: { available?: boolean; stop?: boolean } = {}): DeviceEntry => ({
  descriptor: {
    id, pluginId: 'mock', externalId: id, kind: 'cover', name: id,
    capabilities: ['open_close', ...(opts.stop === false ? [] : ['stop'])],
    meta: deviceClass === undefined ? {} : { cover: { deviceClass } },
  } as DeviceDescriptor,
  state: { kind: 'cover', updatedAt: 0, available: opts.available ?? true, motion: 'stopped', ...(position === undefined ? {} : { position }) } as StateFor<'cover'>,
})

const key = (w: VueWrapper, label: string) => w.find(`button[aria-label="${label}"]`)

function setup(entries: DeviceEntry[]) {
  const devices = useDevicesStore()
  devices.setEntries(entries)
  const runScene = vi.spyOn(devices, 'runScene').mockResolvedValue()
  return { w: mount(RoomShutterKeys, { props: { entries } }), runScene }
}

describe('RoomShutterKeys', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null) })

  it("n'agit que sur les volets : ni store, ni portail, ni porte de garage", async () => {
    const { w, runScene } = setup([cover('v', 0), cover('nu', 0, undefined), cover('s', 0, 'awning'), cover('p', 0, 'gate'), cover('g', 0, 'garage')])
    await key(w, 'Ouvrir les volets de la pièce').trigger('click')
    expect(runScene).toHaveBeenCalledWith([
      { deviceId: 'v', command: { type: 'cover.open' } },
      { deviceId: 'nu', command: { type: 'cover.open' } },   // sans nature déclarée : un volet
    ])
  })

  it("n'écrit qu'aux volets qui doivent bouger, et à ceux dont on ignore la position", async () => {
    const { w, runScene } = setup([cover('ouvert', 100), cover('ferme', 0), cover('muet', undefined)])
    await key(w, 'Fermer les volets de la pièce').trigger('click')
    expect(runScene).toHaveBeenLastCalledWith([
      { deviceId: 'ouvert', command: { type: 'cover.close' } },
      { deviceId: 'muet', command: { type: 'cover.close' } },
    ])
    await key(w, 'Ouvrir les volets de la pièce').trigger('click')
    expect(runScene).toHaveBeenLastCalledWith([
      { deviceId: 'ferme', command: { type: 'cover.open' } },
      { deviceId: 'muet', command: { type: 'cover.open' } },
    ])
  })

  it('stop : seulement aux volets joignables qui savent s’arrêter', async () => {
    const { w, runScene } = setup([cover('a', 50), cover('rts', 50, 'shutter', { stop: false }), cover('loin', 50, 'shutter', { available: false })])
    await key(w, 'Arrêter les volets de la pièce').trigger('click')
    expect(runScene).toHaveBeenCalledWith([{ deviceId: 'a', command: { type: 'cover.stop' } }])
  })

  it('sans volet, pas de touches ; aucun volet ne sait s’arrêter, pas de stop', () => {
    expect(setup([cover('s', 0, 'awning')]).w.findAll('button')).toHaveLength(0)
    expect(setup([cover('rts', 0, 'shutter', { stop: false })]).w.findAll('button')).toHaveLength(2)
  })

  // règle « rien ne doit bouger » : un pont muet ne fait pas disparaître les touches
  it('garde ses touches, inactives, quand aucun volet ne répond', () => {
    const { w } = setup([cover('a', 0, 'shutter', { available: false })])
    expect(w.findAll('button')).toHaveLength(3)
    expect(w.findAll('button').every((b) => (b.element as HTMLButtonElement).disabled)).toBe(true)
  })
})
