import { describe, expect, it } from 'vitest'
import {
  COMMAND_REQUIRES, commandKind, deviceStateSchema,
  type Command, type CommandType, type DeviceDescriptor, type DeviceState, type StateFor,
} from '@kasbah/shared'
import { ManualClock } from './clock'
import { Simulation } from './simulation'
import { SimError } from './types'
import { SCENARIO_NAMES, type ScenarioName } from './scenarios'

// Contract test: every simulated device of every scenario must honour every command its
// declared capabilities open (`COMMAND_REQUIRES`), and leave a state the schema accepts.
// `chaos` fails on purpose and `empty` has no device: both are left out.

const MONDAY = Date.UTC(2026, 8, 7)
const SCENARIOS = SCENARIO_NAMES.filter((n): n is Exclude<ScenarioName, 'chaos' | 'empty'> => n !== 'chaos' && n !== 'empty')
const make = (scenario: ScenarioName) =>
  new Simulation({ scenario, seed: 7, startTime: MONDAY, tzOffsetMin: 0, clock: new ManualClock(MONDAY) })

type Sample = (d: DeviceDescriptor, s: DeviceState) => Command

/**
 * One valid example per command type of the contract: a new command without an example here
 * breaks the typecheck. Parameters are read from the device when the contract bounds them.
 */
const SAMPLES = {
  'light.set': (d) => ({
    type: 'light.set', on: true,
    ...(d.capabilities.includes('brightness') ? { brightness: 50 } : {}),
    ...(d.meta?.effects?.[1] ? { effect: d.meta.effects[1] } : {}),
  }),
  'cover.open': () => ({ type: 'cover.open' }),
  'cover.close': () => ({ type: 'cover.close' }),
  'cover.stop': () => ({ type: 'cover.stop' }),
  'cover.set_position': () => ({ type: 'cover.set_position', position: 50 }),
  'cover.set_tilt': () => ({ type: 'cover.set_tilt', tilt: 50 }),
  'cover.preset': () => ({ type: 'cover.preset' }),
  'cover.set_preset': () => ({ type: 'cover.set_preset', position: 30 }),
  'cover.set_quiet': () => ({ type: 'cover.set_quiet', on: true }),
  'cover.set_calibration': () => ({ type: 'cover.set_calibration', points: null }),
  'media_player.play': () => ({ type: 'media_player.play' }),
  'media_player.pause': () => ({ type: 'media_player.pause' }),
  'media_player.stop': () => ({ type: 'media_player.stop' }),
  'media_player.next': () => ({ type: 'media_player.next' }),
  'media_player.previous': () => ({ type: 'media_player.previous' }),
  'media_player.set_volume': () => ({ type: 'media_player.set_volume', volume: 40 }),
  'media_player.set_mute': () => ({ type: 'media_player.set_mute', muted: true }),
  'media_player.seek': () => ({ type: 'media_player.seek', positionS: 10 }),
  'media_player.play_url': () => ({ type: 'media_player.play_url', url: 'https://example.org/stream.mp3' }),
  'climate.set_mode': () => ({ type: 'climate.set_mode', mode: 'heat' }),
  'climate.set_target_temp': () => ({ type: 'climate.set_target_temp', targetTempC: 21 }),
  'vacuum.start': () => ({ type: 'vacuum.start' }),
  'vacuum.pause': () => ({ type: 'vacuum.pause' }),
  'vacuum.dock': () => ({ type: 'vacuum.dock' }),
  'vacuum.locate': () => ({ type: 'vacuum.locate' }),
  'mower.start': () => ({ type: 'mower.start', durationMin: 30 }),
  'mower.pause': () => ({ type: 'mower.pause' }),
  'mower.park': () => ({ type: 'mower.park', untilNextSchedule: true }),
  'mower.start_in_area': (_d, s) => ({
    type: 'mower.start_in_area', workAreaId: (s as StateFor<'mower'>).workAreas?.[0]?.id ?? 0, durationMin: 30,
  }),
  'mower.set_stay_out_zone': (_d, s) => ({
    type: 'mower.set_stay_out_zone', zoneId: (s as StateFor<'mower'>).stayOutZones?.[0]?.id ?? 'zone', enabled: false,
  }),
  'mower.confirm_error': () => ({ type: 'mower.confirm_error' }),
  'ev_charger.start': () => ({ type: 'ev_charger.start' }),
  'ev_charger.stop': () => ({ type: 'ev_charger.stop' }),
  'ev_charger.set_current': () => ({ type: 'ev_charger.set_current', amps: 16 }),
  'ev_charger.resume_mode': () => ({ type: 'ev_charger.resume_mode' }),
  'ev_charger.set_mode': () => ({ type: 'ev_charger.set_mode', mode: 'green' }),
  'vehicle.lock': () => ({ type: 'vehicle.lock' }),
  'vehicle.unlock': () => ({ type: 'vehicle.unlock' }),
  'vehicle.start_charge': () => ({ type: 'vehicle.start_charge' }),
  'vehicle.stop_charge': () => ({ type: 'vehicle.stop_charge' }),
  'vehicle.set_charge_limit': () => ({ type: 'vehicle.set_charge_limit', percent: 80 }),
  'vehicle.set_charge_current': () => ({ type: 'vehicle.set_charge_current', amps: 16 }),
  'vehicle.wake': () => ({ type: 'vehicle.wake' }),
  'vehicle.climate_start': () => ({ type: 'vehicle.climate_start', targetTempC: 20 }),
  'vehicle.climate_stop': () => ({ type: 'vehicle.climate_stop' }),
  'vehicle.climate_set': (d) => {
    const c = d.meta?.vehicle?.climate
    const seat = c?.seats[0]
    return {
      type: 'vehicle.climate_set',
      ...(c ? { targetTempC: Math.min(Math.max(20, c.minC), c.maxC) } : {}),
      ...(seat ? { seatHeat: { [seat]: 1 } } : {}),
      ...(c?.steeringWheelHeat ? { steeringWheelHeat: true } : {}),
    }
  },
  'vehicle.refresh': () => ({ type: 'vehicle.refresh' }),
  'vehicle.schedule_update': () => ({ type: 'vehicle.schedule_update', delayS: 0 }),
  'vehicle.cancel_update': () => ({ type: 'vehicle.cancel_update' }),
  'pet_feeder.feed': (d) => ({ type: 'pet_feeder.feed', amount: d.meta?.petFeeder?.portions[0] ?? 10 }),
  'pet_feeder.call_pet': () => ({ type: 'pet_feeder.call_pet' }),
  'pet_fountain.set_power': () => ({ type: 'pet_fountain.set_power', on: true }),
  'pet_fountain.set_mode': () => ({ type: 'pet_fountain.set_mode', mode: 'intermittent' }),
  'fan.set': (d) => ({
    type: 'fan.set', on: true,
    ...(d.meta?.fan?.speeds[0] !== undefined ? { speed: d.meta.fan.speeds[0] } : {}),
    ...(d.capabilities.includes('fan_direction') ? { direction: 'reverse' } : {}),
    ...(d.capabilities.includes('fan_timer') ? { timerMin: 30 } : {}),
    ...(d.capabilities.includes('mute') ? { muted: false } : {}),
  }),
} satisfies Record<CommandType, Sample>

const ALL_TYPES = Object.keys(COMMAND_REQUIRES) as CommandType[]

/** Command types the device's kind and capabilities open. */
const allowed = (d: DeviceDescriptor) =>
  ALL_TYPES.filter((t) => commandKind(t) === d.kind && d.capabilities.includes(COMMAND_REQUIRES[t]))

/**
 * A legitimate refusal due to the CURRENT state (car asleep or not plugged in, no update
 * downloaded, no mower error to clear, battery too low), not an unsupported command. Vehicles
 * are woken first so most of these do not happen; the rest are tolerated here.
 */
const isStateRefusal = (e: unknown) => e instanceof SimError && (e.code === 'DEVICE_UNAVAILABLE' || e.code === 'LOW_BATTERY')

describe.each(SCENARIOS)('simulation contract — %s', (scenario) => {
  it('every device accepts every command its capabilities open, and keeps a valid state', async () => {
    const failures: string[] = []
    for (const d of make(scenario).devices()) {
      for (const type of allowed(d)) {
        // a fresh simulation per command: the order of the commands masks nothing
        const sim = make(scenario)
        const id = d.externalId
        if (d.kind === 'vehicle') await sim.execute(id, { type: 'vehicle.wake' })
        const cmd = (SAMPLES[type] as Sample)(d, sim.getState(id)!)
        try {
          await sim.execute(id, cmd)
        } catch (e) {
          if (!isStateRefusal(e)) failures.push(`${id} ${type}: ${e instanceof Error ? e.message : String(e)}`)
        }
        sim.tick(1)
        const parsed = deviceStateSchema.safeParse(sim.getState(id))
        if (!parsed.success) failures.push(`${id} ${type}: invalid state — ${parsed.error.message}`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('simulation contract — coverage', () => {
  it('every command type is opened by at least one simulated device, except the listed ones', () => {
    const seen = new Set<CommandType>()
    for (const scenario of SCENARIOS) for (const d of make(scenario).devices()) for (const t of allowed(d)) seen.add(t)
    // no simulated charger declares `charge_mode`: an explicit gap, not an oversight
    expect(ALL_TYPES.filter((t) => !seen.has(t))).toEqual(['ev_charger.set_mode'])
  })
})
