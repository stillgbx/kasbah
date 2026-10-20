import type { Command, CommandInput } from '../devices/command'

// "For N minutes": the command that undoes that of an action, at the end of the delay. Only
// the OBVIOUS inverses (open ↔ close, turn on ↔ turn off…): a position, a brightness, a
// volume or a setpoint have no inverse without reading the previous value, which we do not do.

/**
 * The command ONLY toggles `on` (no brightness, speed, color…). A fade does not
 * count: turned on over 10 min, the light turns off over 10 min at the end of the delay.
 */
const onlyOn = (cmd: { on?: boolean }): cmd is { on: boolean } =>
  typeof cmd.on === 'boolean' && Object.keys(cmd).every((k) => k === 'type' || k === 'on' || k === 'transitionMs')

export function inverseCommand(cmd: CommandInput): Command | undefined {
  switch (cmd.type) {
    case 'light.set': return onlyOn(cmd)
      ? { type: 'light.set', on: !cmd.on, ...(cmd.transitionMs !== undefined ? { transitionMs: cmd.transitionMs } : {}) }
      : undefined
    case 'fan.set': return onlyOn(cmd) ? { type: 'fan.set', on: !cmd.on } : undefined
    case 'pet_fountain.set_power': return { type: 'pet_fountain.set_power', on: !cmd.on }
    case 'cover.open': return { type: 'cover.close' }
    case 'cover.close': return { type: 'cover.open' }
    case 'media_player.play': return { type: 'media_player.stop' }
    case 'media_player.play_url': return { type: 'media_player.stop' }
    case 'vacuum.start': return { type: 'vacuum.dock' }
    case 'mower.start': return { type: 'mower.park', untilNextSchedule: true }
    case 'mower.start_in_area': return { type: 'mower.park', untilNextSchedule: true }
    case 'mower.set_stay_out_zone': return { type: 'mower.set_stay_out_zone', zoneId: cmd.zoneId, enabled: !cmd.enabled }
    case 'vehicle.lock': return { type: 'vehicle.unlock' }
    case 'vehicle.unlock': return { type: 'vehicle.lock' }
    case 'vehicle.start_charge': return { type: 'vehicle.stop_charge' }
    case 'vehicle.stop_charge': return { type: 'vehicle.start_charge' }
    case 'vehicle.climate_start': return { type: 'vehicle.climate_stop' }
    case 'ev_charger.start': return { type: 'ev_charger.stop' }
    case 'ev_charger.stop': return { type: 'ev_charger.start' }
    default: return undefined
  }
}
