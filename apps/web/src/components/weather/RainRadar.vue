<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Map as MlMap, Marker, NavigationControl, type RasterTileSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { planStyleUrl, type LatLon } from '../../lib/map'
import { useSettingsStore } from '../../stores/settings'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Carte des précipitations : le radar OBSERVÉ des deux dernières heures et une demi-heure de
// nowcast, par RainViewer (sans clé, tuiles ouvertes au navigateur — aucun relais serveur). Une
// prévision de modèle (Open-Meteo, AROME) viendra en seconde passe sur la même carte.
//
// Une seule source raster : changer d'image, c'est remplacer ses tuiles (`setTiles`), pas empiler
// des couches. La frise de temps a une taille fixe quel que soit le nombre d'images. La lecture
// démarre d'elle-même à l'arrivée sur la vue : une carte de pluie se lit en mouvement.

const props = defineProps<{ home: LatLon }>()
const { d, t } = useI18n()
const settings = useSettingsStore()

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'
/** Palette 2 (« universal blue »), lissée, neige distinguée : `/256/{z}/{x}/{y}/2/1_1.png`. */
const TILE_SUFFIX = '/256/{z}/{x}/{y}/2/1_1.png'
const FRAME_MS = 600
const REFRESH_MS = 5 * 60 * 1000

interface Frame { time: number; path: string; nowcast: boolean }
const frames = ref<Frame[]>([])
const host = ref('')
const index = ref(0)
const playing = ref(false)
const failed = ref(false)
const container = ref<HTMLDivElement | null>(null)
let map: MlMap | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let refresher: ReturnType<typeof setInterval> | null = null
/** La lecture part toute seule au premier chargement des images ; ensuite, c'est l'utilisateur qui décide. */
let started = false

const current = computed(() => frames.value[index.value])
const lastObserved = computed(() => frames.value.reduce((n, f, i) => (f.nowcast ? n : i), 0))

async function loadFrames(): Promise<void> {
  try {
    const r = await fetch(FRAMES_URL)
    if (!r.ok) throw new Error(String(r.status))
    const j = (await r.json()) as { host: string; radar: { past: { time: number; path: string }[]; nowcast: { time: number; path: string }[] } }
    host.value = j.host
    frames.value = [...j.radar.past.map((f) => ({ ...f, nowcast: false })), ...j.radar.nowcast.map((f) => ({ ...f, nowcast: true }))]
    failed.value = false
    if (!started) { started = true; index.value = lastObserved.value; togglePlay() }
    else if (!playing.value) index.value = lastObserved.value
  } catch { failed.value = true }
}

function tiles(f: Frame): string[] { return [`${host.value}${f.path}${TILE_SUFFIX}`] }

function applyFrame(): void {
  const f = current.value
  if (!map || !f) return
  const src = map.getSource('radar') as RasterTileSource | undefined
  if (src) src.setTiles(tiles(f))
  else if (map.isStyleLoaded()) {
    map.addSource('radar', { type: 'raster', tiles: tiles(f), tileSize: 256, attribution: '© RainViewer' })
    map.addLayer({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 } })
  }
}

function togglePlay(): void {
  playing.value = !playing.value
  if (ticker) { clearInterval(ticker); ticker = null }
  if (playing.value) ticker = setInterval(() => { index.value = (index.value + 1) % Math.max(1, frames.value.length) }, FRAME_MS)
}

onMounted(() => {
  if (!container.value) return
  const m = new MlMap({
    container: container.value, style: planStyleUrl(settings.isDark), attributionControl: { compact: true },
    center: [props.home.lon, props.home.lat], zoom: 6.2, minZoom: 4, maxZoom: 10, dragRotate: false, pitchWithRotate: false,
  })
  map = m
  m.addControl(new NavigationControl({ showCompass: false }), 'top-left')
  const el = document.createElement('div')
  el.className = 'radar__home'
  el.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 11l9-7 9 7v9H3zM9 20v-6h6v6" fill="var(--surface)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
  new Marker({ element: el }).setLngLat([props.home.lon, props.home.lat]).addTo(m)
  // la couche radar est reposée après chaque changement de style (le thème la retire avec le style)
  m.on('style.load', applyFrame)
  void loadFrames()
  refresher = setInterval(() => { void loadFrames() }, REFRESH_MS)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  if (refresher) clearInterval(refresher)
  map?.remove(); map = null
})
watch([current, host], applyFrame)
watch(() => settings.isDark, (dark) => map?.setStyle(planStyleUrl(dark)))
</script>

<template>
  <div class="radar">
    <div ref="container" class="radar__canvas" />
    <div v-if="failed" class="radar__empty muted">{{ t('weather.radarUnavailable') }}</div>
    <!-- frise fixe : bouton, heure de l'image, curseur ; « prévu » quand l'image est du nowcast -->
    <div class="radar__bar">
      <button type="button" class="radar__btn" :disabled="!frames.length" :aria-label="playing ? t('weather.pause') : t('weather.play')" @click="togglePlay">
        <StrokeIcon :name="playing ? 'pause' : 'play'" :size="16" />
      </button>
      <div class="radar__time">{{ current ? d(new Date(current.time * 1000), 'time') : '—:—' }}</div>
      <div class="radar__kind muted">{{ current?.nowcast ? t('weather.precipProbability') : t('weather.radarSource') }}</div>
      <input v-model.number="index" type="range" class="radar__range" :min="0" :max="Math.max(0, frames.length - 1)" :disabled="!frames.length"
             :aria-label="t('weather.radar')" @input="playing && togglePlay()" />
      <div class="radar__now" :style="{ left: `${frames.length > 1 ? (lastObserved / (frames.length - 1)) * 100 : 0}%` }" />
    </div>
  </div>
</template>

<style scoped>
.radar { position: relative; border-radius: var(--radius); overflow: hidden; background: var(--surface2); height: 100%; min-height: 320px; display: flex; flex-direction: column; }
.radar__canvas { flex: 1 1 auto; min-height: 0; }
.radar__empty { position: absolute; inset: 0 0 52px 0; display: grid; place-items: center; background: color-mix(in srgb, var(--surface) 55%, transparent); font-size: 13px; }
.radar__bar { position: relative; flex: 0 0 52px; display: grid; grid-template-columns: 36px 56px 1fr; grid-template-rows: 1fr 1fr; align-items: center; column-gap: 10px; padding: 0 14px; background: var(--surface); border-top: 1px solid var(--line); }
.radar__btn { grid-row: 1 / 3; width: 36px; height: 36px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); display: grid; place-items: center; }
.radar__btn:disabled { opacity: .45; }
.radar__time { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; align-self: end; }
.radar__kind { font-size: 11px; align-self: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.radar__range { grid-column: 3; grid-row: 1 / 3; width: 100%; accent-color: var(--accent); }
/* trait « maintenant » sous le curseur : la frontière entre observé et prévu */
.radar__now { position: absolute; bottom: 6px; width: 2px; height: 8px; background: var(--muted); margin-left: calc(36px + 56px + 20px + 14px); transform: translateX(-1px); pointer-events: none; display: none; }
:deep(.radar__home) { color: var(--accent); filter: drop-shadow(0 1px 2px rgb(0 0 0 / .35)); }
</style>
