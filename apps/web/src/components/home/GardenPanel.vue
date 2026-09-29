<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_HEDGE_LENGTH, DEFAULT_HEDGE_WIDTH, GARDEN_KINDS, MAX_GARDEN_HEIGHT, MAX_HEDGE_LENGTH, MAX_HEDGE_SPACING, MAX_HEDGE_WIDTH, MIN_GARDEN_HEIGHT, MIN_HEDGE_LENGTH, MIN_HEDGE_SPACING, MIN_HEDGE_WIDTH, type GardenKind } from '@kasbah/shared'
import { useHouseStore } from '../../stores/house'
import { GARDEN_ICON } from '../../lib/gardenIcons'
import { SPECIES, speciesOf, type SpeciesRecipe } from '../../three/garden/species'
import { autoHedgeSpacing } from '../../three/garden/hedgeShape'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Panneau « élément du jardin » : sa famille, sa hauteur, son cap, une autre forme, le supprimer.
// Mêmes idiomes que `ParkingPanel` (touches −/+, saisie qui ne s'écrit qu'à la validation, virgule
// acceptée, chiffres à chasse fixe, suppression en deux temps).
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()

const item = computed(() => house.selectedGardenItem)
const busy = computed(() => house.savingGarden)

const { t, locale } = useI18n()
const speciesName = (s: SpeciesRecipe) => (locale.value.startsWith('en') ? s.name.en : s.name.fr)
const species = computed(() => (item.value ? speciesOf(item.value) : undefined))
/** Les espèces de la famille de l'élément : on ne fait pas d'un palmier un cerisier. */
const kindSpecies = computed(() => SPECIES.filter((s) => s.kind === item.value?.kind))
const title = computed(() => (species.value ? speciesName(species.value) : item.value ? t(`garden.kinds.${item.value.kind}`) : ''))

/** Changer de famille rend la forme générique : l'espèce appartenait à l'ancienne. */
function setKind(kind: GardenKind) {
  if (item.value && item.value.kind !== kind) void house.saveGardenItem({ kind, species: '' })
}
function setSpecies(id: string) {
  if (item.value && (item.value.species ?? '') !== id) void house.saveGardenItem({ species: id })
}

// --- hauteur : pas de 10 cm sous 2 m (buisson, pierre), de 50 cm au-dessus (arbre)
const round = (v: number) => Math.round(v * 100) / 100
const clampHeight = (v: number) => Math.min(MAX_GARDEN_HEIGHT, Math.max(MIN_GARDEN_HEIGHT, round(v)))
const height = computed(() => item.value?.height ?? 0)
function bumpHeight(sign: 1 | -1) {
  const h = height.value
  const step = (sign > 0 ? h : h - 0.01) < 2 ? 0.1 : 0.5
  const next = clampHeight(h + sign * step)
  if (next !== h) void house.saveGardenItem({ height: next })
}
const editingHeight = ref(false)
const heightDraft = ref('')
function startHeight(ev?: FocusEvent) {
  editingHeight.value = true
  heightDraft.value = height.value.toFixed(2)
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function commitHeight() {
  if (!editingHeight.value) return
  editingHeight.value = false
  const raw = Number(heightDraft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw) || raw <= 0) return
  const next = clampHeight(raw)
  if (next !== height.value) void house.saveGardenItem({ height: next })
}

// --- longueur d'une haie : pas de 50 cm
const LENGTH_STEP = 0.5
const clampLength = (v: number) => Math.min(MAX_HEDGE_LENGTH, Math.max(MIN_HEDGE_LENGTH, round(v)))
const length = computed(() => item.value?.length ?? DEFAULT_HEDGE_LENGTH)
function bumpLength(sign: 1 | -1) {
  const next = clampLength(length.value + sign * LENGTH_STEP)
  if (next !== length.value) void house.saveGardenItem({ length: next })
}
const editingLength = ref(false)
const lengthDraft = ref('')
function startLength(ev?: FocusEvent) {
  editingLength.value = true
  lengthDraft.value = length.value.toFixed(2)
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function commitLength() {
  if (!editingLength.value) return
  editingLength.value = false
  const raw = Number(lengthDraft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw) || raw <= 0) return
  const next = clampLength(raw)
  if (next !== length.value) void house.saveGardenItem({ length: next })
}

// --- largeur d'une haie : pas de 10 cm
const WIDTH_STEP = 0.1
const clampWidth = (v: number) => Math.min(MAX_HEDGE_WIDTH, Math.max(MIN_HEDGE_WIDTH, round(v)))
const width = computed(() => item.value?.width ?? DEFAULT_HEDGE_WIDTH)
function bumpWidth(sign: 1 | -1) {
  const next = clampWidth(width.value + sign * WIDTH_STEP)
  if (next !== width.value) void house.saveGardenItem({ width: next })
}
const editingWidth = ref(false)
const widthDraft = ref('')
function startWidth(ev?: FocusEvent) {
  editingWidth.value = true
  widthDraft.value = width.value.toFixed(2)
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function commitWidth() {
  if (!editingWidth.value) return
  editingWidth.value = false
  const raw = Number(widthDraft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw) || raw <= 0) return
  const next = clampWidth(raw)
  if (next !== width.value) void house.saveGardenItem({ width: next })
}

// --- espacement entre les sujets d'une haie : pas de 10 cm ; absent, la valeur automatique s'affiche
const SPACING_STEP = 0.1
const clampSpacing = (v: number) => Math.min(MAX_HEDGE_SPACING, Math.max(MIN_HEDGE_SPACING, round(v)))
const spacing = computed(() => item.value?.spacing ?? round(autoHedgeSpacing(width.value)))
function bumpSpacing(sign: 1 | -1) {
  const next = clampSpacing(spacing.value + sign * SPACING_STEP)
  if (next !== spacing.value) void house.saveGardenItem({ spacing: next })
}
const editingSpacing = ref(false)
const spacingDraft = ref('')
function startSpacing(ev?: FocusEvent) {
  editingSpacing.value = true
  spacingDraft.value = spacing.value.toFixed(2)
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function commitSpacing() {
  if (!editingSpacing.value) return
  editingSpacing.value = false
  const raw = Number(spacingDraft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw) || raw <= 0) return
  const next = clampSpacing(raw)
  if (next !== spacing.value) void house.saveGardenItem({ spacing: next })
}
/** Espacement réglé : la pastille « auto » y ramène ; automatique, elle le dit (même place, rien ne bouge). */
const spacingSet = computed(() => item.value?.spacing !== undefined)
function resetSpacing() { if (spacingSet.value) void house.saveGardenItem({ spacing: null }) }

// --- cap : sens trigonométrique, comme une place (la touche de gauche fait tourner à gauche)
const YAW_STEP = 15
const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360
const yaw = computed(() => norm(item.value?.yaw ?? 0))
function turn(delta: number) { if (item.value) void house.saveGardenItem({ yaw: norm(yaw.value + delta) }) }
const editingYaw = ref(false)
const yawDraft = ref('')
function startYaw(ev?: FocusEvent) {
  editingYaw.value = true
  yawDraft.value = String(yaw.value)
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function commitYaw() {
  if (!editingYaw.value) return
  editingYaw.value = false
  const raw = Number(yawDraft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw) || norm(raw) === yaw.value) return
  void house.saveGardenItem({ yaw: norm(raw) })
}

// --- supprimer : armer, puis confirmer dans les 4 s
const removeArmed = ref(false)
let disarm: ReturnType<typeof setTimeout> | undefined
function clickRemove() {
  if (!removeArmed.value) { removeArmed.value = true; disarm = setTimeout(() => { removeArmed.value = false }, 4000); return }
  clearTimeout(disarm)
  removeArmed.value = false
  void house.removeGardenItem()
}
onBeforeUnmount(() => clearTimeout(disarm))
</script>

<template>
  <template v-if="item">
    <div class="panel-head">
      <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ $t('nav.home') }}</button>
      <div class="head">
        <span class="icon-square icon-square--lg"><StrokeIcon :name="GARDEN_ICON[item.kind]" :size="22" /></span>
        <div class="head__main">
          <div class="head__name">{{ title }}</div>
          <div class="muted head__sub">{{ species ? $t(`garden.kinds.${item.kind}`) : $t('garden.list') }}</div>
        </div>
      </div>
    </div>

    <div class="card card--soft gp">
      <div class="gp__label muted">{{ $t('garden.kind') }}</div>
      <div class="gp__kinds">
        <button v-for="k in GARDEN_KINDS" :key="k" type="button" class="key key--kind" :data-on="item.kind === k ? '1' : '0'"
                :disabled="busy" :title="$t(`garden.kinds.${k}`)" :aria-label="$t(`garden.kinds.${k}`)" :aria-pressed="item.kind === k"
                @click="setKind(k)">
          <StrokeIcon :name="GARDEN_ICON[k]" :size="18" />
        </button>
      </div>

      <div class="gp__label muted">{{ $t('garden.species') }}</div>
      <div class="gp__species">
        <button type="button" class="pill pill--sm gp__sp" :data-on="!species ? '1' : '0'" :disabled="busy" @click="setSpecies('')">
          {{ $t('garden.generic') }}
        </button>
        <button v-for="s in kindSpecies" :key="s.id" type="button" class="pill pill--sm gp__sp"
                :data-on="species?.id === s.id ? '1' : '0'" :disabled="busy" @click="setSpecies(s.id)">
          {{ speciesName(s) }}
        </button>
      </div>

      <div class="gp__row">
        <span class="muted">{{ $t('garden.height') }}</span>
        <span class="gp__turn">
          <button type="button" class="key" :disabled="busy || height <= MIN_GARDEN_HEIGHT"
                  :title="$t('garden.smaller')" :aria-label="$t('garden.smaller')" @click="bumpHeight(-1)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <span class="gp__val">
            <input class="gp__num" type="text" inputmode="decimal" enterkeyhint="done"
                   :value="editingHeight ? heightDraft : height.toFixed(2)" :disabled="busy" :aria-label="$t('garden.height')"
                   @focus="startHeight($event)"
                   @mouseup.prevent
                   @input="heightDraft = ($event.target as HTMLInputElement).value"
                   @keydown.enter="($event.target as HTMLInputElement).blur()"
                   @keydown.esc="editingHeight = false; ($event.target as HTMLInputElement).blur()"
                   @blur="commitHeight">
            <span class="gp__unit">m</span>
          </span>
          <button type="button" class="key" :disabled="busy || height >= MAX_GARDEN_HEIGHT"
                  :title="$t('garden.bigger')" :aria-label="$t('garden.bigger')" @click="bumpHeight(1)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <div v-if="item.kind === 'hedge'" class="gp__row">
        <span class="muted">{{ $t('garden.length') }}</span>
        <span class="gp__turn">
          <button type="button" class="key" :disabled="busy || length <= MIN_HEDGE_LENGTH"
                  :title="$t('garden.shorter')" :aria-label="$t('garden.shorter')" @click="bumpLength(-1)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <span class="gp__val">
            <input class="gp__num" type="text" inputmode="decimal" enterkeyhint="done"
                   :value="editingLength ? lengthDraft : length.toFixed(2)" :disabled="busy" :aria-label="$t('garden.length')"
                   @focus="startLength($event)"
                   @mouseup.prevent
                   @input="lengthDraft = ($event.target as HTMLInputElement).value"
                   @keydown.enter="($event.target as HTMLInputElement).blur()"
                   @keydown.esc="editingLength = false; ($event.target as HTMLInputElement).blur()"
                   @blur="commitLength">
            <span class="gp__unit">m</span>
          </span>
          <button type="button" class="key" :disabled="busy || length >= MAX_HEDGE_LENGTH"
                  :title="$t('garden.longer')" :aria-label="$t('garden.longer')" @click="bumpLength(1)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <div v-if="item.kind === 'hedge'" class="gp__row">
        <span class="muted">{{ $t('garden.width') }}</span>
        <span class="gp__turn">
          <button type="button" class="key" :disabled="busy || width <= MIN_HEDGE_WIDTH"
                  :title="$t('garden.narrower')" :aria-label="$t('garden.narrower')" @click="bumpWidth(-1)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <span class="gp__val">
            <input class="gp__num" type="text" inputmode="decimal" enterkeyhint="done"
                   :value="editingWidth ? widthDraft : width.toFixed(2)" :disabled="busy" :aria-label="$t('garden.width')"
                   @focus="startWidth($event)"
                   @mouseup.prevent
                   @input="widthDraft = ($event.target as HTMLInputElement).value"
                   @keydown.enter="($event.target as HTMLInputElement).blur()"
                   @keydown.esc="editingWidth = false; ($event.target as HTMLInputElement).blur()"
                   @blur="commitWidth">
            <span class="gp__unit">m</span>
          </span>
          <button type="button" class="key" :disabled="busy || width >= MAX_HEDGE_WIDTH"
                  :title="$t('garden.wider')" :aria-label="$t('garden.wider')" @click="bumpWidth(1)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <div v-if="item.kind === 'hedge'" class="gp__row">
        <span class="gp__lab">
          <span class="muted">{{ $t('garden.spacing') }}</span>
          <button type="button" class="pill pill--sm gp__auto" :data-on="spacingSet ? '0' : '1'" :disabled="busy || !spacingSet"
                  :title="$t('garden.spacingAuto')" :aria-label="$t('garden.spacingAuto')" :aria-pressed="!spacingSet" @click="resetSpacing">
            <StrokeIcon v-if="spacingSet" name="undo" :size="12" /> {{ $t('garden.auto') }}
          </button>
        </span>
        <span class="gp__turn">
          <button type="button" class="key" :disabled="busy || spacing <= MIN_HEDGE_SPACING"
                  :title="$t('garden.closer')" :aria-label="$t('garden.closer')" @click="bumpSpacing(-1)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <span class="gp__val">
            <input class="gp__num" type="text" inputmode="decimal" enterkeyhint="done"
                   :value="editingSpacing ? spacingDraft : spacing.toFixed(2)" :disabled="busy" :aria-label="$t('garden.spacing')"
                   @focus="startSpacing($event)"
                   @mouseup.prevent
                   @input="spacingDraft = ($event.target as HTMLInputElement).value"
                   @keydown.enter="($event.target as HTMLInputElement).blur()"
                   @keydown.esc="editingSpacing = false; ($event.target as HTMLInputElement).blur()"
                   @blur="commitSpacing">
            <span class="gp__unit">m</span>
          </span>
          <button type="button" class="key" :disabled="busy || spacing >= MAX_HEDGE_SPACING"
                  :title="$t('garden.farther')" :aria-label="$t('garden.farther')" @click="bumpSpacing(1)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <div class="gp__row">
        <span class="muted">{{ $t('garden.yaw') }}</span>
        <span class="gp__turn">
          <button type="button" class="key" :disabled="busy" :title="$t('place.rotateLeft')" :aria-label="$t('place.rotateLeft')" @click="turn(YAW_STEP)">
            <StrokeIcon name="rotateLeft" :size="16" />
          </button>
          <span class="gp__val">
            <input class="gp__num gp__num--deg" type="text" inputmode="numeric" enterkeyhint="done"
                   :value="editingYaw ? yawDraft : String(yaw)" :disabled="busy" :aria-label="$t('garden.yaw')"
                   @focus="startYaw($event)"
                   @mouseup.prevent
                   @input="yawDraft = ($event.target as HTMLInputElement).value"
                   @keydown.enter="($event.target as HTMLInputElement).blur()"
                   @keydown.esc="editingYaw = false; ($event.target as HTMLInputElement).blur()"
                   @blur="commitYaw">
            <span class="gp__unit">°</span>
          </span>
          <button type="button" class="key" :disabled="busy" :title="$t('place.rotateRight')" :aria-label="$t('place.rotateRight')" @click="turn(-YAW_STEP)">
            <StrokeIcon name="rotateRight" :size="16" />
          </button>
        </span>
      </div>

      <div class="gp__row gp__bottom">
        <button type="button" class="pill gp__btn" :disabled="busy" @click="house.reshapeGardenItem()">
          <StrokeIcon name="sparkle" :size="14" /> {{ $t('garden.reshape') }}
        </button>
        <button type="button" class="pill gp__btn gp__remove" :class="{ 'gp__remove--armed': removeArmed }" :disabled="busy" @click="clickRemove">
          {{ removeArmed ? $t('garden.removeConfirm') : $t('garden.remove') }}
        </button>
      </div>
      <p class="muted gp__hint">{{ $t('garden.whereHint') }}</p>
    </div>
  </template>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; align-self: flex-start; }
.crumb:hover { color: var(--text); }
.head { display: flex; align-items: center; gap: 12px; }
.head__main { flex: 1 1 0; min-width: 0; }
.head__name { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head__sub { font-size: 12px; }
.icon-square--lg { width: 44px; height: 44px; border-radius: 12px; flex: none; }

.gp { padding: 12px 14px; font-size: 13px; display: grid; gap: 10px; }
.gp__label { font-size: 12px; }
.gp__kinds { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; }
.gp__species { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; }
.gp__sp[data-on='1'] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.gp__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
/* libellé et pastille empilés : côte à côte, ils faisaient déborder la carte de 23 px */
.gp__lab { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 3px; }
/* pastille « auto » : largeur fixe, qu'elle porte l'icône de retour ou non */
.gp__auto { box-sizing: border-box; width: 76px; height: 24px; min-height: 0; padding: 0 8px; justify-content: center; gap: 4px; font-size: 11px; line-height: 1; }
.gp__auto[data-on='1'] { background: transparent; color: var(--muted); border-color: var(--border, currentColor); }
.gp__auto[data-on='1']:disabled { opacity: 1; }
.gp__turn { display: inline-flex; align-items: center; gap: 6px; }
.gp__val { display: inline-flex; align-items: baseline; gap: 1px; }
/* largeur fixe (« 12.34 ») : la valeur change sans déplacer les touches */
.gp__num {
  width: 5ch; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent;
  color: inherit; font: inherit; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -1px 0 var(--line); border-radius: 4px;
}
.gp__num:focus { outline: none; background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent); }
.gp__num:disabled { opacity: .4; box-shadow: none; }
.gp__num--deg { width: 4ch; }
.gp__unit { font-size: 12px; color: var(--muted); }
.gp__bottom { min-height: 34px; }
.gp__btn { flex: 1 1 0; min-width: 0; justify-content: center; gap: 6px; font-size: 12px; }
.gp__remove--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
.gp__hint { margin: 0; font-size: 12px; min-height: 32px; line-height: 16px; }
.key {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
  font: inherit; font-size: 12px;
}
.key--kind { width: 100%; height: 36px; }
.key[data-on='1'] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
