<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Map as MlMap, Marker, NavigationControl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import '../../lib/maplibreWorker'
import 'maplibre-gl/dist/maplibre-gl.css'
import { FIRST_ROOM, localToGeo, type GeoOrigin, type Vec2 } from '@kasbah/shared'
import { IGN_MAX_ZOOM, planStyleUrl, satelliteStyle, satelliteStyleWithLabels, type MapMode } from '../../lib/map'
import { useSettingsStore } from '../../stores/settings'
import Segmented from '../ui/Segmented.vue'
import { AXIS_COLORS } from './axes'

// POINT 0 of a new property, placed on the map: a corner of the house, from which all the
// measurements start. It is placed by a tap (or by dragging the marker), the heading is turned until the first
// room drawn (5 × 4 m, corner on point 0) aligns with a facade of the photo. The land, when
// given, is drawn too: one sees what the assistant will write before it writes it.
const props = defineProps<{
  lat: number | null
  lon: number | null
  heading: number
  /** Land centered on the first room (m), drawn if given. */
  terrain?: { width: number; depth: number } | null
}>()
const emit = defineEmits<{ pick: [lat: number, lon: number] }>()
const settings = useSettingsStore()

const container = ref<HTMLDivElement | null>(null)
const mode = ref<MapMode>('satellite')
let map: MlMap | null = null
let marker: Marker | null = null
let observer: ResizeObserver | null = null

/** Starting view: the whole of France (the IGN orthophotos only cover it; the plan, the world). */
const START = { center: [2.4, 46.6] as [number, number], zoom: 5 }
const ROOM_ZOOM = IGN_MAX_ZOOM + 1   // the 5 m room is about sixty pixels there

const origin = (): GeoOrigin | null => (props.lat === null || props.lon === null ? null : { lat: props.lat, lon: props.lon, alt: 0, heading: props.heading })
const ll = (o: GeoOrigin, p: Vec2): [number, number] => { const g = localToGeo(o, [p[0], p[1], 0]); return [g.lon, g.lat] }

type OverlayData = Parameters<GeoJSONSource['setData']>[0]
/** The room, the two axes and the land, as GeoJSON: what the map overlays on the photo. */
function overlay(): OverlayData {
  const o = origin()
  if (!o) return { type: 'FeatureCollection', features: [] }
  const ring = (pts: readonly Vec2[]) => [...pts.map((p) => ll(o, p)), ll(o, pts[0]!)]
  const features: object[] = [
    { type: 'Feature', properties: { role: 'room' }, geometry: { type: 'Polygon', coordinates: [ring(FIRST_ROOM)] } },
    { type: 'Feature', properties: { role: 'axis', label: 'x' }, geometry: { type: 'LineString', coordinates: [ll(o, [0, 0]), ll(o, [8, 0])] } },
    { type: 'Feature', properties: { role: 'axis', label: 'y' }, geometry: { type: 'LineString', coordinates: [ll(o, [0, 0]), ll(o, [0, 8])] } },
  ]
  if (props.terrain) {
    const w = props.terrain.width / 2, d = props.terrain.depth / 2
    features.push({ type: 'Feature', properties: { role: 'terrain' }, geometry: { type: 'Polygon', coordinates: [ring([[2.5 - w, 2 - d], [2.5 + w, 2 - d], [2.5 + w, 2 + d], [2.5 - w, 2 + d]])] } })
  }
  return { type: 'FeatureCollection', features } as OverlayData
}

/** The house layers, put back after each style change (a `setStyle` clears them). */
function addOverlay(): void {
  if (!map || map.getSource('origin')) return
  map.addSource('origin', { type: 'geojson', data: overlay() })
  map.addLayer({ id: 'origin-terrain', type: 'line', source: 'origin', filter: ['==', ['get', 'role'], 'terrain'], paint: { 'line-color': '#f5d76e', 'line-width': 2, 'line-dasharray': [2, 2] } })
  map.addLayer({ id: 'origin-room-fill', type: 'fill', source: 'origin', filter: ['==', ['get', 'role'], 'room'], paint: { 'fill-color': '#4fd1c5', 'fill-opacity': 0.25 } })
  map.addLayer({ id: 'origin-room', type: 'line', source: 'origin', filter: ['==', ['get', 'role'], 'room'], paint: { 'line-color': '#4fd1c5', 'line-width': 2.5 } })
  map.addLayer({ id: 'origin-axis', type: 'line', source: 'origin', filter: ['==', ['get', 'role'], 'axis'], paint: { 'line-color': ['match', ['get', 'label'], 'x', AXIS_COLORS.x, AXIS_COLORS.y], 'line-width': 3 } })
}
function refresh(): void { (map?.getSource('origin') as GeoJSONSource | undefined)?.setData(overlay()) }

const planStyles = new Map<string, Promise<StyleSpecification>>()
// `diff: false`: a style change "by difference" removes our layers WITHOUT emitting
// `style.load`, which puts them back — the room, the axes and the land disappeared depending on whether the style
// of the labels arrived before or after the first load.
const FULL = { diff: false } as const
async function applyStyle(): Promise<void> {
  if (!map) return
  if (mode.value !== 'satellite') { map.setStyle(planStyleUrl(settings.isDark), FULL); return }
  const url = planStyleUrl(settings.isDark)
  let p = planStyles.get(url)
  if (!p) { p = fetch(url).then((r) => r.json() as Promise<StyleSpecification>); planStyles.set(url, p) }
  try { const plan = await p; if (map && mode.value === 'satellite') map.setStyle(satelliteStyleWithLabels(plan), FULL) }
  catch { if (map && mode.value === 'satellite') map.setStyle(satelliteStyle(), FULL) }
}

function placeMarker(): void {
  if (!map) return
  const o = origin()
  if (!o) { marker?.remove(); marker = null; return }
  if (!marker) {
    const el = document.createElement('div')
    el.className = 'op__marker'
    marker = new Marker({ element: el, draggable: true }).setLngLat([o.lon, o.lat]).addTo(map)
    marker.on('dragend', () => { const p = marker!.getLngLat(); emit('pick', p.lat, p.lng) })
  }
  marker.setLngLat([o.lon, o.lat])
}

/** Go and see a place (search, device position): the map settles there at the room's level. */
function flyTo(lat: number, lon: number): void { map?.flyTo({ center: [lon, lat], zoom: ROOM_ZOOM }) }
defineExpose({ flyTo })

onMounted(() => {
  if (!container.value) return
  const o = origin()
  const m = new MlMap({
    container: container.value, style: satelliteStyle(), attributionControl: { compact: true },
    maxZoom: IGN_MAX_ZOOM + 1, dragRotate: false, pitchWithRotate: false,
    ...(o ? { center: [o.lon, o.lat] as [number, number], zoom: ROOM_ZOOM } : START),
  })
  map = m
  m.addControl(new NavigationControl({ showCompass: false }), 'top-left')
  m.on('style.load', () => { addOverlay(); refresh() })
  m.on('click', (e) => emit('pick', e.lngLat.lat, e.lngLat.lng))
  void applyStyle()
  placeMarker()
  observer = new ResizeObserver(() => m.resize())
  observer.observe(container.value)
})
onBeforeUnmount(() => { observer?.disconnect(); map?.remove(); map = null; marker = null })

watch(() => [props.lat, props.lon, props.heading, props.terrain?.width, props.terrain?.depth], () => { placeMarker(); refresh() })
// the land appears (step 3): the map zooms out to show it in full
watch(() => !!props.terrain, (on) => {
  const o = origin()
  if (!on || !o || !map || !props.terrain) return
  const w = props.terrain.width / 2, d = props.terrain.depth / 2
  const pts = ([[2.5 - w, 2 - d], [2.5 + w, 2 - d], [2.5 + w, 2 + d], [2.5 - w, 2 + d]] as Vec2[]).map((p) => ll(o, p))
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1])
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40, maxZoom: IGN_MAX_ZOOM + 1 })
})
watch(mode, () => void applyStyle())
watch(() => settings.isDark, () => { if (mode.value === 'plan') void applyStyle() })
</script>

<template>
  <div class="op">
    <div ref="container" class="op__map" />
    <Segmented class="op__mode" dense :model-value="mode" :options="[{ value: 'satellite', label: $t('property.wizard.satellite') }, { value: 'plan', label: $t('property.wizard.plan') }]"
               @update:model-value="(v: MapMode) => { mode = v }" />
    <div class="op__legend">
      <span><i class="op__swatch" :style="{ background: AXIS_COLORS.x }" />x</span>
      <span><i class="op__swatch" :style="{ background: AXIS_COLORS.y }" />y</span>
      <span><i class="op__swatch op__swatch--room" />{{ $t('property.wizard.legendRoom') }}</span>
      <span v-if="terrain"><i class="op__swatch op__swatch--terrain" />{{ $t('property.wizard.legendTerrain') }}</span>
    </div>
  </div>
</template>

<style scoped>
.op { position: relative; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--line); min-height: 0; }
.op__map { position: absolute; inset: 0; }
.op__mode { position: absolute; top: 8px; right: 8px; z-index: 1; }
.op__legend {
  position: absolute; left: 8px; bottom: 8px; z-index: 1; display: flex; gap: 10px; padding: 4px 8px;
  border-radius: 8px; background: color-mix(in srgb, var(--surface) 85%, transparent); font-size: 12px;
}
.op__legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.op__swatch { display: inline-block; width: 12px; height: 3px; border-radius: 2px; }
.op__swatch--room { background: #4fd1c5; height: 8px; }
.op__swatch--terrain { background: #f5d76e; }
:deep(.op__marker) {
  width: 18px; height: 18px; border-radius: 50%; background: var(--accent); border: 3px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, .5); cursor: grab;
}
</style>
