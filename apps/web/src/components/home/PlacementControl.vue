<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveDefaults, roomHeight, SPEAKER_SHAPES, type HouseDevice, type PlacedHouseDevice, type SpeakerShape } from '@kasbah/shared'
import { isFlatCover } from '../../lib/cover'
import { coverLeaves, coverSize, hasLeaves, isOrientable, isSizable, isTv, tvInchesFromSize, tvSizeFromInches } from '../../lib/orientation'
import type { IconName } from '../../lib/strokeIcons'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Settings of a placed device: "Edit" opens the edit mode — x;y by dragging in the 3D,
// height, orientation, TV size / speaker shape, leaves… Each setting is written to
// house.json (store `house`); "Revert" goes back to the placement on entering the mode.
//
// The section lives at the BOTTOM of the panel: its title row is at the bottom, and the body opens ABOVE
// it, smoothly (`max-height` transition). The "Edit" button and the
// "Done" button occupy exactly the same place (same width, same corner): one closes where one
// opened. "Revert" has a reserved place in the body, invisible as long as there is nothing to revert —
// nothing shifts when it appears.
const props = defineProps<{ device: PlacedHouseDevice }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

// Natural height of the body, measured (ResizeObserver): the transition animates `max-height` from 0 to
// this value — a height in pixels animates everywhere, where `grid-template-rows: 0fr → 1fr` jumped.
const inner = ref<HTMLElement | null>(null)
const innerHeight = ref(0)
let observer: ResizeObserver | null = null
onMounted(() => {
  if (!inner.value) return
  innerHeight.value = inner.value.scrollHeight
  observer = new ResizeObserver(() => { if (inner.value) innerHeight.value = inner.value.scrollHeight })
  observer.observe(inner.value)
})
onBeforeUnmount(() => observer?.disconnect())

// Orientation (`yaw`, 0 = facing +y): offered to devices that LOOK somewhere (rule
// shared with the 3D scene: `lib/orientation.ts`). Two keys, 45° steps, written on each press.
//
// The JSON's `yaw` turns COUNTERCLOCKWISE (the Z axis points up), so INCREASING it pivots
// the object to the left seen from above. It is the left key that increases it, and the right one
// that decreases it: what one sees turning follows the key pressed, not the file's convention.
const YAW_STEP = 45
const descriptor = computed(() => (props.device.deviceId ? devices.descriptors[props.device.deviceId] : undefined))
const orientable = computed(() => isOrientable(props.device, descriptor.value))
const yaw = computed(() => props.device.yaw ?? 0)
function rotate(delta: number) {
  void house.savePlacement({ yaw: (((yaw.value + delta) % 360) + 360) % 360 })
}

// Size of what is DRAWN: free covers (width × height or projection, in meters) and
// TVs (a single diagonal in inches — the number on the box, converted to a 16:9
// slab for the scene). See `lib/orientation.ts`. Wide but finite bounds.
const SIZE_STEP = 0.25
const SIZE_LIMITS = { width: { min: 0.25, max: 12 }, height: { min: 0.25, max: 4 } } as const
/** Step and bounds of the TV diagonal (inches): commercial sizes go by whole inch. */
const DIAGONAL_STEP = 1
const DIAGONAL_LIMITS = { min: 20, max: 100 } as const
const sizable = computed(() => isSizable(props.device, descriptor.value))
const tv = computed(() => isTv(descriptor.value))
const size = computed(() => coverSize(props.device, descriptor.value))
const inches = computed(() => tvInchesFromSize(size.value))
// The second dimension is not the same thing depending on the kind: the HEIGHT of a standing
// gate, the PROJECTION of an awning deployed flat. Same field in the JSON, two words on screen.
const dimLabel = (dim: 'width' | 'height') =>
  t(dim === 'width' ? 'place.size.width' : isFlatCover(descriptor.value) ? 'place.size.projection' : 'place.size.height')
function resize(dim: 'width' | 'height', delta: number) {
  const { min, max } = SIZE_LIMITS[dim]
  const next = Math.min(max, Math.max(min, Math.round((size.value[dim] + delta) * 100) / 100))
  if (next === size.value[dim]) return
  void house.savePlacement({ size: { ...size.value, [dim]: next } })
}
function resizeDiagonal(delta: number) {
  const next = Math.min(DIAGONAL_LIMITS.max, Math.max(DIAGONAL_LIMITS.min, inches.value + delta))
  if (next === inches.value) return
  void house.savePlacement({ size: tvSizeFromInches(next) })
}

// Leaves of a gate: what swings apart when it opens, hence what the scene animates. An awning
// deploys in one piece, the question only arises for what stands upright.
const leavesShown = computed(() => hasLeaves(props.device, descriptor.value))
// `Segmented` speaks in strings (its segment key); the JSON, for its part, counts leaves.
const leaves = computed(() => String(coverLeaves(props.device, descriptor.value)))
const leavesOptions = [{ value: '1', label: '1' }, { value: '2', label: '2' }]

/** Speaker: 3D silhouette (cylinder / pebble / bar / block), independent of the drag mode. */
const isSpeaker = computed(() =>
  descriptor.value?.kind === 'media_player'
  && (descriptor.value.meta.mediaPlayer?.deviceClass ?? 'speaker') === 'speaker')
const speakerShape = computed(() => props.device.speakerShape ?? 'default')
/** Glyph per silhouette: the Segmented only displays the icon, the label stays in title / aria. */
const SPEAKER_SHAPE_ICONS: Record<SpeakerShape, IconName> = {
  default: 'speakerTube',
  pebble: 'speakerPebble',
  bar: 'speakerBar',
  block: 'speakerBlock',
}
const speakerShapeOptions = computed(() =>
  SPEAKER_SHAPES.map((s) => ({ value: s, label: t(`place.speakerShape.${s}`), icon: SPEAKER_SHAPE_ICONS[s] })))
function setSpeakerShape(raw: string): void {
  const next = (SPEAKER_SHAPES.find((s) => s === raw) ?? 'default') as SpeakerShape
  if (next === speakerShape.value) return
  const id = props.device.deviceId
  if (!id) return
  // `''` clears → default cylinder; the other values are written as they are
  void house.setDeviceTuning(id, { speakerShape: next === 'default' ? '' : next })
}

// DIRECT input of a value, next to the −/+ keys: adjusting a 4.10 m gate by quarter
// meter took sixteen presses. The field only commits on validation (Enter or focus loss) —
// writing house.json on each keystroke would send one house per character. While typing, it is the
// draft that is displayed: otherwise the value reread from the server would overwrite the input in progress.
type Field = 'yaw' | 'width' | 'height' | 'diagonal'
const editing = ref<Field | null>(null)
const draft = ref('')

/** The content gets SELECTED on focus: typing replaces the value instead of being appended to it. */
function startEdit(field: Field, shown: string, ev?: FocusEvent) {
  editing.value = field
  draft.value = shown
  // AFTER the render: Vue rewrites `value` when the draft is set, which clears the selection
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function cancelEdit() { editing.value = null }
/** Value displayed by a field: the draft if it is being edited, otherwise the state. */
const shownValue = (field: Field, value: string) => (editing.value === field ? draft.value : value)

function commitEdit(field: Field) {
  if (editing.value !== field) return          // exit via Escape: nothing to write
  editing.value = null
  // decimal comma accepted: it is what a French keyboard types
  const raw = Number(draft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw)) return            // unreadable input: we keep what was there
  if (field === 'yaw') {
    const next = (((Math.round(raw) % 360) + 360) % 360)
    if (next !== yaw.value) void house.savePlacement({ yaw: next })
    return
  }
  if (field === 'diagonal') {
    const next = Math.min(DIAGONAL_LIMITS.max, Math.max(DIAGONAL_LIMITS.min, Math.round(raw)))
    if (next !== inches.value) void house.savePlacement({ size: tvSizeFromInches(next) })
    return
  }
  const { min, max } = SIZE_LIMITS[field]
  const next = Math.min(max, Math.max(min, Math.round(raw * 100) / 100))
  if (next !== size.value[field]) void house.savePlacement({ size: { ...size.value, [field]: next } })
}

type Mount = NonNullable<HouseDevice['mount']>
type Preset = 'ceiling' | 'wall' | 'table' | 'floor' | ''
const PRESETS: { value: Exclude<Preset, ''>; mount: Mount; z: (ceiling: number) => number }[] = [
  { value: 'ceiling', mount: 'ceiling', z: (c) => c - 0.15 },
  { value: 'wall', mount: 'wall', z: () => 1.8 },
  { value: 'table', mount: 'free', z: () => 0.75 },
  { value: 'floor', mount: 'floor', z: () => 0.1 },
]
const presetOptions = computed(() => PRESETS.map((p) => ({ value: p.value as Preset, label: t(`place.presets.${p.value}`) })))
const preset = computed<Preset>(() => (props.device.mount === 'free' ? 'table' : props.device.mount ?? ''))

/** Ceiling height of the anchor room (slider bound); 4 m outside a room. */
const ceiling = computed(() => {
  const room = props.device.roomId ? house.index?.roomsById.get(props.device.roomId) : undefined
  const level = room ? house.index?.levelsById.get(room.levelId) : undefined
  return house.house && room && level ? roomHeight(room, level, resolveDefaults(house.house.defaults)) : 4
})
const position = computed(() => house.draft?.position ?? props.device.position)
// Changing level is done HERE, by a selector, never by the level tabs (a click to go
// look elsewhere re-anchored the device without saying so). From top to bottom, like the app's lists.
const levelOptions = computed(() => house.levels.map((l) => ({ value: l.id, title: l.shortName ?? l.name })))
// What anchors the device: its room, or failing that its level — a level without a room (the roof) anchors alone.
const anchorName = computed(() => {
  const id = house.draft?.roomId ?? props.device.roomId
  if (id) return house.index?.roomsById.get(id)?.name ?? id
  const level = props.device.levelId ? house.index?.levelsById.get(props.device.levelId) : undefined
  return level ? level.shortName ?? level.name : t('place.outside')
})

// Remove from house: two-step gesture (arm, then confirm within 4 s) so as not to take a
// device out with a sliding finger; the place is reserved, only the label changes.
//
// A solar installation takes its PANEL ARRAYS with it (`siteId`, see `house/place.ts`): the
// confirmation says so, because it is the moment when one decides — twenty modules disappear with it.
const removeArmed = ref(false)
const ownedArrays = computed(() => (props.device.deviceId
  ? house.arrays.filter((a) => a.siteId === props.device.deviceId).length
  : 0))
const removeLabel = computed(() => (!removeArmed.value ? t('place.remove')
  : ownedArrays.value > 0 ? t('place.removeWithArrays', { n: ownedArrays.value }, ownedArrays.value)
  : t('place.removeConfirm')))
let disarm: ReturnType<typeof setTimeout> | undefined
function removeClick() {
  if (!removeArmed.value) { removeArmed.value = true; disarm = setTimeout(() => { removeArmed.value = false }, 4000); return }
  clearTimeout(disarm)
  removeArmed.value = false
  void house.removePlacement()
}
onBeforeUnmount(() => clearTimeout(disarm))

function applyPreset(p: Preset) {
  const def = PRESETS.find((x) => x.value === p)
  if (!def) return
  const [x, y] = position.value
  void house.savePlacement({ position: [x, y, Math.round(def.z(ceiling.value) * 20) / 20], mount: def.mount })
}
</script>

<template>
  <div class="card card--soft place" :data-open="house.placing ? '1' : '0'">
    <!-- collapsible body, ABOVE the foot: height animated from 0 to its content -->
    <div class="place__body" :style="{ '--place-h': `${innerHeight}px` }" :aria-hidden="house.placing ? 'false' : 'true'">
      <div ref="inner" class="place__inner">
        <div class="place__row place__top">
          <p class="muted place__hint">{{ $t('place.hint') }}</p>
          <!-- reserved place: invisible as long as there is nothing to revert, the row does not move -->
          <button type="button" class="pill place__revert" :class="{ 'place__revert--off': !house.canRevert }"
                  :disabled="house.saving || !house.canRevert" :tabindex="house.canRevert ? 0 : -1" @click="house.revertPlacement()">
            {{ $t('place.revert') }}
          </button>
        </div>
        <div class="place__row">
          <span class="muted">{{ $t('place.level') }}</span>
          <v-select class="place__level" :model-value="house.placementLevelId" :items="levelOptions" item-title="title" item-value="value"
                    density="compact" variant="outlined" hide-details :disabled="house.saving || !house.placing"
                    :aria-label="$t('place.level')" @update:model-value="(id: string) => house.setPlacementLevel(id)" />
        </div>
        <Segmented dense class="place__presets" :model-value="preset" :options="presetOptions" @update:model-value="applyPreset" />
        <div class="place__row">
          <span class="muted">{{ $t('place.height') }}</span>
          <span class="place__value">{{ position[2].toFixed(2) }} m</span>
        </div>
        <v-slider :model-value="position[2]" :min="0" :max="ceiling" :step="0.05" :disabled="house.saving || !house.placing" hide-details
                  @update:model-value="(v: number) => house.previewHeight(v)" @end="() => house.savePlacement()" />
        <div v-if="orientable" class="place__row">
          <span class="muted">{{ $t('place.orientation') }}</span>
          <span class="place__turn">
            <button type="button" class="key" :disabled="house.saving || !house.placing" :title="$t('place.rotateLeft')" :aria-label="$t('place.rotateLeft')" @click="rotate(YAW_STEP)">
              <StrokeIcon name="rotateLeft" :size="16" />
            </button>
            <span class="place__deg">
              <input class="place__value place__num" type="text" inputmode="numeric" enterkeyhint="done"
                     :value="shownValue('yaw', String(yaw))" :disabled="house.saving || !house.placing"
                     :aria-label="$t('place.orientation')"
                     @focus="startEdit('yaw', String(yaw), $event)"
                     @mouseup.prevent
                     @input="draft = ($event.target as HTMLInputElement).value"
                     @keydown.enter="($event.target as HTMLInputElement).blur()"
                     @keydown.esc="cancelEdit(); ($event.target as HTMLInputElement).blur()"
                     @blur="commitEdit('yaw')">
              <span class="place__unit">°</span>
            </span>
            <button type="button" class="key" :disabled="house.saving || !house.placing" :title="$t('place.rotateRight')" :aria-label="$t('place.rotateRight')" @click="rotate(-YAW_STEP)">
              <StrokeIcon name="rotateRight" :size="16" />
            </button>
          </span>
        </div>
        <!-- TV: a diagonal in inches (the number on the box). Cover: width × height/projection. -->
        <div v-if="sizable && tv" class="place__row">
          <span class="muted">{{ $t('place.size.diagonal') }}</span>
          <span class="place__turn">
            <button type="button" class="key" :disabled="house.saving || !house.placing"
                    :title="`${$t('place.smaller')} — ${$t('place.size.diagonal')}`"
                    :aria-label="`${$t('place.smaller')} — ${$t('place.size.diagonal')}`"
                    @click="resizeDiagonal(-DIAGONAL_STEP)">
              <StrokeIcon name="minus" :size="16" />
            </button>
            <span class="place__deg">
              <input class="place__value place__num" type="text" inputmode="numeric" enterkeyhint="done"
                     :value="shownValue('diagonal', String(inches))" :disabled="house.saving || !house.placing"
                     :aria-label="$t('place.size.diagonal')"
                     @focus="startEdit('diagonal', String(inches), $event)"
                     @mouseup.prevent
                     @input="draft = ($event.target as HTMLInputElement).value"
                     @keydown.enter="($event.target as HTMLInputElement).blur()"
                     @keydown.esc="cancelEdit(); ($event.target as HTMLInputElement).blur()"
                     @blur="commitEdit('diagonal')">
              <span class="place__unit">″</span>
            </span>
            <button type="button" class="key" :disabled="house.saving || !house.placing"
                    :title="`${$t('place.bigger')} — ${$t('place.size.diagonal')}`"
                    :aria-label="`${$t('place.bigger')} — ${$t('place.size.diagonal')}`"
                    @click="resizeDiagonal(DIAGONAL_STEP)">
              <StrokeIcon name="plus" :size="16" />
            </button>
          </span>
        </div>
        <template v-else-if="sizable">
          <div v-for="dim in (['width', 'height'] as const)" :key="dim" class="place__row">
            <span class="muted">{{ dimLabel(dim) }}</span>
            <span class="place__turn">
              <button type="button" class="key" :disabled="house.saving || !house.placing"
                      :title="`${$t('place.smaller')} — ${dimLabel(dim)}`" :aria-label="`${$t('place.smaller')} — ${dimLabel(dim)}`"
                      @click="resize(dim, -SIZE_STEP)">
                <StrokeIcon name="minus" :size="16" />
              </button>
              <input class="place__value place__num place__num--size" type="text" inputmode="decimal" enterkeyhint="done"
                     :value="shownValue(dim, size[dim].toFixed(2))" :disabled="house.saving || !house.placing"
                     :aria-label="dimLabel(dim)"
                     @focus="startEdit(dim, size[dim].toFixed(2), $event)"
                     @mouseup.prevent
                     @input="draft = ($event.target as HTMLInputElement).value"
                     @keydown.enter="($event.target as HTMLInputElement).blur()"
                     @keydown.esc="cancelEdit(); ($event.target as HTMLInputElement).blur()"
                     @blur="commitEdit(dim)">
              <button type="button" class="key" :disabled="house.saving || !house.placing"
                      :title="`${$t('place.bigger')} — ${dimLabel(dim)}`" :aria-label="`${$t('place.bigger')} — ${dimLabel(dim)}`"
                      @click="resize(dim, SIZE_STEP)">
                <StrokeIcon name="plus" :size="16" />
              </button>
            </span>
          </div>
        </template>
        <div v-if="leavesShown" class="place__row">
          <span class="muted">{{ $t('place.leaves') }}</span>
          <Segmented dense class="place__leaves" :model-value="leaves" :options="leavesOptions"
                     @update:model-value="(v: string) => house.savePlacement({ leaves: v === '2' ? 2 : 1 })" />
        </div>
        <div v-if="isSpeaker" class="place__row">
          <span class="muted">{{ $t('place.speakerShape.label') }}</span>
          <Segmented dense class="place__leaves" :model-value="speakerShape" :options="speakerShapeOptions"
                     @update:model-value="setSpeakerShape" />
        </div>
        <div class="place__row place__bottom">
          <div class="muted place__coords">x {{ position[0].toFixed(2) }} · y {{ position[1].toFixed(2) }} · {{ anchorName }}</div>
          <!-- reserved place: invisible for a provisional one ("Cancel" is enough), otherwise two-step removal -->
          <button type="button" class="pill place__remove" :class="{ 'place__remove--off': house.isProvisional, 'place__remove--armed': removeArmed }"
                  :disabled="house.saving || house.isProvisional" :tabindex="house.isProvisional ? -1 : 0"
                  :title="$t('place.removeHint')" @click="removeClick">
            {{ removeLabel }}
          </button>
        </div>
      </div>
    </div>
    <!-- foot: title on the left, ONE button on the right that keeps its place and width in both states -->
    <div class="place__foot">
      <span class="muted">{{ $t('place.title') }}</span>
      <button v-if="!house.placing" type="button" class="pill place__cta" @click="house.startPlacing()">
        <StrokeIcon name="move" :size="16" /> {{ $t('place.move') }}
      </button>
      <!-- a provisional one never dropped is abandoned: the button says so -->
      <button v-else type="button" class="pill place__cta" data-on="1" @click="house.stopPlacing()">{{ house.isProvisional ? $t('place.cancel') : $t('place.done') }}</button>
    </div>
  </div>
</template>

<style scoped>
.place { padding: 12px 14px; font-size: 13px; }
/* the body opens by its height (0 → measured height) and lights up; closed, it occupies nothing */
.place__body {
  overflow: hidden; max-height: 0; opacity: 0; visibility: hidden;
  transition: max-height .3s ease, opacity .25s ease, visibility 0s linear .3s;   /* invisible only once folded */
}
.place[data-open="1"] .place__body { max-height: var(--place-h, 400px); opacity: 1; visibility: visible; transition: max-height .3s ease, opacity .25s ease, visibility 0s; }
/* The space between the body and the foot is part of the body: it folds with it.
   `minmax(0, 1fr)` and not the default `auto` column: an auto column never goes below the
   min-content of its rows (the four height presets, the "Remove from house" pill),
   and the body, in `overflow: hidden`, then cut the 3 px that stuck out — the "m" of the mounting
   height went through there. The rows now squeeze to the panel's width. */
.place__inner { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; align-content: start; padding-bottom: 12px; }
.place__foot, .place__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.place__top { align-items: flex-start; }
.place__hint { margin: 0; font-size: 12px; flex: 1 1 auto; }
.place__revert { flex: 0 0 auto; }
.place__revert--off { visibility: hidden; }
/* same width for "Move" and "Done": the button changes neither place nor size */
.place__cta { min-width: 124px; justify-content: center; }
.place__value { font-variant-numeric: tabular-nums; font-weight: 600; }
.place__coords { font-size: 12px; font-variant-numeric: tabular-nums; min-width: 0; }
.place__bottom { align-items: center; }
/* fixed width for both labels ("Remove from house" / "Confirm removal"): nothing moves */
.place__remove { flex: 0 0 auto; min-width: 150px; justify-content: center; font-size: 12px; }
.place__remove--off { visibility: hidden; }
.place__remove--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
.place__turn { display: inline-flex; align-items: center; gap: 6px; }
/* the level selector stays at the end of its row, at fixed width: changing level moves nothing */
.place__level { flex: 0 0 auto; width: 150px; }
/* only two choices: the segmented control stays at the end of its row rather than taking its width */
.place__leaves { flex: 0 0 auto; }
/* The four height presets asked for 264 px out of 257: as soon as the panel takes its scrollbar,
   the last pill overflowed the card. A segmented control does not squeeze by itself (its
   words do not break), so we take a few pixels back on the sides of each segment. */
.place__presets { max-width: 100%; }
.place__presets :deep(.segmented__item) { padding: 0 8px; }
/* fixed width ("315°", "10.25"): the value changes without moving the keys */
.place__deg { width: 5ch; display: inline-flex; align-items: center; justify-content: center; }
.place__unit { flex: 0 0 auto; }
/* The input field occupies exactly the place the text occupied: same font, same weight,
   same width, fixed-width digits — switching to edit therefore moves nothing. The underline is
   set as `box-shadow` and not as a border, for the same reason. */
.place__num {
  width: 3.5ch; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent;
  color: inherit; font: inherit; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -1px 0 var(--line); border-radius: 4px;
}
.place__num--size { width: 5ch; }
.place__num:focus { outline: none; background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent); }
.place__num:disabled { opacity: .4; box-shadow: none; }
.key {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
@media (prefers-reduced-motion: reduce) { .place__body { transition: none; } }
</style>
