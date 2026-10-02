import { computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import { ALERT_SEVERITIES, deviceAlerts, type AlertSeverity, type DeviceAlert, type DeviceKind } from '@kasbah/shared'
import { useDevicesStore } from './devices'

// Les alertes des appareils et le marqueur du rail. Les alertes viennent de l'état (`deviceAlerts`,
// partagé) ; ce qui est PROPRE AU POSTE, c'est de les avoir vues : une alerte fermée sur la tablette
// du salon reste signalée sur le téléphone. D'où `localStorage`, et pas le serveur.

/** La vue du rail où chaque sorte d'appareil montre ses alertes. */
const VIEW_OF: Partial<Record<DeviceKind, string>> = { vehicle: 'vehicles', mower: 'robots', vacuum: 'robots', weather: 'weather' }

export interface RailAlert extends DeviceAlert { view: string }

const rank = (s: AlertSeverity) => ALERT_SEVERITIES.indexOf(s)

export const useAlertsStore = defineStore('alerts', () => {
  const devices = useDevicesStore()
  /** Alertes fermées sur ce poste : id → appareil (pour oublier celles d'un appareil disparu). */
  const dismissed = useLocalStorage<Record<string, string>>('kasbah.alerts.dismissed', {})

  /** Par appareil : ses alertes, ou `null` si son état ne permet pas de le dire. */
  const byDevice = computed(() => {
    const out: Record<string, DeviceAlert[] | null> = {}
    for (const [id, state] of Object.entries(devices.states)) out[id] = deviceAlerts(id, state)
    return out
  })

  const active = computed<RailAlert[]>(() => Object.values(byDevice.value).flatMap((list) =>
    (list ?? []).flatMap((a) => (VIEW_OF[a.kind] ? [{ ...a, view: VIEW_OF[a.kind]! }] : []))))

  /** Une alerte critique ne se ferme pas : elle part avec sa cause. */
  const isDismissed = (id: string) => id in dismissed.value
  const pending = computed(() => active.value.filter((a) => a.severity === 'critical' || !isDismissed(a.id)))

  /** La gravité la plus haute qui attend dans une vue, `null` = rien à signaler. */
  function viewSeverity(view: string): AlertSeverity | null {
    let top: AlertSeverity | null = null
    for (const a of pending.value) if (a.view === view && (top === null || rank(a.severity) > rank(top))) top = a.severity
    return top
  }

  /** Les alertes d'un appareil qui peuvent encore être fermées : un seul « Masquer » les ferme toutes. */
  const closableFor = (deviceId: string) => pending.value.filter((a) => a.deviceId === deviceId && a.severity !== 'critical')

  function dismiss(list: DeviceAlert[]) {
    const add = list.filter((a) => a.severity !== 'critical' && !isDismissed(a.id))
    if (add.length) dismissed.value = { ...dismissed.value, ...Object.fromEntries(add.map((a) => [a.id, a.deviceId])) }
  }

  /** On regarde la vue : ses alertes `info` sont vues. Les problèmes attendent un geste. */
  const markViewSeen = (view: string) => dismiss(pending.value.filter((a) => a.view === view && a.severity === 'info'))

  // Le stockage ne garde que les alertes ENCORE en cours. Une alerte n'est oubliée que sur une
  // lecture qui dit qu'elle est finie : un appareil injoignable ou pas encore reçu (démarrage) garde
  // les siennes ; un appareil qui n'existe plus les perd, une fois la liste des appareils connue.
  watch(byDevice, (known) => {
    const anyDevice = Object.keys(devices.descriptors).length > 0
    const keep = Object.entries(dismissed.value).filter(([id, deviceId]) => {
      if (!(deviceId in devices.descriptors)) return !anyDevice
      const list = known[deviceId]
      return list == null || list.some((a) => a.id === id)
    })
    if (keep.length !== Object.keys(dismissed.value).length) dismissed.value = Object.fromEntries(keep)
  }, { immediate: true })

  return { active, pending, viewSeverity, closableFor, dismiss, markViewSeen, isDismissed }
})
