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
/** The lit segment, that is the state shown; empty string when the lights are mixed. */
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

  it('stays out of a view without lights', () => {
    expect(setup([cover]).w.findAll('button')).toHaveLength(0)
  })

  it('shows the state, and nothing at all when the lights are mixed', () => {
    expect(selected(setup([light('a', false), light('b', false), cover]).w)).toBe('Tout éteindre')
    expect(selected(setup([light('a', true), light('b', true)]).w)).toBe('Tout allumer')
    expect(selected(setup([light('a', true), light('b', false)]).w)).toBe('')
  })

  // what the switch could not do: turn a half-lit room back on with a single press
  it('both gestures stay within reach, and only write to the lights that must change', async () => {
    const { w, runScene } = setup([light('a', true), light('b', false), light('c', false, false)])
    await key(w, 'Tout allumer').trigger('click')
    expect(runScene).toHaveBeenCalledWith([{ deviceId: 'b', command: { type: 'light.set', on: true } }])
    await key(w, 'Tout éteindre').trigger('click')
    expect(runScene).toHaveBeenLastCalledWith([{ deviceId: 'a', command: { type: 'light.set', on: false } }])
  })

  it('takes its target value under the finger, and reverts if the server refuses', async () => {
    // the server does not answer right away: it is between the press and its answer that the
    // segment must already show the target — with an immediate refusal, there would be nothing to observe
    const refus: ((err: unknown) => void)[] = []
    setTransport({ sendCommand: vi.fn(() => new Promise((_, rj) => refus.push(rj))) } as unknown as Transport)
    const devices = useDevicesStore()
    devices.setEntries([light('a', false), light('b', false)])
    const w = mount(LightsMaster, { props: { deviceIds: ['a', 'b'], label: 'Toutes les lumières' } })
    expect(selected(w)).toBe('Tout éteindre')
    await key(w, 'Tout allumer').trigger('click')
    expect(selected(w)).toBe('Tout allumer')        // optimistic update: the target, under the finger
    for (const rj of refus) rj(new ApiRequestError(502, 'UPSTREAM_ERROR', 'boom'))
    await flush()
    await w.vm.$nextTick()
    expect(selected(w)).toBe('Tout éteindre')       // server refusal: roll back
  })

  // "nothing must move" rule: a silent bridge must not make the control disappear
  it('keeps its place, inactive, when no light answers', () => {
    const { w } = setup([light('a', false, false)])
    const keys = w.findAll('button')
    expect(keys).toHaveLength(2)
    expect(keys.every((b) => (b.element as HTMLButtonElement).disabled)).toBe(true)
  })
})
