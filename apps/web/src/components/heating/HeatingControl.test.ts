import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceEntry } from '@kasbah/shared'
import HeatingControl from './HeatingControl.vue'
import { SETPOINT_SEND_AFTER_MS } from '../../composables/useSetpointDraft'

// The commands of a heating device, in its room's line. What they must hold:
//
//  - live on THEIR OWN row (`grid-column: 1 / -1`): the previous version put them in the
//    status column without letting them shrink, and they overlapped the link pill as soon
//    as the card tightened;
//  - speak the house's vocabulary: square 36 px `.key` keys, those of the Covers
//    and Media views, and not round buttons invented for the occasion;
//  - keep the setpoint BETWEEN the two keys that set it, and no longer show it when off;
//  - offer no gesture that the plugin would refuse (the MELCloud zones declare neither
//    `target_temp` nor `hvac_mode`) and respect the device's bounds.

const entry = (over: Partial<DeviceEntry['descriptor']>, state: Record<string, unknown> = {}): DeviceEntry => ({
  descriptor: {
    id: 'x:1', pluginId: 'x', externalId: '1', kind: 'climate', name: 'Zone', capabilities: [], meta: {},
    ...over,
  } as DeviceEntry['descriptor'],
  state: { kind: 'climate', updatedAt: 0, available: true, mode: 'heat', action: 'idle', currentTempC: 22.5, targetTempC: 19.5, ...state } as DeviceEntry['state'],
})

const thermostat = entry({
  capabilities: ['hvac_mode', 'target_temp', 'current_temp'],
  meta: { targetTempC: [10, 30], climate: { modes: ['heat', 'off'] } },
})
const readOnlyZone = entry(
  { capabilities: ['current_temp'], meta: { targetTempC: [30, 60], climate: { modes: ['off', 'heat'], control: 'flow' } } },
  { currentTempC: 20, targetTempC: 45 },
)

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('HeatingControl', () => {
  it('puts its commands on their own row, outside the status columns', () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    expect(w.find('.controls').exists()).toBe(true)
  })

  it('uses the house\'s keys, not round buttons', () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    expect(w.findAll('.key').length).toBeGreaterThan(0)
    expect(w.findAll('.round')).toHaveLength(0)
  })

  it('keeps the setpoint between the two keys that set it', () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    const keys = w.find('.keys--target')
    expect(keys.find('.target').text()).toBe('19,5 °C')
    expect(keys.findAll('.key')).toHaveLength(2)
  })

  /** A read zone has nothing to set: no empty row either. */
  it('shows no row of commands on a read-only device', () => {
    expect(mount(HeatingControl, { props: { entry: readOnlyZone } }).find('.controls').exists()).toBe(false)
  })

  it('sets the setpoint in steps of 0.5', async () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    const [, plus] = w.find('.keys--target').findAll('.key')
    await plus!.trigger('click')
    vi.advanceTimersByTime(SETPOINT_SEND_AFTER_MS)
    expect(w.emitted('command')).toEqual([['x:1', { type: 'climate.set_target_temp', targetTempC: 20 }]])
  })

  /**
   * A Nest counts against Google's quota (about ten calls a minute): five clicks in a row earned
   * "Rate limited" on the real house. The figure follows each click; ONE command leaves once they
   * are over.
   */
  it('sends one command once the clicks in a row are over', async () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    const [minus, plus] = w.find('.keys--target').findAll('.key')
    for (let i = 0; i < 4; i++) { await minus!.trigger('click'); vi.advanceTimersByTime(300) }
    expect(w.find('.target').text()).toBe('17,5 °C')          // follows the finger
    expect(w.emitted('command')).toBeUndefined()               // nothing sent yet
    vi.advanceTimersByTime(SETPOINT_SEND_AFTER_MS)
    expect(w.emitted('command')).toEqual([['x:1', { type: 'climate.set_target_temp', targetTempC: 17.5 }]])
    // back where it started: nothing to ask
    await plus!.trigger('click'); await minus!.trigger('click')
    vi.advanceTimersByTime(SETPOINT_SEND_AFTER_MS)
    expect(w.emitted('command')).toHaveLength(1)
  })

  /** Leaving the view before the wait ends: the setpoint chosen is not lost. */
  it('sends a pending setpoint when it goes away', async () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    await w.find('.keys--target').findAll('.key')[1]!.trigger('click')
    w.unmount()
    expect(w.emitted('command')).toEqual([['x:1', { type: 'climate.set_target_temp', targetTempC: 20 }]])
  })

  /** The bounds come from the device: a flow water does not go down to 10 °C. */
  it('does not go outside the declared bounds', () => {
    const atFloor = entry({ capabilities: ['target_temp'], meta: { targetTempC: [30, 60] } }, { targetTempC: 30 })
    const w = mount(HeatingControl, { props: { entry: atFloor } })
    void w.findAll('.key')[0]!.trigger('click')
    vi.advanceTimersByTime(SETPOINT_SEND_AFTER_MS)
    // at the floor already: nothing to send, rather than 30 again
    expect(w.emitted('command')).toBeUndefined()
  })

  it('chooses a mode, and shows the one in effect', () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    const modes = w.findAll('.key--text')
    expect(modes).toHaveLength(2)
    expect(modes[0]!.attributes('data-on')).toBe('1')   // "Heat", the current mode
    void modes[1]!.trigger('click')
    expect(w.emitted('command')![0]).toEqual(['x:1', { type: 'climate.set_mode', mode: 'off' }])
  })

  /** Modes first: choosing "Off" removes the setpoint at the end of the row, without moving the key touched. */
  it('no longer shows a setpoint when off, and keeps the modes in front', () => {
    expect(mount(HeatingControl, { props: { entry: thermostat } }).findAll('.keys').map((k) => k.classes()).at(0)).toContain('keys--modes')
    const off = mount(HeatingControl, { props: { entry: entry({ ...thermostat.descriptor }, { mode: 'off' }) } })
    expect(off.find('.keys--target').exists()).toBe(false)
    expect(off.text()).not.toContain('°C')
    expect(off.findAll('.key--text')).toHaveLength(2)   // the modes stay, to turn back on
  })

  /** The humidity sits on the setpoint's row, and stays there when off takes the setpoint away. */
  it('shows the humidity on the control row, off included', () => {
    const humid = mount(HeatingControl, { props: { entry: entry({ ...thermostat.descriptor }, { humidity: 62 }) } })
    expect(humid.find('.controls .humidity').text()).toBe('62 %')
    const off = mount(HeatingControl, { props: { entry: entry({ ...thermostat.descriptor }, { humidity: 62, mode: 'off' }) } })
    expect(off.find('.keys--target').exists()).toBe(false)
    expect(off.find('.humidity').text()).toBe('62 %')
    expect(mount(HeatingControl, { props: { entry: thermostat } }).find('.humidity').exists()).toBe(false)
  })

  /** A Nest in eco follows its own eco setpoint and refuses any other: shown, not set. */
  it('shows the eco setpoint without the keys that would set it', () => {
    const eco = mount(HeatingControl, { props: { entry: entry({ ...thermostat.descriptor }, { mode: 'eco', targetTempC: 13.9 }) } })
    const keys = eco.find('.keys--target')
    expect(keys.find('.target').text()).toBe('13,9 °C')
    // the keys keep their place (the setpoint does not slide) but are neither seen nor usable
    const buttons = keys.findAll('.key')
    expect(buttons).toHaveLength(2)
    expect(buttons.every((b) => b.classes('key--hidden') && b.attributes('disabled') !== undefined)).toBe(true)
  })

  it('greys everything out when the device is unreachable', () => {

    const gone = mount(HeatingControl, { props: { entry: entry({ ...thermostat.descriptor }, { available: false }) } })
    // an unreachable device obeys nothing: the mode is refused like the setpoint
    expect(gone.findAll('.key').every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })
})
