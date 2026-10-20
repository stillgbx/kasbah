import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { ALERT_SEVERITIES, deviceAlerts, type AlertSeverity, type DeviceAlert, type DeviceKind, type PluginHealth } from '@kasbah/shared'
import { useDevicesStore } from './devices'

// The devices' alerts and the rail marker. The alerts come from the state (`deviceAlerts`,
// shared). A `problem` or `critical` alert is flagged FOR AS LONG AS IT LASTS: it is a task to
// do, it is not closed, it goes away with its cause. Only an `info` goes out when opening its view,
// and this "seen" is SPECIFIC TO THE WORKSTATION: seen on the living room tablet, it stays flagged on the
// phone. Hence `localStorage`, and not the server.

/** The rail view where each kind of device shows its alerts. */
const VIEW_OF: Partial<Record<DeviceKind, string>> = {
  vehicle: 'vehicles', mower: 'robots', vacuum: 'robots', weather: 'weather', pet_feeder: 'pets', pet_fountain: 'pets',
}

export interface RailAlert extends DeviceAlert { view: string }

/**
 * A plugin that is not working (`/api/health`, polled by `App.vue`): an account to link again, a
 * service that does not answer. Flagged on the Settings gear, where it is repaired.
 */
export interface PluginAlert { pluginId: string; status: PluginHealth['status']; detail?: string; severity: AlertSeverity; view: 'settings' }

/** `degraded` is often a passing miss (a poll, a restart): flagged only once it has lasted this long. */
export const DEGRADED_GRACE_MS = 5 * 60_000
const FAILING: PluginHealth['status'][] = ['error', 'needs_pairing']

const rank = (s: AlertSeverity) => ALERT_SEVERITIES.indexOf(s)

export const useAlertsStore = defineStore('alerts', () => {
  const devices = useDevicesStore()
  /** `info` alerts seen on this workstation: id → device (to forget those of a vanished device). */
  const dismissed = useLocalStorage<Record<string, string>>('kasbah.alerts.dismissed', {})

  /** Per device: its alerts, or `null` if its state does not allow saying. */
  const byDevice = computed(() => {
    const out: Record<string, DeviceAlert[] | null> = {}
    for (const [id, state] of Object.entries(devices.states)) out[id] = deviceAlerts(id, state)
    return out
  })

  /** All ongoing alerts, the most serious first. */
  const active = computed<RailAlert[]>(() => Object.values(byDevice.value).flatMap((list) =>
    (list ?? []).flatMap((a) => (VIEW_OF[a.kind] ? [{ ...a, view: VIEW_OF[a.kind]! }] : [])))
    .sort((a, b) => rank(b.severity) - rank(a.severity)))

  /** The last health read, since when each plugin reads `degraded` (ms epoch), and when health was last read. */
  const lastPlugins = ref<Record<string, PluginHealth>>({})
  const degradedSince = ref<Record<string, number>>({})
  const healthAt = ref(0)
  watch(() => devices.health, (h) => {
    if (!h) return                                       // unread: the server's silence says nothing of its plugins
    const now = Date.now()
    const next: Record<string, number> = {}
    for (const [id, p] of Object.entries(h?.plugins ?? {})) if (p.status === 'degraded') next[id] = degradedSince.value[id] ?? now
    degradedSince.value = next
    healthAt.value = now
    lastPlugins.value = h.plugins
  }, { immediate: true })

  /** The plugins that are not working, in the order of the server's inventory. */
  const plugins = computed<PluginAlert[]>(() => Object.entries(lastPlugins.value).flatMap(([pluginId, p]) => {
    const failing = FAILING.includes(p.status)
      || (p.status === 'degraded' && healthAt.value - (degradedSince.value[pluginId] ?? healthAt.value) >= DEGRADED_GRACE_MS)
    return failing ? [{ pluginId, status: p.status, ...(p.detail ? { detail: p.detail } : {}), severity: 'problem' as const, view: 'settings' as const }] : []
  }))

  const isDismissed = (id: string) => id in dismissed.value
  /** What the rail flags: everything that lasts, and the `info` not yet seen. */
  const pending = computed(() => active.value.filter((a) => a.severity !== 'info' || !isDismissed(a.id)))

  /** The highest severity waiting in a view, `null` = nothing to flag. */
  function viewSeverity(view: string): AlertSeverity | null {
    let top: AlertSeverity | null = null
    for (const a of [...pending.value, ...plugins.value]) if (a.view === view && (top === null || rank(a.severity) > rank(top))) top = a.severity
    return top
  }

  /** The view is looked at: its `info` alerts are seen. The others wait to be settled. */
  function markViewSeen(view: string) {
    const add = pending.value.filter((a) => a.view === view && a.severity === 'info')
    if (add.length) dismissed.value = { ...dismissed.value, ...Object.fromEntries(add.map((a) => [a.id, a.deviceId])) }
  }

  // The storage only keeps the alerts STILL ongoing. An alert is only forgotten on a
  // reading that says it is over: an unreachable device or one not yet received (startup) keeps
  // its own; a device that no longer exists loses them, once the device list is known.
  watch(byDevice, (known) => {
    const anyDevice = Object.keys(devices.descriptors).length > 0
    const keep = Object.entries(dismissed.value).filter(([id, deviceId]) => {
      if (!(deviceId in devices.descriptors)) return !anyDevice
      const list = known[deviceId]
      return list == null || list.some((a) => a.id === id)
    })
    if (keep.length !== Object.keys(dismissed.value).length) dismissed.value = Object.fromEntries(keep)
  }, { immediate: true })

  return { active, pending, plugins, viewSeverity, markViewSeen, isDismissed }
})
