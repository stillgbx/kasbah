import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { StateFor, WeatherForecast } from '@kasbah/shared'
import { getTransport } from '../api'
import { useDevicesStore } from '../stores/devices'

// Le SEUL point d'accès à la météo côté UI : widget, vue Météo et scène 3D passent par ici, jamais
// par l'appareil `weather` directement. C'est ce qui permettra, le jour où une station personnelle
// publiera ses capteurs, de consolider mesure locale et modèle à un seul endroit.

export function useWeather() {
  const devices = useDevicesStore()
  /** Le premier appareil météo DISPONIBLE, sinon le premier tout court (grisé) : la simulation compte. */
  const entry = computed(() => {
    const list = devices.list.filter((e) => e.descriptor.kind === 'weather')
    return list.find((e) => e.state.available) ?? list[0]
  })
  const descriptor = computed(() => entry.value?.descriptor)
  const state = computed(() => entry.value?.state as StateFor<'weather'> | undefined)
  /** L'état seulement quand il vaut quelque chose : indisponible, on n'en tire rien. */
  const live = computed(() => (state.value?.available ? state.value : undefined))
  /** Nébulosité 0-1 pour la scène 3D ; ciel dégagé sans météo. */
  const cloudiness = computed(() => (live.value?.cloudCover ?? 0) / 100)
  return { entry, descriptor, state, live, cloudiness }
}

/** Cadence de relecture des prévisions : celle du sondage serveur, relire plus vite relit la même chose. */
const FORECAST_REFRESH_MS = 10 * 60 * 1000

/** Les prévisions d'un appareil météo, rechargées à l'ouverture puis toutes les dix minutes. */
export function useForecast(deviceId: Ref<string | undefined>) {
  const forecast = ref<WeatherForecast | null>(null)
  const failed = ref(false)
  async function load(): Promise<void> {
    const id = deviceId.value
    if (!id) { forecast.value = null; return }
    try { forecast.value = await getTransport().getForecast(id); failed.value = false }
    catch { failed.value = true }
  }
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => { void load(); timer = setInterval(() => { void load() }, FORECAST_REFRESH_MS) })
  onBeforeUnmount(() => { if (timer) clearInterval(timer) })
  watch(deviceId, () => { void load() })
  return { forecast, failed, reload: load }
}
