import type { DeviceMeta, ReleaseNote, VehicleSeat } from '@kasbah/shared'
import { SimError, type SimDevice } from '../types'
import { clamp, descriptor, inWindow } from './common'

// Vehicle + charger. The vehicle leaves in the morning (25 min trip), comes back in the evening, and
// plugs in automatically on return. The charger reads the state of the associated vehicle via ctx.getState.

export interface VehicleOptions {
  name: string
  manufacturer?: string
  model?: string
  batteryKwh?: number
  rangeKmFull?: number
  home: { lat: number; lon: number }
  work: { lat: number; lon: number }
  /** Working days of departure (0 = Sunday). */
  workDays?: number[]
  leaveHour?: number
  returnHour?: number
  soc?: number
  chargeLimit?: number
  /** Wanted charge floor, when the vendor has that notion (Renault; Tesla does not). */
  socMin?: number
  /** Power of the charger that charges it when plugged in (W); 0 = never charged by this sim. */
  chargerPowerW?: number
  /** What its climate control can do (`meta.vehicle.climate`); default: that of a Tesla. */
  climate?: ClimateFeatures
  /**
   * Software, like a Tesla: installed version and, if there is one, the update already downloaded
   * (`pending`). Declares `release_notes` and `software_update`; without it, neither.
   */
  software?: { version: string; pending?: string; notes?: Record<string, Record<string, ReleaseNote[]>> }
}

/** Countdown left by "Install now" before the installation starts (simulated seconds). */
const NOW_COUNTDOWN_S = 120
/** Woken on demand, it stays awake that long (simulated): a Tesla falls back asleep after a quarter of an hour. */
const AWAKE_AFTER_WAKE_MS = 10 * 60_000

/**
 * Simulated notes, by LANGUAGE then by version: enough to try out the notes box, its history and
 * the fallback to English without an account. English is complete, French too (as with Tesla).
 */
const SAMPLE_NOTES: Record<string, Record<string, ReleaseNote[]>> = {
  en: {
    '2026.38': [
      { title: 'Supercharger Site Maps', description: 'Tap “View Site Map” to see the charger layout and live occupancy on arrival.' },
      { title: 'Security Improvements', description: 'This update includes important security fixes and improvements.' },
    ],
    '2026.32': [
      { title: 'Apple Music', description: 'Go to Search, select Apple Music, then tap Library to find your songs, albums and playlists.' },
      { title: 'Security Improvements', description: 'This update includes important security fixes and improvements.' },
    ],
    '2026.26.6': [
      { title: 'Automatic Navigation', description: 'Automatic Navigation adapts to your routine and suggests the places you visit regularly, when Destination Suggestions are enabled.' },
      { title: 'Speed Cameras on Route', description: 'Navigation shows speed cameras along your route. Requires Premium Connectivity.' },
      { title: 'Supercharger Search', description: 'You can now find Superchargers by name.' },
    ],
  },
  fr: {
  '2026.38': [
    { title: 'Plans des Superchargeurs', description: 'Touchez « Voir le plan du site » pour voir la disposition des bornes et leur occupation à l’arrivée.' },
    { title: 'Améliorations de la sécurité', description: 'Cette mise à jour comprend des correctifs et améliorations de sécurité importants.' },
  ],
  '2026.32': [
    { title: 'Apple Music', description: 'Allez dans Recherche, choisissez Apple Music, puis Bibliothèque pour retrouver vos titres, albums et listes.' },
    { title: 'Améliorations de la sécurité', description: 'Cette mise à jour comprend des correctifs et améliorations de sécurité importants.' },
  ],
  '2026.26.6': [
    { title: 'Navigation automatique', description: 'La navigation automatique s’adapte à vos habitudes et propose les lieux où vous allez souvent, quand les suggestions de destination sont activées.' },
    { title: 'Radars sur l’itinéraire', description: 'La navigation affiche les radars le long de votre itinéraire. Nécessite la Connectivité Premium.' },
    { title: 'Recherche de Superchargeurs', description: 'Vous pouvez maintenant chercher un Superchargeur par son nom.' },
  ],
  },
}
const versionOrder = (a: string, b: string) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? -1) !== (pb[i] ?? -1)) return (pa[i] ?? -1) - (pb[i] ?? -1)
  return 0
}

type ClimateFeatures = NonNullable<NonNullable<DeviceMeta['vehicle']>['climate']>
const TESLA_CLIMATE: ClimateFeatures = { minC: 15, maxC: 28, stepC: 0.5, seats: ['fl', 'fr', 'rl', 'rc', 'rr'] as VehicleSeat[], seatLevels: 3, steeringWheelHeat: true }

export function vehicle(externalId: string, o: VehicleOptions): SimDevice<'vehicle'> {
  const batteryKwh = o.batteryKwh ?? 75, rangeFull = o.rangeKmFull ?? 450
  const workDays = o.workDays ?? [1, 2, 3, 4, 5], leave = o.leaveHour ?? 8.5, back = o.returnHour ?? 18.25
  const tripMin = 25
  let phase: 'home' | 'toWork' | 'work' | 'toHome' = 'home'
  let tripProgress = 0
  let awakeUntil = 0
  let installStartedAt = 0
  const notesIn = o.software?.notes ?? SAMPLE_NOTES
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  /** Heading (0 = north, clockwise) from `a` to `b`, in plan: enough to orient a simulation's marker. */
  const bearing = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), dy = b.lat - a.lat
    return Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360)
  }
  const setLocation = (t: number, at: number, s: SimDevice<'vehicle'>['state']) => {
    s.location = { lat: lerp(o.home.lat, o.work.lat, t), lon: lerp(o.home.lon, o.work.lon, t), at }
  }
  const dev: SimDevice<'vehicle'> = {
    descriptor: descriptor(externalId, 'vehicle', o.name, [
      'soc', 'range', 'location', 'lock', 'charging', 'charge_limit', 'climate_precondition',
      // no charger, no power to report: this vehicle gets estimated like a real R5
      ...((o.chargerPowerW ?? 7400) > 0 ? ['charge_power' as const] : []),
      ...(o.software ? ['release_notes' as const, 'software_update' as const] : []),
    ], {
      manufacturer: o.manufacturer ?? 'Mock', model: o.model ?? 'EV', vehicle: { climate: o.climate ?? TESLA_CLIMATE },
    }),
    state: {
      kind: 'vehicle', updatedAt: 0, available: true,
      soc: o.soc ?? 72, rangeKm: Math.round(((o.soc ?? 72) / 100) * rangeFull), pluggedIn: true, charging: false,
      locked: true, chargeLimit: o.chargeLimit ?? 80, ...(o.socMin === undefined ? {} : { socMin: o.socMin }),
      location: { lat: o.home.lat, lon: o.home.lon, at: 0 }, odometerKm: 24_310,
      // what a real connected vehicle also reports: the simulation provides it so the UI can try itself on it
      sleepState: 'asleep', gear: 'P', speedKmh: 0, headingDeg: bearing(o.home, o.work),
      tirePressureBar: { fl: 2.9, fr: 2.9, rl: 2.95, rr: 2.95 }, insideTempC: 21.5, outsideTempC: 17,
      climateOn: false, climateTargetC: 20, steeringWheelHeat: false,
      seatHeat: Object.fromEntries((o.climate ?? TESLA_CLIMATE).seats.map((k) => [k, 0])),
      ...(o.software ? { softwareVersion: o.software.version } : {}),
      ...(o.software?.pending ? { softwareUpdate: { status: 'available' as const, version: o.software.pending, expectedDurationS: 1200 } } : {}),
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
        s.soc = clamp(s.soc - (18 / (tripMin * 60)) * ctx.dtS * 0.5, 0, 100)   // ≈ 9 % per trip
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
        // what a real vehicle estimates by itself: the time left at the current power
        s.chargeMinutesRemaining = Math.round((((s.chargeLimit ?? 80) - s.soc) / 100 * batteryKwh * 1000 * 60) / power)
        ctx.world.loadsW += power
      } else { s.chargePowerW = 0; delete s.chargeMinutesRemaining }
      s.soc = Math.round(s.soc * 10) / 10
      s.rangeKm = Math.round((s.soc / 100) * rangeFull)
      // on the road: gear D and average speed of the trip; parked: P, 0 — and it falls asleep as soon as it does nothing
      const driving = phase === 'toWork' || phase === 'toHome'
      s.gear = driving ? 'D' : 'P'
      if (driving) s.headingDeg = phase === 'toWork' ? bearing(o.home, o.work) : bearing(o.work, o.home)
      s.speedKmh = driving ? Math.round((32 / tripMin) * 60) : 0
      // a scheduled installation starts at its time, and the car stays awake until the end.
      // New object on every change: the mock's diff compares references
      const su = s.softwareUpdate
      if (su?.status === 'scheduled' && su.scheduledAt !== undefined && ctx.simTime >= su.scheduledAt) {
        installStartedAt = ctx.simTime
        s.softwareUpdate = { status: 'installing', ...(su.version ? { version: su.version } : {}), installPct: 0, ...(su.expectedDurationS ? { expectedDurationS: su.expectedDurationS } : {}) }
      } else if (su?.status === 'installing') {
        const pctDone = Math.min(100, Math.floor(((ctx.simTime - installStartedAt) / ((su.expectedDurationS ?? 1200) * 1000)) * 100))
        if (pctDone >= 100) { if (su.version) s.softwareVersion = su.version; delete s.softwareUpdate }
        else if (pctDone !== su.installPct) s.softwareUpdate = { ...su, installPct: pctDone }
      }
      s.sleepState = driving || s.charging || s.climateOn || s.softwareUpdate?.status === 'installing' || ctx.simTime < awakeUntil ? 'online' : 'asleep'
      s.readAt = ctx.simTime
    },
    apply(cmd, ctx) {
      const s = dev.state
      switch (cmd.type) {
        case 'vehicle.lock': s.locked = true; break
        case 'vehicle.unlock': s.locked = false; break
        case 'vehicle.start_charge': if (!s.pluggedIn) throw new SimError('DEVICE_UNAVAILABLE', 'vehicle not plugged in'); s.chargeLimit = Math.max(s.chargeLimit ?? 80, Math.min(100, s.soc + 10)); break
        case 'vehicle.stop_charge': s.chargeLimit = Math.floor(s.soc); break
        case 'vehicle.set_charge_limit': s.chargeLimit = clamp(Math.round(cmd.percent), 50, 100); break
        case 'vehicle.wake': s.sleepState = 'online'; awakeUntil = ctx.simTime + AWAKE_AFTER_WAKE_MS; break
        // like the real one: preconditioning wakes the car up, and keeps it awake
        // like Tesla (`low_soc`): no climate control below 20 %
        case 'vehicle.climate_start': if (s.soc < 20) throw new SimError('LOW_BATTERY', 'battery too low to run the climate'); s.sleepState = 'online'; s.climateOn = true; if (cmd.targetTempC !== undefined) s.climateTargetC = cmd.targetTempC; break
        case 'vehicle.climate_stop': s.climateOn = false; break
        case 'vehicle.climate_set': {
          const climate = o.climate ?? TESLA_CLIMATE
          // Tesla refuses a setting while the car is asleep; the R5 writes preconditioning settings, with no sleep
          if (!climate.heatWhileOff && s.sleepState !== 'online') throw new SimError('DEVICE_UNAVAILABLE', 'vehicle is asleep')
          if (cmd.targetTempC !== undefined) s.climateTargetC = clamp(cmd.targetTempC, climate.minC, climate.maxC)
          for (const [seat, level] of Object.entries(cmd.seatHeat ?? {}) as [VehicleSeat, number | undefined][]) {
            if (level === undefined) continue
            if (!climate.seats.includes(seat)) throw new SimError('UNSUPPORTED_COMMAND', `no heater on seat ${seat}`)
            // new object: state merging is shallow, and the mock's diff compares references
            s.seatHeat = { ...s.seatHeat, [seat]: Math.min(level, climate.seatLevels) }
          }
          if (cmd.steeringWheelHeat !== undefined) {
            if (!climate.steeringWheelHeat) throw new SimError('UNSUPPORTED_COMMAND', 'no steering wheel heater')
            s.steeringWheelHeat = cmd.steeringWheelHeat
          }
          break
        }
        case 'vehicle.refresh': break
        // like the real one: car awake, update downloaded
        case 'vehicle.schedule_update': {
          const su = s.softwareUpdate
          if (!o.software) throw new SimError('UNSUPPORTED_COMMAND', 'no software updates on this vehicle')
          if (s.sleepState !== 'online') throw new SimError('DEVICE_UNAVAILABLE', 'vehicle is asleep: wake it first')
          if (su?.status !== 'available' && su?.status !== 'scheduled') throw new SimError('DEVICE_UNAVAILABLE', 'no downloaded software update to install')
          // "now" does not start right away on a Tesla: it leaves a countdown, cancelable (seen
          // on the real car on 2026-10-02); the simulation leaves two minutes
          s.softwareUpdate = { ...su, status: 'scheduled', scheduledAt: ctx.simTime + Math.max(cmd.delayS, NOW_COUNTDOWN_S) * 1000 }
          break
        }
        case 'vehicle.cancel_update': {
          const su = s.softwareUpdate
          if (!o.software) throw new SimError('UNSUPPORTED_COMMAND', 'no software updates on this vehicle')
          if (su?.status !== 'scheduled') break
          if (s.sleepState !== 'online') throw new SimError('DEVICE_UNAVAILABLE', 'vehicle is asleep: wake it first')
          const { scheduledAt: _dropped, ...rest } = su
          s.softwareUpdate = { ...rest, status: 'available' }
          break
        }
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on vehicle`)
      }
    },
    releaseNotes(lang = 'en') {
      if (!o.software) throw new SimError('UNSUPPORTED_COMMAND', 'no release notes on this vehicle')
      const served = notesIn[lang] ? lang : 'en'
      const notes = notesIn[served] ?? {}
      const installed = dev.state.softwareVersion ?? o.software.version
      const next = dev.state.softwareUpdate?.version
      return {
        lang: served,
        installedVersion: installed,
        ...(next && notes[next] ? { pending: { version: next, notes: notes[next] } } : {}),
        history: Object.keys(notes).filter((v) => versionOrder(v, installed) <= 0).sort((a, b) => versionOrder(b, a)).map((version) => ({ version, notes: notes[version]! })),
      }
    },
  }
  return dev
}

export interface ChargerOptions { name: string; vehicleId: string; maxCurrentA?: number }

/** Charger: mirrors the charge state of the associated vehicle; start/stop act on the vehicle's limit. */
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
        case 'ev_charger.resume_mode': enabled = true; break
        case 'ev_charger.set_current': dev.state.maxCurrentA = clamp(Math.round(cmd.amps), 6, 32); break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on ev_charger`)
      }
    },
  }
  return dev
}
