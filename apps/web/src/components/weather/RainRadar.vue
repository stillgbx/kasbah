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

// Carte des précipitations : UNE frise, deux sources. Le passé est le radar OBSERVÉ de RainViewer
// (deux heures, sans clé, tuiles ouvertes au navigateur) ; l'avenir est la PRÉVISION AROME de
// Météo-France au pas de 15 minutes, publiée par Open-Meteo en fichiers `.om` et rendue dans le
// navigateur par `@openmeteo/weather-map-layer` (protocole MapLibre `om://`, WASM chargé à la
// demande — le module n'est importé qu'ici, et seulement quand la carte s'affiche). Sans AROME
// (réseau, run absent), la demi-heure de prévision immédiate de RainViewer prend la suite.
//
// Deux couches raster coexistent, une seule visible à la fois : changer d'image, c'est remplacer
// les tuiles de l'une (`setTiles`) ou l'URL de l'autre (`setUrl`), pas empiler des couches. La
// frise de temps a une taille fixe quel que soit le nombre d'images. La lecture démarre d'elle-même
// à l'arrivée sur la vue : une carte de pluie se lit en mouvement.

/** `home` = le centre de la carte ; `away` : ce n'est pas la maison (repère d'épingle, pas de maison). */
const props = defineProps<{ home: LatLon; away?: boolean }>()
const HOUSE_SVG = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 11l9-7 9 7v9H3zM9 20v-6h6v6" fill="var(--surface)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
const PIN_SVG = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" fill="var(--surface)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>'
const { d, t } = useI18n()
const settings = useSettingsStore()

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json'
/** Palette 2 (« universal blue »), lissée, neige distinguée : `/256/{z}/{x}/{y}/2/1_1.png`. */
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
/** La lecture part toute seule au premier chargement des images ; ensuite, c'est l'utilisateur qui décide. */
let started = false
/** Le protocole `om://` est mondial à MapLibre : on l'enregistre une fois, au premier besoin. */
let omReady: Promise<boolean> | null = null
/**
 * Le style est posé (`style.load`), donc on peut y ajouter des sources. PAS `map.isStyleLoaded()` : il
 * vaut faux tant qu'une source charge encore une tuile — c'est-à-dire presque toujours pendant qu'une
 * animation change d'image toutes les 600 ms, et les couches ne se posaient jamais.
 */
let styleReady = false

const current = computed(() => frames.value[index.value])
const lastObserved = computed(() => frames.value.reduce((n, f, i) => (f.kind === 'radar' ? i : n), 0))
const KIND_LABEL: Record<FrameKind, string> = { radar: 'weather.radarSource', nowcast: 'weather.nowcastSource', arome: 'weather.aromeSource' }
/** Où la frise passe de l'observé au prévu, en part de la course du curseur (entre les deux images) ; `null` sans prévision. */
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

/** Les pas AROME après maintenant ; vide si le run manque, est vieux, ou si le rendu `om://` n'est pas disponible. */
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
    // l'avenir est AROME quand il y en a ; sinon la prévision immédiate du radar prend la suite
    frames.value = [...radar.past, ...(arome.length ? arome : radar.nowcast)]
    failed.value = false
    if (!started) { started = true; index.value = lastObserved.value; togglePlay() }
    else if (!playing.value) index.value = Math.min(index.value, frames.value.length - 1)
  } catch { failed.value = true }
}

/** Charge le moteur de rendu des fichiers `.om` (et son WASM) à la demande, une seule fois. */
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
  // Les crédits démarrent REPLIÉS (le bouton ⓘ les ouvre). MapLibre les déplie d'office : quand les
  // premières attributions arrivent, il pose `maplibregl-compact` ET `maplibregl-compact-show` — mais
  // seulement si la première manque. En la posant nous-mêmes tout de suite, la seconde ne vient jamais,
  // et la bascule au clic continue de fonctionner. (Retirer `compact-show` ici ne servirait à rien :
  // à cet instant l'attribution est encore vide, donc la classe n'est pas encore posée.)
  container.value.querySelector('.maplibregl-ctrl-attrib')?.classList.add('maplibregl-compact')
  // en développement seulement : la carte est interrogeable depuis la console (`el.__map`), pour vérifier
  // qu'une source dessine bien quand rien ne se voit à l'écran
  if (import.meta.env.DEV) (container.value as HTMLDivElement & { __map?: MlMap }).__map = m
  m.addControl(new NavigationControl({ showCompass: false }), 'top-left')
  const el = document.createElement('div')
  el.className = 'radar__home'
  el.innerHTML = props.away ? PIN_SVG : HOUSE_SVG
  marker = new Marker({ element: el }).setLngLat([props.home.lon, props.home.lat]).addTo(m)
  // les couches sont reposées après chaque changement de style (le thème les retire avec le style)
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
// un autre lieu : la carte s'y recentre (même zoom), le repère le suit
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
    <!-- frise fixe : bouton, heure de l'image, source de l'image (observé, immédiat, AROME), curseur -->
    <div class="radar__bar">
      <button type="button" class="radar__btn" :disabled="!frames.length" :aria-label="playing ? t('weather.pause') : t('weather.play')" @click="togglePlay">
        <StrokeIcon :name="playing ? 'pause' : 'play'" :size="16" />
      </button>
      <div class="radar__time">{{ current ? d(new Date(current.time * 1000), 'time') : '—:—' }}</div>
      <div class="radar__kind muted" :data-kind="current?.kind ?? 'radar'">{{ t(KIND_LABEL[current?.kind ?? 'radar']) }}</div>
      <!-- le curseur, et sur sa course le trait où l'observé laisse place au modèle -->
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
/* la colonne de l'heure et de la source est FIXE : « Prévision AROME · Météo-France » ne pousse pas le curseur */
.radar__bar { position: relative; flex: 0 0 52px; display: grid; grid-template-columns: 36px 150px 1fr; grid-template-rows: 1fr 1fr; align-items: center; column-gap: 10px; padding: 0 14px; background: var(--surface); border-top: 1px solid var(--line); }
.radar__btn { grid-row: 1 / 3; width: 36px; height: 36px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); display: grid; place-items: center; }
.radar__btn:disabled { opacity: .45; }
.radar__time { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; align-self: end; }
.radar__kind { font-size: 11px; align-self: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* la prévision se distingue de l'observé d'un coup d'œil : la couleur de l'accent */
.radar__kind[data-kind='arome'], .radar__kind[data-kind='nowcast'] { color: var(--accent); }
.radar__track { grid-column: 3; grid-row: 1 / 3; position: relative; display: flex; align-items: center; }
.radar__range { width: 100%; accent-color: var(--accent); }
/* la bascule observé → prévu : un trait sous la piste (la course utile du curseur exclut le pouce, ~16 px) et son mot */
.radar__switch { position: absolute; top: 50%; width: 2px; height: 12px; margin-top: 2px; background: var(--accent); transform: translateX(-1px); pointer-events: none; }
.radar__switch span { position: absolute; top: 11px; left: 4px; font-size: 10px; line-height: 1; color: var(--accent); white-space: nowrap; letter-spacing: .04em; }
:deep(.radar__home) { color: var(--accent); filter: drop-shadow(0 1px 2px rgb(0 0 0 / .35)); }
</style>
