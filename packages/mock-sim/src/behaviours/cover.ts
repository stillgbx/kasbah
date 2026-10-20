import type { Capability, CoverClass } from '@kasbah/shared'
import { SimError, type SimDevice } from '../types'
import { clamp, descriptor } from './common'

export interface CoverOptions { name: string; deviceClass: CoverClass; position?: number; tilt?: boolean; speedPctPerS?: number; preset?: number; quiet?: boolean }

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
 */
export function cover(externalId: string, o: CoverOptions): SimDevice<'cover'> {
  const caps: Capability[] = ['open_close', 'position', 'stop']
  if (o.tilt) caps.push('tilt')
  // favorite position stored "in the motor": the simulation knows it, so it shows it,
  // and it can rewrite it — hence the two capabilities, like an io-homecontrol motor
  if (o.preset !== undefined) caps.push('preset', 'preset_set')
  // quiet mode: the motor can run at slow speed (half as fast here)
  if (o.quiet) caps.push('quiet')
  // the demo's quiet shutter is also SOLAR: it publishes its battery
  if (o.quiet) caps.push('battery')
  // the memory is MUTABLE: `cover.set_preset` rewrites it, and `cover.preset` follows the new value
  let preset = o.preset
  const speed = o.speedPctPerS ?? 5
  let target: number | null = null
  const dev: SimDevice<'cover'> = {
    descriptor: descriptor(externalId, 'cover', o.name, caps, {
      manufacturer: 'Mock', model: MODELS[o.deviceClass], cover: { deviceClass: o.deviceClass },
    }),
    state: {
      kind: 'cover', updatedAt: 0, available: true, position: o.position ?? 100, motion: 'stopped',
      ...(o.tilt ? { tilt: 50 } : {}), ...(preset !== undefined ? { presetPosition: preset } : {}),
      ...(o.quiet ? { quiet: false, batteryPct: 86 } : {}),
    },
    // `position` is optional in the contract (a one-way radio does not know it),
    // but the simulation sets it at startup and never clears it: hence the `!` below.
    tick(ctx) {
      if (target === null) return
      const delta = target - dev.state.position!
      const step = (dev.state.quiet ? speed / 2 : speed) * ctx.dtS
      if (Math.abs(delta) <= step) {
        dev.state.position = target
        dev.state.motion = 'stopped'
        target = null
      } else {
        dev.state.position = clamp(Math.round((dev.state.position! + Math.sign(delta) * step) * 100) / 100, 0, 100)
        dev.state.motion = delta > 0 ? 'opening' : 'closing'
      }
      if (dev.state.motion !== 'stopped') ctx.world.loadsW += 120
    },
    apply(cmd) {
      switch (cmd.type) {
        case 'cover.open': target = 100; break
        case 'cover.close': target = 0; break
        case 'cover.stop': target = null; dev.state.motion = 'stopped'; break
        case 'cover.set_position': target = cmd.position; break
        case 'cover.preset':
          if (preset === undefined) throw new SimError('UNSUPPORTED_COMMAND', 'no preset')
          target = preset
          break
        case 'cover.set_preset':
          if (preset === undefined) throw new SimError('UNSUPPORTED_COMMAND', 'no preset')
          // rewriting the memory does NOT MOVE the cover: it is a setting, not a maneuver
          preset = cmd.position
          dev.state.presetPosition = cmd.position
          return
        case 'cover.set_quiet':
          if (!o.quiet) throw new SimError('UNSUPPORTED_COMMAND', 'no low speed')
          // a setting, not a maneuver: the cover does not move
          dev.state.quiet = cmd.on
          return
        case 'cover.set_tilt':
          if (!o.tilt) throw new SimError('UNSUPPORTED_COMMAND', 'no tilt')
          dev.state.tilt = cmd.tilt
          break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on cover`)
      }
      if (target !== null && Math.abs(target - dev.state.position!) < 1e-9) { target = null; dev.state.motion = 'stopped' }
      else if (target !== null) dev.state.motion = target > dev.state.position! ? 'opening' : 'closing'
    },
  }
  return dev
}
