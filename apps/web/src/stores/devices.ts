import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { CommandInput, DeviceDescriptor, DeviceEntry, DeviceState, HealthResponse, ServerMessage } from '@kasbah/shared'
import { ApiRequestError, getTransport, type ConnectionStatus } from '../api'
import { t } from '../i18n'
import { optimisticPatch } from '../lib/optimistic'
import { useNotificationsStore } from './notifications'

// Appareils des plugins : descripteurs + états, connexion push, commandes avec mise à jour
// optimiste et retour arrière. INVARIANT : l'objet d'état d'un appareil est REMPLACÉ (jamais muté)
// à chaque changement → la scène 3D détecte les changements par simple comparaison de référence.

export const useDevicesStore = defineStore('devices', () => {
  const descriptors = shallowRef<Record<string, DeviceDescriptor>>({})
  const states = shallowRef<Record<string, DeviceState>>({})
  const connection = ref<ConnectionStatus>('connecting')
  const pending = ref<Record<string, number>>({})
  const health = ref<HealthResponse | null>(null)
  let disconnect: (() => void) | null = null

  const list = computed<DeviceEntry[]>(() =>
    Object.values(descriptors.value)
      .map((descriptor) => ({ descriptor, state: states.value[descriptor.id]! }))
      .filter((e) => e.state)
      .sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name)),
  )
  const count = computed(() => list.value.length)

  function setEntries(entries: DeviceEntry[]) {
    const d: Record<string, DeviceDescriptor> = {}, s: Record<string, DeviceState> = {}
    for (const e of entries) { d[e.descriptor.id] = e.descriptor; s[e.descriptor.id] = e.state }
    descriptors.value = d
    states.value = s
  }

  function setState(id: string, state: DeviceState) {
    if (!descriptors.value[id]) return
    states.value = { ...states.value, [id]: state }
  }

  function applyMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'snapshot': setEntries(msg.devices); break
      case 'devices': setEntries(msg.devices); break
      case 'state': setState(msg.deviceId, msg.state); break
      case 'availability': {
        const next = { ...states.value }
        for (const id of msg.deviceIds) { const prev = next[id]; if (prev) next[id] = { ...prev, available: msg.available } }
        states.value = next
        break
      }
      case 'error': useNotificationsStore().error(msg.message); break
    }
  }

  function start() {
    if (disconnect) return
    disconnect = getTransport().connect({
      onMessage: applyMessage,
      onStatus: (s) => { connection.value = s },
    })
  }

  function stop() { disconnect?.(); disconnect = null }

  async function refreshHealth() {
    try { health.value = await getTransport().getHealth() } catch { health.value = null }
  }

  /** Envoie une commande. Applique tout de suite l'effet attendu, annule si le serveur refuse. */
  async function sendCommand(deviceId: string, command: CommandInput): Promise<boolean> {
    const prev = states.value[deviceId]
    const descriptor = descriptors.value[deviceId]
    if (!prev || !descriptor) return false
    const patch = optimisticPatch(prev, command)
    if (patch) setState(deviceId, { ...prev, ...patch } as DeviceState)
    pending.value = { ...pending.value, [deviceId]: (pending.value[deviceId] ?? 0) + 1 }
    try {
      await getTransport().sendCommand(deviceId, command)
      return true
    } catch (err) {
      // retour arrière seulement si aucun état plus récent n'est arrivé entre-temps
      const cur = states.value[deviceId]
      if (cur && cur.updatedAt === prev.updatedAt) setState(deviceId, prev)
      const n = useNotificationsStore()
      if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name: descriptor.name, message: err.message }))
      else n.error(t('errors.UNKNOWN', { name: descriptor.name, message: (err as Error).message }))
      return false
    } finally {
      const left = (pending.value[deviceId] ?? 1) - 1
      const next = { ...pending.value }
      if (left <= 0) delete next[deviceId]; else next[deviceId] = left
      pending.value = next
    }
  }

  const isPending = (id: string) => (pending.value[id] ?? 0) > 0

  /** Exécute une scène (lot de commandes) ; les appareils inconnus sont ignorés. */
  async function runScene(actions: { deviceId: string; command: CommandInput }[]): Promise<void> {
    await Promise.all(actions.filter((a) => descriptors.value[a.deviceId]).map((a) => sendCommand(a.deviceId, a.command)))
  }

  return { descriptors, states, connection, pending, health, list, count, start, stop, applyMessage, sendCommand, runScene, isPending, refreshHealth, setEntries }
})
