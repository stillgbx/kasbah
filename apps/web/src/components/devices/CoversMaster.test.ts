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

/** The lit segment, that is the state shown; empty string when the device set is mixed. */
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

  it('shows rest when EVERYTHING is at rest: shutters and gate closed, awnings retracted', () => {
    expect(selected(setup([cover('v', 0), cover('p', 0, 'gate'), cover('s', 100, 'awning')]).w)).toBe('Tout fermer')
    // an open shutter: neither one nor the other, the device set is mixed
    expect(selected(setup([cover('v', 50), cover('s', 100, 'awning')]).w)).toBe('')
    // all shutters wide open: it is the other gesture that is done
    expect(selected(setup([cover('v', 100), cover('s', 100, 'awning')]).w)).toBe('Tout ouvrir')
    // a DEPLOYED awning (position 0 = lowered) is not at rest, even if the contract calls it "closed"
    expect(selected(setup([cover('v', 0), cover('s', 0, 'awning')]).w)).toBe('')
    // unknown position: assumed at rest, otherwise a silent gate would forever prevent showing it
    expect(selected(setup([cover('v', 0), cover('p', undefined, 'gate')]).w)).toBe('Tout fermer')
  })

  it('close all: closes what stands upright and RETRACTS the awnings', async () => {
    const { w, runScene } = setup([cover('v', 100), cover('p', undefined, 'gate'), cover('s', 0, 'awning'), cover('deja', 0)])
    await key(w, 'Tout fermer').trigger('click')
    expect(runScene).toHaveBeenCalledWith([
      { deviceId: 'v', command: { type: 'cover.close' } },   // open shutter: we close it
      { deviceId: 'p', command: { type: 'cover.close' } },   // silent gate: we close anyway, it costs nothing
      { deviceId: 's', command: { type: 'cover.open' } },    // lowered awning: we RETRACT it, we do not deploy it
    ])
  })

  it("open all touches ONLY the shutters: not the gate, nor the garage, nor the awnings", async () => {
    const { w, runScene } = setup([cover('v', 0), cover('p', 0, 'gate'), cover('g', 0, 'garage'), cover('s', 100, 'awning')])
    await key(w, 'Tout ouvrir').trigger('click')
    expect(runScene).toHaveBeenCalledWith([{ deviceId: 'v', command: { type: 'cover.open' } }])
  })

  it("does not promise a gesture it would not make: a terrace and a gate, nothing to open", () => {
    const { w } = setup([cover('p', 0, 'gate'), cover('s', 100, 'awning')])
    expect(disabled(w, 'Tout ouvrir')).toBe(true)
    expect(disabled(w, 'Tout fermer')).toBe(false)
  })

  // "nothing must move" rule: a silent bridge must not make the control disappear
  it('keeps its place, inactive, when no cover answers', () => {
    const { w } = setup([cover('a', 0, 'shutter', false)])
    expect(w.findAll('button')).toHaveLength(2)
    expect(disabled(w, 'Tout fermer')).toBe(true)
    expect(disabled(w, 'Tout ouvrir')).toBe(true)
  })

  // The core of the gesture: we close by mistake, and change our mind within the second. The motors
  // have not published anything yet — it is the TARGETED position that must be read, otherwise
  // "Open all" would believe the shutters already open and say nothing to them.
  it('changing your mind: the reverse command goes out right away, before the motor has moved', async () => {
    const sendCommand = vi.fn(async (_id: string, _command: CommandInput) => {})
    setTransport({ sendCommand } as unknown as Transport)
    const devices = useDevicesStore()
    const entries = [cover('v', 100), cover('w', 100)]
    devices.setEntries(entries)
    const w = mount(CoversMaster, { props: { entries, label: 'Tous les ouvrants' } })

    await key(w, 'Tout fermer').trigger('click')
    expect(selected(w)).toBe('Tout fermer')                          // the target value, under the finger
    expect((entries[0]!.state as StateFor<'cover'>).position).toBe(100)   // the motor, itself, has said nothing

    await key(w, 'Tout ouvrir').trigger('click')
    expect(sendCommand.mock.calls.map((c) => [c[0], c[1].type])).toEqual([
      ['v', 'cover.close'], ['w', 'cover.close'],
      ['v', 'cover.open'], ['w', 'cover.open'],
    ])
    expect(selected(w)).toBe('Tout ouvrir')
  })
})
