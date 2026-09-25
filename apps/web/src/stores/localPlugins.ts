import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'

// Plugins LOCAUX : activés sur CE poste seulement, jamais dans house.json. Un plugin de la maison
// se voit sur toutes les tablettes ; celui-ci pilote un appareil personnel appairé au navigateur
// (le TENS en Bluetooth) et ne doit exister que là où on l'a allumé — pas sur la tablette du palier.

export const LOCAL_PLUGINS = ['tens'] as const
export type LocalPluginId = (typeof LOCAL_PLUGINS)[number]

export const useLocalPluginsStore = defineStore('localPlugins', () => {
  const enabled = useLocalStorage<Partial<Record<LocalPluginId, boolean>>>('kasbah.localPlugins', {})
  const isEnabled = (id: LocalPluginId) => enabled.value[id] === true
  function setEnabled(id: LocalPluginId, on: boolean) { enabled.value = { ...enabled.value, [id]: on } }
  return { enabled, isEnabled, setEnabled }
})
