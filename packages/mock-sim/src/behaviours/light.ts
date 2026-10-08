import type { Capability } from '@kasbah/shared'
import { SimError, type SimDevice, type TickCtx } from '../types'
import { descriptor } from './common'

export interface LightOptions {
  name: string
  dimmable?: boolean
  colorTemp?: boolean
  color?: boolean
  on?: boolean
  brightness?: number
  /** Puissance consommée à pleine luminosité (W), déclarée au monde. */
  powerW?: number
  /** Effets du fabricant (« bougie », « feu de cheminée ») : déclare la capacité `effect`. */
  effects?: string[]
}

export function light(externalId: string, o: LightOptions): SimDevice<'light'> {
  const caps: Capability[] = ['on_off']
  if (o.dimmable ?? true) caps.push('brightness')
  if (o.colorTemp) caps.push('color_temp')
  if (o.color) caps.push('color')
  if (o.effects?.length) caps.push('effect')
  let transition: { from: number; to: number; left: number; total: number } | null = null
  const dev: SimDevice<'light'> = {
    descriptor: descriptor(externalId, 'light', o.name, caps, {
      manufacturer: 'Mock', model: o.color ? 'Color bulb' : 'White bulb',
      ...(o.colorTemp ? { colorTempMirek: [153, 500] as [number, number] } : {}),
      // `no_effect` en premier, comme le contrat le demande : c'est l'entrée qui arrête l'effet
      ...(o.effects?.length ? { effects: ['no_effect', ...o.effects] } : {}),
    }),
    state: {
      kind: 'light', updatedAt: 0, available: true,
      on: o.on ?? false,
      ...(caps.includes('brightness') ? { brightness: o.brightness ?? 80 } : {}),
      ...(o.colorTemp ? { colorTempMirek: 366 } : {}),
      ...(o.color ? { color: { x: 0.4573, y: 0.41 } } : {}),
      ...(o.effects?.length ? { effect: 'no_effect' } : {}),
    },
    tick(ctx: TickCtx) {
      if (transition) {
        transition.left = Math.max(0, transition.left - ctx.dtS * 1000)
        const k = transition.total === 0 ? 1 : 1 - transition.left / transition.total
        dev.state.brightness = Math.round(transition.from + (transition.to - transition.from) * k)
        if (transition.left === 0) transition = null
      }
      if (dev.state.on) ctx.world.loadsW += (o.powerW ?? 9) * ((dev.state.brightness ?? 100) / 100)
    },
    apply(cmd) {
      if (cmd.type !== 'light.set') throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on light`)
      if (cmd.on !== undefined) dev.state.on = cmd.on
      if (cmd.brightness !== undefined && caps.includes('brightness')) {
        if (cmd.brightness === 0) dev.state.on = false
        else {
          dev.state.on = true
          if (cmd.transitionMs && cmd.transitionMs > 0) {
            transition = { from: dev.state.brightness ?? 0, to: cmd.brightness, left: cmd.transitionMs, total: cmd.transitionMs }
          } else { transition = null; dev.state.brightness = cmd.brightness }
        }
      }
      if (cmd.colorTempMirek !== undefined && o.colorTemp) dev.state.colorTempMirek = Math.min(500, Math.max(153, cmd.colorTempMirek))
      if (cmd.color !== undefined && o.color) dev.state.color = { ...cmd.color }
      if (cmd.effect !== undefined && o.effects?.length) {
        if (cmd.effect !== 'no_effect' && !o.effects.includes(cmd.effect)) throw new SimError('UNSUPPORTED_COMMAND', `unknown effect "${cmd.effect}"`)
        dev.state.effect = cmd.effect
        if (cmd.effect !== 'no_effect') dev.state.on = true
      }
    },
  }
  return dev
}
