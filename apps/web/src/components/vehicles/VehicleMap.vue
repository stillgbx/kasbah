<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Map as MlMap, Marker, NavigationControl, type FilterSpecification, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection, Geometry } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { IGN_MAX_ZOOM, initialView, normalizeHeading, planStyleUrl, satelliteStyle, satelliteStyleWithLabels, type LatLon, type MapMode } from '../../lib/map'
import { JOURNAL_COLORS, type JournalPoint } from '../../lib/journal'
import { LAWN_COLOR, REWILDING_COLOR, SITE_MAP_LAYERS, WORK_AREA_COLORS, layerOf, type SiteMapFeatureProps, type SiteMapLayer } from '../../lib/siteMap'
import { useSettingsStore } from '../../stores/settings'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Carte d'un véhicule : sa position (et son cap), la maison, plan ou satellite, plein écran.
//
// Le plein écran est un état du COMPOSANT (position fixe sur toute la fenêtre), pas l'API
// Fullscreen du navigateur : l'app a déjà son propre plein écran, iOS ne l'offre pas aux
// éléments, et un même canvas MapLibre suit sans se reconstruire — il suffit de le redimensionner.
//
// Le style change avec le mode (plan ↔ satellite) et avec le thème (plan clair ↔ sombre) ; les
// marqueurs sont des éléments DOM, ils survivent au changement de style.

const props = defineProps<{
  location?: LatLon | undefined
  headingDeg?: number | undefined
  home?: LatLon | undefined
  /** Ligne posée en bas de la carte (distance, kilométrage). */
  caption?: string | undefined
  /** Ce qu'on suit : une voiture (flèche tournée selon son cap) ou une tondeuse (disque, pas de cap). */
  subject?: 'car' | 'mower' | undefined
  /** Les incidents du journal qui savent où ils se sont produits : petites pastilles de gravité. */
  points?: readonly JournalPoint[] | undefined
  /** Un point à AMENER au centre (une ligne du journal choisie) : la carte y va, et cesse de se recadrer seule. */
  focus?: LatLon | undefined
  /** L'incident ACTIF (sa date) : sa pastille grossit et passe devant. */
  activeAt?: number | undefined
  /**
   * La carte du terrain d'une tondeuse, déjà posée sur le monde (`lib/siteMap.ts`) : zones, obstacles,
   * câbles. Présente = un bouton la montre ou la masque, choix gardé pour toutes les cartes.
   */
  overlay?: FeatureCollection<Geometry, SiteMapFeatureProps> | undefined
}>()
const emit = defineEmits<{ pointTap: [at: number] }>()

const settings = useSettingsStore()
// Clé VOLONTAIREMENT nouvelle : sous l'ancien nom traînent des valeurs écrites par un watcher trop
// large (cf. plus bas), que l'utilisateur n'a jamais choisies. Les ignorer est le seul moyen que le
// défaut « satellite » s'applique vraiment.
const MODE_KEY = 'kasbah.mapMode.v2'

const container = ref<HTMLDivElement | null>(null)
const full = ref(false)
// Satellite PAR DÉFAUT : sur une carte de véhicule, reconnaître son allée, son parking ou le
// bâtiment devant lequel la voiture est garée se fait d'un coup d'œil sur la photo, pas sur un plan.
// Le choix de l'utilisateur, lui, prime et survit (`localStorage`).
const mode = ref<MapMode>((() => { try { return localStorage.getItem(MODE_KEY) === 'plan' ? 'plan' : 'satellite' } catch { return 'satellite' } })())
/** L'utilisateur a bougé la carte : on ne la recadre plus sous ses doigts, un bouton le propose. */
const moved = ref(false)
// La carte du terrain se montre par CALQUES (terrain, zones de travail, zones d'exclusion, câbles) :
// tous visibles par défaut, ceux qu'on masque survivent, comme le mode. On garde les MASQUÉS, pas les
// visibles : un calque qui apparaît plus tard (une première zone d'exclusion) se montre de lui-même.
const LAYERS_KEY = 'kasbah.mapLayers.v1'
const hiddenLayers = ref<ReadonlySet<SiteMapLayer>>((() => {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((l): l is SiteMapLayer => (SITE_MAP_LAYERS as readonly unknown[]).includes(l)) : [])
  } catch { return new Set<SiteMapLayer>() }
})())
/** Les calques que cette carte a vraiment : le menu ne propose que ceux-là. */
const presentLayers = computed(() => SITE_MAP_LAYERS.filter((l) => props.overlay?.features.some((f) => layerOf(f.properties.kind) === l)))
const anyLayerShown = computed(() => presentLayers.value.some((l) => !hiddenLayers.value.has(l)))
function toggleLayer(l: SiteMapLayer): void {
  const next = new Set(hiddenLayers.value)
  if (next.has(l)) next.delete(l)
  else next.add(l)
  hiddenLayers.value = next
}
/** La teinte de la pastille de chaque calque dans le menu : celle qu'il a sur la carte. */
const LAYER_COLORS: Record<SiteMapLayer, string> = { lawn: LAWN_COLOR, work_areas: WORK_AREA_COLORS[0], stay_out: '#e53935', rewilding: REWILDING_COLOR, guides: '#42a5f5' }
const LAYER_LABELS: Record<SiteMapLayer, string> = { lawn: 'vehicle.map.layerLawn', work_areas: 'vehicle.map.layerWorkAreas', stay_out: 'vehicle.map.layerStayOut', rewilding: 'vehicle.map.layerRewilding', guides: 'vehicle.map.layerGuides' }
/** Le menu des calques : un panneau posé SUR la carte, sous les boutons — rien ne bouge en l'ouvrant. */
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
 * Le style du plan, en cache par thème : c'est lui qui fournit les étiquettes du satellite, et il
 * ne sert à rien de le retélécharger à chaque bascule.
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
 * Applique le style courant. Le satellite attend les étiquettes du plan ; si elles ne viennent pas
 * (réseau, service indisponible), la photo NUE est posée quand même — mieux qu'une carte vide.
 * La garde sur `mode` évite qu'une réponse en retard écrase une bascule entre-temps.
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
  // flèche de cap pour la voiture (tourne avec `setRotation`), disque pour la tondeuse (elle ne dit
  // pas son cap), maison fixe
  el.innerHTML = kind === 'car'
    ? '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M12 2 L19 20 L12 16 L5 20 Z" fill="currentColor" stroke="var(--surface)" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    : kind === 'mower'
      ? '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="7" fill="currentColor" stroke="var(--surface)" stroke-width="2.5"/></svg>'
      : '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 11l9-7 9 7v9H3zM9 20v-6h6v6" fill="var(--surface)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
  return el
}

/**
 * MapLibre DÉPLIE l'attribution une demi-seconde après le montage (au premier calcul des mentions),
 * même en mode `compact` : 300 px de large sur une carte de 320, par-dessus la légende. On la referme,
 * en touchant aux DEUX choses qui la commandent, sans quoi il faut deux taps sur le ⓘ pour la rouvrir :
 * `open` du `<details>` (le repli natif) ET la classe `maplibregl-compact-show` (l'affichage du texte,
 * que MapLibre bascule de son côté au clic). Une seule fois : passé là, le panneau est à l'utilisateur.
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

/** Les incidents : une pastille par point, teintée de sa gravité, refaite à chaque changement de liste. */
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
    // toucher une pastille désigne l'incident : la liste le surligne et le raconte
    el.addEventListener('click', (ev) => { ev.stopPropagation(); emit('pointTap', p.at) })
    pointEls.set(p.at, el)
    pointMarkers.push(new Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map))
  }
}

/**
 * La carte du terrain : une source GeoJSON et trois couches, SOUS les marqueurs (qui sont du DOM).
 * Les couleurs sont celles de l'appli du fabricant (vert du terrain, rouge, bleu, jaune), plus une
 * teinte par zone de travail tracée (`color`, celle de sa pastille dans le panneau Zones) : elles se
 * lisent sur la photo comme sur le plan, quel que soit le thème. Un changement de style efface sources et couches ;
 * `style.load` les repose. Masquée = une source vide, les couches restent.
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
  // la position AVANT `addTo` : MapLibre projette le marqueur en l'ajoutant, sans position il plante
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
    // style de départ : la photo nue, remplacée dès que les étiquettes du plan sont là
    container: container.value, style: mode.value === 'satellite' ? satelliteStyle() : planStyleUrl(settings.isDark),
    attributionControl: { compact: true },
    maxZoom: IGN_MAX_ZOOM + 1, dragRotate: true, pitchWithRotate: true,
  })
  map = m
  // le panneau n'est déplié qu'après le premier calcul des mentions : on guette les trois moments
  for (const ev of ['load', 'styledata', 'idle'] as const) m.on(ev, collapseAttribution)
  m.on('style.load', applyOverlay)
  // en développement seulement : la carte est interrogeable depuis la console (`el.__map`), ce qui
  // permet de vérifier qu'elle rend bien des entités quand rien ne se voit à l'écran
  if (import.meta.env.DEV) (container.value as HTMLDivElement & { __map?: MlMap }).__map = m
  m.addControl(new NavigationControl({ showCompass: true, visualizePitch: true }), 'top-left')
  // un geste de l'utilisateur (pas un `jumpTo` du composant) : la carte est à lui
  for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) {
    m.on(ev, (e: { originalEvent?: unknown }) => { if (e.originalEvent) moved.value = true })
  }
  void applyStyle()
  placeMarkers()
  placePoints()
  fit(false)
  // la carte du véhicule vit dans une grille qui se redimensionne : MapLibre ne suit que la fenêtre
  observer = new ResizeObserver(() => m.resize())
  observer.observe(container.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  map?.remove()
  map = null
})

// position ou cap qui changent : les marqueurs suivent ; la vue aussi, tant que l'utilisateur n'y a pas touché
watch(() => [props.location?.lat, props.location?.lon, props.headingDeg, props.home?.lat, props.home?.lon], () => {
  placeMarkers()
  if (!moved.value) fit(true)
})
watch(() => props.points, placePoints)
// l'actif change : seules deux pastilles changent d'état, rien n'est refait
watch(() => props.activeAt, (at) => { for (const [k, el] of pointEls) el.dataset.active = k === at ? '1' : '0' })
// un point choisi : la carte y va (assez près pour lire le jardin), et c'est comme si l'utilisateur
// l'avait déplacée — elle ne se recadre plus seule, « Recentrer » le propose
watch(() => props.focus, (f) => {
  if (!f || !map) return
  map.easeTo({ center: [f.lon, f.lat], zoom: Math.max(map.getZoom(), 18), duration: 500 })
  moved.value = true
})
watch([mode, () => settings.isDark], () => { void applyStyle() })
watch([() => props.overlay, hiddenLayers], applyOverlay)
watch(hiddenLayers, (h) => {
  try { localStorage.setItem(LAYERS_KEY, JSON.stringify([...h])) } catch { /* stockage indisponible : le choix ne survit pas */ }
})
onBeforeUnmount(() => { layersOpen.value = false })
// Le choix n'est écrit QUE lorsque le mode change. Il était auparavant réécrit à chaque changement
// de thème, ce qui rangeait comme « choix de l'utilisateur » un mode qu'il n'avait jamais touché —
// et le défaut n'avait alors plus jamais l'occasion de s'appliquer.
watch(mode, (m) => {
  try { localStorage.setItem(MODE_KEY, m) } catch { /* stockage indisponible : le choix ne survit pas, sans plus */ }
})

function toggleFull(): void {
  full.value = !full.value
  // le conteneur change de taille au prochain rendu : redimensionner après, et recadrer si
  // l'utilisateur n'avait pas pris la main (la vignette et le plein écran n'ont pas le même cadre)
  requestAnimationFrame(() => { map?.resize(); if (!moved.value) fit(false) })
}
function onKey(e: KeyboardEvent): void { if (e.key === 'Escape' && full.value) toggleFull() }
watch(full, (f) => { if (f) window.addEventListener('keydown', onKey); else window.removeEventListener('keydown', onKey) })
</script>

<template>
  <div class="vmap" :class="{ 'vmap--full': full }">
    <div ref="container" class="vmap__canvas" />
    <!-- nos boutons à droite ; les boutons natifs de MapLibre (zoom, boussole) sont à gauche -->
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
    <!-- sans position : la carte reste (la maison s'y voit), un voile le dit -->
    <div v-if="!hasPosition" class="vmap__empty muted">{{ $t('vehicle.map.noPosition') }}</div>
    <div v-if="caption" class="vmap__caption">{{ caption }}</div>
  </div>
</template>

<style scoped>
.vmap { position: relative; border-radius: var(--radius); overflow: hidden; background: var(--surface2); min-height: 220px; }
/* `!important` : le parent pose la hauteur de la vignette par sa propre classe (`.vcard__map`), et en
   plein écran c'est la fenêtre qui doit la donner — sans quoi la carte s'étirait en largeur sur 220 px */
.vmap--full { position: fixed; inset: 0; z-index: 2000; border-radius: 0; min-height: 0; width: auto !important; height: auto !important; }
.vmap__canvas { position: absolute; inset: 0; }
.vmap__tools { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; z-index: 2; }
.vmap__btn {
  height: 32px; min-width: 32px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: 500 12px/1 var(--font); display: inline-flex; align-items: center; gap: 6px;
  box-shadow: 0 1px 4px rgb(0 0 0 / .15);
}
.vmap__btn[data-on='1'] { background: var(--accent); color: var(--on-accent); border-color: transparent; }
/* le menu des calques : posé sous la rangée de boutons, calé sur SON bord droit (celui de la carte) et
   non sur le bouton, le plus à gauche de la rangée — sur un téléphone il sortait de la carte, coupé.
   PAR-DESSUS la carte : rien ne bouge en l'ouvrant. */
.vmap__layers-wrap { position: static; }
.vmap__layers {
  position: absolute; top: calc(100% + 6px); right: 0; min-width: 200px; padding: 4px; display: grid; gap: 1px;
  /* cinq calques tiennent dans la carte la plus basse (220 px, boutons compris) ; au-delà, il défile */
  max-height: 164px; overflow-y: auto;
  background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 4px 16px rgb(0 0 0 / .25);
}
.vmap__layer { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 8px; border-radius: 8px; font-size: 13px; cursor: pointer; white-space: nowrap; }
.vmap__layer:hover { background: var(--surface2); }
.vmap__layer input { margin: 0; accent-color: var(--accent); }
.vmap__swatch { flex: none; width: 12px; height: 12px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .25); }
.vmap__layer-name { flex: 1 1 auto; }
.vmap__caption {
  /* s'arrête avant le ⓘ de l'attribution (26 px + ses marges), qui occupe le coin bas droit */
  position: absolute; left: 10px; bottom: 10px; max-width: calc(100% - 66px); padding: 4px 10px; border-radius: 999px; z-index: 2;
  background: var(--surface); color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 1px 4px rgb(0 0 0 / .15);
}
.vmap__empty { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; z-index: 1; pointer-events: none; }
/* marqueurs : couleur de l'accent pour la voiture, du texte pour la maison ; l'ombre les détache du satellite */
:global(.vmap__marker) { display: grid; place-items: center; filter: drop-shadow(0 1px 2px rgb(0 0 0 / .4)); }
:global(.vmap__marker--car), :global(.vmap__marker--mower) { color: var(--accent); }
/* les incidents passent SOUS le robot et la maison : ce sont eux qu'on cherche, pas eux qu'on suit ;
   l'ACTIF grossit et passe devant — c'est lui qu'on regarde */
:global(.vmap__marker--point) { z-index: 0; cursor: pointer; }
:global(.vmap__marker--point svg) { transition: transform .15s; }
:global(.vmap__marker--point[data-active='1']) { z-index: 1; }
:global(.vmap__marker--point[data-active='1'] svg) { transform: scale(1.7); }
:global(.vmap__marker--home) { color: var(--text); }
/* les boutons natifs de MapLibre suivent les jetons du thème */
:global(.vmap .maplibregl-ctrl-group) { background: var(--surface); border-radius: 10px; box-shadow: 0 1px 4px rgb(0 0 0 / .15); }
:global(.vmap .maplibregl-ctrl-group button) { width: 32px; height: 32px; }
:global(.vmap .maplibregl-ctrl-group button + button) { border-top-color: var(--line); }
/* Attribution : repliée elle tient dans une pastille ⓘ comme les autres boutons ; dépliée, elle
   s'ouvre en petit panneau lisible, borné à la largeur de la carte. */
:global(.vmap .maplibregl-ctrl-attrib.maplibregl-compact) {
  box-sizing: border-box; min-height: 26px; padding: 3px 26px 3px 0; margin: 10px;
  background: var(--surface); color: var(--muted); border-radius: 999px; box-shadow: 0 1px 4px rgb(0 0 0 / .15);
}
/* déplié, le panneau MONTE d'une ligne : il passerait sinon derrière la pilule de distance, qui
   occupe le bas de la carte (10 px de fond + 26 px de haut, plus un jour de 8 px) */
:global(.vmap .maplibregl-ctrl-attrib.maplibregl-compact-show) { padding: 3px 30px 3px 12px; max-width: calc(100% - 20px); }
:global(.vmap:has(.vmap__caption) .maplibregl-ctrl-attrib.maplibregl-compact-show) { margin-bottom: 44px; }
:global(.vmap .maplibregl-ctrl-attrib-inner) { font-size: 10px; line-height: 1.5; }
:global(.vmap .maplibregl-ctrl-attrib a) { color: var(--text); }
/* `background-position: center` : le ⓘ de MapLibre est calé en haut à gauche par défaut, et se
   retrouvait décentré dès qu'on change la taille du bouton ou de l'image */
:global(.vmap .maplibregl-ctrl-attrib-button),
:global(.vmap .maplibregl-ctrl-attrib.maplibregl-compact-show .maplibregl-ctrl-attrib-button) {
  width: 26px; height: 26px; border-radius: 999px; background-color: transparent;
  background-size: 18px 18px; background-position: center; background-repeat: no-repeat;
}
/* le ⓘ de MapLibre est une image SOMBRE : sur une surface sombre il disparaîtrait */
:global(html[data-theme='dark'] .vmap .maplibregl-ctrl-attrib-button) { filter: invert(1); }
</style>
