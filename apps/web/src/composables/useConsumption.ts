import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { DeviceConsumption } from '@kasbah/shared'
import { getTransport } from '../api'

/** The consumption history only moves on the hour or the day (cf. comap plugin, 30 s polling): no point re-reading it faster than that. */
const CONSUMPTION_REFRESH_MS = 5 * 60 * 1000

/**
 * Consumption history of a `water` device, on demand (`GET /api/devices/:id/consumption`),
 * like the forecasts and the log (`useForecast`, `useJournals`): the server keeps it up to date,
 * re-reading costs one local request. A failure keeps the previous history; without a device, nothing is requested.
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
