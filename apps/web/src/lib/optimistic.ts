import type { CommandInput, DeviceState } from '@kasbah/shared'

/**
 * Expected effect of a command on the current state, applied BEFORE the server's response so that
 * the interface reacts to the finger. Returns null when nothing is predictable.
 */
export function optimisticPatch(state: DeviceState, cmd: CommandInput): Partial<DeviceState> | null {
  switch (state.kind) {
    case 'light':
      if (cmd.type !== 'light.set') return null
      return {
        ...(cmd.on !== undefined ? { on: cmd.on } : {}),
        ...(cmd.brightness !== undefined ? (cmd.brightness === 0 ? { on: false } : { on: true, brightness: cmd.brightness }) : {}),
        ...(cmd.colorTempMirek !== undefined ? { colorTempMirek: cmd.colorTempMirek } : {}),
        ...(cmd.color !== undefined ? { color: cmd.color } : {}),
        ...(cmd.effect !== undefined ? { effect: cmd.effect } : {}),
      } as Partial<DeviceState>
    case 'cover':
      // The movement only: the aimed POSITION is not written into the state, it is held
      // separately by the store (`coverTarget`). A vendor that only publishes its position at the end of
      // the travel would re-emit the old value and immediately overwrite an optimistic position.
      switch (cmd.type) {
        // unknown position: we do not know whether the cover is already at the end, so we bet on the
        // movement — an indicator that lights up for nothing is better than a gesture without an echo
        case 'cover.open': return { motion: state.position !== undefined && state.position >= 100 ? 'stopped' : 'opening' } as Partial<DeviceState>
        case 'cover.close': return { motion: state.position !== undefined && state.position <= 0 ? 'stopped' : 'closing' } as Partial<DeviceState>
        case 'cover.stop': return { motion: 'stopped' } as Partial<DeviceState>
        case 'cover.set_position': {
          if (state.position === undefined) return { motion: 'opening' } as Partial<DeviceState>
          const p = state.position
          return { motion: cmd.position > p ? 'opening' : cmd.position < p ? 'closing' : 'stopped' } as Partial<DeviceState>
        }
        // same reasoning as `set_position`, on the motor's favorite position: without it we
        // do not know the direction, so we bet on the movement
        case 'cover.preset': {
          const to = state.presetPosition
          if (to === undefined || state.position === undefined) return { motion: 'opening' } as Partial<DeviceState>
          const p = state.position
          return { motion: to > p ? 'opening' : to < p ? 'closing' : 'stopped' } as Partial<DeviceState>
        }
        case 'cover.set_tilt': return { tilt: cmd.tilt } as Partial<DeviceState>
        case 'cover.set_quiet': return { quiet: cmd.on } as Partial<DeviceState>
        default: return null
      }
    case 'media_player':
      switch (cmd.type) {
        case 'media_player.play': return { playback: 'playing' } as Partial<DeviceState>
        case 'media_player.play_url': return { playback: 'playing' } as Partial<DeviceState>
        case 'media_player.pause': return { playback: 'paused' } as Partial<DeviceState>
        case 'media_player.stop': return { playback: 'idle', nowPlaying: undefined } as Partial<DeviceState>
        case 'media_player.set_volume': return { volume: cmd.volume } as Partial<DeviceState>
        case 'media_player.set_mute': return { muted: cmd.muted } as Partial<DeviceState>
        case 'media_player.seek':
          // the aimed position is displayed right away; the receiver confirms through its state
          return state.nowPlaying ? { nowPlaying: { ...state.nowPlaying, positionS: cmd.positionS } } as Partial<DeviceState> : null
        default: return null
      }
    case 'climate':
      if (cmd.type === 'climate.set_mode') return { mode: cmd.mode } as Partial<DeviceState>
      if (cmd.type === 'climate.set_target_temp') return { targetTempC: cmd.targetTempC } as Partial<DeviceState>
      return null
    case 'vacuum':
      switch (cmd.type) {
        case 'vacuum.start': return { activity: 'cleaning' } as Partial<DeviceState>
        case 'vacuum.pause': return { activity: 'paused' } as Partial<DeviceState>
        case 'vacuum.dock': return { activity: 'returning' } as Partial<DeviceState>
        default: return null
      }
    case 'mower':
      switch (cmd.type) {
        // without a duration, the robot resumes its program: it only leaves if a slot is open
        case 'mower.start': return cmd.durationMin === undefined ? null : { activity: 'mowing' } as Partial<DeviceState>
        case 'mower.pause': return { activity: 'paused' } as Partial<DeviceState>
        case 'mower.park': return { activity: state.activity === 'mowing' || state.activity === 'paused' ? 'returning' : state.activity } as Partial<DeviceState>
        case 'mower.start_in_area': return { activity: 'mowing' } as Partial<DeviceState>
        case 'mower.set_stay_out_zone':
          return { stayOutZones: state.stayOutZones?.map((z) => (z.id === cmd.zoneId ? { ...z, enabled: cmd.enabled } : z)) } as Partial<DeviceState>
        default: return null
      }
    case 'ev_charger':
      if (cmd.type === 'ev_charger.stop') return { status: state.status === 'charging' ? 'connected' : state.status, powerW: 0 } as Partial<DeviceState>
      if (cmd.type === 'ev_charger.set_current') return { maxCurrentA: cmd.amps } as Partial<DeviceState>
      // choosing a mode lifts the manual override (the same mode under override is "resume")
      if (cmd.type === 'ev_charger.set_mode') return { chargeMode: cmd.mode, manualOverride: false } as Partial<DeviceState>
      return null
    case 'vehicle':
      switch (cmd.type) {
        case 'vehicle.lock': return { locked: true } as Partial<DeviceState>
        case 'vehicle.unlock': return { locked: false } as Partial<DeviceState>
        case 'vehicle.set_charge_limit': return { chargeLimit: cmd.percent } as Partial<DeviceState>
        case 'vehicle.stop_charge': return { charging: false } as Partial<DeviceState>
        // stopping only: a sleeping car's start waits for its wake-up, announcing it in advance would lie
        case 'vehicle.climate_stop': return { climateOn: false } as Partial<DeviceState>
        // a setting, for its part, only goes out with the car awake: the acknowledgment follows a second later
        case 'vehicle.climate_set': {
          const seats = Object.fromEntries(Object.entries(cmd.seatHeat ?? {}).filter(([, v]) => v !== undefined))
          return {
            ...(cmd.targetTempC !== undefined ? { climateTargetC: cmd.targetTempC } : {}),
            ...(Object.keys(seats).length ? { seatHeat: { ...state.seatHeat, ...seats } } : {}),
            ...(cmd.steeringWheelHeat !== undefined ? { steeringWheelHeat: cmd.steeringWheelHeat } : {}),
          } as Partial<DeviceState>
        }
        default: return null
      }
    case 'pet_feeder':
      // We do NOT advance the served counter: the machine may pour less than requested (hopper
      // almost empty), and a figure that then jumps is worse than no figure. "Dispensing"
      // is true in all cases, and the plugin's re-read follows a second later.
      return cmd.type === 'pet_feeder.feed' ? { feeding: true } as Partial<DeviceState> : null
    case 'pet_fountain':
      switch (cmd.type) {
        case 'pet_fountain.set_power': return { on: cmd.on } as Partial<DeviceState>
        // Setting the mode turns the pump back on: it is the same frame that carries both, and
        // the device would not know how to apply a mode while off.
        case 'pet_fountain.set_mode': return { mode: cmd.mode, on: true } as Partial<DeviceState>
        default: return null
      }
    case 'fan':
      if (cmd.type !== 'fan.set') return null
      return {
        ...(cmd.on !== undefined ? { on: cmd.on } : {}),
        // Writing the speed TURNS ON the fan (measured on the CREATE).
        ...(cmd.speed !== undefined ? { on: true, speed: cmd.speed } : {}),
        ...(cmd.direction !== undefined ? { direction: cmd.direction } : {}),
        ...(cmd.timerMin !== undefined ? { timerMin: cmd.timerMin } : {}),
        ...(cmd.muted !== undefined ? { muted: cmd.muted } : {}),
      } as Partial<DeviceState>
    default:
      return null
  }
}
