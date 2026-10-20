import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'

// LOCAL plugins: enabled on THIS workstation only, never in house.json. A house plugin
// shows on all screens; this one drives a personal device paired to the browser
// (the Bluetooth TENS) and must only exist where it was turned on — not on the landing tablet.

export const LOCAL_PLUGINS = ['tens'] as const
export type LocalPluginId = (typeof LOCAL_PLUGINS)[number]

export const useLocalPluginsStore = defineStore('localPlugins', () => {
  const enabled = useLocalStorage<Partial<Record<LocalPluginId, boolean>>>('kasbah.localPlugins', {})
  const isEnabled = (id: LocalPluginId) => enabled.value[id] === true
  function setEnabled(id: LocalPluginId, on: boolean) { enabled.value = { ...enabled.value, [id]: on } }
  return { enabled, isEnabled, setEnabled }
})
