import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import type { Capability, DeviceDescriptor, StateFor } from '@kasbah/shared'
import CoverControl from './CoverControl.vue'
import fr from '../../i18n/locales/fr.json'
import { useDevicesStore } from '../../stores/devices'

const descriptor = (capabilities: Capability[], deviceClass?: 'shutter' | 'awning'): DeviceDescriptor => ({
  id: 'tahoma:v', pluginId: 'tahoma', externalId: 'v', kind: 'cover', name: 'Volet', capabilities,
  meta: deviceClass ? { cover: { deviceClass } } : {},
})
const state = (over: Partial<StateFor<'cover'>> = {}): StateFor<'cover'> =>
  ({ kind: 'cover', updatedAt: 0, available: true, position: 100, motion: 'stopped', ...over })

const ALL: Capability[] = ['open_close', 'position', 'tilt', 'stop']

describe('CoverControl', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('shows a CLOSURE percentage: fully open reads 0 %', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ position: 100 }) } })
    expect(w.text()).toContain('0 %')
    expect(w.text()).not.toContain('100 %')
  })
  it('a cover 30 % open reads 70 %', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ position: 30 }) } })
    expect(w.text()).toContain('70 %')
  })
  it('offers a draggable cover pill and a tilt slider when the device can aim', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state() } })
    expect(w.find('.pill').attributes('role')).toBe('slider')
    expect(w.findAll('.v-slider')).toHaveLength(1)              // the tilt only
    expect(w.findAll('button')).toHaveLength(3)                 // open · stop · close
  })
  it('the pill only SHOWS a one-way device (RTS shutter), which keeps open and close', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(['open_close', 'stop']), state: state() } })
    expect(w.find('.pill').attributes('role')).toBe('img')
    expect(w.findAll('button')).toHaveLength(3)
  })
  it('drops the stop button when the device has no stop command', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(['open_close']), state: state() } })
    expect(w.findAll('button')).toHaveLength(2)
  })
  it('signals movement WITHOUT changing the line height', () => {
    // the dot and the line always exist: only their state changes, so nothing shifts
    const still = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state() } })
    expect(still.find('.line').attributes('data-moving')).toBe('0')
    expect(still.find('.pulse').attributes('data-on')).toBe('0')
    expect(still.find('.line__text').text()).toBe(fr.cover.openClose.open)          // 0 % closure

    const moving = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ motion: 'closing' }) } })
    expect(moving.find('.line').attributes('data-moving')).toBe('1')
    expect(moving.find('.pulse').attributes('data-on')).toBe('1')
    expect(moving.find('.line__text').text()).toBe(fr.cover.openClose.closing)
    // same number of lines on both sides: none appears or disappears
    expect(moving.findAll('.line')).toHaveLength(still.findAll('.line').length)
  })

  it('the text never repeats the percentage, already at the end of the line', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state({ position: 30 }) } })
    expect(w.find('.line__text').text()).toBe(fr.cover.openClose.level)
    expect(w.find('.line__pct').text()).toBe('70 %')
  })

  it('a cover without a position keeps the line, without a percentage', () => {
    const w = mount(CoverControl, { props: { descriptor: descriptor(['open_close', 'stop']), state: state({ motion: 'opening' }) } })
    expect(w.find('.line__text').text()).toBe(fr.cover.openClose.opening)
    expect(w.find('.line__pct').exists()).toBe(false)
  })
  it('a BLIND talks about raising / lowering, not open / closed', () => {
    // same kind, same commands: only the vocabulary changes (meta.cover.deviceClass)
    const store = mount(CoverControl, { props: { descriptor: descriptor(ALL, 'awning'), state: state({ position: 0 }) } })
    expect(store.find('.line__text').text()).toBe(fr.cover.upDown.closed)          // "Lowered"
    expect(store.findAll('button').map((b) => b.text())).toEqual([
      fr.cover.upDown.actionOpen, fr.common.stop, fr.cover.upDown.actionClose,     // Raise / Stop / Lower
    ])
    const volet = mount(CoverControl, { props: { descriptor: descriptor(ALL, 'shutter'), state: state({ position: 0 }) } })
    expect(volet.find('.line__text').text()).toBe(fr.cover.openClose.closed)       // "Closed"
  })

  it('unknown position: no invented percentage, and the assumption is stated', () => {
    // RTS blind never commanded: `position` absent. The slider stays (the capability is there), but
    // the percentage disappears rather than showing 0 %. The panel shows the ASSUMED state in large
    // ("Raised"): it is this line that says it is an assumption.
    const unknown: StateFor<'cover'> = { kind: 'cover', updatedAt: 0, available: true, motion: 'stopped' }
    const w = mount(CoverControl, { props: { descriptor: descriptor(ALL, 'awning'), state: unknown } })
    const line = w.findAll('.line')[0]!                          // the 2nd line is the tilt
    expect(line.find('.line__text').text()).toBe(fr.cover.assumedHint)
    expect(line.find('.line__pct').exists()).toBe(false)
    expect(w.findAll('button')).toHaveLength(3)                 // raise · stop · lower

    // as soon as a movement is announced, the line speaks again
    const moving = mount(CoverControl, { props: { descriptor: descriptor(ALL, 'awning'), state: { ...unknown, motion: 'closing' } } })
    expect(moving.findAll('.line')[0]!.find('.line__text').text()).toBe(fr.cover.upDown.closing)
  })

  it('custom position: wide recall key, written value, reference mark on the slider', () => {
    // two distinct notions: the CAPABILITY says the motor's favorite position can be recalled,
    // the VALUE only that it can be shown. An RTS motor has the first without the second.
    const w = mount(CoverControl, {
      props: { descriptor: descriptor([...ALL, 'preset']), state: state({ position: 30, presetPosition: 27 }) },
    })
    const key = w.findAll('button').at(-1)!
    expect(key.text()).toContain(fr.cover.preset)
    expect(key.find('.key__pct').text()).toBe('73 %')            // 27 open = 73 closed
    expect(key.classes()).toContain('preset__recall')
    // the reference mark sits on the thumbnail, at the memorized closure
    expect(w.find('.pill__preset').exists()).toBe(true)

    // unknown value (RTS): the key stays, the figure disappears, no invented reference mark
    const rts = mount(CoverControl, {
      props: { descriptor: descriptor(['open_close', 'stop', 'preset'], 'awning'), state: state({ position: 0 }) },
    })
    expect(rts.findAll('button').at(-1)!.text()).toContain(fr.cover.preset)
    expect(rts.find('.key__pct').exists()).toBe(false)
    expect(rts.find('.pill__preset').exists()).toBe(false)

    // without the capability, no key at all
    const plain = mount(CoverControl, { props: { descriptor: descriptor(ALL), state: state() } })
    expect(plain.text()).not.toContain(fr.cover.preset)
  })

  it('memorize the position: stores the CURRENT one, and never mid-travel', async () => {
    // the Somfy remote's gesture: we bring the cover to the right place, then memorize —
    // so we never record a position we have not seen.
    const d = descriptor([...ALL, 'preset', 'preset_set'])
    const w = mount(CoverControl, { props: { descriptor: d, state: state({ position: 40, presetPosition: 27 }) } })
    const save = w.find('.preset__save')
    // icon only: the label goes through the title and aria-label, mandatory without text
    expect(save.attributes('aria-label')).toBe(fr.cover.presetSave)
    expect(save.attributes('title')).toBe(fr.cover.presetSave)
    await save.trigger('click')
    expect(w.emitted('command')).toEqual([[{ type: 'cover.set_preset', position: 40 }]])

    // in motion, the displayed position is the starting one: the key is locked
    const moving = mount(CoverControl, { props: { descriptor: d, state: state({ position: 40, motion: 'closing' }) } })
    expect(moving.find('.preset__save').attributes('disabled')).toBeDefined()

    // without the write capability, the key does not exist — an RTS recalls without rewriting
    const recallOnly = mount(CoverControl, { props: { descriptor: descriptor(['open_close', 'stop', 'preset']), state: state() } })
    expect(recallOnly.find('.preset__save').exists()).toBe(false)
    expect(recallOnly.text()).toContain(fr.cover.preset)
  })

  it('shows the position the store aims at, not the one the device still reports', () => {
    const devices = useDevicesStore()
    const d = descriptor(ALL)
    // the device is still open (position 100 = 0 % closure) but we aim for closure
    devices.setEntries([{ descriptor: d, state: state({ position: 100 }) }])
    const w = mount(CoverControl, { props: { descriptor: d, state: state({ position: 100 }) } })
    expect(w.text()).toContain('0 %')
    devices.targets = { 'tahoma:v': { position: 0, moved: false, at: 0 } }
    return w.vm.$nextTick().then(() => { expect(w.text()).toContain('100 %') })
  })
})
