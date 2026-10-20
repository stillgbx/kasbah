import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { optimisticPatch } from '../../lib/optimistic'
import PetFeederCard from './PetFeederCard.vue'
import PetFountainCard from './PetFountainCard.vue'

// What these cards must hold, and which comes from the CONTRACT rather than the design:
//
//  - a portion is only offered if the device SAYS which ones it accepts. Without
//    `meta.petFeeder.portionsG`, no button — a slider or a default value would serve
//    something other than what the user thinks they are asking for;
//  - a section follows its CAPABILITY: no "filter" line on a fountain that does not declare one;
//  - an unknown value is written "—" and does not make its line disappear ("nothing moves").

const feeder: DeviceDescriptor = {
  id: 'petkit:d4-1', pluginId: 'petkit', externalId: 'd4-1', kind: 'pet_feeder', name: 'Mangeoire',
  capabilities: ['feed', 'consumables', 'battery'],
  meta: { manufacturer: 'PetKit', model: 'Fresh Element Solo', petFeeder: { portions: [1, 2, 3, 4, 5], unit: 'cup' as const } },
}
const feederState: StateFor<'pet_feeder'> = {
  kind: 'pet_feeder', updatedAt: 0, available: true, foodLow: false, servedToday: 4, plannedToday: 5, desiccantDays: 18,
}

const fountain: DeviceDescriptor = {
  id: 'petkit:ctw3-2', pluginId: 'petkit', externalId: 'ctw3-2', kind: 'pet_fountain', name: 'Fontaine',
  capabilities: ['on_off', 'pump_mode', 'consumables', 'battery', 'water_usage'],
  meta: { manufacturer: 'PetKit', model: 'Eversweet Max' },
}
const fountainState: StateFor<'pet_fountain'> = {
  kind: 'pet_fountain', updatedAt: 0, available: true, on: true, mode: 'intermittent', filterPct: 78, drinksToday: 6, drinkAvgS: 26,
}

describe('PetFeederCard', () => {
  it('offers one portion per accepted value, and nothing else', () => {
    const w = mount(PetFeederCard, { global: { plugins: [createPinia()] }, props: { descriptor: feeder, state: feederState } })
    // In CUPS, the unit THIS machine declares — with the gram counterpart below it,
    // ESTIMATED from the weight of a cup (100 g by default). The vendor's app writes
    // "1/2 (about 50 g)": 10 g per tenth, the same count.
    const labels = w.findAll('button').map((b) => b.text()).filter((t) => t.includes('tasse'))
    expect(labels).toEqual(['0,1 tasse~ 10 g', '0,2 tasse~ 20 g', '0,3 tasse~ 30 g', '0,4 tasse~ 40 g', '0,5 tasse~ 50 g'])
  })

  it('emits the requested portion, in the device\'s unit', async () => {
    const w = mount(PetFeederCard, { global: { plugins: [createPinia()] }, props: { descriptor: feeder, state: feederState } })
    await w.findAll('button').find((b) => b.text().startsWith('0,3 tasse'))!.trigger('click')
    expect(w.emitted('command')?.[0]).toEqual([{ type: 'pet_feeder.feed', amount: 3 }])
  })

  it('offers NO portion when the device does not say which ones it accepts', () => {
    const w = mount(PetFeederCard, { global: { plugins: [createPinia()] },
      props: { descriptor: { ...feeder, meta: { manufacturer: 'PetKit' } }, state: feederState },
    })
    expect(w.findAll('button').filter((b) => b.text().includes('tasse'))).toHaveLength(0)
  })

  it('keeps the desiccant line, with a dash, when the value is unknown', () => {
    const w = mount(PetFeederCard, { global: { plugins: [createPinia()] }, props: { descriptor: feeder, state: { ...feederState, desiccantDays: undefined } } })
    expect(w.text()).toContain('Dessiccant')
    expect(w.text()).toContain('—')
  })
})

describe('PetFountainCard', () => {
  it('toggles the pump to the OPPOSITE state of the one it shows', async () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: fountainState } })
    await w.findAll('button')[0]!.trigger('click')
    expect(w.emitted('command')?.[0]).toEqual([{ type: 'pet_fountain.set_power', on: false }])
  })

  it('greys out the modes when the pump is off: setting them would make no sense', () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: { ...fountainState, on: false } } })
    const modes = w.findAll('button').slice(1)
    expect(modes.length).toBe(2)
    expect(modes.every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })

  it('counts PASSES, not milliliters: an Eversweet Max measures no volume', () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: fountainState } })
    expect(w.text()).toContain('Passages aujourd')
    expect(w.text()).toContain('26 s en moyenne')
    expect(w.text()).not.toContain('mL')
  })

  it('does not show the filter line when the capability is not declared', () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] },
      props: { descriptor: { ...fountain, capabilities: ['on_off'] }, state: fountainState },
    })
    expect(w.text()).not.toContain('Filtre')
  })

  it('always states the AGE of the reading — a Bluetooth fountain is never real-time', () => {
    const fresh = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: { ...fountainState, syncedAt: Date.now() } } })
    expect(fresh.text()).toContain('Relevé')
    const never = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: fountainState } })
    expect(never.text()).toContain('Date du relevé inconnue')
  })
})

describe('animals — immediate feedback on a command', () => {
  // Three things must be visible when pressing, otherwise we do not know whether the gesture went out:
  // the state toggles RIGHT AWAY (the store rolls back if the vendor refuses), the pushed
  // button — and only it — spins, and nothing changes size during the wait.

  it('toggles the state without waiting for the vendor', () => {
    expect(optimisticPatch(fountainState, { type: 'pet_fountain.set_power', on: false })).toEqual({ on: false })
    // setting the mode turns it back on: it is the SAME frame that carries both
    expect(optimisticPatch(fountainState, { type: 'pet_fountain.set_mode', mode: 'continuous' }))
      .toEqual({ mode: 'continuous', on: true })
    // the portion is NOT added to what was served: the machine may pour less than requested
    expect(optimisticPatch(feederState, { type: 'pet_feeder.feed', amount: 3 })).toEqual({ feeding: true })
  })

  it('spins ONLY the pushed button', async () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: fountainState, pending: false } })
    const modeBtn = w.findAll('button').find((b) => b.text().includes('Continu'))!
    await modeBtn.trigger('click')
    await w.setProps({ pending: true })
    const loading = w.findAll('.v-btn--loading')
    expect(loading).toHaveLength(1)
    expect(loading[0]!.text()).toContain('Continu')
    // command settled: nothing spins anymore
    await w.setProps({ pending: false })
    expect(w.findAll('.v-btn--loading')).toHaveLength(0)
  })

  it('an error message REPLACES the alert line, it does not add one', () => {
    const calm = mount(PetFeederCard, { global: { plugins: [createPinia()] }, props: { descriptor: feeder, state: feederState } })
    const angry = mount(PetFeederCard, { global: { plugins: [createPinia()] },
      props: { descriptor: feeder, state: { ...feederState, errorMessage: 'Porte obstruée, retirez les croquettes coincées et relancez la distribution' } },
    })
    // same number of lines: the card does not grow by an inch
    expect(angry.findAll('.line')).toHaveLength(calm.findAll('.line').length)
    expect(angry.find('.line').text()).toContain('Porte obstru')
    expect(calm.find('.line').text()).toContain('Trémie garnie')
  })
})
