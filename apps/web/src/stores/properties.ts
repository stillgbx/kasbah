import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PropertiesResponse, ServerMessage } from '@kasbah/shared'
import { getTransport } from '../api'
import { useNotificationsStore } from './notifications'

// Les PROPRIÉTÉS que l'application sait montrer (maison, appartement). Aujourd'hui, seul le mode démo
// en offre plusieurs : basculer recharge l'application entière sur l'autre maison, son parc simulé,
// ses ambiances — rien d'une propriété ne doit survivre dans l'autre.

const SWITCH_TIMEOUT_MS = 30_000
const POLL_MS = 500

export const usePropertiesStore = defineStore('properties', () => {
  const info = ref<PropertiesResponse | null>(null)
  /** Propriété en cours de bascule : le sélecteur l'annonce et refuse un second choix. */
  const switching = ref<string | null>(null)
  /** Propriété du premier snapshot : un snapshot qui en nomme une autre veut dire qu'un écran a basculé. */
  let seen: string | null = null

  const switchable = computed(() => !!info.value?.switchable && info.value.properties.length > 1)
  const active = computed(() => info.value?.properties.find((p) => p.id === info.value?.activeId) ?? null)

  async function load() {
    try { info.value = await getTransport().getProperties() }
    catch { info.value = null }   // serveur d'avant la fonction : pas de sélecteur, rien d'autre ne change
  }

  async function select(id: string) {
    if (switching.value || id === info.value?.activeId) return
    switching.value = id
    try {
      await getTransport().selectProperty(id)
      // le serveur redémarre sur l'autre maison : attendre qu'il la nomme, puis tout recharger
      const deadline = Date.now() + SWITCH_TIMEOUT_MS
      while (Date.now() < deadline) {
        try { if ((await getTransport().getProperties()).activeId === id) break }
        catch { /* serveur en cours de redémarrage */ }
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
      window.location.reload()
    } catch (err) {
      switching.value = null
      useNotificationsStore().error((err as Error).message)
    }
  }

  function apply(msg: ServerMessage) {
    if (msg.type !== 'snapshot' || !msg.propertyId) return
    if (seen === null) seen = msg.propertyId
    else if (msg.propertyId !== seen) window.location.reload()
  }

  return { info, switching, switchable, active, load, select, apply }
})
