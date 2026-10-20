import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import type { SiteMap } from '@kasbah/shared'
import { getTransport } from '../api'

// A mower's terrain map PAINTED in the 3D scene, when wanted. What is chosen
// is specific to the workstation — the living room tablet can show it, the phone not —: `localStorage`.
// Per robot: painted or not, and the hidden elements (the terrain, a zone, the cables…, see
// `sceneEntryKey`). We keep the HIDDEN ones: a zone drawn later shows up by itself.
//
// The maps themselves are kept here, shared between the scene and the panel that lists the
// zones; the server serves its cache, asking for them again costs no quota with the vendor.

export const useSceneZonesStore = defineStore('sceneZones', () => {
  const shown = useLocalStorage<string[]>('kasbah.sceneZones.shown', [])
  const hidden = useLocalStorage<Record<string, string[]>>('kasbah.sceneZones.hidden', {})
  const maps = ref<Record<string, SiteMap>>({})

  const isShown = (deviceId: string) => shown.value.includes(deviceId)
  function setShown(deviceId: string, on: boolean): void {
    shown.value = on ? [...new Set([...shown.value, deviceId])] : shown.value.filter((id) => id !== deviceId)
  }
  const hiddenFor = (deviceId: string): ReadonlySet<string> => new Set(hidden.value[deviceId] ?? [])
  function toggleEntry(deviceId: string, key: string): void {
    const set = new Set(hidden.value[deviceId] ?? [])
    if (set.has(key)) set.delete(key)
    else set.add(key)
    hidden.value = { ...hidden.value, [deviceId]: [...set] }
  }

  /** (Re)requests a robot's map; replaced only if it changed. Failure = it is missing, nothing more. */
  async function load(deviceId: string): Promise<void> {
    try {
      const map = await getTransport().getSiteMap(deviceId)
      if (JSON.stringify(map) !== JSON.stringify(maps.value[deviceId])) maps.value = { ...maps.value, [deviceId]: map }
    } catch { /* no map: nothing to paint nor to list */ }
  }

  return { shown, hidden, maps, isShown, setShown, hiddenFor, toggleEntry, load }
})
