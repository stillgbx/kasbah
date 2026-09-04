import { SimError, type SimDevice } from '../types'
import { clamp, descriptor, inWindow, nextOccurrence, round1 } from './common'

// Robots : aspirateur (cycle quotidien) et tondeuse (planning hebdomadaire, errance dans un rectangle).

export interface VacuumOptions { name: string; startHour?: number; durationMin?: number }

export function vacuum(externalId: string, o: VacuumOptions): SimDevice<'vacuum'> {
  const startHour = o.startHour ?? 11, durationMin = o.durationMin ?? 45
  let cleaningLeftS = 0, returningLeftS = 0, lastDay = -1, manual = false
  const dev: SimDevice<'vacuum'> = {
    descriptor: descriptor(externalId, 'vacuum', o.name, ['clean', 'dock', 'battery', 'locate'], { manufacturer: 'Mock', model: 'Robot vacuum' }),
    state: { kind: 'vacuum', updatedAt: 0, available: true, activity: 'docked', battery: 100, binFull: false },
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
}

export function mower(externalId: string, o: MowerOptions): SimDevice<'mower'> {
  const schedule = o.schedule === undefined ? { days: [1, 2, 3, 4, 5], startHour: 10, endHour: 12 } : o.schedule
  let heading = 0.7, parkedUntilNext = false, manualUntil = 0, returningLeftS = 0
  const [x0, y0, x1, y1] = o.area
  const dev: SimDevice<'mower'> = {
    descriptor: descriptor(externalId, 'mower', o.name, ['mow', 'park', 'battery', 'schedule'], { manufacturer: 'Mock', model: 'Robotic mower' }),
    state: { kind: 'mower', updatedAt: 0, available: true, activity: 'parked', battery: 100, position: [...o.dock] },
    tick(ctx) {
      const s = dev.state
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
          if (wantsMow && s.battery > 30) s.activity = 'mowing'
          break
        case 'mowing': {
          s.battery = round1(clamp(s.battery - (1 / 90) * ctx.dtS, 0, 100))
          heading += (ctx.rng() - 0.5) * 0.6 * Math.min(ctx.dtS, 5)
          const speed = 0.5 // m/s
          let [px, py] = s.position ?? o.dock
          px += Math.cos(heading) * speed * ctx.dtS
          py += Math.sin(heading) * speed * ctx.dtS
          if (px < x0 || px > x1) { heading = Math.PI - heading; px = clamp(px, x0, x1) }
          if (py < y0 || py > y1) { heading = -heading; py = clamp(py, y0, y1) }
          s.position = [Math.round(px * 100) / 100, Math.round(py * 100) / 100]
          if (!wantsMow || s.battery <= 20) { s.activity = 'returning'; returningLeftS = 90 }
          break
        }
        case 'returning': {
          returningLeftS -= ctx.dtS
          const k = clamp(1 - returningLeftS / 90, 0, 1)
          const [px, py] = s.position ?? o.dock
          s.position = [px + (o.dock[0] - px) * k, py + (o.dock[1] - py) * k]
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
          if (s.activity === 'paused' || s.activity === 'parked' || s.activity === 'charging') s.activity = 'mowing'
          break
        case 'mower.pause': if (s.activity === 'mowing') s.activity = 'paused'; break
        case 'mower.park':
          manualUntil = 0
          parkedUntilNext = cmd.untilNextSchedule
          if (s.activity === 'mowing' || s.activity === 'paused') { s.activity = 'returning'; returningLeftS = 90 }
          break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on mower`)
      }
    },
  }
  return dev
}
