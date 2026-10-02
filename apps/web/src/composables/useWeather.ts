import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { StateFor, WeatherForecast } from '@kasbah/shared'
import { createSharedComposable, StorageSerializers, useLocalStorage } from '@vueuse/core'
import { getTransport } from '../api'
import type { WeatherAlerts, WeatherElsewhere, WeatherPlace } from '../api/transport'
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

/**
 * Le lieu affiché par la vue Météo et les favoris, mémorisés dans le navigateur (comme les recherches
 * récentes de la Musique). `null` = la maison, le défaut ; le widget d'accueil et la scène 3D, eux,
 * restent à la maison. Partagé : la barre de lieux et la vue lisent le même état.
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

/** La météo d'un autre lieu, relue à la même cadence que la maison ; vidée dès qu'on change de lieu. */
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
  // un autre lieu : rien de l'ancien ne doit rester affiché sous le nouveau nom
  watch(() => place.value?.id, () => { data.value = null; failed.value = false; void load() })
  return { data, failed }
}

/** La vigilance météo d'une position (maison ou lieu choisi), relue à la cadence des prévisions. `null` = pas (encore) lue. */
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
  // un autre lieu : la vigilance de l'ancien ne doit pas rester sous le nouveau nom
  watch(() => (at.value ? `${at.value.lat},${at.value.lon}` : ''), () => { data.value = null; void load() })
  return { data }
}
