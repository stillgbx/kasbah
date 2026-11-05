import { calibratedToMotor, motorToCalibrated, type Capability, type CoverCalibration, type CoverClass } from '@kasbah/shared'
import { SimError, type SimDevice } from '../types'
import { clamp, descriptor } from './common'

export interface CoverOptions {
  name: string; deviceClass: CoverClass; position?: number; tilt?: boolean; speedPctPerS?: number; preset?: number; quiet?: boolean
  /** The shutter can be calibrated (`calibration` capability), like an io shutter at TaHoma. */
  calibratable?: boolean
}

/**
 * Model announced for each kind. A real plugin reads what the vendor declares (`uiClass` on
 * Overkiz); the simulation can only decide it, but it decides it DEVICE BY DEVICE, never from the
 * name: a gate controller does not announce itself as "Roller shutter".
 */
const MODELS: Record<CoverClass, string> = {
  shutter: 'Roller shutter', awning: 'Awning', blind: 'Venetian blind', curtain: 'Curtain rail',
  gate: 'Gate operator', garage: 'Garage door opener', window: 'Window opener',
}

/**
 * Cover: moves toward a target at constant speed (5 %/s by default), `stop` freezes it.
 *
 * `deviceClass` is MANDATORY, as with a real plugin: it is what travels in
 * `meta.cover.deviceClass` and decides the vocabulary, the drawn shape and the resting state
 * (`apps/web/src/lib/cover.ts`). Without it, all these rules would fall back on the shutter case
 * and could not be verified in simulation.
 *
 * The simulation moves the MOTOR (`motor`, contract scale). Without calibration the published
 * `position` is that value; with one, it is the real share of the window, the motor's value going to
 * `motorPosition` — what the TaHoma plugin does.
 */
export function cover(externalId: string, o: CoverOptions): SimDevice<'cover'> {
  const caps: Capability[] = ['open_close', 'position', 'stop']
  if (o.tilt) caps.push('tilt')
  // favorite position stored "in the motor": the simulation knows it, so it shows it,
  // and it can rewrite it — hence the two capabilities, like an io-homecontrol motor
  if (o.preset !== undefined) caps.push('preset', 'preset_set')
  // quiet mode: the motor can run at slow speed (half as fast here)
  if (o.quiet) caps.push('quiet')
  if (o.calibratable) caps.push('calibration')
  // the demo's quiet shutter is also SOLAR: it publishes its battery
  if (o.quiet) caps.push('battery')
  // the memory is MUTABLE: `cover.set_preset` rewrites it, and `cover.preset` follows the new value
  // (motor scale, like the motor's own memory)
  let preset = o.preset
  let motor = o.position ?? 100
  let calibration: CoverCalibration | null = null
  const speed = o.speedPctPerS ?? 5
  let target: number | null = null
  /** Real position last asked for, published as is when the motor stops where it was sent. */
  let requested: number | undefined
  const toMotor = (position: number) => (calibration ? calibratedToMotor(calibration, position) : position)

  /** Motor → published state, on the real scale when calibrated. */
  function publish(): void {
    const s = dev.state
    if (calibration) {
      const real = motorToCalibrated(calibration, motor, requested)
      s.position = real.position
      s.motorPosition = motor
      s.sealed = real.sealed
      s.calibration = calibration
      if (preset !== undefined) s.presetPosition = motorToCalibrated(calibration, preset).position
    } else {
      s.position = motor
      delete s.motorPosition
      delete s.sealed
      delete s.calibration
      if (preset !== undefined) s.presetPosition = preset
    }
  }

  const dev: SimDevice<'cover'> = {
    descriptor: descriptor(externalId, 'cover', o.name, caps, {
      manufacturer: 'Mock', model: MODELS[o.deviceClass], cover: { deviceClass: o.deviceClass },
    }),
    state: {
      kind: 'cover', updatedAt: 0, available: true, position: motor, motion: 'stopped',
      ...(o.tilt ? { tilt: 50 } : {}), ...(preset !== undefined ? { presetPosition: preset } : {}),
      ...(o.quiet ? { quiet: false, batteryPct: 86 } : {}),
    },
    tick(ctx) {
      if (target === null) return
      const delta = target - motor
      const step = (dev.state.quiet ? speed / 2 : speed) * ctx.dtS
      if (Math.abs(delta) <= step) {
        motor = target
        dev.state.motion = 'stopped'
        target = null
      } else {
        motor = clamp(Math.round((motor + Math.sign(delta) * step) * 100) / 100, 0, 100)
        dev.state.motion = delta > 0 ? 'opening' : 'closing'
      }
      publish()
      if (dev.state.motion !== 'stopped') ctx.world.loadsW += 120
    },
    apply(cmd) {
      if (cmd.type === 'cover.set_position') requested = cmd.motor ? undefined : cmd.position
      else if (cmd.type !== 'cover.set_tilt' && cmd.type !== 'cover.set_preset' && cmd.type !== 'cover.set_quiet') requested = undefined
      switch (cmd.type) {
        case 'cover.open': target = 100; break
        case 'cover.close': target = 0; break
        case 'cover.stop': target = null; dev.state.motion = 'stopped'; break
        case 'cover.set_position': target = cmd.motor ? cmd.position : toMotor(cmd.position); break
        case 'cover.preset':
          if (preset === undefined) throw new SimError('UNSUPPORTED_COMMAND', 'no preset')
          target = preset
          break
        case 'cover.set_preset':
          if (preset === undefined) throw new SimError('UNSUPPORTED_COMMAND', 'no preset')
          // rewriting the memory does NOT MOVE the cover: it is a setting, not a maneuver. Saving
          // the position shown saves where the motor IS (a sealed shutter and the sill both read 0)
          preset = calibration && motorToCalibrated(calibration, motor, requested).position === cmd.position ? motor : toMotor(cmd.position)
          publish()
          return
        case 'cover.set_quiet':
          if (!o.quiet) throw new SimError('UNSUPPORTED_COMMAND', 'no low speed')
          // a setting, not a maneuver: the cover does not move
          dev.state.quiet = cmd.on
          return
        case 'cover.set_calibration':
          if (!o.calibratable) throw new SimError('UNSUPPORTED_COMMAND', 'not calibratable')
          // a setting too: the motor stays where it is, only its reading changes
          calibration = cmd.points
          publish()
          return
        case 'cover.set_tilt':
          if (!o.tilt) throw new SimError('UNSUPPORTED_COMMAND', 'no tilt')
          dev.state.tilt = cmd.tilt
          break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on cover`)
      }
      if (target !== null && Math.abs(target - motor) < 1e-9) { target = null; dev.state.motion = 'stopped' }
      else if (target !== null) dev.state.motion = target > motor ? 'opening' : 'closing'
    },
  }
  return dev
}
