import type { DeviceEnergyDays } from '@kasbah/shared'

/**
 * The last `n` days of a site's history, today included (`GET /api/devices/:id/energy-days?days=n`).
 * The Energy view loads the whole history once, then asks only for this every minute: during a day
 * only today and yesterday move; the past changes on a resync, which the view sees through
 * `syncedAt` and reloads in full. Years of history from twenty inverters weigh hundreds of KB.
 */
export function recentEnergyDays(d: DeviceEnergyDays, n: number, now: number): DeviceEnergyDays {
  const cut = new Date(now)
  cut.setHours(0, 0, 0, 0)
  cut.setDate(cut.getDate() - (n - 1))
  const from = cut.getTime()
  const out: DeviceEnergyDays = { ...d, days: d.days.filter((x) => x.t >= from) }
  if (d.inverters) {
    // calendar days, not 24 h steps: a day of 23 or 25 h at the clock changes
    const day = new Date(d.inverters.from)
    let k = 0
    while (day.getTime() < from) { day.setDate(day.getDate() + 1); k++ }
    out.inverters = {
      ...d.inverters,
      from: day.getTime(),
      devices: d.inverters.devices.map((v) => ({ ...v, wh: v.wh.slice(k), ...(v.peakW ? { peakW: v.peakW.slice(k) } : {}) })),
    }
  }
  return out
}
