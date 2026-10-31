import { readFileSync } from 'node:fs'
import type { DeviceId, DeviceState, EnergyHistoryPoint } from '@kasbah/shared'
import { writeFileAtomic } from './atomic-file'
import type { Bus } from './bus'
import type { Clock } from './clock'
import type { Logger } from 'pino'

// Hourly history of `energy` devices (average of the samples per hour, and the peak of each
// phase). Feeds the "Production today" chart and the Phases block without a database; bounded to
// `retentionHours`.
//
// Kept in a FILE when one is given: a meter that trips switches the server off too, and the
// history would lose precisely the hour that explains the cut. Written every `SAVE_EVERY_MS`, and AT
// ONCE when a phase's peak rises past `URGENT_SHARE` of its limit: the seconds before a cut are
// the ones worth keeping, the rest can wait (about 300 writes a day instead of thousands).

interface Bucket { t: number; production: number; consumption: number; grid: number; n: number; peaks?: number[] }

const SAVE_EVERY_MS = 5 * 60_000
/** Share of the phase's limit (`phaseLimitVa`) above which a rising peak is written at once. */
const URGENT_SHARE = 0.8

export interface EnergyHistoryOptions {
  retentionHours?: number
  /** JSON file the buckets survive a restart in. Absent = memory only (tests). */
  file?: string
  logger?: Logger
}

export class EnergyHistory {
  private readonly buckets = new Map<DeviceId, Bucket[]>()
  private readonly unsubscribe: () => void
  private readonly retentionHours: number
  private readonly options: EnergyHistoryOptions
  private savedAt = 0

  constructor(bus: Bus, private readonly clock: Clock, options: EnergyHistoryOptions | number = {}) {
    const o = typeof options === 'number' ? { retentionHours: options } : options
    this.retentionHours = o.retentionHours ?? 48
    this.options = o
    if (o.file) this.load(o.file)
    this.unsubscribe = bus.on('state', (id, state) => this.record(id, state))
  }

  record(id: DeviceId, state: DeviceState, at = this.clock.now()): void {
    if (state.kind !== 'energy' || !state.available) return
    const hour = Math.floor(at / 3_600_000) * 3_600_000
    let list = this.buckets.get(id)
    if (!list) { list = []; this.buckets.set(id, list) }
    let b = list[list.length - 1]
    if (!b || b.t !== hour) {
      b = { t: hour, production: 0, consumption: 0, grid: 0, n: 0 }
      list.push(b)
      const cutoff = hour - this.retentionHours * 3_600_000
      while (list.length && list[0]!.t < cutoff) list.shift()
    }
    b.production += state.productionW
    b.consumption += state.consumptionW
    b.grid += state.gridW
    b.n++
    let urgent = false
    if (state.gridPhases?.length) {
      const peaks = b.peaks ?? []
      const near = state.phaseLimitVa ? state.phaseLimitVa * URGENT_SHARE : Infinity
      state.gridPhases.forEach((p, i) => {
        const va = Math.max(0, Math.round(p.va))
        if (va > (peaks[i] ?? 0)) { peaks[i] = va; if (va >= near) urgent = true }
        else peaks[i] ??= 0
      })
      b.peaks = peaks
    }
    if (urgent || at - this.savedAt >= SAVE_EVERY_MS) this.save(at)
  }

  points(id: DeviceId, hours = 24): EnergyHistoryPoint[] {
    const cutoff = Math.floor(this.clock.now() / 3_600_000) * 3_600_000 - (hours - 1) * 3_600_000
    return (this.buckets.get(id) ?? [])
      .filter((b) => b.t >= cutoff)
      .map((b) => ({
        t: b.t, productionW: Math.round(b.production / b.n), consumptionW: Math.round(b.consumption / b.n),
        gridW: Math.round(b.grid / b.n), samples: b.n, ...(b.peaks ? { phasePeakVa: [...b.peaks] } : {}),
      }))
  }

  close(): void { this.unsubscribe() }

  private load(file: string): void {
    let text: string
    try { text = readFileSync(file, 'utf8') } catch { return }   // first start: nothing kept yet
    try {
      const saved = JSON.parse(text) as { devices?: Record<string, Bucket[]> }
      for (const [id, list] of Object.entries(saved.devices ?? {})) {
        if (Array.isArray(list)) this.buckets.set(id, list.filter((b) => typeof b?.t === 'number' && b.n > 0))
      }
    } catch (err) {
      this.options.logger?.warn({ err, file }, 'energy history unreadable: starting empty')
    }
  }

  private save(at: number): void {
    const file = this.options.file
    if (!file) return
    this.savedAt = at
    const text = `${JSON.stringify({ schemaVersion: 1, devices: Object.fromEntries(this.buckets) })}\n`
    writeFileAtomic(file, text).catch((err: unknown) => this.options.logger?.warn({ err, file }, 'energy history not saved'))
  }
}
