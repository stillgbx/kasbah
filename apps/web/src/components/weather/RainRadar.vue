<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { addProtocol, Map as MlMap, Marker, NavigationControl, type RasterTileSource } from 'maplibre-gl'
import '../../lib/maplibreWorker'
import 'maplibre-gl/dist/maplibre-gl.css'
import { AROME_META_URL, aromeFrames, aromeSourceUrl, type AromeMeta } from '../../lib/arome'
import { planStyleUrl, type LatLon } from '../../lib/map'
import { useSettingsStore } from '../../stores/settings'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Precipitation map: ONE timeline, two sources. The past is the OBSERVED radar from RainViewer
// (two hours, no key, tiles open to the browser); the future is Météo-France's AROME FORECAST
// at 15-minute steps, published by Open-Meteo as `.om` files and rendered in the
// browser by `@openmeteo/weather-map-layer` (MapLibre `om://` protocol, WASM loaded on
// demand — the module is only imported here, and only when the map is displayed). Without AROME
// (network, run missing), RainViewer's immediate half-hour forecast takes over.
//
// Two raster layers coexist, only one visible at a time: changing frame means replacing
// the tiles of one (`setTiles`) or the URL of the other (`setUrl`), not stacking layers. The
// timeline has a fixed size whatever the number of frames. Playback starts by itself
// on arriving at the view: a rain map is read in motion.

/** `home` = the center of the map; `away`: it is not the house (pin marker, no house). */
const props = defineProps<{ home: LatLon; away?: boolean }>()
const HOUSE_SVG = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 11l9-7 9 7v9H3zM9 20v-6h6v6" fill="var(--surface)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
const PIN_SVG = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="var(--surface)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>'
const { d, t } = useI18n()
const settings = useSettingsStore()

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'
/** Palette 2 ("universal blue"), smoothed, snow distinguished: `/256/{z}/{x}/{y}/2/1_1.png`. */
const TILE_SUFFIX = '/256/{z}/{x}/{y}/2/1_1.png'
const FRAME_MS = 600
const REFRESH_MS = 5 * 60 * 1000

type FrameKind = 'radar' | 'nowcast' | 'arome'
interface Frame { time: number; kind: FrameKind; path?: string; url?: string }
const frames = ref<Frame[]>([])
const host = ref('')
const index = ref(0)
const playing = ref(false)
const failed = ref(false)
const container = ref<HTMLDivElement | null>(null)
let map: MlMap | null = null
let marker: Marker | null = null
let ticker: ReturnType<typeof setInterval> | null = null
let refresher: ReturnType<typeof setInterval> | null = null
/** Playback starts by itself at the first loading of the frames; afterwards, it is the user who decides. */
let started = false
/** The `om://` protocol is global to MapLibre: we register it once, at first need. */
let omReady: Promise<boolean> | null = null
/**
 * The style is set (`style.load`), so we can add sources to it. NOT `map.isStyleLoaded()`: it
 * is false as long as a source is still loading a tile — that is, almost always while an
 * animation changes frame every 600 ms, and the layers were never put in place.
 */
let styleReady = false

const current = computed(() => frames.value[index.value])
const lastObserved = computed(() => frames.value.reduce((n, f, i) => (f.kind === 'radar' ? i : n), 0))
const KIND_LABEL: Record<FrameKind, string> = { radar: 'weather.radarSource', nowcast: 'weather.nowcastSource', arome: 'weather.aromeSource' }
/** Where the timeline goes from observed to forecast, as a share of the slider's travel (between the two frames); `null` without a forecast. */
const boundary = computed(() => {
  const n = frames.value.length
  const first = frames.value[lastObserved.value + 1]
  return n > 1 && first ? (lastObserved.value + 0.5) / (n - 1) : null
})
const switchLabel = computed(() => (frames.value[lastObserved.value + 1]?.kind === 'arome' ? 'AROME' : t('weather.nowcastSource')))

async function loadRadar(): Promise<{ past: Frame[]; nowcast: Frame[] }> {
  const r = await fetch(FRAMES_URL)
  if (!r.ok) throw new Error(String(r.status))
  const j = (await r.json()) as { host: string; radar: { past: { time: number; path: string }[]; nowcast: { time: number; path: string }[] } }
  host.value = j.host
  return {
    past: j.radar.past.map((f) => ({ time: f.time, kind: 'radar' as const, path: f.path })),
    nowcast: j.radar.nowcast.map((f) => ({ time: f.time, kind: 'nowcast' as const, path: f.path })),
  }
}

/** The AROME steps after now; empty if the run is missing, is old, or if `om://` rendering is not available. */
async function loadArome(): Promise<Frame[]> {
  try {
    if (!(await ensureOmProtocol())) return []
    const r = await fetch(AROME_META_URL)
    if (!r.ok) return []
    const meta = (await r.json()) as AromeMeta
    return aromeFrames(meta, Date.now()).map((f) => ({ time: f.time, kind: 'arome' as const, url: f.url }))
  } catch { return [] }
}

async function loadFrames(): Promise<void> {
  try {
    const [radar, arome] = await Promise.all([loadRadar(), loadArome()])
    // the future is AROME when there is any; otherwise the radar's immediate forecast takes over
    frames.value = [...radar.past, ...(arome.length ? arome : radar.nowcast)]
    failed.value = false
    if (!started) { started = true; index.value = lastObserved.value; togglePlay() }
    else if (!playing.value) index.value = Math.min(index.value, frames.value.length - 1)
  } catch { failed.value = true }
}

/** Loads the rendering engine for `.om` files (and its WASM) on demand, only once. */
function ensureOmProtocol(): Promise<boolean> {
  omReady ??= import('@openmeteo/weather-map-layer')
    .then(({ omProtocol }) => { addProtocol('om', omProtocol); return true })
    .catch(() => false)
  return omReady
}

function radarTiles(f: Frame): string[] { return [`${host.value}${f.path}${TILE_SUFFIX}`] }

function applyFrame(): void {
  const f = current.value
  if (!map || !f || !styleReady) return
  const radar = map.getSource('radar') as RasterTileSource | undefined
  const arome = map.getSource('arome') as RasterTileSource | undefined
  if (f.kind === 'arome') {
    const url = aromeSourceUrl({ time: f.time, url: f.url! }, settings.isDark)
    if (arome) arome.setUrl(url)
    else {
      map.addSource('arome', { type: 'raster', url, tileSize: 256, attribution: '© Open-Meteo · Météo-France AROME' })
      map.addLayer({ id: 'arome', type: 'raster', source: 'arome', paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 } })
    }
  } else if (radar) radar.setTiles(radarTiles(f))
  else {
    map.addSource('radar', { type: 'raster', tiles: radarTiles(f), tileSize: 256, attribution: '© RainViewer' })
    map.addLayer({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 } })
  }
  if (map.getLayer('radar')) map.setLayoutProperty('radar', 'visibility', f.kind === 'arome' ? 'none' : 'visible')
  if (map.getLayer('arome')) map.setLayoutProperty('arome', 'visibility', f.kind === 'arome' ? 'visible' : 'none')
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
  // The credits start FOLDED (the ⓘ button opens them). MapLibre unfolds them on its own: when the
  // first attributions arrive, it sets `maplibregl-compact` AND `maplibregl-compact-show` — but
  // only if the first is missing. By setting it ourselves right away, the second never comes,
  // and the toggle on click keeps working. (Removing `compact-show` here would be useless:
  // at that moment the attribution is still empty, so the class is not yet set.)
  container.value.querySelector('.maplibregl-ctrl-attrib')?.classList.add('maplibregl-compact')
  // in development only: the map can be queried from the console (`el.__map`), to check
  // that a source does draw when nothing shows on screen
  if (import.meta.env.DEV) (container.value as HTMLDivElement & { __map?: MlMap }).__map = m
  m.addControl(new NavigationControl({ showCompass: false }), 'top-left')
  const el = document.createElement('div')
  el.className = 'radar__home'
  el.innerHTML = props.away ? PIN_SVG : HOUSE_SVG
  marker = new Marker({ element: el }).setLngLat([props.home.lon, props.home.lat]).addTo(m)
  // the layers are put back after each style change (the theme removes them along with the style)
  m.on('style.load', () => { styleReady = true; applyFrame() })
  void loadFrames()
  refresher = setInterval(() => { void loadFrames() }, REFRESH_MS)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  if (refresher) clearInterval(refresher)
  map?.remove(); map = null; marker = null
})
watch([current, host], applyFrame)
// another place: the map recenters there (same zoom), the marker follows
watch(() => [props.home.lat, props.home.lon, props.away] as const, ([lat, lon, away]) => {
  map?.jumpTo({ center: [lon, lat] })
  marker?.setLngLat([lon, lat])
  const el = marker?.getElement()
  if (el) el.innerHTML = away ? PIN_SVG : HOUSE_SVG
})
watch(() => settings.isDark, (dark) => { styleReady = false; map?.setStyle(planStyleUrl(dark)) })
</script>

<template>
  <div class="radar">
    <div ref="container" class="radar__canvas" />
    <div v-if="failed" class="radar__empty muted">{{ t('weather.radarUnavailable') }}</div>
    <!-- fixed timeline: button, frame time, frame source (observed, immediate, AROME), slider -->
    <div class="radar__bar">
      <button type="button" class="radar__btn" :disabled="!frames.length" :aria-label="playing ? t('weather.pause') : t('weather.play')" @click="togglePlay">
        <StrokeIcon :name="playing ? 'pause' : 'play'" :size="16" />
      </button>
      <div class="radar__time">{{ current ? d(new Date(current.time * 1000), 'time') : '—:—' }}</div>
      <div class="radar__kind muted" :data-kind="current?.kind ?? 'radar'">{{ t(KIND_LABEL[current?.kind ?? 'radar']) }}</div>
      <!-- the slider, and along its travel the line where the observed gives way to the model -->
      <div class="radar__track">
        <input v-model.number="index" type="range" class="radar__range" :min="0" :max="Math.max(0, frames.length - 1)" :disabled="!frames.length"
               :aria-label="t('weather.radar')" @input="playing && togglePlay()" />
        <div v-if="boundary !== null" class="radar__switch" :style="{ left: `calc(8px + (100% - 16px) * ${boundary})` }"><span>{{ switchLabel }}</span></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.radar { position: relative; border-radius: var(--radius); overflow: hidden; background: var(--surface2); height: 100%; min-height: 320px; display: flex; flex-direction: column; }
.radar__canvas { flex: 1 1 auto; min-height: 0; }
.radar__empty { position: absolute; inset: 0 0 52px 0; display: grid; place-items: center; background: color-mix(in srgb, var(--surface) 55%, transparent); font-size: 13px; }
/* the time and source column is FIXED: "AROME forecast · Météo-France" does not push the slider */
.radar__bar { position: relative; flex: 0 0 52px; display: grid; grid-template-columns: 36px 150px 1fr; grid-template-rows: 1fr 1fr; align-items: center; column-gap: 10px; padding: 0 14px; background: var(--surface); border-top: 1px solid var(--line); }
.radar__btn { grid-row: 1 / 3; width: 36px; height: 36px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); display: grid; place-items: center; }
.radar__btn:disabled { opacity: .45; }
.radar__time { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; align-self: end; }
.radar__kind { font-size: 11px; align-self: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the forecast is told apart from the observed at a glance: the accent color */
.radar__kind[data-kind='arome'], .radar__kind[data-kind='nowcast'] { color: var(--accent); }
.radar__track { grid-column: 3; grid-row: 1 / 3; position: relative; display: flex; align-items: center; }
.radar__range { width: 100%; accent-color: var(--accent); }
/* the observed → forecast switch: a line under the track (the slider's useful travel excludes the thumb, ~16 px) and its word */
.radar__switch { position: absolute; top: 50%; width: 2px; height: 12px; margin-top: 2px; background: var(--accent); transform: translateX(-1px); pointer-events: none; }
.radar__switch span { position: absolute; top: 11px; left: 4px; font-size: 10px; line-height: 1; color: var(--accent); white-space: nowrap; letter-spacing: .04em; }
:deep(.radar__home) { color: var(--accent); filter: drop-shadow(0 1px 2px rgb(0 0 0 / .35)); }
</style>
