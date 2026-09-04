import type { Capability } from '@kasbah/shared'
import { SimError, type SimDevice } from '../types'
import { clamp, descriptor } from './common'

export interface CoverOptions { name: string; position?: number; tilt?: boolean; speedPctPerS?: number }

/** Volet : se déplace vers une cible à vitesse constante (5 %/s par défaut), `stop` fige. */
export function cover(externalId: string, o: CoverOptions): SimDevice<'cover'> {
  const caps: Capability[] = ['position', 'stop']
  if (o.tilt) caps.push('tilt')
  const speed = o.speedPctPerS ?? 5
  let target: number | null = null
  const dev: SimDevice<'cover'> = {
    descriptor: descriptor(externalId, 'cover', o.name, caps, { manufacturer: 'Mock', model: 'Roller shutter' }),
    state: { kind: 'cover', updatedAt: 0, available: true, position: o.position ?? 100, motion: 'stopped', ...(o.tilt ? { tilt: 50 } : {}) },
    tick(ctx) {
      if (target === null) return
      const delta = target - dev.state.position
      const step = speed * ctx.dtS
      if (Math.abs(delta) <= step) {
        dev.state.position = target
        dev.state.motion = 'stopped'
        target = null
      } else {
        dev.state.position = clamp(Math.round((dev.state.position + Math.sign(delta) * step) * 100) / 100, 0, 100)
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
        case 'cover.set_tilt':
          if (!o.tilt) throw new SimError('UNSUPPORTED_COMMAND', 'no tilt')
          dev.state.tilt = cmd.tilt
          break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on cover`)
      }
      if (target !== null && Math.abs(target - dev.state.position) < 1e-9) { target = null; dev.state.motion = 'stopped' }
      else if (target !== null) dev.state.motion = target > dev.state.position ? 'opening' : 'closing'
    },
  }
  return dev
}
