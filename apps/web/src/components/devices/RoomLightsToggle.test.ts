import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, DeviceState, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import RoomLightsToggle from './RoomLightsToggle.vue'

const light = (id: string, on: boolean, available = true): DeviceEntry => ({
  descriptor: { id, pluginId: 'mock', externalId: id, kind: 'light', name: id, capabilities: ['on_off'], meta: {} } as DeviceDescriptor,
  state: { kind: 'light', updatedAt: 0, available, on } as StateFor<'light'>,
})
const cover: DeviceEntry = {
  descriptor: { id: 'c', pluginId: 'mock', externalId: 'c', kind: 'cover', name: 'c', capabilities: ['open_close'], meta: {} } as DeviceDescriptor,
  state: { kind: 'cover', updatedAt: 0, available: true, position: 100, motion: 'stopped' } as DeviceState,
}

function setup(entries: DeviceEntry[]) {
  const devices = useDevicesStore()
  devices.setEntries(entries)
  const runScene = vi.spyOn(devices, 'runScene').mockResolvedValue()
  const w = mount(RoomLightsToggle, { props: { deviceIds: entries.map((e) => e.descriptor.id) } })
  return { w, runScene }
}

describe('RoomLightsToggle', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('stays out of a room without lights', () => {
    const { w } = setup([cover])
    expect(w.find('input').exists()).toBe(false)
  })

  it('is on as soon as one light is on, and switches off only those that are on', async () => {
    const { w, runScene } = setup([light('a', true), light('b', false), cover])
    expect((w.find('input').element as HTMLInputElement).checked).toBe(true)
    // the bulb is INSIDE the thumb: it is what says what a switch with no name next to it acts on
    expect(w.find('.v-switch__thumb svg').exists()).toBe(true)
    await w.find('input').setValue(false)
    expect(runScene).toHaveBeenCalledWith([{ deviceId: 'a', command: { type: 'light.set', on: false } }])
  })

  it('switches on every reachable light when the room is dark', async () => {
    const { w, runScene } = setup([light('a', false), light('b', false), light('c', false, false)])
    expect((w.find('input').element as HTMLInputElement).checked).toBe(false)
    await w.find('input').setValue(true)
    expect(runScene).toHaveBeenCalledWith([
      { deviceId: 'a', command: { type: 'light.set', on: true } },
      { deviceId: 'b', command: { type: 'light.set', on: true } },
    ])
  })

  // "nothing must move" rule: a silent bridge must not make the switch disappear
  it('keeps the switch in place, disabled, when no light is reachable', () => {
    const { w } = setup([light('a', false, false)])
    expect(w.find('input').exists()).toBe(true)
    expect((w.find('input').element as HTMLInputElement).disabled).toBe(true)
  })
})
