import type { ClimateClass, ClimateMode } from '@kasbah/shared'
import { SimError, type SimDevice } from '../types'
import { clamp, descriptor, round1 } from './common'

export interface ClimateOptions {
  name: string
  mode?: ClimateMode
  targetTempC?: number
  currentTempC?: number
  heatPowerW?: number
  /** Thermostat au mur ou pompe à chaleur au sol : ne décide que le marqueur 3D. Absent = rien déclaré. */
  deviceClass?: ClimateClass
}

/** PAC : l'intérieur tend vers la consigne (τ 20 min) ou vers l'extérieur (τ 4 h) si éteinte. */
export function climate(externalId: string, o: ClimateOptions): SimDevice<'climate'> {
  const heatPowerW = o.heatPowerW ?? 1800
  const dev: SimDevice<'climate'> = {
    descriptor: descriptor(externalId, 'climate', o.name, ['hvac_mode', 'target_temp', 'current_temp', 'humidity'], {
      manufacturer: 'Mock', model: o.deviceClass === 'thermostat' ? 'Thermostat' : 'Heat pump', targetTempC: [16, 28],
      ...(o.deviceClass ? { climate: { modes: ['off', 'heat', 'cool', 'auto', 'eco'], deviceClass: o.deviceClass } } : {}),
    }),
    state: {
      kind: 'climate', updatedAt: 0, available: true,
      mode: o.mode ?? 'heat', action: 'idle', targetTempC: o.targetTempC ?? 20, currentTempC: o.currentTempC ?? 19.5, humidity: 48,
    },
    tick(ctx) {
      const s = dev.state
      const outdoor = ctx.world.outdoorTempC
      const gap = s.targetTempC - s.currentTempC
      let action: typeof s.action = 'idle'
      if (s.mode === 'heat' || s.mode === 'auto' || s.mode === 'eco') { if (gap > 0.3) action = 'heating' }
      if (s.mode === 'cool' || s.mode === 'auto') { if (gap < -0.3) action = 'cooling' }
      if (s.mode === 'off') action = 'off'
      s.action = action
      const tau = action === 'heating' || action === 'cooling' ? 1200 : 14_400
      const goal = action === 'heating' || action === 'cooling' ? s.targetTempC : outdoor
      const k = 1 - Math.exp(-ctx.dtS / tau)
      s.currentTempC = round1(s.currentTempC + (goal - s.currentTempC) * k)
      s.humidity = round1(clamp((s.humidity ?? 48) + ((45 - (s.humidity ?? 48)) * k) / 4, 30, 70))
      if (action === 'heating' || action === 'cooling') ctx.world.loadsW += heatPowerW * (s.mode === 'eco' ? 0.6 : 1)
      else if (action !== 'off') ctx.world.loadsW += 25
    },
    apply(cmd) {
      switch (cmd.type) {
        case 'climate.set_mode': dev.state.mode = cmd.mode; break
        case 'climate.set_target_temp': dev.state.targetTempC = clamp(Math.round(cmd.targetTempC * 2) / 2, 16, 28); break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on climate`)
      }
    },
  }
  return dev
}
