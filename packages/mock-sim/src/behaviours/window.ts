import type { Capability } from '@kasbah/shared'
import { SimError, type SimDevice } from '../types'
import { clamp, descriptor } from './common'

export interface WindowOptions { name: string; position?: number; quiet?: boolean }

/**
 * Motorized window (a Velux roof window): moves toward a target at 5 %/s, `stop` freezes it,
 * quiet mode halves the speed. Its own kind, not a cover: a group gesture on the shutters never
 * reaches it.
 */
export function motorWindow(externalId: string, o: WindowOptions): SimDevice<'window'> {
  const caps: Capability[] = ['open_close', 'position', 'stop']
  if (o.quiet) caps.push('quiet')
  const speed = 5
  let target: number | null = null
  const dev: SimDevice<'window'> = {
    descriptor: descriptor(externalId, 'window', o.name, caps, { manufacturer: 'Mock', model: 'Roof window' }),
    state: {
      kind: 'window', updatedAt: 0, available: true, position: o.position ?? 0, motion: 'stopped',
      ...(o.quiet ? { quiet: false } : {}),
    },
    tick(ctx) {
      if (target === null) return
      const position = dev.state.position ?? 0
      const delta = target - position
      const step = (dev.state.quiet ? speed / 2 : speed) * ctx.dtS
      if (Math.abs(delta) <= step) {
        dev.state.position = target
        dev.state.motion = 'stopped'
        target = null
      } else {
        dev.state.position = clamp(Math.round((position + Math.sign(delta) * step) * 100) / 100, 0, 100)
        dev.state.motion = delta > 0 ? 'opening' : 'closing'
        ctx.world.loadsW += 40
      }
    },
    apply(cmd) {
      switch (cmd.type) {
        case 'window.open': target = 100; break
        case 'window.close': target = 0; break
        case 'window.stop': target = null; dev.state.motion = 'stopped'; return
        case 'window.set_position': target = cmd.position; break
        case 'window.set_quiet':
          if (!o.quiet) throw new SimError('UNSUPPORTED_COMMAND', 'no low speed')
          // a setting, not a maneuver: the window does not move
          dev.state.quiet = cmd.on
          return
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on window`)
      }
      const position = dev.state.position ?? 0
      if (Math.abs(target - position) < 1e-9) { target = null; dev.state.motion = 'stopped' }
      else dev.state.motion = target > position ? 'opening' : 'closing'
    },
  }
  return dev
}
