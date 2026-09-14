import { SimError, type SimDevice } from '../types'
import { clamp, descriptor, inWindow } from './common'

// Véhicule + borne. Le véhicule part le matin (trajet 25 min), revient le soir, se branche
// automatiquement au retour. La borne lit l'état du véhicule associé via ctx.getState.

export interface VehicleOptions {
  name: string
  manufacturer?: string
  model?: string
  batteryKwh?: number
  rangeKmFull?: number
  home: { lat: number; lon: number }
  work: { lat: number; lon: number }
  /** Jours ouvrés de départ (0 = dimanche). */
  workDays?: number[]
  leaveHour?: number
  returnHour?: number
  soc?: number
  chargeLimit?: number
  /** Plancher de charge voulu, quand le fabricant a cette notion (Renault ; Tesla ne l'a pas). */
  socMin?: number
  /** Puissance de la borne qui le charge quand branché (W) ; 0 = jamais chargé par cette sim. */
  chargerPowerW?: number
}

export function vehicle(externalId: string, o: VehicleOptions): SimDevice<'vehicle'> {
  const batteryKwh = o.batteryKwh ?? 75, rangeFull = o.rangeKmFull ?? 450
  const workDays = o.workDays ?? [1, 2, 3, 4, 5], leave = o.leaveHour ?? 8.5, back = o.returnHour ?? 18.25
  const tripMin = 25
  let phase: 'home' | 'toWork' | 'work' | 'toHome' = 'home'
  let tripProgress = 0
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  /** Cap (0 = nord, horaire) de `a` vers `b`, en plan : assez pour orienter le marqueur d'une simulation. */
  const bearing = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), dy = b.lat - a.lat
    return Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360)
  }
  const setLocation = (t: number, at: number, s: SimDevice<'vehicle'>['state']) => {
    s.location = { lat: lerp(o.home.lat, o.work.lat, t), lon: lerp(o.home.lon, o.work.lon, t), at }
  }
  const dev: SimDevice<'vehicle'> = {
    descriptor: descriptor(externalId, 'vehicle', o.name, [
      'soc', 'range', 'location', 'lock', 'charging', 'charge_limit',
      // pas de borne, pas de puissance à dire : ce véhicule-là se fait estimer comme une vraie R5
      ...((o.chargerPowerW ?? 7400) > 0 ? ['charge_power' as const] : []),
    ], {
      manufacturer: o.manufacturer ?? 'Mock', model: o.model ?? 'EV',
    }),
    state: {
      kind: 'vehicle', updatedAt: 0, available: true,
      soc: o.soc ?? 72, rangeKm: Math.round(((o.soc ?? 72) / 100) * rangeFull), pluggedIn: true, charging: false,
      locked: true, chargeLimit: o.chargeLimit ?? 80, ...(o.socMin === undefined ? {} : { socMin: o.socMin }),
      location: { lat: o.home.lat, lon: o.home.lon, at: 0 }, odometerKm: 24_310,
      // ce qu'un vrai véhicule connecté dit aussi : la simulation le fournit pour que l'UI s'essaie dessus
      sleepState: 'asleep', gear: 'P', speedKmh: 0, headingDeg: bearing(o.home, o.work),
      tirePressureBar: { fl: 2.9, fr: 2.9, rl: 2.95, rr: 2.95 }, insideTempC: 21.5, outsideTempC: 17,
    },
    tick(ctx) {
      const s = dev.state
      const workday = workDays.includes(ctx.dow)
      const inWorkWindow = workday && inWindow(ctx.hour, leave, back)
      if (phase === 'home' && inWorkWindow && ctx.hour < back - 0.5) { phase = 'toWork'; tripProgress = 0; s.pluggedIn = false; s.charging = false }
      if (phase === 'work' && !inWorkWindow) { phase = 'toHome'; tripProgress = 0 }
      if (phase === 'toWork' || phase === 'toHome') {
        tripProgress = clamp(tripProgress + ctx.dtS / (tripMin * 60), 0, 1)
        const t = phase === 'toWork' ? tripProgress : 1 - tripProgress
        setLocation(t, ctx.simTime, s)
        s.soc = clamp(s.soc - (18 / (tripMin * 60)) * ctx.dtS * 0.5, 0, 100)   // ≈ 9 % par trajet
        s.odometerKm = Math.round(((s.odometerKm ?? 0) + (32 / (tripMin * 60)) * ctx.dtS) * 10) / 10
        if (tripProgress >= 1) {
          if (phase === 'toWork') phase = 'work'
          else { phase = 'home'; s.pluggedIn = true }
        }
      }
      if (phase === 'home') setLocation(0, ctx.simTime, s)
      if (phase === 'work') setLocation(1, ctx.simTime, s)
      const power = o.chargerPowerW ?? 7400
      s.charging = phase === 'home' && s.pluggedIn && power > 0 && s.soc < (s.chargeLimit ?? 80) - 0.01
      if (s.charging) {
        s.soc = clamp(s.soc + ((power * ctx.dtS) / 3600 / (batteryKwh * 1000)) * 100, 0, s.chargeLimit ?? 80)
        s.chargePowerW = power
        // ce qu'un vrai véhicule estime lui-même : le temps qu'il reste à la puissance du moment
        s.chargeMinutesRemaining = Math.round((((s.chargeLimit ?? 80) - s.soc) / 100 * batteryKwh * 1000 * 60) / power)
        ctx.world.loadsW += power
      } else { s.chargePowerW = 0; delete s.chargeMinutesRemaining }
      s.soc = Math.round(s.soc * 10) / 10
      s.rangeKm = Math.round((s.soc / 100) * rangeFull)
      // en route : rapport D et vitesse moyenne du trajet ; garé : P, 0 — et il s'endort dès qu'il ne fait rien
      const driving = phase === 'toWork' || phase === 'toHome'
      s.gear = driving ? 'D' : 'P'
      if (driving) s.headingDeg = phase === 'toWork' ? bearing(o.home, o.work) : bearing(o.work, o.home)
      s.speedKmh = driving ? Math.round((32 / tripMin) * 60) : 0
      s.sleepState = driving || s.charging ? 'online' : 'asleep'
      s.readAt = ctx.simTime
    },
    apply(cmd) {
      const s = dev.state
      switch (cmd.type) {
        case 'vehicle.lock': s.locked = true; break
        case 'vehicle.unlock': s.locked = false; break
        case 'vehicle.start_charge': if (!s.pluggedIn) throw new SimError('DEVICE_UNAVAILABLE', 'vehicle not plugged in'); s.chargeLimit = Math.max(s.chargeLimit ?? 80, Math.min(100, s.soc + 10)); break
        case 'vehicle.stop_charge': s.chargeLimit = Math.floor(s.soc); break
        case 'vehicle.set_charge_limit': s.chargeLimit = clamp(Math.round(cmd.percent), 50, 100); break
        case 'vehicle.wake': s.sleepState = 'online'; break
        case 'vehicle.refresh': break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on vehicle`)
      }
    },
  }
  return dev
}

export interface ChargerOptions { name: string; vehicleId: string; maxCurrentA?: number }

/** Borne : reflète l'état de charge du véhicule associé ; start/stop agissent sur la limite du véhicule. */
export function evCharger(externalId: string, o: ChargerOptions): SimDevice<'ev_charger'> {
  let enabled = true, sessionWh = 0, wasCharging = false
  const dev: SimDevice<'ev_charger'> = {
    descriptor: descriptor(externalId, 'ev_charger', o.name, ['charge_control', 'charge_current'], { manufacturer: 'Mock', model: 'Wallbox' }),
    state: { kind: 'ev_charger', updatedAt: 0, available: true, status: 'connected', powerW: 0, sessionWh: 0, maxCurrentA: o.maxCurrentA ?? 32 },
    tick(ctx) {
      const v = ctx.getState(o.vehicleId)
      const s = dev.state
      if (!v || v.kind !== 'vehicle') { s.status = 'error'; s.powerW = 0; return }
      if (!v.pluggedIn) { s.status = 'disconnected'; s.powerW = 0; sessionWh = 0; wasCharging = false }
      else if (v.charging && enabled) {
        if (!wasCharging) sessionWh = 0
        s.status = 'charging'; s.powerW = v.chargePowerW ?? 0
        sessionWh += (s.powerW * ctx.dtS) / 3600
        wasCharging = true
      } else { s.status = wasCharging ? 'finished' : 'connected'; s.powerW = 0 }
      s.sessionWh = Math.round(sessionWh)
    },
    apply(cmd) {
      switch (cmd.type) {
        case 'ev_charger.start': enabled = true; break
        case 'ev_charger.stop': enabled = false; break
        case 'ev_charger.set_current': dev.state.maxCurrentA = clamp(Math.round(cmd.amps), 6, 32); break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on ev_charger`)
      }
    },
  }
  return dev
}
