import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { DeviceDescriptor, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import RoomBrightness from './RoomBrightness.vue'

const light = (id: string, on: boolean, brightness?: number, dimmable = true): DeviceEntry => ({
  descriptor: {
    id, pluginId: 'mock', externalId: id, kind: 'light', name: id,
    capabilities: dimmable ? ['on_off', 'brightness'] : ['on_off'], meta: {},
  } as DeviceDescriptor,
  state: { kind: 'light', updatedAt: 0, available: true, on, ...(brightness !== undefined ? { brightness } : {}) } as StateFor<'light'>,
})

function setup(entries: DeviceEntry[]) {
  const devices = useDevicesStore()
  devices.setEntries(entries)
  const runScene = vi.spyOn(devices, 'runScene').mockResolvedValue()
  const w = mount(RoomBrightness, { props: { deviceIds: entries.map((e) => e.descriptor.id) } })
  return { w, runScene }
}

describe('RoomBrightness', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('stays out of a room where no light can dim', () => {
    const { w } = setup([light('a', true, undefined, false)])
    expect(w.find('input').exists()).toBe(false)
  })

  it('shows the average of the lit lights', () => {
    const { w } = setup([light('a', true, 40), light('b', true, 60), light('c', false, 100)])
    expect((w.find('input').element as HTMLInputElement).value).toBe('50')
  })

  it('writes the same brightness on every LIT light, and leaves the dark ones alone', async () => {
    const { w, runScene } = setup([light('a', true, 40), light('b', false, 10), light('c', true, 80, false)])
    await w.findComponent({ name: 'VSlider' }).vm.$emit('end', 25)
    expect(runScene).toHaveBeenCalledWith([{ deviceId: 'a', command: { type: 'light.set', brightness: 25 } }])
  })

  it('writes the value next to the slider, and follows the drag', async () => {
    const { w } = setup([light('a', true, 40), light('b', true, 60)])
    expect(w.find('.room-bright__pct').text()).toBe('50 %')
    await w.findComponent({ name: 'VSlider' }).vm.$emit('update:modelValue', 25)
    expect(w.find('.room-bright__pct').text()).toBe('25 %')
  })

  // "nothing must move" rule: the slider's place is reserved even when the room is dark
  it('keeps the slider in place, disabled, when the room is dark', () => {
    const { w } = setup([light('a', false, 30)])
    expect(w.find('input').exists()).toBe(true)
    expect((w.find('input').element as HTMLInputElement).disabled).toBe(true)
    expect(w.find('.room-bright--off').exists()).toBe(true)
  })
})
