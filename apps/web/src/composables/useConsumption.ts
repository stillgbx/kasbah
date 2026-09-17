import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { DeviceConsumption } from '@kasbah/shared'
import { getTransport } from '../api'

/** L'historique de consommation ne bouge qu'à l'heure ou au jour (cf. plugin comap, sondage 30 s) : pas la peine de le relire plus vite que ça. */
const CONSUMPTION_REFRESH_MS = 5 * 60 * 1000

/**
 * Historique de consommation d'un appareil `water`, à la demande (`GET /api/devices/:id/consumption`),
 * comme les prévisions et le journal (`useForecast`, `useJournals`) : le serveur le tient à jour,
 * relire coûte une requête locale. Un échec garde l'historique d'avant ; sans appareil, rien n'est demandé.
 */
export function useConsumption(deviceId: Ref<string | undefined>) {
  const consumption = ref<DeviceConsumption | null>(null)
  const failed = ref(false)

  async function load(): Promise<void> {
    const id = deviceId.value
    if (!id) { consumption.value = null; return }
    try { consumption.value = await getTransport().getConsumption(id); failed.value = false }
    catch { failed.value = true }
  }

  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => { void load(); timer = setInterval(() => { void load() }, CONSUMPTION_REFRESH_MS) })
  onBeforeUnmount(() => { if (timer) clearInterval(timer) })
  watch(deviceId, () => { void load() })

  return { consumption, failed, reload: load }
}
