import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import ClimateControl from './ClimateControl.vue'

// Two very different devices share this control:
//
//  - a thermostat that we DRIVE (the simulation): setpoint buttons and mode choice;
//  - an air-to-water heat pump zone READ ONLY (MELCloud): the same figures, no
//    gesture. And one of its zones is set on the FLOW water, not on a room's air: 45 °C
//    there is a circuit setpoint, which the thermostat's vocabulary would make read as a living room.
//
// This control was the only one not to consult the capabilities — nothing forced it to as long as the
// only `climate` device was simulated, and it declared everything.

const thermostat: DeviceDescriptor = {
  id: 'mock:c', pluginId: 'mock', externalId: 'c', kind: 'climate', name: 'Salon',
  capabilities: ['hvac_mode', 'target_temp', 'current_temp'],
  meta: { targetTempC: [16, 28], climate: { modes: ['off', 'heat'] } },
}
const state: StateFor<'climate'> = { kind: 'climate', updatedAt: 0, available: true, mode: 'heat', action: 'idle', currentTempC: 23, targetTempC: 19.5 }

/** Ecodan's zone 2: read only, and set on the flow temperature. */
const flowZone: DeviceDescriptor = {
  id: 'melcloud:1-z2', pluginId: 'melcloud', externalId: '1-z2', kind: 'climate', name: 'Chauffage zone 2',
  capabilities: ['current_temp'],
  meta: { targetTempC: [30, 60], climate: { modes: ['off', 'heat', 'eco'], control: 'flow' } },
}

describe('ClimateControl', () => {
  it('offers the gestures when the device declares them', () => {
    const w = mount(ClimateControl, { props: { descriptor: thermostat, state } })
    expect(w.findAll('.v-btn')).toHaveLength(2)      // minus / plus
    expect(w.find('.v-chip-group').exists()).toBe(true)
  })

  /** The heart of the matter: an undeclared capability must not produce a button that would fail. */
  it('offers NO gesture on a read-only device', () => {
    const w = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    expect(w.findAll('.v-btn')).toHaveLength(0)
    expect(w.find('.v-chip-group').exists()).toBe(false)
  })

  it('shows no setpoint when off, and keeps the mode above it', () => {
    const on = mount(ClimateControl, { props: { descriptor: thermostat, state } })
    expect(on.text().indexOf('Mode')).toBeLessThan(on.text().indexOf('Consigne'))
    const off = mount(ClimateControl, { props: { descriptor: thermostat, state: { ...state, mode: 'off', action: 'off' } } })
    expect(off.text()).not.toContain('Consigne')
    expect(off.text()).not.toContain('19,5')
    expect(off.findAll('.v-btn')).toHaveLength(0)
    expect(off.find('.v-chip-group').exists()).toBe(true)   // enough to turn it back on
  })

  /** A Nest in eco follows its own eco setpoint and refuses any other: shown, not set. */
  it('shows the eco setpoint without buttons in eco', () => {
    const w = mount(ClimateControl, { props: { descriptor: thermostat, state: { ...state, mode: 'eco', targetTempC: 13.9 } } })
    expect(w.text()).toContain('Consigne éco')
    expect(w.text()).toContain('13,9')
    // the buttons keep their place (the setpoint does not slide) but are neither seen nor usable
    const buttons = w.findAll('.v-btn')
    expect(buttons).toHaveLength(2)
    expect(buttons.every((b) => b.classes('btn-hidden') && b.attributes('disabled') !== undefined)).toBe(true)
    expect(w.find('.v-chip-group').exists()).toBe(true)   // the mode stays, to leave eco
  })

  it('still shows the setpoint and the mode, which are state', () => {
    const w = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    expect(w.text()).toContain('19,5')                // the setpoint stays readable
    expect(w.text()).toContain('Chauffage')           // the mode too, as a plain label
  })

  it('talks about flow water, not ambient temperature, on a water-law zone', () => {
    const w = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    expect(w.text()).toContain('Eau de départ')
    expect(w.text()).toContain('Consigne de départ')
    expect(w.text()).not.toContain('Température')
  })

  it('keeps the thermostat vocabulary when the zone is set on the room', () => {
    const w = mount(ClimateControl, { props: { descriptor: thermostat, state } })
    expect(w.text()).toContain('Température')
    expect(w.text()).not.toContain('Eau de départ')
  })
})

describe('ClimateControl — setpoint alignment', () => {
  /** Without buttons, a number centered under a left-aligned label floats in the middle of nowhere. */
  it('aligns the setpoint to the left when there are no buttons around', () => {
    const readOnly = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    expect(readOnly.find('.justify-start').exists()).toBe(true)

    const pilotable = mount(ClimateControl, { props: { descriptor: thermostat, state } })
    expect(pilotable.find('.justify-center').exists()).toBe(true)
  })

  // The panel KEEPS this component when switching from one zone to another: everything that depends on
  // the device must follow the new descriptor, not the one from the first mount.
  it('follows the device when the panel goes from a thermostat to a zone on water flow', async () => {
    const w = mount(ClimateControl, { props: { descriptor: thermostat, state } })
    await w.setProps({ descriptor: flowZone })
    expect(w.findAll('.v-btn')).toHaveLength(0)
    expect(w.find('.v-chip-group').exists()).toBe(false)
    expect(w.text()).toContain('départ')
  })
  it('clamps the setpoint to the NEW device\'s range', async () => {
    const w = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    const wide: DeviceDescriptor = { ...thermostat, meta: { ...thermostat.meta, targetTempC: [5, 35] } }
    await w.setProps({ descriptor: wide, state: { ...state, targetTempC: 20 } })
    await w.findAll('.v-btn')[0]!.trigger('click')
    expect(w.emitted('command')).toEqual([[{ type: 'climate.set_target_temp', targetTempC: 19.5 }]])
  })
})

