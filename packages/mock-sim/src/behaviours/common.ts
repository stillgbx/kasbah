import type { Capability, DeviceDescriptor, DeviceKind, DeviceMeta } from '@kasbah/shared'

export const PLUGIN_ID = 'mock'

export function descriptor(externalId: string, kind: DeviceKind, name: string, capabilities: Capability[], meta: DeviceMeta = {}): DeviceDescriptor {
  return { id: `${PLUGIN_ID}:${externalId}`, pluginId: PLUGIN_ID, externalId, kind, name, capabilities, meta }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const round1 = (v: number) => Math.round(v * 10) / 10

/** True if `hour` ∈ [start, end) (fractional hours). */
export const inWindow = (hour: number, start: number, end: number) => hour >= start && hour < end

/** Timestamp (ms) of the next occurrence of `hour` (local) after `simTime`, honoring the allowed days. */
export function nextOccurrence(simTime: number, hour: number, dow: number, tzOffsetMin: number, allowedDows: readonly number[]): number {
  const local = simTime - tzOffsetMin * 60_000
  const dayStart = Math.floor(local / 86_400_000) * 86_400_000
  for (let d = 0; d < 8; d++) {
    const candidate = dayStart + d * 86_400_000 + hour * 3_600_000
    const cdow = (dow + d) % 7
    if (candidate > local && allowedDows.includes(cdow)) return candidate + tzOffsetMin * 60_000
  }
  return simTime + 86_400_000
}
