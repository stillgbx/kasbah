import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { setTransport, type Transport } from '../../api'
import { useDevicesStore } from '../../stores/devices'
import RoomShutterKeys from './RoomShutterKeys.vue'

const cover = (id: string, position: number | undefined, deviceClass: string | undefined = 'shutter', opts: { available?: boolean; stop?: boolean; motion?: 'opening' | 'closing' } = {}): DeviceEntry => ({
  descriptor: {
    id, pluginId: 'mock', externalId: id, kind: 'cover', name: id,
    capabilities: ['open_close', ...(opts.stop === false ? [] : ['stop'])],
    meta: deviceClass === undefined ? {} : { cover: { deviceClass } },
  } as DeviceDescriptor,
  state: { kind: 'cover', updatedAt: 0, available: opts.available ?? true, motion: opts.motion ?? 'stopped', ...(position === undefined ? {} : { position }) } as StateFor<'cover'>,
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

  it("only acts on shutters: no awning, no gate, no garage door", async () => {
    const { w, runScene } = setup([cover('v', 0), cover('nu', 0, undefined), cover('s', 0, 'awning'), cover('p', 0, 'gate'), cover('g', 0, 'garage')])
    await key(w, 'Ouvrir les volets de la pièce').trigger('click')
    expect(runScene).toHaveBeenCalledWith([
      { deviceId: 'v', command: { type: 'cover.open' } },
      { deviceId: 'nu', command: { type: 'cover.open' } },   // no declared kind: a shutter
    ])
  })

  it("only writes to the shutters that must move, and to those whose position is unknown", async () => {
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

  // a stop on a motionless motor erases the position of a radio with no feedback: we do not send it
  it('stop: only to shutters that are MOVING, reachable and able to stop', async () => {
    const { w, runScene } = setup([
      cover('monte', 50, 'shutter', { motion: 'opening' }), cover('descend', 50, 'shutter', { motion: 'closing' }),
      cover('immobile', 50), cover('sansStop', 50, 'shutter', { stop: false, motion: 'closing' }),
      cover('loin', 50, 'shutter', { available: false, motion: 'closing' }),
    ])
    await key(w, 'Arrêter les volets de la pièce').trigger('click')
    expect(runScene).toHaveBeenCalledWith([
      { deviceId: 'monte', command: { type: 'cover.stop' } },
      { deviceId: 'descend', command: { type: 'cover.stop' } },
    ])
  })

  it('stop grayed out when nothing is moving, active from the gesture that starts a shutter', async () => {
    setTransport({ sendCommand: vi.fn(async () => {}) } as unknown as Transport)
    const devices = useDevicesStore()
    const entries = [cover('a', 100)]
    devices.setEntries(entries)
    const w = mount(RoomShutterKeys, { props: { entries: devices.list } })
    const stopKey = () => key(w, 'Arrêter les volets de la pièce').element as HTMLButtonElement
    expect(stopKey().disabled).toBe(true)
    await key(w, 'Fermer les volets de la pièce').trigger('click')
    await w.setProps({ entries: devices.list })
    expect(stopKey().disabled).toBe(false)
  })

  it('without a shutter, no keys; no shutter able to stop, no stop', () => {
    expect(setup([cover('s', 0, 'awning')]).w.findAll('button')).toHaveLength(0)
    expect(setup([cover('rts', 0, 'shutter', { stop: false })]).w.findAll('button')).toHaveLength(2)
  })

  // "nothing must move" rule: a silent bridge does not make the keys disappear
  it('keeps its keys, inactive, when no shutter answers', () => {
    const { w } = setup([cover('a', 0, 'shutter', { available: false })])
    expect(w.findAll('button')).toHaveLength(3)
    expect(w.findAll('button').every((b) => (b.element as HTMLButtonElement).disabled)).toBe(true)
  })
})
