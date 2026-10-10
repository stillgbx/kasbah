<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PropertyKind } from '@kasbah/shared'
import { usePropertiesStore } from '../../stores/properties'
import { useMediaQuery } from '@vueuse/core'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import OriginPicker from './OriginPicker.vue'
import { searchAddress, type GeoResult } from '../../lib/geocode'
import { AXIS_COLORS } from './axes'

// « Créer une propriété » : trois étapes, puis la maison neuve s'ouvre et un guide prend le relais
// (contour du terrain, puis cotes de la première pièce, dans le mode édition).
//   1. le nom et le type ;
//   2. le POINT 0 : le principe (un coin de la maison, d'où partent toutes les cotes), sa place sur la
//      carte, et le cap qui aligne la première pièce sur une façade ;
//   3. le terrain (une maison seulement) : un rectangle à la louche, qu'on retouche ou qu'on remplace
//      par le cadastre ensuite.
const properties = usePropertiesStore()
const { t, locale } = useI18n()
const phone = useMediaQuery('(max-width: 599px)')

const step = ref(1)
const name = ref('')
const kind = ref<PropertyKind>('house')
const lat = ref<number | null>(null)
const lon = ref<number | null>(null)
const heading = ref(0)
const width = ref(30)
const depth = ref(20)
const picker = ref<InstanceType<typeof OriginPicker> | null>(null)

const steps = computed(() => (kind.value === 'house' ? 3 : 2))
const last = computed(() => step.value === steps.value)
const canNext = computed(() => (step.value === 1 ? name.value.trim().length > 0 : step.value === 2 ? lat.value !== null : width.value >= 5 && depth.value >= 5))

// une boîte rouverte repart de zéro
watch(() => properties.creating, (open) => {
  if (!open) return
  step.value = 1; name.value = ''; kind.value = 'house'; lat.value = null; lon.value = null; heading.value = 0
  width.value = 30; depth.value = 20; query.value = ''; results.value = []; locError.value = ''
})

function pick(a: number, b: number) { lat.value = Math.round(a * 1e7) / 1e7; lon.value = Math.round(b * 1e7) / 1e7 }
function turn(delta: number) { heading.value = ((Math.round(heading.value + delta) % 360) + 360) % 360 }

// -- recherche d'adresse : IGN (France) et Photon (monde), lancée par l'utilisateur (`lib/geocode.ts`)
const query = ref('')
const results = ref<GeoResult[]>([])
const searching = ref(false)
async function search() {
  const q = query.value.trim()
  if (q.length < 3) return
  searching.value = true
  try { results.value = await searchAddress(q, locale.value) }
  finally { searching.value = false }
}
function choose(r: { lat: number; lon: number }) { results.value = []; pick(r.lat, r.lon); picker.value?.flyTo(r.lat, r.lon) }

// -- la position de l'appareil (navigateur, HTTPS ou localhost)
const locError = ref('')
function locate() {
  locError.value = ''
  if (!navigator.geolocation) { locError.value = t('property.wizard.locateUnavailable'); return }
  navigator.geolocation.getCurrentPosition(
    (p) => { pick(p.coords.latitude, p.coords.longitude); picker.value?.flyTo(p.coords.latitude, p.coords.longitude) },
    () => { locError.value = t('property.wizard.locateFailed') },
    { enableHighAccuracy: true, timeout: 10_000 },
  )
}

async function next() {
  if (!canNext.value) return
  if (!last.value) { step.value++; return }
  await properties.create({
    name: name.value.trim(), kind: kind.value,
    origin: { lat: lat.value!, lon: lon.value!, heading: heading.value },
    ...(kind.value === 'house' ? { terrain: { width: width.value, depth: depth.value } } : {}),
    levelName: t('property.wizard.levelName'), roomName: t('property.wizard.roomName'),
  })
}
const kinds = computed(() => [
  { value: 'house' as const, label: t('properties.kinds.house') },
  { value: 'apartment' as const, label: t('properties.kinds.apartment') },
])
</script>

<template>
  <v-dialog :model-value="properties.creating" :max-width="760" :fullscreen="phone" scrollable
            @update:model-value="(v: boolean) => { if (!v && !properties.busy) properties.creating = false }">
    <div class="card np">
      <div class="np__head">
        <div class="min0">
          <div class="np__title">{{ $t('properties.create') }}</div>
          <div class="muted np__sub">{{ $t('property.wizard.step', { n: step, of: steps }) }} · {{ $t(`property.wizard.steps.${step === 3 ? 'terrain' : step === 2 ? 'origin' : 'name'}`) }}</div>
        </div>
        <button type="button" class="np__close" :aria-label="$t('common.close')" :disabled="properties.busy" @click="properties.creating = false"><StrokeIcon name="close" :size="18" /></button>
      </div>

      <div class="np__body">
        <template v-if="step === 1">
          <label class="np__field">
            <span class="section-label">{{ $t('property.wizard.name') }}</span>
            <input v-model="name" class="np__input" type="text" maxlength="60" :placeholder="$t('property.wizard.namePlaceholder')" @keydown.enter="next()">
          </label>
          <div class="np__field">
            <span class="section-label">{{ $t('property.wizard.kind') }}</span>
            <Segmented :model-value="kind" :options="kinds" @update:model-value="(v: PropertyKind) => { kind = v }" />
          </div>
          <p class="muted np__hint">{{ $t('property.wizard.nameHint') }}</p>
        </template>

        <!-- la carte reste montée entre le point 0 et le terrain : même place, même taille aux deux
             étapes (texte sur lignes réservées, une rangée au-dessus, une au-dessous), le terrain en plus -->
        <div v-show="step >= 2" class="np__origin">
          <p class="np__principle">{{ $t(step === 3 ? 'property.wizard.terrainHint' : 'property.wizard.principle') }}</p>
          <!-- les résultats flottent sous la recherche, par-dessus la carte : rien ne descend -->
          <div v-if="step === 2" class="np__searchwrap np__top">
            <div class="np__search">
              <input v-model="query" class="np__input" type="search" :placeholder="$t('property.wizard.searchPlaceholder')" :aria-label="$t('property.wizard.searchPlaceholder')" @keydown.enter="search()">
              <button type="button" class="pill" :aria-label="$t('property.wizard.search')" :disabled="searching || query.trim().length < 3" @click="search()"><StrokeIcon name="search" :size="16" /></button>
              <button type="button" class="pill" @click="locate()"><StrokeIcon name="crosshair" :size="16" /> {{ $t('property.wizard.locate') }}</button>
            </div>
            <div v-if="results.length" class="np__results card">
              <button v-for="r in results" :key="r.label" type="button" class="np__result" @click="choose(r)">{{ r.label }}</button>
            </div>
          </div>
          <div v-else class="np__row np__dims np__top">
            <label class="np__dim"><i class="np__swatch" :style="{ background: AXIS_COLORS.x }" /><span class="section-label">{{ $t('property.wizard.alongX') }}</span><input v-model.number="width" class="np__input np__num" type="number" min="5" max="2000" step="1"><span class="muted">m</span></label>
            <label class="np__dim"><i class="np__swatch" :style="{ background: AXIS_COLORS.y }" /><span class="section-label">{{ $t('property.wizard.alongY') }}</span><input v-model.number="depth" class="np__input np__num" type="number" min="5" max="2000" step="1"><span class="muted">m</span></label>
          </div>
          <OriginPicker ref="picker" class="np__map" :lat="lat" :lon="lon" :heading="heading" :terrain="step === 3 ? { width, depth } : null" @pick="pick" />
          <!-- le cap reste réglable à l'étape du terrain : on le voit alors tourner avec lui -->
          <div class="np__row">
            <span class="mono np__coords">{{ lat === null ? $t('property.wizard.noPoint') : `${lat.toFixed(6)}, ${lon!.toFixed(6)}` }}</span>
            <span class="np__heading">
              <span class="section-label">{{ $t('property.wizard.heading') }}</span>
              <button type="button" class="pill pill--sm" :aria-label="$t('property.wizard.turnLeft')" @click="turn(-5)"><StrokeIcon name="rotateLeft" :size="14" /></button>
              <input v-model.number="heading" class="np__input np__num" type="number" min="0" max="359" step="1" :aria-label="$t('property.wizard.heading')" @change="turn(0)">
              <span class="muted">°</span>
              <button type="button" class="pill pill--sm" :aria-label="$t('property.wizard.turnRight')" @click="turn(5)"><StrokeIcon name="rotateRight" :size="14" /></button>
            </span>
          </div>
          <p class="muted np__hint">{{ step === 2 ? locError || $t('property.wizard.originHint') : '' }}</p>
        </div>
      </div>

      <div class="np__foot">
        <button type="button" class="pill" :disabled="step === 1 || properties.busy" @click="step--">{{ $t('property.wizard.back') }}</button>
        <button type="button" class="pill np__next" :disabled="!canNext || properties.busy" @click="next()">
          <v-progress-circular v-if="properties.busy" indeterminate size="16" width="2" />
          {{ last ? $t('property.wizard.create') : $t('property.wizard.next') }}
        </button>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
/* hauteur fixe sur un écran large : d'une étape à l'autre, « Retour » et « Suivant » restent sous le doigt */
.np { display: flex; flex-direction: column; box-shadow: var(--shadow); height: min(660px, 90vh); max-height: 100%; min-height: 0; }
.np__head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 8px; }
.min0 { flex: 1 1 0; min-width: 0; }
.np__title { font-size: 18px; font-weight: 600; }
.np__sub { font-size: 13px; margin-top: 2px; }
.np__close { flex: none; width: 32px; height: 32px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
.np__close:hover { background: var(--surface2); color: var(--text); }
/* la carte prend la hauteur qui reste : rien sous le pli, quelle que soit la fenêtre */
.np__body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 12px; padding: 8px 20px; overflow-y: auto; min-height: 0; scrollbar-gutter: stable; }
.np__field { display: grid; gap: 6px; }
.np__input {
  min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
  color: var(--text); font: inherit; font-size: 14px;
}
.np__input:focus { outline: none; border-color: var(--accent); }
.np__num { width: 72px; text-align: right; font-variant-numeric: tabular-nums; }
.np__hint { margin: 0; font-size: 12px; line-height: 1.5; min-height: 1.5em; }
/* quatre lignes réservées : le principe (étape 2) et la consigne du terrain (étape 3) n'ont pas la même longueur */
.np__principle { margin: 0; font-size: 14px; line-height: 1.45; min-height: 5.8em; flex: none; }
.np__origin { flex: 1 1 auto; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.np__top { flex: none; height: 40px; }   /* hauteur d'une pastille : recherche ou cotes, la carte ne bouge pas */
.np__search { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; }
.np__searchwrap { position: relative; }
.np__results { position: absolute; z-index: 3; left: 0; right: 0; top: calc(100% + 4px); display: grid; padding: 6px; box-shadow: var(--shadow); }
.np__result { border: 0; background: transparent; color: var(--text); text-align: left; padding: 8px 10px; border-radius: 8px; font: inherit; font-size: 14px; cursor: pointer; }
.np__result:hover { background: var(--surface2); }
.np__map { flex: 1 1 0; min-height: 140px; }
.np__row { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.np__coords { font-size: 13px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np__heading, .np__dim { display: inline-flex; align-items: center; gap: 6px; }
.np__dims { justify-content: flex-start; gap: 20px; }
/* la pastille de l'axe, comme dans la légende de la carte : on voit à quel côté du terrain va la cote */
.np__swatch { display: inline-block; width: 12px; height: 3px; border-radius: 2px; flex: none; }
.np__foot { display: flex; justify-content: space-between; gap: 8px; padding: 12px 20px 18px; }
/* même largeur pour « Suivant » et « Créer » (fr comme en) : le bouton ne change pas de taille sous le doigt */
.np__foot .np__next { gap: 8px; min-width: 104px; justify-content: center; border-color: var(--accent); color: var(--accent); }
</style>
