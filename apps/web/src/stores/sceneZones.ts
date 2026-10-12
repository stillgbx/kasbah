import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useLocalStorage } from '@vueuse/core'
import type { SiteMap } from '@kasbah/shared'
import { getTransport } from '../api'

// La carte du terrain d'une tondeuse PEINTE dans la scène 3D, quand on le souhaite. Ce qui se choisit
// est propre au poste — la tablette du salon peut la montrer, le téléphone non — : `localStorage`.
// Par robot : peinte ou non, et les éléments masqués (le terrain, une zone, les câbles…, voir
// `sceneEntryKey`). On garde les MASQUÉS : une zone tracée plus tard se montre d'elle-même.
//
// Les cartes elles-mêmes sont gardées ici, partagées entre la scène et le panneau qui liste les
// zones ; le serveur sert son cache, les redemander ne coûte pas de quota chez le fabricant.

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

  /** (Re)demande la carte d'un robot ; remplacée seulement si elle a changé. Échec = elle manque, sans plus. */
  async function load(deviceId: string): Promise<void> {
    try {
      const map = await getTransport().getSiteMap(deviceId)
      if (JSON.stringify(map) !== JSON.stringify(maps.value[deviceId])) maps.value = { ...maps.value, [deviceId]: map }
    } catch { /* pas de carte : rien à peindre ni à lister */ }
  }

  return { shown, hidden, maps, isShown, setShown, hiddenFor, toggleEntry, load }
})
