<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Map as MlMap, Marker, NavigationControl, type FilterSpecification, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import '../../lib/maplibreWorker'
import type { FeatureCollection, Geometry } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { IGN_MAX_ZOOM, initialView, normalizeHeading, planStyleUrl, satelliteStyle, satelliteStyleWithLabels, type LatLon, type MapMode } from '../../lib/map'
import { JOURNAL_COLORS, type JournalPoint } from '../../lib/journal'
import { LAWN_COLOR, REWILDING_COLOR, SITE_MAP_LAYERS, WORK_AREA_COLORS, layerOf, type SiteMapFeatureProps, type SiteMapLayer } from '../../lib/siteMap'
import { useSettingsStore } from '../../stores/settings'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Map of a vehicle: its position (and heading), the house, plan or satellite, full screen.
//
// Full screen is a state of the COMPONENT (fixed position over the whole window), not the browser's
// Fullscreen API: the app already has its own full screen, iOS does not offer it for
// elements, and the same MapLibre canvas follows without being rebuilt — it just has to be resized.
//
// The style changes with the mode (plan ↔ satellite) and with the theme (light ↔ dark plan); the
// markers are DOM elements, they survive the style change.

const props = defineProps<{
  location?: LatLon | undefined
  headingDeg?: number | undefined
  home?: LatLon | undefined
  /** Line placed at the bottom of the map (distance, mileage). */
  caption?: string | undefined
  /** What is followed: a car (arrow turned according to its heading) or a mower (disc, no heading). */
  subject?: 'car' | 'mower' | undefined
  /** The log's incidents that know where they happened: small severity pills. */
  points?: readonly JournalPoint[] | undefined
  /** A point to BRING to the center (a chosen log row): the map goes there, and stops reframing itself. */
  focus?: LatLon | undefined
  /** The ACTIVE incident (its date): its pill grows and comes to the front. */
  activeAt?: number | undefined
  /**
   * The map of a mower's terrain, already placed on the world (`lib/siteMap.ts`): zones, obstacles,
   * cables. Present = a button shows or hides it, choice kept for all maps.
   */
  overlay?: FeatureCollection<Geometry, SiteMapFeatureProps> | undefined
}>()
const emit = defineEmits<{ pointTap: [at: number] }>()

const settings = useSettingsStore()
// DELIBERATELY new key: under the old name linger values written by an overly broad watcher
// (see below), which the user never chose. Ignoring them is the only way for the
// "satellite" default to really apply.
const MODE_KEY = 'kasbah.mapMode.v2'

const container = ref<HTMLDivElement | null>(null)
const full = ref(false)
// Satellite BY DEFAULT: on a vehicle map, recognizing one's driveway, parking lot or the
// building in front of which the car is parked is done at a glance on the photo, not on a plan.
// The user's choice, for its part, takes precedence and survives (`localStorage`).
const mode = ref<MapMode>((() => { try { return localStorage.getItem(MODE_KEY) === 'plan' ? 'plan' : 'satellite' } catch { return 'satellite' } })())
/** The user moved the map: we no longer reframe it under their fingers, a button offers it. */
const moved = ref(false)
// The terrain map is shown by LAYERS (terrain, work zones, exclusion zones, cables):
// all visible by default, those that are hidden survive, like the mode. We keep the HIDDEN ones, not the
// visible ones: a layer that appears later (a first exclusion zone) shows up by itself.
const LAYERS_KEY = 'kasbah.mapLayers.v1'
const hiddenLayers = ref<ReadonlySet<SiteMapLayer>>((() => {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((l): l is SiteMapLayer => (SITE_MAP_LAYERS as readonly unknown[]).includes(l)) : [])
  } catch { return new Set<SiteMapLayer>() }
})())
/** The layers this map really has: the menu only offers those. */
const presentLayers = computed(() => SITE_MAP_LAYERS.filter((l) => props.overlay?.features.some((f) => layerOf(f.properties.kind) === l)))
const anyLayerShown = computed(() => presentLayers.value.some((l) => !hiddenLayers.value.has(l)))
function toggleLayer(l: SiteMapLayer): void {
  const next = new Set(hiddenLayers.value)
  if (next.has(l)) next.delete(l)
  else next.add(l)
  hiddenLayers.value = next
}
/** The tint of each layer's pill in the menu: the one it has on the map. */
const LAYER_COLORS: Record<SiteMapLayer, string> = { lawn: LAWN_COLOR, work_areas: WORK_AREA_COLORS[0], stay_out: '#e53935', rewilding: REWILDING_COLOR, guides: '#42a5f5' }
const LAYER_LABELS: Record<SiteMapLayer, string> = { lawn: 'vehicle.map.layerLawn', work_areas: 'vehicle.map.layerWorkAreas', stay_out: 'vehicle.map.layerStayOut', rewilding: 'vehicle.map.layerRewilding', guides: 'vehicle.map.layerGuides' }
/** The layers menu: a panel placed ON the map, under the buttons — nothing moves when opening it. */
const layersOpen = ref(false)
const layersEl = ref<HTMLElement | null>(null)
function onOutside(e: PointerEvent): void { if (layersEl.value && !layersEl.value.contains(e.target as Node)) layersOpen.value = false }
function onLayersKey(e: KeyboardEvent): void { if (e.key === 'Escape') layersOpen.value = false }
watch(layersOpen, (open) => {
  if (open) { document.addEventListener('pointerdown', onOutside, true); window.addEventListener('keydown', onLayersKey) }
  else { document.removeEventListener('pointerdown', onOutside, true); window.removeEventListener('keydown', onLayersKey) }
})

let map: MlMap | null = null
let carMarker: Marker | null = null
let homeMarker: Marker | null = null
let pointMarkers: Marker[] = []
const pointEls = new Map<number, HTMLElement>()
let observer: ResizeObserver | null = null

const hasPosition = computed(() => !!props.location)

/**
 * The plan's style, cached per theme: it is what provides the satellite's labels, and there is
 * no point downloading it again on each toggle.
 */
const planStyles = new Map<string, Promise<StyleSpecification>>()
function planStyle(dark: boolean): Promise<StyleSpecification> {
  const url = planStyleUrl(dark)
  let p = planStyles.get(url)
  if (!p) {
    p = fetch(url).then((r) => r.json() as Promise<StyleSpecification>)
    planStyles.set(url, p)
  }
  return p
}

/**
 * Applies the current style. The satellite waits for the plan's labels; if they do not come
 * (network, service unavailable), the BARE photo is put in place anyway — better than an empty map.
 * The guard on `mode` prevents a late response from overwriting a toggle in the meantime.
 */
async function applyStyle(): Promise<void> {
  if (!map) return
  if (mode.value !== 'satellite') { map.setStyle(planStyleUrl(settings.isDark)); return }
  const dark = settings.isDark
  try {
    const plan = await planStyle(dark)
    if (map && mode.value === 'satellite') map.setStyle(satelliteStyleWithLabels(plan))
  } catch {
    if (map && mode.value === 'satellite') map.setStyle(satelliteStyle())
  }
}

function markerEl(kind: 'car' | 'mower' | 'home'): HTMLElement {
  const el = document.createElement('div')
  el.className = `vmap__marker vmap__marker--${kind}`
  // heading arrow for the car (turns with `setRotation`), disc for the mower (it does not report
  // its heading), fixed house
  el.innerHTML = kind === 'car'
    ? '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 2 L19 20 L12 16 L5 20 Z" fill="currentColor" stroke="var(--surface)" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    : kind === 'mower'
      ? '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="7" fill="currentColor" stroke="var(--surface)" stroke-width="2.5"/></svg>'
      : '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 11l9-7 9 7v9H3zM9 20v-6h6v6" fill="var(--surface)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
  return el
}

/**
 * MapLibre UNFOLDS the attribution half a second after mounting (on the first computation of the credits),
 * even in `compact` mode: 300 px wide on a 320 map, over the legend. We close it again,
 * by touching the TWO things that control it, without which it takes two taps on the ⓘ to reopen it:
 * `open` of the `<details>` (the native fold) AND the class `maplibregl-compact-show` (the display of the text,
 * which MapLibre toggles on its own on click). Only once: past that, the panel belongs to the user.
 */
let attributionClosed = false
function collapseAttribution(): void {
  if (attributionClosed) return
  const el = container.value?.querySelector<HTMLDetailsElement>('details.maplibregl-ctrl-attrib')
  if (!el || (!el.open && !el.classList.contains('maplibregl-compact-show'))) return
  el.open = false
  el.classList.remove('maplibregl-compact-show')
  attributionClosed = true
}

function fit(animate: boolean): void {
  if (!map) return
  const view = initialView(props.location, props.home)
  if (view.kind === 'bounds') {
    map.fitBounds([[view.sw.lon, view.sw.lat], [view.ne.lon, view.ne.lat]], { padding: 36, maxZoom: 17, duration: animate ? 600 : 0 })
  } else if (view.kind === 'center') {
    map.jumpTo({ center: [view.center.lon, view.center.lat], zoom: view.zoom })
  }
  moved.value = false
}

/** The incidents: one pill per point, tinted with its severity, redone on each list change. */
function placePoints(): void {
  if (!map) return
  for (const m of pointMarkers) m.remove()
  pointMarkers = []
  pointEls.clear()
  for (const p of props.points ?? []) {
    const el = document.createElement('div')
    el.className = 'vmap__marker vmap__marker--point'
    el.title = p.label
    el.dataset.active = p.at === props.activeAt ? '1' : '0'
    el.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="5" fill="${JOURNAL_COLORS[p.severity]}" stroke="var(--surface)" stroke-width="2"/></svg>`
    // touching a pill designates the incident: the list highlights it and tells it
    el.addEventListener('click', (ev) => { ev.stopPropagation(); emit('pointTap', p.at) })
    pointEls.set(p.at, el)
    pointMarkers.push(new Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map))
  }
}

/**
 * The terrain map: a GeoJSON source and three layers, UNDER the markers (which are DOM).
 * The colors are those of the vendor's app (terrain green, red, blue, yellow), plus a
 * tint per drawn work zone (`color`, that of its pill in the Zones panel): they
 * read on the photo as on the plan, whatever the theme. A style change clears sources and layers;
 * `style.load` puts them back. Hidden = an empty source, the layers remain.
 */
const EMPTY_OVERLAY: FeatureCollection = { type: 'FeatureCollection', features: [] }
function applyOverlay(): void {
  if (!map || !map.isStyleLoaded()) return
  const hidden = hiddenLayers.value
  const data = props.overlay ? { ...props.overlay, features: props.overlay.features.filter((f) => !hidden.has(layerOf(f.properties.kind))) } : EMPTY_OVERLAY
  const source = map.getSource<GeoJSONSource>('site-map')
  if (source) { source.setData(data); return }
  map.addSource('site-map', { type: 'geojson', data })
  const isArea: FilterSpecification = ['==', ['geometry-type'], 'Polygon']
  map.addLayer({
    id: 'site-map-fill', type: 'fill', source: 'site-map', filter: isArea,
    paint: {
      'fill-color': ['match', ['get', 'kind'], 'lawn', LAWN_COLOR, 'work_area', ['get', 'color'], 'rewilding', REWILDING_COLOR, '#e53935'],
      'fill-opacity': ['match', ['get', 'kind'], 'lawn', 0.16, 'work_area', 0.32, 'obstacle', 0.3, ['case', ['get', 'enabled'], 0.42, 0.06]],
    },
  })
  map.addLayer({
    id: 'site-map-outline', type: 'line', source: 'site-map', filter: isArea,
    paint: {
      'line-color': ['match', ['get', 'kind'], 'lawn', '#66bb6a', 'work_area', ['get', 'color'], 'rewilding', REWILDING_COLOR, '#ef5350'],
      'line-width': ['match', ['get', 'kind'], 'work_area', 2.5, 1.5],
    },
  })
  map.addLayer({
    id: 'site-map-lines', type: 'line', source: 'site-map', filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'kind'], 'station', '#fdd835', '#42a5f5'],
      'line-width': ['match', ['get', 'kind'], 'station', 4, 'transport', 3, 2],
    },
  })
}

function placeMarkers(): void {
  if (!map) return
  // the position BEFORE `addTo`: MapLibre projects the marker when adding it, without a position it crashes
  if (props.location) {
    const at: [number, number] = [props.location.lon, props.location.lat]
    carMarker ??= new Marker({ element: markerEl(props.subject ?? 'car'), rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(at).addTo(map)
    carMarker.setLngLat(at)
    carMarker.setRotation(props.headingDeg === undefined ? 0 : normalizeHeading(props.headingDeg))
  } else if (carMarker) { carMarker.remove(); carMarker = null }
  if (props.home) {
    const at: [number, number] = [props.home.lon, props.home.lat]
    homeMarker ??= new Marker({ element: markerEl('home') }).setLngLat(at).addTo(map)
    homeMarker.setLngLat(at)
  } else if (homeMarker) { homeMarker.remove(); homeMarker = null }
}

onMounted(() => {
  if (!container.value) return
  const m = new MlMap({
    // starting style: the bare photo, replaced as soon as the plan's labels are there
    container: container.value, style: mode.value === 'satellite' ? satelliteStyle() : planStyleUrl(settings.isDark),
    attributionControl: { compact: true },
    maxZoom: IGN_MAX_ZOOM + 1, dragRotate: true, pitchWithRotate: true,
  })
  map = m
  // the panel is only unfolded after the first computation of the credits: we watch for the three moments
  for (const ev of ['load', 'styledata', 'idle'] as const) m.on(ev, collapseAttribution)
  m.on('style.load', applyOverlay)
  // in development only: the map can be queried from the console (`el.__map`), which
  // makes it possible to check that it does render features when nothing shows on screen
  if (import.meta.env.DEV) (container.value as HTMLDivElement & { __map?: MlMap }).__map = m
  m.addControl(new NavigationControl({ showCompass: true, visualizePitch: true }), 'top-left')
  // a user gesture (not a `jumpTo` of the component): the map is theirs
  for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) {
    m.on(ev, (e: { originalEvent?: unknown }) => { if (e.originalEvent) moved.value = true })
  }
  void applyStyle()
  placeMarkers()
  placePoints()
  fit(false)
  // the vehicle map lives in a grid that resizes: MapLibre only follows the window
  observer = new ResizeObserver(() => m.resize())
  observer.observe(container.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  map?.remove()
  map = null
})

// position or heading that change: the markers follow; the view too, as long as the user has not touched it
watch(() => [props.location?.lat, props.location?.lon, props.headingDeg, props.home?.lat, props.home?.lon], () => {
  placeMarkers()
  if (!moved.value) fit(true)
})
watch(() => props.points, placePoints)
// the active one changes: only two pills change state, nothing is redone
watch(() => props.activeAt, (at) => { for (const [k, el] of pointEls) el.dataset.active = k === at ? '1' : '0' })
// a chosen point: the map goes there (close enough to read the garden), and it is as if the user
// had moved it — it no longer reframes itself, "Recenter" offers it
watch(() => props.focus, (f) => {
  if (!f || !map) return
  map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 18), duration: 500 })
  moved.value = true
})
watch([mode, () => settings.isDark], () => { void applyStyle() })
watch([() => props.overlay, hiddenLayers], applyOverlay)
watch(hiddenLayers, (h) => {
  try { localStorage.setItem(LAYERS_KEY, JSON.stringify([...h])) } catch { /* storage unavailable: the choice does not survive */ }
})
onBeforeUnmount(() => { layersOpen.value = false })
// The choice is written ONLY when the mode changes. It used to be rewritten on each theme
// change, which filed as "the user's choice" a mode they had never touched —
// and the default then never again had the opportunity to apply.
watch(mode, (m) => {
  try { localStorage.setItem(MODE_KEY, m) } catch { /* storage unavailable: the choice does not survive, no more */ }
})

function toggleFull(): void {
  full.value = !full.value
  // the container changes size at the next render: resize after, and reframe if
  // the user had not taken control (the thumbnail and the full screen do not have the same frame)
  requestAnimationFrame(() => { map?.resize(); if (!moved.value) fit(false) })
}
function onKey(e: KeyboardEvent): void { if (e.key === 'Escape' && full.value) toggleFull() }
watch(full, (f) => { if (f) window.addEventListener('keydown', onKey); else window.removeEventListener('keydown', onKey) })
</script>

<template>
  <div class="vmap" :class="{ 'vmap--full': full }">
    <div ref="container" class="vmap__canvas" />
    <!-- our buttons on the right; MapLibre's native buttons (zoom, compass) are on the left -->
    <div class="vmap__tools">
      <div v-if="presentLayers.length" ref="layersEl" class="vmap__layers-wrap">
        <button type="button" class="vmap__btn" :data-on="anyLayerShown ? '1' : '0'" :aria-expanded="layersOpen" aria-haspopup="true"
                :title="$t('vehicle.map.layers')" @click="layersOpen = !layersOpen">
          <StrokeIcon name="layers" :size="16" />
        </button>
        <div v-if="layersOpen" class="vmap__layers" role="group" :aria-label="$t('vehicle.map.layers')">
          <label v-for="l in presentLayers" :key="l" class="vmap__layer">
            <input type="checkbox" :checked="!hiddenLayers.has(l)" @change="toggleLayer(l)" />
            <span class="vmap__swatch" :style="{ background: LAYER_COLORS[l] }" aria-hidden="true" />
            <span class="vmap__layer-name">{{ $t(LAYER_LABELS[l]) }}</span>
          </label>
        </div>
      </div>
      <button type="button" class="vmap__btn" :data-on="mode === 'satellite' ? '1' : '0'" :title="$t(mode === 'plan' ? 'vehicle.map.satellite' : 'vehicle.map.plan')"
              @click="mode = mode === 'plan' ? 'satellite' : 'plan'">
        {{ $t(mode === 'plan' ? 'vehicle.map.satellite' : 'vehicle.map.plan') }}
      </button>
      <button v-if="moved" type="button" class="vmap__btn" :title="$t('vehicle.map.recenter')" @click="fit(true)">
        <StrokeIcon name="crosshair" :size="16" />
      </button>
      <button type="button" class="vmap__btn" :title="$t(full ? 'vehicle.map.close' : 'vehicle.map.fullscreen')" @click="toggleFull">
        <StrokeIcon :name="full ? 'close' : 'fullscreen'" :size="16" />
      </button>
    </div>
    <!-- without a position: the map stays (the house shows on it), a veil says so -->
    <div v-if="!hasPosition" class="vmap__empty muted">{{ $t('vehicle.map.noPosition') }}</div>
    <div v-if="caption" class="vmap__caption">{{ caption }}</div>
  </div>
</template>

<style scoped>
.vmap { position: relative; border-radius: var(--radius); overflow: hidden; background: var(--surface2); min-height: 220px; }
/* `!important`: the parent sets the thumbnail's height through its own class (`.vcard__map`), and in
   full screen it is the window that must give it — otherwise the map stretched in width over 220 px */
.vmap--full { position: fixed; inset: 0; z-index: 2000; border-radius: 0; min-height: 0; width: auto !important; height: auto !important; }
.vmap__canvas { position: absolute; inset: 0; }
.vmap__tools { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; z-index: 2; }
.vmap__btn {
  height: 32px; min-width: 32px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: 500 12px/1 var(--font); display: inline-flex; align-items: center; gap: 6px;
  box-shadow: 0 1px 4px rgb(0 0 0 / .15);
}
.vmap__btn[data-on='1'] { background: var(--accent); color: var(--on-accent); border-color: transparent; }
/* the layers menu: placed under the row of buttons, aligned on ITS right edge (the map's) and
   not on the button, the leftmost of the row — on a phone it went out of the map, cut off.
   OVER the map: nothing moves when opening it. */
.vmap__layers-wrap { position: static; }
.vmap__layers {
  position: absolute; top: calc(100% + 6px); right: 0; min-width: 200px; padding: 4px; display: grid; gap: 1px;
  /* five layers fit in the lowest map (220 px, buttons included); beyond that, it scrolls */
  max-height: 164px; overflow-y: auto;
  background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 4px 16px rgb(0 0 0 / .25);
}
.vmap__layer { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 8px; border-radius: 8px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.vmap__layer:hover { background: var(--surface2); }
.vmap__layer input { margin: 0; accent-color: var(--accent); }
.vmap__swatch { flex: none; width: 12px; height: 12px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .25); }
.vmap__layer-name { flex: 1 1 auto; }
.vmap__caption {
  /* stops before the attribution's ⓘ (26 px + its margins), which occupies the bottom right corner */
  position: absolute; left: 10px; bottom: 10px; max-width: calc(100% - 66px); padding: 4px 10px; border-radius: 999px; z-index: 2;
  background: var(--surface); color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 1px 4px rgb(0 0 0 / .15);
}
.vmap__empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; z-index: 1; pointer-events: none; }
/* markers: accent color for the car, text color for the house; the shadow detaches them from the satellite */
:global(.vmap__marker) { display: grid; place-items: center; filter: drop-shadow(0 1px 2px rgb(0 0 0 / .4)); }
:global(.vmap__marker--car), :global(.vmap__marker--mower) { color: var(--accent); }
/* the incidents go UNDER the robot and the house: they are what one looks for, not what one follows;
   the ACTIVE one grows and comes to the front — it is the one being looked at */
:global(.vmap__marker--point) { z-index: 0; cursor: pointer; }
:global(.vmap__marker--point svg) { transition: transform .15s; }
:global(.vmap__marker--point[data-active='1']) { z-index: 1; }
:global(.vmap__marker--point[data-active='1'] svg) { transform: scale(1.7); }
:global(.vmap__marker--home) { color: var(--text); }
/* MapLibre's native buttons follow the theme tokens */
:global(.vmap .maplibregl-ctrl-group) { background: var(--surface); border-radius: 10px; box-shadow: 0 1px 4px rgb(0 0 0 / .15); }
:global(.vmap .maplibregl-ctrl-group button) { width: 32px; height: 32px; }
:global(.vmap .maplibregl-ctrl-group button + button) { border-top-color: var(--line); }
/* Attribution: folded it fits in a ⓘ pill like the other buttons; unfolded, it
   opens as a small readable panel, bounded to the map's width. */
:global(.vmap .maplibregl-ctrl-attrib.maplibregl-compact) {
  box-sizing: border-box; min-height: 26px; padding: 3px 26px 3px 0; margin: 10px;
  background: var(--surface); color: var(--muted); border-radius: 999px; box-shadow: 0 1px 4px rgb(0 0 0 / .15);
}
/* unfolded, the panel RISES by one line: it would otherwise pass behind the distance pill, which
   occupies the bottom of the map (10 px of bottom + 26 px of height, plus a gap of 8 px) */
:global(.vmap .maplibregl-ctrl-attrib.maplibregl-compact-show) { padding: 3px 30px 3px 12px; max-width: calc(100% - 20px); }
:global(.vmap:has(.vmap__caption) .maplibregl-ctrl-attrib.maplibregl-compact-show) { margin-bottom: 44px; }
:global(.vmap .maplibregl-ctrl-attrib-inner) { font-size: 10px; line-height: 1.5; }
:global(.vmap .maplibregl-ctrl-attrib a) { color: var(--text); }
/* `background-position: center`: MapLibre's ⓘ is set at the top left by default, and ended up
   off-center as soon as the size of the button or of the image changes */
:global(.vmap .maplibregl-ctrl-attrib-button),
:global(.vmap .maplibregl-ctrl-attrib.maplibregl-compact-show .maplibregl-ctrl-attrib-button) {
  width: 26px; height: 26px; border-radius: 999px; background-color: transparent;
  background-size: 18px 18px; background-position: center; background-repeat: no-repeat;
}
/* MapLibre's ⓘ is a DARK image: on a dark surface it would disappear */
:global(html[data-theme='dark'] .vmap .maplibregl-ctrl-attrib-button) { filter: invert(1); }
</style>
