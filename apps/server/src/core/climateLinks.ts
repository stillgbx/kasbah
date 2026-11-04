import type { Logger } from 'pino'
import type { Command, DeviceEntry, DeviceId, DeviceState } from '@kasbah/shared'
import type { Bus } from './bus'
import type { Clock } from './clock'

// Linked thermostats (`house.climateLinks`): the server keeps the setpoints of a group equal.
//
// The case that asked for it: a Nest in front of a heat pump that regulates on its own room sensor.
// With different setpoints they fight — the Nest asks for heat while the heat pump has cut, or the
// heat pump would heat and the Nest holds it back. Nothing here knows a brand: a member is any
// `climate` device that declares `target_temp`.
//
// A setpoint that CHANGES on a member is copied to the others, wherever the change came from: a
// Kasbah screen, an automation, the dial of the thermostat or the vendor's app (seen at the next
// poll). Each member receives it rounded UP to the step it keeps (`meta.climate.stepC`): a heat pump
// that only holds half-degrees gets 20.0 for a Nest at 19.8, so that it never cuts before the Nest
// is satisfied (the user's choice of 2026-11-03).
//
// The echo of a copy must not be copied back: the heat pump confirming 20.0 would set the Nest from
// 19.8 to 20.0. So a pushed value is remembered for a while, and neither its confirmation nor a
// read still carrying the value from before the push (a poll that left before the command) is a
// change.

/** How long the echoes of a copy are ignored: a MELCloud unit reports every few minutes. */
export const CONFIRM_WITHIN_MS = 10 * 60_000

/** The setpoint a member receives: rounded UP to the step it keeps, within its range. */
export function linkedSetpoint(value: number, entry: DeviceEntry): number {
  const step = entry.descriptor.meta.climate?.stepC ?? 0.1
  // the epsilon keeps 20.0 at 20.0: 20 / 0.1 is 200.00000000000003 in floating point
  let v = Math.round(Math.ceil(value / step - 1e-6) * step * 10) / 10
  const range = entry.descriptor.meta.targetTempC
  if (range) v = Math.min(range[1], Math.max(range[0], v))
  return v
}

/** The device follows a setpoint: not off (none applies), not in eco (it follows its own). */
const followsSetpoint = (s: DeviceState): boolean => s.kind === 'climate' && s.mode !== 'off' && s.mode !== 'eco'

export interface ClimateLinksOptions {
  /** The house's groups, re-read on every change: house.json may be rewritten from the UI. */
  links: () => readonly (readonly DeviceId[])[]
  registry: { get(id: DeviceId): DeviceEntry | undefined }
  bus: Bus
  clock: Clock
  logger: Logger
  execute: (id: DeviceId, command: Command) => Promise<void>
}

export class ClimateLinks {
  /** Last setpoint seen per thermostat: what tells a change from a repeated read. */
  private readonly seen = new Map<DeviceId, number>()
  /** Setpoints pushed, whose echoes are ignored `until`: `from` is the device's setpoint before the push. */
  private readonly pushed = new Map<DeviceId, { value: number; from: number; until: number }>()

  constructor(private readonly opts: ClimateLinksOptions) {
    opts.bus.on('state', (id, state) => this.onState(id, state))
  }

  private onState(id: DeviceId, state: DeviceState): void {
    if (state.kind !== 'climate') return
    const value = state.targetTempC
    const before = this.seen.get(id)
    this.seen.set(id, value)
    if (before === value) return
    const group = this.opts.links().find((g) => g.includes(id))
    if (!group) return
    // Every setpoint change of a member that is not copied says why: on 2026-11-04 a change made
    // from Kasbah on the Nest reached nobody and left nothing in the log.
    const skip = (reason: string) => this.opts.logger.info({ source: id, targetTempC: value, reason }, 'linked thermostat skipped')
    // first read (server start): nothing changed, and the group is not realigned behind the user's back
    if (before === undefined) return skip('first reading')

    // Within the window, the pushed value and the one from before are echoes, in any order: a poll
    // that left before the command can land AFTER the device confirmed. The price: putting the
    // device back to its former setpoint from the vendor's app is not copied for these few minutes.
    const pushed = this.pushed.get(id)
    if (pushed && this.opts.clock.now() < pushed.until && (value === pushed.value || value === pushed.from)) return skip('echo of a copy')
    this.pushed.delete(id)
    if (!followsSetpoint(state)) return skip(`source in mode ${state.mode}`)
    for (const other of group) if (other !== id) this.push(other, value, id)
  }

  private push(id: DeviceId, value: number, source: DeviceId): void {
    const entry = this.opts.registry.get(id)
    const skip = (reason: string) => this.opts.logger.info({ source, device: id, targetTempC: value, reason }, 'linked thermostat skipped')
    if (!entry || entry.state.kind !== 'climate') return skip('not a known thermostat')
    if (!entry.state.available) return skip('unavailable')
    if (!entry.descriptor.capabilities.includes('target_temp')) return skip('takes no setpoint')
    if (!followsSetpoint(entry.state)) return skip(`in mode ${entry.state.mode}`)
    const targetTempC = linkedSetpoint(value, entry)
    if (entry.state.targetTempC === targetTempC) return skip('already at that setpoint')
    this.pushed.set(id, { value: targetTempC, from: entry.state.targetTempC, until: this.opts.clock.now() + CONFIRM_WITHIN_MS })
    this.opts.execute(id, { type: 'climate.set_target_temp', targetTempC }).then(
      () => this.opts.logger.info({ source, device: id, targetTempC }, 'linked thermostat set'),
      (err) => {
        this.pushed.delete(id)
        this.opts.logger.warn({ err, source, device: id, targetTempC }, 'linked thermostat not set')
      },
    )
  }
}
