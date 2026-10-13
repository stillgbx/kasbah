<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { Map as MlMap, NavigationControl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { geoToLocal, localToGeo, parkingCorners, shiftOrigin, turnOrigin, type GeoOrigin, type Vec2 } from '@kasbah/shared'
import { IGN_MAX_ZOOM, planStyleUrl, satelliteStyle, satelliteStyleWithLabels, type MapMode } from '../../lib/map'
import { siteMapAnchor, siteMapFeatures } from '../../lib/siteMap'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useSceneZonesStore } from '../../stores/sceneZones'
import { useSettingsStore } from '../../stores/settings'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Caler la maison sur la photo : l'origine GPS (`origin`) et le cap se règlent à l'œil, par-dessus
// l'orthophoto : le contour du dernier étage (le toit que montre la photo), les pièces du rez-de-chaussée
// (une annexe, une terrasse), et la pelouse relevée par une tondeuse, posée sur sa base — elle est AU
// SOL, quand un toit photographié d'avion est un peu déporté par la perspective. Le contour d'un
// rez-de-chaussée n'est pas tracé : c'est une enveloppe pour le toit, plus grande que la maison. Les flèches font glisser la maison en mètres du MONDE (le
// nord est en haut de la photo), la rotation se fait autour du centre de la maison — tourner autour du
// 0;0, un coin, la ferait partir de côté. Rien n'est écrit avant « Enregistrer ».
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const zones = useSceneZonesStore()
const settings = useSettingsStore()
const { t, locale } = useI18n()
const phone = useMediaQuery('(max-width: 599px)')

/** Les pas du calage : en mètres pour les flèches, en degrés pour la rotation (même chiffre). Le fin
 * sert au dernier ajustement, quand le contour est déjà sur le toit. */
const STEPS = ['0.1', '0.5', '2'] as const
type Step = typeof STEPS[number]
const stepKey = ref<Step>('0.5')
const step = computed(() => Number(stepKey.value))
const stepOptions = computed(() => STEPS.map((v) => ({ value: v, label: fmt(Number(v), v === '2' ? 0 : 1) })))

const draft = ref<GeoOrigin | null>(null)
const saving = ref(false)
const mode = ref<MapMode>('satellite')

/** Ce que la photo montre de la maison : le toit du dernier niveau qui a un contour, les pièces du plus bas. */
const shape = computed(() => {
  const h = house.house
  if (!h?.levels.length) return null
  const levels = [...h.levels].sort((a, b) => a.elevation - b.elevation)
  const ground = levels[0]!
  return { roof: [...levels].reverse().find((l) => l.outline)?.outline ?? null, rooms: h.rooms.filter((r) => r.levelId === ground.id).map((r) => r.polygon) }
})
/** Les tondeuses qui ont une carte du terrain et une base posée : leur pelouse se pose sur la photo. */
const mowers = computed(() => devices.list.filter((e) => e.state.kind === 'mower' && e.descriptor.capabilities.includes('site_map') && house.dockFor(e.descriptor.id)))
/** Le centre de la maison (repère local), pivot de la rotation. */
const pivot = computed<Vec2>(() => {
  const pts = shape.value ? [...(shape.value.roof ?? []), ...shape.value.rooms.flat()] : []
  if (!pts.length) return [0, 0]
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
})

const changed = computed(() => {
  const o = house.house?.origin, d = draft.value
  return !!o && !!d && (o.lat !== d.lat || o.lon !== d.lon || o.heading !== d.heading)
})
const fmt = (v: number, digits = 1) => v.toLocaleString(locale.value, { minimumFractionDigits: digits, maximumFractionDigits: digits })
/** Ce que la maison a fait depuis l'origine enregistrée : le glissement de SON CENTRE, et la rotation. */
const delta = computed(() => {
  const o = house.house?.origin, d = draft.value
  if (!o || !d) return ''
  const p: [number, number, number] = [pivot.value[0], pivot.value[1], 0]
  const [east, north] = geoToLocal({ ...o, heading: 0 }, localToGeo(d, p))
  const [e0, n0] = geoToLocal({ ...o, heading: 0 }, localToGeo(o, p))
  const de = east - e0, dn = north - n0
  const turn = ((d.heading - o.heading + 540) % 360) - 180
  return [
    t(de < 0 ? 'settings.calibration.westShort' : 'settings.calibration.eastShort', { v: fmt(Math.abs(de)) }),
    t(dn < 0 ? 'settings.calibration.southShort' : 'settings.calibration.northShort', { v: fmt(Math.abs(dn)) }),
    `${turn > 0 ? '+' : turn < 0 ? '−' : ''}${fmt(Math.abs(turn))}°`,
  ].join(' · ')
})

function move(east: number, north: number) { if (draft.value) draft.value = shiftOrigin(draft.value, east * step.value, north * step.value) }
function turn(sign: number) {
  if (!draft.value) return
  const heading = Math.round((((draft.value.heading + sign * step.value) % 360) + 360) % 360 * 10) / 10
  draft.value = turnOrigin(draft.value, heading, pivot.value)
}
function close() { if (!saving.value) emit('update:modelValue', false) }
async function save() {
  if (!draft.value || !changed.value) return
  saving.value = true
  const ok = await house.saveOrigin({ ...draft.value, lat: Math.round(draft.value.lat * 1e8) / 1e8, lon: Math.round(draft.value.lon * 1e8) / 1e8 })
  saving.value = false
  if (ok) emit('update:modelValue', false)
}

// ---- la carte ----------------------------------------------------------------------------------
const container = ref<HTMLDivElement | null>(null)
let map: MlMap | null = null
let observer: ResizeObserver | null = null

type OverlayData = Parameters<GeoJSONSource['setData']>[0]
/** La maison, le terrain, les places et la pelouse des tondeuses, posés par l'origine EN COURS. */
function overlay(): OverlayData {
  const o = draft.value, h = house.house, g = shape.value
  if (!o || !h || !g) return { type: 'FeatureCollection', features: [] }
  const ring = (pts: readonly Vec2[]) => [...pts, pts[0]!].map((p) => { const q = localToGeo(o, [p[0], p[1], 0]); return [q.lon, q.lat] })
  const poly = (role: string, pts: readonly Vec2[]) => ({ type: 'Feature', properties: { role }, geometry: { type: 'Polygon', coordinates: [ring(pts)] } })
  const features = [
    poly('terrain', h.site.terrain),
    ...g.rooms.map((r) => poly('room', r)),
    ...(g.roof ? [poly('outline', g.roof)] : []),
    ...(h.site.parkings ?? []).map((p) => poly('parking', parkingCorners(p))),
    ...mowers.value.flatMap((m) => {
      const map = zones.maps[m.descriptor.id]
      const anchor = map && siteMapAnchor({ origin: o, dock: house.dockFor(m.descriptor.id)?.center, location: undefined, atStation: false })
      if (!map || !anchor) return []
      return siteMapFeatures(map, anchor, undefined).features.filter((f) => f.properties.kind === 'lawn').map((f) => ({ ...f, properties: { role: 'lawn' } }))
    }),
  ]
  return { type: 'FeatureCollection', features } as OverlayData
}
function addOverlay(): void {
  if (!map || map.getSource('calib')) return
  map.addSource('calib', { type: 'geojson', data: overlay() })
  map.addLayer({ id: 'calib-terrain', type: 'line', source: 'calib', filter: ['==', ['get', 'role'], 'terrain'], paint: { 'line-color': '#f5d76e', 'line-width': 2, 'line-dasharray': [2, 2] } })
  map.addLayer({ id: 'calib-room', type: 'line', source: 'calib', filter: ['==', ['get', 'role'], 'room'], paint: { 'line-color': '#4fd1c5', 'line-width': 0.75, 'line-opacity': 0.7 } })
  map.addLayer({ id: 'calib-outline', type: 'line', source: 'calib', filter: ['==', ['get', 'role'], 'outline'], paint: { 'line-color': '#4fd1c5', 'line-width': 1.5 } })
  map.addLayer({ id: 'calib-lawn', type: 'line', source: 'calib', filter: ['==', ['get', 'role'], 'lawn'], paint: { 'line-color': '#9be15d', 'line-width': 1.5 } })
  map.addLayer({ id: 'calib-parking', type: 'line', source: 'calib', filter: ['==', ['get', 'role'], 'parking'], paint: { 'line-color': '#ffffff', 'line-width': 1 } })
}
function refresh(): void { (map?.getSource('calib') as GeoJSONSource | undefined)?.setData(overlay()) }

const planStyles = new Map<string, Promise<StyleSpecification>>()
// `diff: false` : un changement de style « en différence » retire nos calques sans émettre `style.load` (voir OriginPicker)
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

function mountMap(): void {
  const o = draft.value
  if (!container.value || !o || map) return
  const c = localToGeo(o, [pivot.value[0], pivot.value[1], 0])
  const m = new MlMap({
    container: container.value, style: satelliteStyle(), attributionControl: { compact: true },
    maxZoom: IGN_MAX_ZOOM + 4, dragRotate: false, pitchWithRotate: false, center: [c.lon, c.lat], zoom: IGN_MAX_ZOOM + 1,
  })
  map = m
  m.addControl(new NavigationControl({ showCompass: false }), 'top-left')
  m.on('style.load', () => { addOverlay(); refresh() })
  void applyStyle()
  observer = new ResizeObserver(() => m.resize())
  observer.observe(container.value)
}
function unmountMap(): void { observer?.disconnect(); observer = null; map?.remove(); map = null }

// une boîte rouverte repart de l'origine enregistrée ; la carte se monte une fois la boîte affichée
watch(() => props.modelValue, (open) => {
  if (open) {
    draft.value = house.house ? { ...house.house.origin } : null; mode.value = 'satellite'; stepKey.value = '0.5'
    for (const m of mowers.value) if (!zones.maps[m.descriptor.id]) void zones.load(m.descriptor.id)
  }
  else unmountMap()
}, { immediate: true })
watch(container, (el) => { if (el && props.modelValue) mountMap() })
watch([draft, () => zones.maps], refresh)
watch(mode, () => void applyStyle())
watch(() => settings.isDark, () => { if (mode.value === 'plan') void applyStyle() })
onBeforeUnmount(unmountMap)
</script>

<template>
  <v-dialog :model-value="modelValue" :max-width="900" :fullscreen="phone" scrollable @update:model-value="(v: boolean) => { if (!v) close() }">
    <div class="card oc">
      <div class="oc__head">
        <div class="min0">
          <div class="oc__title">{{ $t('settings.calibration.title') }}</div>
          <div class="muted oc__sub">{{ $t('settings.calibration.hint') }}</div>
        </div>
        <button type="button" class="oc__close" :aria-label="$t('common.close')" :disabled="saving" @click="close()"><StrokeIcon name="close" :size="18" /></button>
      </div>

      <div class="oc__body">
        <div class="oc__map">
          <div ref="container" class="oc__canvas" />
          <Segmented class="oc__mode" dense :model-value="mode" :options="[{ value: 'satellite', label: $t('vehicle.map.satellite') }, { value: 'plan', label: $t('vehicle.map.plan') }]"
                     @update:model-value="(v: MapMode) => { mode = v }" />
          <div class="oc__legend">
            <span><i class="oc__swatch oc__swatch--building" />{{ $t('settings.calibration.building') }}</span>
            <span><i class="oc__swatch oc__swatch--terrain" />{{ $t('settings.calibration.terrain') }}</span>
            <span><i class="oc__swatch oc__swatch--parking" />{{ $t('settings.calibration.parkings') }}</span>
            <span v-if="mowers.length"><i class="oc__swatch oc__swatch--lawn" />{{ $t('settings.calibration.lawn') }}</span>
          </div>
        </div>
        <!-- commandes à place fixe : la valeur vit dans une boîte de largeur constante, rien ne bouge sous le doigt -->
        <div class="oc__controls">
          <div class="oc__step">
            <span class="section-label">{{ $t('settings.calibration.step') }}</span>
            <Segmented dense :model-value="stepKey" :options="stepOptions" @update:model-value="(v: Step) => { stepKey = v }" />
          </div>
          <div class="oc__pad" role="group" :aria-label="$t('settings.calibration.move', { step: fmt(step) })">
            <button type="button" class="pill pill--sm oc__n" :aria-label="$t('settings.calibration.north')" @click="move(0, 1)"><StrokeIcon name="arrowUp" :size="14" /></button>
            <button type="button" class="pill pill--sm oc__w" :aria-label="$t('settings.calibration.west')" @click="move(-1, 0)"><StrokeIcon name="arrowLeft" :size="14" /></button>
            <button type="button" class="pill pill--sm oc__e" :aria-label="$t('settings.calibration.east')" @click="move(1, 0)"><StrokeIcon name="arrowRight" :size="14" /></button>
            <button type="button" class="pill pill--sm oc__s" :aria-label="$t('settings.calibration.south')" @click="move(0, -1)"><StrokeIcon name="arrowDown" :size="14" /></button>
          </div>
          <div class="oc__turn">
            <span class="section-label">{{ $t('settings.calibration.turn') }}</span>
            <button type="button" class="pill pill--sm" :aria-label="$t('settings.calibration.turnLeft')" @click="turn(-1)"><StrokeIcon name="rotateLeft" :size="14" /></button>
            <span class="mono oc__heading">{{ draft ? `${fmt(draft.heading)}°` : '' }}</span>
            <button type="button" class="pill pill--sm" :aria-label="$t('settings.calibration.turnRight')" @click="turn(1)"><StrokeIcon name="rotateRight" :size="14" /></button>
          </div>
        </div>
        <!-- sa propre ligne : sa longueur change à chaque clic, elle ne doit rien faire passer à la ligne -->
        <div class="mono muted oc__delta">{{ delta }}</div>
      </div>

      <div class="oc__foot">
        <button type="button" class="pill" :disabled="saving" @click="close()">{{ $t('settings.calibration.cancel') }}</button>
        <button type="button" class="pill oc__save" :disabled="!changed || saving" @click="save()">
          <v-progress-circular v-if="saving" indeterminate size="16" width="2" />
          {{ $t('settings.calibration.save') }}
        </button>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.oc { display: flex; flex-direction: column; box-shadow: var(--shadow); height: min(760px, 92vh); max-height: 100%; min-height: 0; }
.oc__head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 8px; }
.min0 { flex: 1 1 0; min-width: 0; }
.oc__title { font-size: 18px; font-weight: 600; }
.oc__sub { font-size: 13px; margin-top: 2px; line-height: 1.45; }
.oc__close { flex: none; width: 32px; height: 32px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
.oc__close:hover { background: var(--surface2); color: var(--text); }
.oc__body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 12px; padding: 8px 20px; min-height: 0; overflow-y: auto; }
.oc__map { position: relative; flex: 1 0 0; min-height: 200px; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--line); }
.oc__canvas { position: absolute; inset: 0; }
.oc__mode { position: absolute; top: 8px; right: 8px; z-index: 1; }
.oc__legend {
  position: absolute; left: 8px; bottom: 8px; z-index: 1; display: flex; gap: 10px; padding: 4px 8px;
  border-radius: 8px; background: color-mix(in srgb, var(--surface) 85%, transparent); font-size: 12px;
}
.oc__legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.oc__swatch { display: inline-block; width: 12px; height: 3px; border-radius: 2px; }
.oc__swatch--building { background: #4fd1c5; }
.oc__swatch--terrain { background: #f5d76e; }
.oc__swatch--lawn { background: #9be15d; }
.oc__swatch--parking { background: #ffffff; outline: 1px solid var(--line); }
.oc__controls { flex: none; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
/* la croix des quatre directions : nord en haut, comme la photo */
.oc__pad { display: grid; grid-template-columns: repeat(3, auto); grid-template-areas: '. n .' 'w . e' '. s .'; gap: 2px; }
.oc__n { grid-area: n; } .oc__w { grid-area: w; } .oc__e { grid-area: e; } .oc__s { grid-area: s; }
.oc__turn, .oc__step { display: inline-flex; align-items: center; gap: 6px; }
.oc__heading { display: inline-block; width: 6ch; text-align: right; font-variant-numeric: tabular-nums; }
.oc__delta { flex: none; min-height: 1.5em; text-align: right; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.oc__foot { display: flex; justify-content: space-between; gap: 8px; padding: 12px 20px 18px; }
.oc__foot .oc__save { gap: 8px; min-width: 120px; justify-content: center; border-color: var(--accent); color: var(--accent); }
</style>
