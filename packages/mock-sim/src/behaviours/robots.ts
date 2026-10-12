import { localToGeo, type StateFor } from '@kasbah/shared'
import { SimError, type SimDevice } from '../types'
import { clamp, descriptor, inWindow, nextOccurrence, round1 } from './common'

// Robots : aspirateur (cycle quotidien) et tondeuse (planning hebdomadaire, errance dans un rectangle).

export interface VacuumOptions { name: string; startHour?: number; durationMin?: number }

export function vacuum(externalId: string, o: VacuumOptions): SimDevice<'vacuum'> {
  const startHour = o.startHour ?? 11, durationMin = o.durationMin ?? 45
  let cleaningLeftS = 0, returningLeftS = 0, lastDay = -1, manual = false
  const dev: SimDevice<'vacuum'> = {
    // l'aspirateur simulé LAVE aussi : sans la capacité `mop`, les contrôles de serpillière ne
    // seraient vérifiables qu'avec un vrai Combo sous la main
    descriptor: descriptor(externalId, 'vacuum', o.name, ['clean', 'dock', 'battery', 'locate', 'mop'], { manufacturer: 'Mock', model: 'Robot vacuum' }),
    state: { kind: 'vacuum', updatedAt: 0, available: true, activity: 'docked', battery: 100, binFull: false, mopAttached: true, tankLevel: 80 },
    tick(ctx) {
      const s = dev.state
      const day = Math.floor(ctx.simTime / 86_400_000)
      if (!manual && s.activity === 'docked' && s.battery > 50 && inWindow(ctx.hour, startHour, startHour + 0.25) && lastDay !== day) {
        lastDay = day; s.activity = 'cleaning'; cleaningLeftS = durationMin * 60
      }
      switch (s.activity) {
        case 'cleaning':
          cleaningLeftS -= ctx.dtS
          s.battery = round1(clamp(s.battery - (65 / (durationMin * 60)) * ctx.dtS, 0, 100))
          // le réservoir se vide en lavant, et personne ne le remplit tout seul
          if (s.mopAttached && s.tankLevel !== undefined && s.tankLevel !== null) {
            s.tankLevel = round1(clamp(s.tankLevel - (70 / (durationMin * 60)) * ctx.dtS, 0, 100))
          }
          if (cleaningLeftS <= 0 || s.battery <= 15) { s.activity = 'returning'; returningLeftS = 180; manual = false }
          break
        case 'returning':
          returningLeftS -= ctx.dtS
          if (returningLeftS <= 0) { s.activity = 'docked'; s.binFull = ctx.rng() < 0.2 }
          break
        case 'docked':
          s.battery = round1(clamp(s.battery + (1 / 60) * ctx.dtS, 0, 100))
          if (s.battery >= 100) ctx.world.loadsW += 3
          else ctx.world.loadsW += 30
          break
        case 'paused': break
        case 'error': break
      }
    },
    apply(cmd) {
      const s = dev.state
      switch (cmd.type) {
        case 'vacuum.start':
          if (s.activity === 'paused') s.activity = 'cleaning'
          else { s.activity = 'cleaning'; cleaningLeftS = durationMin * 60; manual = true; s.binFull = false }
          break
        case 'vacuum.pause': if (s.activity === 'cleaning') s.activity = 'paused'; break
        case 'vacuum.dock': if (s.activity !== 'docked') { s.activity = 'returning'; returningLeftS = 120 } break
        case 'vacuum.locate': break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on vacuum`)
      }
    },
  }
  return dev
}

export interface MowerOptions {
  name: string
  /** Rectangle d'errance [x0, y0, x1, y1] (repère maison). */
  area: [number, number, number, number]
  /** Position de la station de charge. */
  dock: [number, number]
  schedule?: { days: number[]; startHour: number; endHour: number } | null
  /**
   * Origine GPS de la maison : la simulation publie alors AUSSI une `location`, comme un vrai robot
   * (Husqvarna), pour que la carte de la vue Robots ait quelque chose à montrer. Repère supposé
   * plein nord : c'est une simulation, pas un relevé.
   */
  home?: { lat: number; lon: number }
}

/** Rectangle [x0, y0, x1, y1] → polygone, sens trigonométrique. */
const rect = ([x0, y0, x1, y1]: [number, number, number, number]): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

export function mower(externalId: string, o: MowerOptions): SimDevice<'mower'> {
  const schedule = o.schedule === undefined ? { days: [1, 2, 3, 4, 5], startHour: 10, endHour: 12 } : o.schedule
  let heading = 0.7, parkedUntilNext = false, manualUntil = 0, returningLeftS = 0, leavingLeftS = 0
  // Deux zones de travail (le rectangle d'errance coupé en deux) et une zone d'exclusion dans la
  // seconde : de quoi montrer la carte et ses commandes. Repère maison supposé plein nord, comme la
  // `location` : la carte est donc dans le repère maison, station comprise.
  const [ax0, ay0, ax1, ay1] = o.area
  const xm = (ax0 + ax1) / 2
  const areas: Record<number, [number, number, number, number]> = { 1: [ax0, ay0, xm, ay1], 2: [xm, ay0, ax1, ay1] }
  const potager: [number, number, number, number] = [ax1 - Math.min(6, (ax1 - xm) / 2), ay1 - Math.min(4, (ay1 - ay0) / 2), ax1 - 1, ay1 - 1]
  /** Où le robot erre : tout le terrain, ou la zone qu'on lui a donnée. */
  let bounds = o.area
  /** Il part de la station : « en route » une vingtaine de secondes, le temps d'arriver sur sa zone. */
  const depart = (s: StateFor<'mower'>) => { s.activity = 'mowing'; s.leaving = true; leavingLeftS = 20 }
  const dev: SimDevice<'mower'> = {
    descriptor: descriptor(externalId, 'mower', o.name, ['mow', 'park', 'battery', 'schedule', 'work_areas', 'stay_out_zones', 'site_map'], { manufacturer: 'Mock', model: 'Robotic mower' }),
    state: {
      kind: 'mower', updatedAt: 0, available: true, activity: 'parked', battery: 100, position: [...o.dock], cuttingHeight: 5,
      statistics: { cuttingTimeS: 2_694_600, chargingCycles: 412, collisions: 5836, driveDistanceM: 1_638_400 },
      workAreas: [{ id: 1, name: 'Devant', enabled: true }, { id: 2, name: 'Fond', enabled: true }],
      workAreaId: 0, leaving: false,
      stayOutZones: [{ id: 'potager', name: 'Potager', enabled: true }],
    },
    siteMap() {
      const [dx, dy] = o.dock
      return {
        station: [dx, dy],
        shapes: [
          { kind: 'lawn', id: 'main_area_0', points: rect(o.area) },
          { kind: 'work_area', id: 'area-1', name: 'Devant', points: rect(areas[1]!) },
          { kind: 'work_area', id: 'area-2', name: 'Fond', points: rect(areas[2]!) },
          { kind: 'stay_out', id: 'potager', name: 'Potager', points: rect(potager) },
          // une zone de réensauvagement : sur la carte seulement, comme chez Husqvarna
          { kind: 'rewilding', id: 'prairie', name: 'Prairie', enabled: true, points: rect([ax0 + 1, ay0 + 1, ax0 + Math.min(6, (xm - ax0) / 2), ay0 + Math.min(4, (ay1 - ay0) / 2)]) },
          { kind: 'guide', id: 'guide_1', points: [[dx, dy], [ax1 - 1, ay0 + 1]] },
          { kind: 'station', id: 'station', points: [[dx, dy], [dx + 1.5, dy]] },
        ],
      }
    },
    tick(ctx) {
      const s = dev.state
      const geo = (xy: [number, number]) => {
        if (!o.home) return
        const g = localToGeo({ lat: o.home.lat, lon: o.home.lon, alt: 0, heading: 0 }, [xy[0], xy[1], 0])
        s.location = { lat: g.lat, lon: g.lon, at: ctx.simTime }
      }
      if (!s.location && s.position) geo(s.position)
      const scheduled = !!schedule && schedule.days.includes(ctx.dow) && inWindow(ctx.hour, schedule.startHour, schedule.endHour)
      const wantsMow = (scheduled && !parkedUntilNext) || ctx.simTime < manualUntil
      if (!scheduled) parkedUntilNext = false
      if (schedule) {
        s.nextStartAt = nextOccurrence(ctx.simTime, schedule.startHour, ctx.dow, ctx.tzOffsetMin ?? 0, schedule.days)
      }
      switch (s.activity) {
        case 'parked':
        case 'charging':
          s.battery = round1(clamp(s.battery + (100 / 5400) * ctx.dtS, 0, 100))
          s.activity = s.battery < 100 ? 'charging' : 'parked'
          if (s.activity === 'charging') ctx.world.loadsW += 45
          if (wantsMow && s.battery > 30) {
            // le planning tond tout le terrain ; un ordre manuel garde la zone qu'il a donnée
            if (ctx.simTime >= manualUntil) { bounds = o.area; s.workAreaId = 0 }
            depart(s)
          }
          break
        case 'mowing': {
          s.battery = round1(clamp(s.battery - (1 / 90) * ctx.dtS, 0, 100))
          if (s.leaving && (leavingLeftS -= ctx.dtS) <= 0) s.leaving = false
          heading += (ctx.rng() - 0.5) * 0.6 * Math.min(ctx.dtS, 5)
          const speed = 0.5 // m/s
          const [x0, y0, x1, y1] = bounds
          let [px, py] = s.position ?? o.dock
          px += Math.cos(heading) * speed * ctx.dtS
          py += Math.sin(heading) * speed * ctx.dtS
          if (px < x0 || px > x1) { heading = Math.PI - heading; px = clamp(px, x0, x1) }
          if (py < y0 || py > y1) { heading = -heading; py = clamp(py, y0, y1) }
          s.position = [Math.round(px * 100) / 100, Math.round(py * 100) / 100]
          geo(s.position)
          if (!wantsMow || s.battery <= 20) { s.activity = 'returning'; s.leaving = false; returningLeftS = 90 }
          break
        }
        case 'returning': {
          returningLeftS -= ctx.dtS
          const k = clamp(1 - returningLeftS / 90, 0, 1)
          const [px, py] = s.position ?? o.dock
          s.position = [px + (o.dock[0] - px) * k, py + (o.dock[1] - py) * k]
          geo(s.position)
          if (returningLeftS <= 0) { s.activity = 'charging'; s.position = [...o.dock] }
          break
        }
        case 'paused': break
        case 'error': break
      }
    },
    apply(cmd, ctx) {
      const s = dev.state
      switch (cmd.type) {
        case 'mower.start':
          manualUntil = ctx.simTime + (cmd.durationMin ?? 60) * 60_000
          parkedUntilNext = false
          bounds = o.area
          s.workAreaId = 0
          if (s.activity === 'paused') s.activity = 'mowing'
          else if (s.activity === 'parked' || s.activity === 'charging') depart(s)
          break
        case 'mower.start_in_area': {
          const area = areas[cmd.workAreaId]
          if (!area) throw new SimError('UNSUPPORTED_COMMAND', `no work area ${cmd.workAreaId}`)
          manualUntil = ctx.simTime + cmd.durationMin * 60_000
          parkedUntilNext = false
          bounds = area
          s.workAreaId = cmd.workAreaId
          if (s.activity === 'paused') s.activity = 'mowing'
          else if (s.activity === 'parked' || s.activity === 'charging') depart(s)
          break
        }
        case 'mower.set_stay_out_zone':
          if (!s.stayOutZones?.some((z) => z.id === cmd.zoneId)) throw new SimError('UNSUPPORTED_COMMAND', `no stay-out zone ${cmd.zoneId}`)
          s.stayOutZones = s.stayOutZones.map((z) => (z.id === cmd.zoneId ? { ...z, enabled: cmd.enabled } : z))
          break
        case 'mower.pause': if (s.activity === 'mowing') s.activity = 'paused'; break
        case 'mower.park':
          manualUntil = 0
          parkedUntilNext = cmd.untilNextSchedule
          if (s.activity === 'mowing' || s.activity === 'paused') { s.activity = 'returning'; s.leaving = false; returningLeftS = 90 }
          break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on mower`)
      }
    },
  }
  return dev
}
