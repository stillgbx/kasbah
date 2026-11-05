import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import CoverCalibrationDialog from './CoverCalibrationDialog.vue'

const descriptor: DeviceDescriptor = {
  id: 'tahoma:v', pluginId: 'tahoma', externalId: 'v', kind: 'cover', name: 'Volet',
  capabilities: ['open_close', 'position', 'stop', 'calibration'], meta: { cover: { deviceClass: 'shutter' } },
}
const state = (over: Partial<StateFor<'cover'>> = {}): StateFor<'cover'> =>
  ({ kind: 'cover', updatedAt: 1, available: true, position: 100, motion: 'stopped', ...over })

let w: VueWrapper | null = null
afterEach(() => { w?.unmount(); w = null; document.body.innerHTML = '' })

async function open(s: StateFor<'cover'>) {
  w = mount(CoverCalibrationDialog, { props: { descriptor, state: s, modelValue: true }, attachTo: document.body })
  await nextTick(); await nextTick()
}
const shown = () => document.querySelector('.motor__pct')!.textContent
const nudge = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.nudges .key')].find((b) => b.textContent === label)!.click()

// A motor that only publishes its position at the END of the travel (io at Somfy): the box must keep
// showing what was asked for, not jump back to the start then forward again.
describe('CoverCalibrationDialog', () => {
  it('holds the asked motor position during the travel, then hands back to the motor', async () => {
    await open(state({ position: 100 }))                                   // motor fully up: closure 0 %
    expect(shown()).toBe('0 %')
    nudge('+5'); nudge('+5'); await nextTick()                              // two quick taps add up
    expect(w!.emitted('command')).toEqual([
      [{ type: 'cover.set_position', position: 95, motor: true }],
      [{ type: 'cover.set_position', position: 90, motor: true }],
    ])
    expect(shown()).toBe('10 %')
    // the app's optimistic guess keeps the old date: it does not count as the device speaking
    await w!.setProps({ state: state({ position: 100, motion: 'closing' }) }); await nextTick()
    expect(shown()).toBe('10 %')
    // the motor moves without publishing a position, then publishes it on arrival
    await w!.setProps({ state: state({ position: 100, motion: 'closing', updatedAt: 2 }) }); await nextTick()
    expect(shown()).toBe('10 %')
    await w!.setProps({ state: state({ position: 90, motion: 'stopped', updatedAt: 3 }) }); await nextTick()
    expect(shown()).toBe('10 %')
  })

  it('a mark can be typed, and one mark cleared without the others', async () => {
    const cal = [{ position: 0, motor: 18 }, { position: 50, motor: 65 }, { position: 100, motor: 100 }]
    await open(state({ calibration: cal }))
    const inputs = () => [...document.querySelectorAll<HTMLInputElement>('.mark__input')]
    // top of the glass · quarter · half · three quarters · sill, as motor CLOSURES
    expect(inputs().map((i) => i.value)).toEqual(['0', '', '35', '', '82'])
    // clear the half mark alone
    document.querySelectorAll<HTMLButtonElement>('.mark__clear')[2]!.click(); await nextTick()
    expect(inputs().map((i) => i.value)).toEqual(['0', '', '', '', '82'])
    // type the quarter mark
    const quarter = inputs()[1]!
    quarter.value = '20'; quarter.dispatchEvent(new Event('change')); await nextTick()
    document.querySelectorAll<HTMLButtonElement>('.pill')[2]!.click(); await nextTick()          // Save
    expect(w!.emitted('command')!.at(-1)).toEqual([{ type: 'cover.set_calibration', points: [
      { position: 0, motor: 18 }, { position: 75, motor: 80 }, { position: 100, motor: 100 },
    ] }])
  })

  it('hands back to the real position when the motor stopped elsewhere', async () => {
    await open(state({ position: 100 }))
    nudge('+5'); await nextTick()
    await w!.setProps({ state: state({ position: 100, motion: 'closing', updatedAt: 2 }) }); await nextTick()
    await w!.setProps({ state: state({ position: 98, motion: 'stopped', updatedAt: 3 }) }); await nextTick()
    expect(shown()).toBe('2 %')
  })
})
