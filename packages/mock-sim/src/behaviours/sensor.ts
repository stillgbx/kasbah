import type { SensorClass } from '@kasbah/shared'
import type { SimDevice, TickCtx } from '../types'
import { descriptor, round1 } from './common'

export interface SensorOptions {
  name: string
  unit: string
  deviceClass: SensorClass
  precision?: number
  /** Target value on each tick; the sensor tends toward it with the time constant `tauS` (0 = instantaneous). */
  target: (ctx: TickCtx, previous: number) => number
  initial: number
  tauS?: number
  noise?: number
  /** Main device this sensor is physically part of (`meta.linkedTo`). */
  linkedTo?: string
}

export function sensor(externalId: string, o: SensorOptions): SimDevice<'sensor'> {
  const p = o.precision ?? 1
  const roundP = (v: number) => Math.round(v * 10 ** p) / 10 ** p
  const dev: SimDevice<'sensor'> = {
    descriptor: descriptor(externalId, 'sensor', o.name, ['measure'], {
      manufacturer: 'Mock', sensor: { unit: o.unit, deviceClass: o.deviceClass, precision: p },
      ...(o.linkedTo ? { linkedTo: o.linkedTo } : {}),
    }),
    state: { kind: 'sensor', updatedAt: 0, available: true, value: o.initial },
    tick(ctx) {
      const target = o.target(ctx, dev.state.value) + (o.noise ? (ctx.rng() - 0.5) * 2 * o.noise : 0)
      const tau = o.tauS ?? 0
      const k = tau <= 0 ? 1 : 1 - Math.exp(-ctx.dtS / tau)
      dev.state.value = roundP(dev.state.value + (target - dev.state.value) * k)
    },
  }
  return dev
}

/** Ready-to-use sensors. */
export const sensors = {
  /** Panel of a solar shutter: the illuminance follows the sunshine (~40,000 lx in full sun). */
  shutterLight: (id: string, name: string, coverId: string) => sensor(id, {
    name, unit: 'lx', deviceClass: 'illuminance', precision: 0, initial: 0, tauS: 120, linkedTo: coverId,
    target: (ctx) => Math.max(0, ctx.world.irradiance * 40_000),
  }),
  outdoorTemp: (id: string, name: string) => sensor(id, {
    name, unit: '°C', deviceClass: 'temperature', initial: 18, tauS: 600, noise: 0.15,
    target: (ctx) => ctx.world.outdoorTempC,
  }),
  indoorTemp: (id: string, name: string, base = 20.5) => sensor(id, {
    name, unit: '°C', deviceClass: 'temperature', initial: base, tauS: 3600, noise: 0.05,
    target: (ctx) => base + (ctx.world.outdoorTempC - base) * 0.15,
  }),
  poolTemp: (id: string, name: string) => sensor(id, {
    name, unit: '°C', deviceClass: 'temperature', initial: 24, tauS: 6 * 3600, noise: 0.02,
    target: (ctx) => round1(ctx.world.outdoorTempC * 0.6 + 12 + ctx.world.irradiance * 3),
  }),
  filtrationPressure: (id: string, name: string) => sensor(id, {
    name, unit: 'bar', deviceClass: 'pressure', initial: 1.1, precision: 2, tauS: 60, noise: 0.01,
    // the pump runs 8 am → 8 pm; the pressure slowly rises as the filter clogs
    target: (ctx) => (ctx.hour >= 8 && ctx.hour < 20 ? 1.1 + ((ctx.simTime / 86_400_000) % 14) * 0.02 : 0.05),
  }),
  waterFlow: (id: string, name: string) => sensor(id, {
    name, unit: 'm³/h', deviceClass: 'flow', initial: 0, tauS: 30, noise: 0.1,
    target: (ctx) => (ctx.hour >= 8 && ctx.hour < 20 ? 14 : 0),
  }),
}
