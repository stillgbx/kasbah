import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { Command, DeviceDescriptor, DeviceId, StatePatch } from '@kasbah/shared'
import { Bus } from './bus'
import { CONFIRM_WITHIN_MS, ClimateLinks, linkedSetpoint } from './climateLinks'
import { DeviceRegistry } from './registry'

// Two thermostats in series on the same heating: a Nest (tenths) in front of a heat pump that only
// holds half-degrees. What must hold: a change on either is copied to the other, the heat pump
// receives the Nest's setpoint rounded UP, and no copy ever comes back as a change of its own.

const NEST = 'nest:thermostat-1'
const PAC = 'melcloud:unit-z1'
const OTHER = 'mock:salon'

const climate = (id: string, meta: DeviceDescriptor['meta']): DeviceDescriptor => {
  const [pluginId, externalId] = id.split(':') as [string, string]
  return { id, pluginId, externalId, kind: 'climate', name: id, capabilities: ['current_temp', 'target_temp', 'hvac_mode'], meta }
}

function setup(o: { links?: DeviceId[][]; fail?: boolean } = {}) {
  const bus = new Bus()
  const clock = new ManualClock(Date.UTC(2026, 10, 3, 21))
  const registry = new DeviceRegistry(bus, clock)
  registry.register('nest', [climate(NEST, { targetTempC: [9, 32] })])
  registry.register('melcloud', [climate(PAC, { targetTempC: [10, 30], climate: { modes: ['off', 'heat', 'eco'], stepC: 0.5 } })])
  registry.register('mock', [climate(OTHER, {})])
  const sent: { id: string; command: Command }[] = []
  // the device keeps what it is sent, as a plugin that re-reads after its command would publish it
  const execute = vi.fn(async (id: DeviceId, command: Command) => {
    sent.push({ id, command })
    if (o.fail) throw new Error('vendor down')
    if (command.type === 'climate.set_target_temp') registry.applyPatch(id, { targetTempC: command.targetTempC } as StatePatch)
  })
  const logs: Record<string, unknown>[] = []
  const logger = pino({ level: 'info' }, { write: (line: string) => { logs.push(JSON.parse(line)) } })
  new ClimateLinks({ links: () => o.links ?? [[NEST, PAC]], registry, bus, clock, logger, execute })
  const report = (id: string, patch: Record<string, unknown>) => registry.applyPatch(id, { available: true, ...patch } as StatePatch)
  // the first read of each: what the server finds at start
  report(NEST, { mode: 'heat', targetTempC: 19.5 })
  report(PAC, { mode: 'heat', targetTempC: 19.5 })
  report(OTHER, { mode: 'heat', targetTempC: 21 })
  return { registry, clock, sent, report, logs }
}

const target = (r: DeviceRegistry, id: string) => (r.get(id)!.state as { targetTempC: number }).targetTempC

describe('linkedSetpoint', () => {
  it('rounds UP to the step the device holds, within its range', () => {
    const pac = climate(PAC, { targetTempC: [10, 30], climate: { modes: ['heat'], stepC: 0.5 } })
    const entry = (d: DeviceDescriptor) => ({ descriptor: d, state: {} as never })
    expect(linkedSetpoint(19.8, entry(pac))).toBe(20)
    expect(linkedSetpoint(19.5, entry(pac))).toBe(19.5)
    expect(linkedSetpoint(20, entry(pac))).toBe(20)
    expect(linkedSetpoint(35, entry(pac))).toBe(30)
    expect(linkedSetpoint(19.8, entry(climate(NEST, {})))).toBe(19.8)
  })
})

describe('ClimateLinks', () => {
  it('copies a change on the Nest to the heat pump, rounded up, and the echo does not come back', () => {
    const { registry, sent, report } = setup()
    report(NEST, { targetTempC: 19.8 })
    expect(sent).toEqual([{ id: PAC, command: { type: 'climate.set_target_temp', targetTempC: 20 } }])
    // the heat pump confirms 20.0: the Nest stays at 19.8
    report(PAC, { targetTempC: 20 })
    expect(sent).toHaveLength(1)
    expect(target(registry, NEST)).toBe(19.8)
  })

  it('copies a change on the heat pump (its app, its dial) to the Nest', () => {
    const { sent, report } = setup()
    report(PAC, { targetTempC: 20.5 })
    expect(sent).toEqual([{ id: NEST, command: { type: 'climate.set_target_temp', targetTempC: 20.5 } }])
  })

  it('does not realign the group at start: only a change is copied', () => {
    const { sent } = setup()
    expect(sent).toEqual([])
  })

  it('takes a read still carrying the value from before the copy for what it is: stale', () => {
    const { registry, clock, sent, report } = setup()
    report(NEST, { targetTempC: 21 })
    // the heat pump confirmed 21 at once; a poll that left before the command lands after it
    report(PAC, { targetTempC: 19.5 })
    report(PAC, { targetTempC: 21 })
    expect(sent).toHaveLength(1)
    expect(target(registry, NEST)).toBe(21)
    // long after, the same value is a real change again
    clock.advance(CONFIRM_WITHIN_MS + 1)
    report(NEST, { targetTempC: 22 })
    report(PAC, { targetTempC: 19.5 })
    expect(sent.at(-1)).toEqual({ id: NEST, command: { type: 'climate.set_target_temp', targetTempC: 19.5 } })
  })

  it('copies nothing from a thermostat off or in eco, and sets none that is', () => {
    const { sent, report } = setup()
    report(NEST, { mode: 'eco', targetTempC: 14 })   // the eco setpoint is the Nest's own
    expect(sent).toEqual([])
    report(PAC, { targetTempC: 21 })
    expect(sent).toEqual([])   // a Nest in eco refuses any setpoint
  })

  it('sends nothing when the other already has the value, nor outside a group', () => {
    const { sent, report } = setup({ links: [[NEST, PAC]] })
    report(NEST, { targetTempC: 19.6 })   // rounded up: 20.0
    report(PAC, { targetTempC: 20 })
    report(NEST, { targetTempC: 19.9 })   // rounded up: 20.0 still, the heat pump already has it
    report(OTHER, { targetTempC: 18 })
    expect(sent).toHaveLength(1)
  })

  it('links any number of brands: a group of three', () => {
    const { sent, report } = setup({ links: [[NEST, PAC, OTHER]] })
    report(OTHER, { targetTempC: 19.7 })
    expect(sent).toEqual([
      { id: NEST, command: { type: 'climate.set_target_temp', targetTempC: 19.7 } },
      { id: PAC, command: { type: 'climate.set_target_temp', targetTempC: 20 } },
    ])
  })

  it('says in the log why a setpoint change was not copied', () => {
    const { report, logs } = setup()
    const skipped = () => logs.filter((l) => l.msg === 'linked thermostat skipped').map((l) => l.reason)
    expect(skipped()).toEqual(['first reading', 'first reading'])   // the Nest and the heat pump, not OTHER
    report(PAC, { mode: 'off' })
    report(NEST, { targetTempC: 21 })
    expect(skipped().at(-1)).toBe('in mode off')
    report(NEST, { mode: 'eco', targetTempC: 14 })
    expect(skipped().at(-1)).toBe('source in mode eco')
  })

  it('forgets a copy the vendor refused: the next real change still goes', async () => {
    const { sent, report } = setup({ fail: true })
    report(NEST, { targetTempC: 21 })
    await new Promise((r) => setTimeout(r, 0))
    report(PAC, { targetTempC: 19.5 + 1 })
    expect(sent.at(-1)!.id).toBe(NEST)
  })
})
