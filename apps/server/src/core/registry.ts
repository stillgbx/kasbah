import {
  defaultState, mergeState, stateKeys, type DeviceDescriptor, type DeviceEntry, type DeviceId, type DeviceState, type StatePatch,
  deviceStateSchema,
} from '@kasbah/shared'
import type { Logger } from 'pino'
import type { Bus } from './bus'
import type { Clock } from './clock'

// Registre des appareils : descripteurs + états courants. Fusionne les patchs, pose `updatedAt`,
// valide (attrape tôt les bugs de plugin) et ne publie QUE s'il y a un changement.

export class DeviceRegistry {
  private entries = new Map<DeviceId, { descriptor: DeviceDescriptor; state: DeviceState }>()

  constructor(private readonly bus: Bus, private readonly clock: Clock, private readonly logger?: Logger) {}

  /** Remplace l'ensemble des appareils d'un plugin. Les états des ids conservés survivent. */
  register(pluginId: string, descriptors: DeviceDescriptor[]): void {
    const keep = new Set(descriptors.map((d) => d.id))
    for (const [id, e] of this.entries) if (e.descriptor.pluginId === pluginId && !keep.has(id)) this.entries.delete(id)
    const now = this.clock.now()
    for (const d of descriptors) {
      const prev = this.entries.get(d.id)
      this.entries.set(d.id, { descriptor: d, state: prev?.state ?? defaultState(d.kind, now) })
    }
    this.bus.emit('devices', this.list())
  }

  get(id: DeviceId): DeviceEntry | undefined { return this.entries.get(id) }
  has(id: DeviceId): boolean { return this.entries.has(id) }
  list(): DeviceEntry[] { return [...this.entries.values()].map((e) => ({ descriptor: e.descriptor, state: e.state })) }
  idsOf(pluginId: string): DeviceId[] {
    return [...this.entries.values()].filter((e) => e.descriptor.pluginId === pluginId).map((e) => e.descriptor.id)
  }
  countOf(pluginId: string): number { return this.idsOf(pluginId).length }

  applyPatch(id: DeviceId, patch: StatePatch): boolean {
    const e = this.entries.get(id)
    if (!e) { this.logger?.warn({ deviceId: id }, 'patch for unknown device ignored'); return false }
    const allowed = stateKeys(e.descriptor.kind)
    const unknown = Object.keys(patch).filter((k) => !allowed.has(k))
    if (unknown.length) { this.logger?.error({ deviceId: id, unknown }, 'patch with keys foreign to this kind rejected'); return false }
    const merged = mergeState(e.state, patch as StatePatch<typeof e.state.kind>, this.clock.now())
    if (merged === e.state) return false
    const check = deviceStateSchema.safeParse(merged)
    if (!check.success) {
      this.logger?.error({ deviceId: id, patch, issues: check.error.issues }, 'invalid state patch rejected')
      return false
    }
    e.state = check.data
    this.bus.emit('state', id, e.state)
    return true
  }

  /** Bascule la disponibilité d'un appareil ou de tous ceux d'un plugin ('*'). */
  setAvailable(pluginId: string, externalId: string | '*', available: boolean): DeviceId[] {
    const ids = externalId === '*' ? this.idsOf(pluginId) : [`${pluginId}:${externalId}`]
    const changed: DeviceId[] = []
    const now = this.clock.now()
    for (const id of ids) {
      const e = this.entries.get(id)
      if (!e || e.state.available === available) continue
      e.state = { ...e.state, available, updatedAt: now }
      changed.push(id)
    }
    if (changed.length) this.bus.emit('availability', changed, available)
    return changed
  }
}
