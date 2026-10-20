import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { StateFor, WeatherForecast } from '@kasbah/shared'
import { createSharedComposable, StorageSerializers, useLocalStorage } from '@vueuse/core'
import { getTransport } from '../api'
import type { WeatherAlerts, WeatherElsewhere, WeatherPlace } from '../api/transport'
import { useDevicesStore } from '../stores/devices'

// The ONLY access point to the weather on the UI side: widget, Weather view and 3D scene go through here, never
// through the `weather` device directly. This is what will allow, the day a personal station
// publishes its sensors, to consolidate local measurement and model in a single place.

export function useWeather() {
  const devices = useDevicesStore()
  /** The first AVAILABLE weather device, otherwise the first one at all (greyed out): the simulation counts. */
  const entry = computed(() => {
    const list = devices.list.filter((e) => e.descriptor.kind === 'weather')
    return list.find((e) => e.state.available) ?? list[0]
  })
  const descriptor = computed(() => entry.value?.descriptor)
  const state = computed(() => entry.value?.state as StateFor<'weather'> | undefined)
  /** The state only when it is worth something: unavailable, nothing is drawn from it. */
  const live = computed(() => (state.value?.available ? state.value : undefined))
  /** Cloud cover 0-1 for the 3D scene; clear sky without weather. */
  const cloudiness = computed(() => (live.value?.cloudCover ?? 0) / 100)
  return { entry, descriptor, state, live, cloudiness }
}

/** Forecast re-read cadence: that of the server polling, re-reading faster re-reads the same thing. */
const FORECAST_REFRESH_MS = 10 * 60 * 1000

/** The forecasts of a weather device, reloaded on opening then every ten minutes. */
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

/**
 * The place displayed by the Weather view and the favorites, remembered in the browser (like the Music's recent
 * searches). `null` = the house, the default; the home widget and the 3D scene, for their part,
 * stay on the house. Shared: the places bar and the view read the same state.
 */
export const useWeatherPlaces = createSharedComposable(() => {
  const selected = useLocalStorage<WeatherPlace | null>('kasbah.weather.place', null, { serializer: StorageSerializers.object })
  const favorites = useLocalStorage<WeatherPlace[]>('kasbah.weather.favorites', [])
  const isFavorite = (p: WeatherPlace) => favorites.value.some((f) => f.id === p.id)
  function select(p: WeatherPlace | null): void { selected.value = p }
  function toggleFavorite(p: WeatherPlace): void {
    favorites.value = isFavorite(p) ? favorites.value.filter((f) => f.id !== p.id) : [...favorites.value, p]
  }
  return { selected, favorites, isFavorite, select, toggleFavorite }
})

/** The weather of another place, re-read at the same cadence as the house; emptied as soon as the place changes. */
export function useWeatherAt(place: Ref<WeatherPlace | null>) {
  const data = ref<WeatherElsewhere | null>(null)
  const failed = ref(false)
  let asked = 0
  async function load(): Promise<void> {
    const p = place.value
    const ticket = ++asked
    if (!p) { data.value = null; failed.value = false; return }
    try {
      const r = await getTransport().getWeatherAt(p.lat, p.lon)
      if (ticket === asked) { data.value = r; failed.value = false }
    } catch { if (ticket === asked) failed.value = true }
  }
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => { void load(); timer = setInterval(() => { void load() }, FORECAST_REFRESH_MS) })
  onBeforeUnmount(() => { if (timer) clearInterval(timer) })
  // another place: nothing of the old one must stay displayed under the new name
  watch(() => place.value?.id, () => { data.value = null; failed.value = false; void load() })
  return { data, failed }
}

/** The weather warning of a position (house or chosen place), re-read at the forecast cadence. `null` = not (yet) read. */
export function useWeatherAlerts(at: Ref<{ lat: number; lon: number } | undefined>) {
  const data = ref<WeatherAlerts | null>(null)
  let asked = 0
  async function load(): Promise<void> {
    const p = at.value
    const ticket = ++asked
    if (!p) { data.value = null; return }
    try {
      const r = await getTransport().getWeatherAlerts(p.lat, p.lon)
      if (ticket === asked) data.value = r
    } catch { if (ticket === asked) data.value = null }
  }
  let timer: ReturnType<typeof setInterval> | null = null
  onMounted(() => { void load(); timer = setInterval(() => { void load() }, FORECAST_REFRESH_MS) })
  onBeforeUnmount(() => { if (timer) clearInterval(timer) })
  // another place: the old one's warning must not stay under the new name
  watch(() => (at.value ? `${at.value.lat},${at.value.lon}` : ''), () => { data.value = null; void load() })
  return { data }
}
