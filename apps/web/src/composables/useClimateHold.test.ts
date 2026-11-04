import { describe, expect, it } from 'vitest'
import type { DeviceState, StateFor } from '@kasbah/shared'
import { heldBy } from './useClimateHold'

// A Nest in series in front of a heat pump zone: the zone, under its setpoint on its own sensor,
// would heat, but the Nest is satisfied and keeps the machine stopped.

const NEST = 'nest:t'
const PAC = 'melcloud:1-z1'
const climate = (o: Partial<StateFor<'climate'>>): StateFor<'climate'> =>
  ({ kind: 'climate', updatedAt: 0, available: true, mode: 'heat', action: 'idle', currentTempC: 19.8, targetTempC: 19.8, ...o })

function held(states: Record<string, DeviceState>, links: string[][] = [[NEST, PAC]]) {
  return heldBy(PAC, links, (id) => states[id])
}

describe('heldBy', () => {
  it('names the linked thermostat that keeps a zone under its setpoint idle', () => {
    expect(held({ [NEST]: climate({}), [PAC]: climate({ currentTempC: 19.5, targetTempC: 20 }) })).toBe(NEST)
  })

  it('holds nothing when the zone is warm enough, heats, or is not linked', () => {
    expect(held({ [NEST]: climate({}), [PAC]: climate({ currentTempC: 20, targetTempC: 20 }) })).toBeNull()
    expect(held({ [NEST]: climate({}), [PAC]: climate({ action: 'heating', currentTempC: 19.5, targetTempC: 20 }) })).toBeNull()
    expect(held({ [NEST]: climate({}), [PAC]: climate({ currentTempC: 19.5, targetTempC: 20 }) }, [])).toBeNull()
  })

  it('blames no thermostat that heats itself, is off, in eco or unavailable', () => {
    const pac = climate({ currentTempC: 19.5, targetTempC: 20 })
    for (const nest of [climate({ action: 'heating' }), climate({ mode: 'off', action: 'off' }), climate({ mode: 'eco' }), climate({ available: false })]) {
      expect(held({ [NEST]: nest, [PAC]: pac })).toBeNull()
    }
  })
})
