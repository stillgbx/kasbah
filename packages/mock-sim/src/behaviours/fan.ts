import type { Command, DeviceId } from '@kasbah/shared'
import { SimError, type SimDevice, type TickCtx } from '../types'
import { descriptor } from './common'

// Ventilateur de plafond (type CREATE / Tuya). Reproduit les deux comportements mesurés :
// régler la vitesse ALLUME, et éteindre EFFACE la minuterie.

export const FAN_SPEEDS = [1, 2, 3, 4, 5, 6]

export interface CeilingFanOptions {
  name: string
  /** Id du descripteur lumière liée (`mock:<id>`). */
  linkedLightId?: string
  speeds?: number[]
}

export function ceilingFan(externalId: string, o: CeilingFanOptions): SimDevice<'fan'> {
  const speeds = o.speeds ?? FAN_SPEEDS
  const lightId = (o.linkedLightId ?? `mock:${externalId.replace(/_fan$/, '_light')}`) as DeviceId

  const dev: SimDevice<'fan'> = {
    descriptor: descriptor(externalId, 'fan', o.name, ['on_off', 'fan_speed', 'fan_direction', 'fan_timer', 'mute'], {
      manufacturer: 'CREATE / Tuya',
      model: 'Windcalm (sim)',
      fan: { speeds },
      linkedTo: lightId,
    }),
    state: {
      kind: 'fan', updatedAt: 0, available: true,
      on: false, speed: 3, direction: 'forward', timerMin: 0, muted: true,
    },
    tick(_ctx: TickCtx) { /* état tenu par apply */ },
    apply(cmd: Command) {
      if (cmd.type !== 'fan.set') throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on fan`)
      const s = dev.state
      if (cmd.on !== undefined) {
        s.on = cmd.on
        if (!cmd.on) s.timerMin = 0
      }
      if (cmd.speed !== undefined) {
        if (!speeds.includes(cmd.speed)) throw new SimError('UNSUPPORTED_COMMAND', `speed ${cmd.speed}`)
        s.speed = cmd.speed
        s.on = true
      }
      if (cmd.direction !== undefined) s.direction = cmd.direction
      if (cmd.timerMin !== undefined) s.timerMin = cmd.timerMin
      if (cmd.muted !== undefined) s.muted = cmd.muted
    },
  }
  return dev
}

/** Lumière 3CCT non dimmable liée au ventilateur. */
export function ceilingFanLight(externalId: string, o: { name: string }): SimDevice<'light'> {
  const steps = [370, 303, 250]
  const dev: SimDevice<'light'> = {
    descriptor: descriptor(externalId, 'light', o.name, ['on_off', 'color_temp'], {
      manufacturer: 'CREATE / Tuya',
      model: 'Windcalm (sim)',
      colorTempMirekSteps: steps,
    }),
    state: {
      kind: 'light', updatedAt: 0, available: true,
      on: true, colorTempMirek: 303,
    },
    tick(_ctx: TickCtx) { /* état tenu par apply */ },
    apply(cmd: Command) {
      if (cmd.type !== 'light.set') throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on light`)
      const s = dev.state
      if (cmd.on !== undefined) s.on = cmd.on
      if (cmd.colorTempMirek !== undefined) {
        if (!steps.includes(cmd.colorTempMirek)) {
          throw new SimError('UNSUPPORTED_COMMAND', `colorTemp ${cmd.colorTempMirek}`)
        }
        s.colorTempMirek = cmd.colorTempMirek
      }
      if (cmd.brightness !== undefined || cmd.color !== undefined || cmd.effect !== undefined) {
        throw new SimError('UNSUPPORTED_COMMAND', 'no brightness/color/effect')
      }
    },
  }
  return dev
}
