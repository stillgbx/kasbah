import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { PluginInfo, PluginSettingsPatch } from '@kasbah/shared'
import { ApiRequestError, getTransport } from '../api'
import { t } from '../i18n'
import { useNotificationsStore } from './notifications'

// Plugins : le serveur les déclare TOUS, la maison dit lesquels tournent (`house.plugins`). Ce
// store n'est que le miroir de l'inventaire du serveur — l'écriture rend l'inventaire à jour, donc
// aucune valeur n'est recalculée ici. Optimiste sur l'interrupteur, avec retour arrière : allumer
// un fabricant demande une découverte, la réponse peut prendre une seconde.

export const usePluginsStore = defineStore('plugins', () => {
  const list = shallowRef<PluginInfo[]>([])
  /** Ids en cours d'écriture : l'interrupteur reste affiché, il attend juste. */
  const busy = ref<Record<string, boolean>>({})
  const loaded = ref(false)

  const byId = computed(() => Object.fromEntries(list.value.map((p) => [p.id, p])))
  const isBusy = (id: string) => busy.value[id] === true

  async function load(): Promise<void> {
    try { list.value = await getTransport().getPlugins() }
    catch { /* inventaire indisponible : l'écran le dit par sa liste vide */ }
    finally { loaded.value = true }
  }

  /** Écrit un choix et adopte l'inventaire renvoyé par le serveur. */
  async function patch(pluginId: string, body: PluginSettingsPatch, optimistic: (p: PluginInfo) => PluginInfo): Promise<boolean> {
    const before = list.value
    list.value = before.map((p) => (p.id === pluginId ? optimistic(p) : p))
    busy.value = { ...busy.value, [pluginId]: true }
    try {
      list.value = await getTransport().setPluginSettings(pluginId, body)
      return true
    } catch (err) {
      list.value = before
      const n = useNotificationsStore()
      if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name: pluginId, message: err.message }))
      else n.error(t('errors.UNKNOWN', { name: pluginId, message: (err as Error).message }))
      return false
    } finally {
      const next = { ...busy.value }
      delete next[pluginId]
      busy.value = next
    }
  }

  const setEnabled = (pluginId: string, enabled: boolean) =>
    patch(pluginId, { enabled }, (p) => ({ ...p, enabled }))

  const setPart = (pluginId: string, partId: string, enabled: boolean) =>
    patch(pluginId, { parts: { [partId]: enabled } },
      (p) => ({ ...p, parts: p.parts.map((q) => (q.id === partId ? { ...q, enabled } : q)) }))

  const setAutoDynamicForNewScenes = (pluginId: string, value: boolean) =>
    patch(pluginId, { autoDynamicForNewScenes: value }, (p) => ({ ...p, autoDynamicForNewScenes: value }))

  return { list, loaded, byId, isBusy, load, setEnabled, setPart, setAutoDynamicForNewScenes }
})
