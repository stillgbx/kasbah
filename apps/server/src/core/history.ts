import type { DeviceId, DeviceState, EnergyHistoryPoint } from '@kasbah/shared'
import type { Bus } from './bus'
import type { Clock } from './clock'

// In-memory hourly history of `energy` devices (average of the samples per hour).
// Feeds the "Production today" chart without a database; bounded to `retentionHours`.

interface Bucket { t: number; production: number; consumption: number; grid: number; n: number }

export class EnergyHistory {
  private readonly buckets = new Map<DeviceId, Bucket[]>()
  private readonly unsubscribe: () => void

  constructor(bus: Bus, private readonly clock: Clock, private readonly retentionHours = 48) {
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
  }

  points(id: DeviceId, hours = 24): EnergyHistoryPoint[] {
    const cutoff = Math.floor(this.clock.now() / 3_600_000) * 3_600_000 - (hours - 1) * 3_600_000
    return (this.buckets.get(id) ?? [])
      .filter((b) => b.t >= cutoff)
      .map((b) => ({ t: b.t, productionW: Math.round(b.production / b.n), consumptionW: Math.round(b.consumption / b.n), gridW: Math.round(b.grid / b.n), samples: b.n }))
  }

  close(): void { this.unsubscribe() }
}
