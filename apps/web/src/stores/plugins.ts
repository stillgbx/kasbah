import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { PluginInfo, PluginSettingsPatch } from '@kasbah/shared'
import { ApiRequestError, getTransport } from '../api'
import { t } from '../i18n'
import { useNotificationsStore } from './notifications'

// Plugins: the server declares ALL of them, the house says which ones run (`house.plugins`). This
// store is only the mirror of the server's inventory — the write returns the up-to-date inventory, so
// no value is recomputed here. Optimistic on the switch, with rollback: turning on
// a vendor requires a discovery, the answer may take a second.

export const usePluginsStore = defineStore('plugins', () => {
  const list = shallowRef<PluginInfo[]>([])
  /** Ids being written: the switch stays displayed, it just waits. */
  const busy = ref<Record<string, boolean>>({})
  const loaded = ref(false)

  const byId = computed(() => Object.fromEntries(list.value.map((p) => [p.id, p])))
  const isBusy = (id: string) => busy.value[id] === true

  async function load(): Promise<void> {
    try { list.value = await getTransport().getPlugins() }
    catch { /* inventory unavailable: the screen says so through its empty list */ }
    finally { loaded.value = true }
  }

  /** Writes a choice and adopts the inventory returned by the server. */
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
