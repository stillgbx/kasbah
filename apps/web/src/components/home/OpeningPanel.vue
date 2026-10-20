<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MAX_OPENING_LEAVES, MIN_OPENING_DIM, MIN_OPENING_LEAVES, OPENING_MATERIALS, OPENING_TYPES, computeRoof, fitGap, fitHeight, fitSurfaceGap, fitWidth, isSurfaceOpening, openingGaps, openingLabel, openingLeaves, openingSill, resolveDefaults, surfaceFootprint, surfaceGaps, type OpeningType, type ParkingSide, type Room } from '@kasbah/shared'
import { canTakeOpening } from '../../lib/cover'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// "Opening" panel: kind, measurements (width, height, sill height, position on the wall) and
// link to a cover. The place used to be read-only at first; it is now also adjusted here, by
// tape measure from the corners — dragging with a finger does not place a window at 3.56 m from a corner.
//
// Same idioms as `PlacementControl`: −/+ keys, direct input that only commits on
// validation, decimal comma accepted, fixed-width digits so that nothing moves while typing.
//
// Rule common to the five measurements (width, height, sill, left, right): we KEEP what the
// user typed and move what can be moved, rather than trimming silently. Typing 3 m
// wide into a gap of 3 m that has only 1 m to the right makes the opening SLIDE (`fitWidth`); a
// height that no longer fits makes the sill GO DOWN (`fitHeight`); one of the two position
// measurements moves the opening along its wall and the other measurement follows (`fitGap`). Each gesture is a single
// write: the two values that change together go out in the same request.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

const sel = computed(() => house.selectedOpening)
const opening = computed(() => sel.value?.opening ?? null)
const room = computed(() => sel.value?.room ?? null)
/** The rooms of the same level: `fitWidth`/`fitGap` need them to see the party walls. */
const roomsOnLevel = computed<Room[]>(() => {
  const r = room.value
  return r ? house.index?.roomsByLevel.get(r.levelId) ?? [r] : []
})

const typeOptions = computed(() => {
  const o = opening.value
  const surface = o ? isSurfaceOpening(o.type) : false
  return OPENING_TYPES
    .filter((v) => isSurfaceOpening(v) === surface)
    .map((v) => ({ value: v, label: t(`opening.types.${v}`) }))
})
/**
 * Changing kind also writes the sill, IN THE SAME request, for everything that touches the floor
 * (door, passage, garage door, bay window, glazed door): `openingSill` returns 0 by default
 * only if `sill` is ABSENT from the JSON, so a window retyped as a bay without this gesture kept its low wall
 * (measured: 20 cm). A single gesture for the user (choosing "Bay window"), a single write.
 * `window`, the only one to take a default sill, guesses nothing: the existing value stays,
 * the user adjusts it themselves. The surface kinds stay among themselves (no wall ↔ floor).
 */
function setType(v: OpeningType) {
  if (v === opening.value?.type) return
  if (isSurfaceOpening(v)) { void house.saveOpening({ type: v }); return }
  void house.saveOpening(v === 'window' ? { type: v } : { type: v, sill: 0 })
}

// --- joinery: what the survey cannot measure with a tape measure. The three settings are
// OPTIONAL in the file, and the panel shows it — "Automatic" for the material, a
// color that can be cleared. An opening that says nothing keeps what the scene deduces from it, and a
// house surveyed yesterday does not change look because these settings exist.
const leafOptions = Array.from(
  { length: MAX_OPENING_LEAVES - MIN_OPENING_LEAVES + 1 },
  (_, i) => ({ value: MIN_OPENING_LEAVES + i, label: String(MIN_OPENING_LEAVES + i) }),
)
/** The EFFECTIVE leaves: the number from the file, otherwise the one the scene deduces (a wide bay). */
const leaves = computed(() => (opening.value ? openingLeaves(opening.value) : 1))
function setLeaves(v: number) { if (v !== leaves.value) void house.saveOpening({ leaves: v }) }

/** `''` = automatic: the key leaves the file and the opening's kind takes over again. */
const materialOptions = computed(() => [
  { value: '', label: t('opening.materials.auto') },
  ...OPENING_MATERIALS.map((v) => ({ value: v, label: t(`opening.materials.${v}`) })),
])
function setMaterial(v: string) {
  // `find` rather than a cast: what the selector returns is a string, and an unknown value
  // falls back to automatic instead of entering the file
  const next = OPENING_MATERIALS.find((m) => m === v) ?? ''
  if (next !== (opening.value?.material ?? '')) void house.saveOpening({ material: next })
}

const color = computed(() => opening.value?.color ?? '')
/**
 * What the native picker shows when nothing is chosen: a joinery anthracite, not a
 * black. We cannot display the style's real tint here — it lives in the scene's
 * palette — but we can start from a value that looks like what is seen.
 */
const DEFAULT_SWATCH = '#3a3f45'
function setColor(v: string) { if (v !== color.value) void house.saveOpening({ color: v }) }

/** EFFECTIVE sill height (the house's default if the JSON gives none). */
const sill = computed(() => {
  const o = opening.value
  return o && house.house ? openingSill(o, resolveDefaults(house.house.defaults)) : 0
})
/**
 * Footprint seen from above (`surfaceFootprint`): a Velux on a roof slope takes the heading of the descent and its
 * length shortened by the slope, so that its measurements start from the edge of its hole. `null` off a surface.
 */
const footprint = computed(() => {
  const o = opening.value, h = house.house
  if (!o || !h || !isSurfaceOpening(o.type) || o.x === undefined || o.y === undefined || o.yaw === undefined) return null
  const roof = o.type === 'roof-window' ? computeRoof(h, resolveDefaults(h.defaults)) : undefined
  return surfaceFootprint({ type: o.type, x: o.x, y: o.y, yaw: o.yaw, width: o.width, height: o.height }, roof)
})
/** The opening as the measurements see it in plan (heading and length of its footprint). */
const planOpening = computed(() => {
  const o = opening.value, fp = footprint.value
  return o && fp ? { ...o, yaw: fp.yaw, height: fp.height } : o
})
/** Heading imposed by the roof slope: the field keeps its place, grayed out, and shows the real heading. */
const yawLocked = computed(() => (footprint.value?.slope ?? 0) > 0)
/** The two wall measurements, or the four surface measurements. */
const gaps = computed(() => (opening.value && room.value ? openingGaps(room.value, opening.value) : { left: 0, right: 0 }))
const surfaceGapMap = computed(() => (
  planOpening.value && room.value && isSurfaceOpening(planOpening.value.type)
    ? surfaceGaps(room.value, planOpening.value)
    : { front: null, back: null, left: null, right: null }
))

type Field = 'width' | 'height' | 'sill' | 'left' | 'right' | 'yaw' | ParkingSide
const STEP = 0.05
const YAW_STEP = 5
const isSurface = computed(() => !!(opening.value && isSurfaceOpening(opening.value.type)))
const fields = computed(() => {
  const o = opening.value
  if (!o) return []
  if (isSurfaceOpening(o.type)) {
    return [
      // Length = axis of the heading (`height` JSON), width = across (`width` JSON) — like a place.
      { key: 'height' as const, label: t('opening.length') },
      { key: 'width' as const, label: t('opening.width') },
      { key: 'yaw' as const, label: t('opening.yaw') },
      { key: 'front' as const, label: t('opening.gapFront') },
      { key: 'back' as const, label: t('opening.gapBack') },
      { key: 'left' as const, label: t('opening.gapLeft') },
      { key: 'right' as const, label: t('opening.gapRight') },
    ]
  }
  return [
    { key: 'width' as const, label: t('opening.width') },
    { key: 'height' as const, label: t('opening.height') },
    { key: 'sill' as const, label: t('opening.sill') },
    { key: 'left' as const, label: t('opening.gapLeft') },
    { key: 'right' as const, label: t('opening.gapRight') },
  ]
})
function fieldValue(field: Field): number {
  const o = opening.value
  if (!o) return 0
  switch (field) {
    case 'width': return o.width
    case 'height': return o.height
    case 'sill': return sill.value
    case 'right': return isSurface.value ? (surfaceGapMap.value.right ?? 0) : gaps.value.right
    case 'left': return isSurface.value ? (surfaceGapMap.value.left ?? 0) : gaps.value.left
    case 'front': return surfaceGapMap.value.front ?? 0
    case 'back': return surfaceGapMap.value.back ?? 0
    case 'yaw': return footprint.value?.yaw ?? o.yaw ?? 0
  }
}

const editing = ref<Field | null>(null)
const draft = ref('')
function startEdit(field: Field, shown: string, ev?: FocusEvent) {
  editing.value = field
  draft.value = shown
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
function cancelEdit() { editing.value = null }
const shownValue = (field: Field, value: string) => (editing.value === field ? draft.value : value)

/**
 * Applies a WANTED measurement: keeps what was typed, moves what can be moved, a single write.
 * `width`/`height` can make a second value move (`offset`/`sill`) — both go out in the
 * same `saveOpening`, otherwise the card would briefly show two inconsistent numbers.
 */
function apply(field: Field, wanted: number) {
  const o = opening.value
  if (!o || !house.house) return
  const defaults = resolveDefaults(house.house.defaults)
  if (field === 'yaw') {
    if (yawLocked.value) return                     // the roof slope decides the heading
    const next = Math.round((((wanted % 360) + 360) % 360) * 10) / 10
    if (next !== (o.yaw ?? 0)) void house.saveOpening({ yaw: next })
    return
  }
  if (field === 'width') {
    if (isSurfaceOpening(o.type)) {
      const next = Math.max(MIN_OPENING_DIM, Math.round(wanted * 100) / 100)
      if (next !== o.width) void house.saveOpening({ width: next })
      return
    }
    if (!room.value) return
    const r = fitWidth(room.value, roomsOnLevel.value, defaults, o, wanted)
    if (r && (r.width !== o.width || r.offset !== o.offset)) void house.saveOpening({ width: r.width, offset: r.offset })
    return
  }
  if (field === 'height') {
    if (isSurfaceOpening(o.type)) {
      const next = Math.max(MIN_OPENING_DIM, Math.round(wanted * 100) / 100)
      if (next !== o.height) void house.saveOpening({ height: next })
      return
    }
    const r = fitHeight(sill.value, o.height, house.openingCeiling, wanted)
    if (r.height !== o.height || r.sill !== sill.value) void house.saveOpening({ height: r.height, sill: r.sill })
    return
  }
  if (field === 'sill') {
    const max = house.openingBounds?.maxSill ?? wanted
    const next = Math.min(max, Math.max(0, Math.round(wanted * 100) / 100))
    if (next !== sill.value) void house.saveOpening({ sill: next })
    return
  }
  if (!room.value) return
  // Surface: the four measurements make the center SLIDE (`fitSurfaceGap`), like a place.
  if (isSurfaceOpening(o.type) && (field === 'front' || field === 'back' || field === 'left' || field === 'right')) {
    if (surfaceGapMap.value[field] === null) return
    const next = fitSurfaceGap(room.value, planOpening.value ?? o, field, wanted)
    if (next && (next.x !== o.x || next.y !== o.y)) void house.saveOpening({ x: next.x, y: next.y })
    return
  }
  // Wall: 'right' / 'left' — measurements from the corners, seen FROM THE INSIDE (`fitGap`).
  if (field !== 'left' && field !== 'right') return
  const next = fitGap(room.value, roomsOnLevel.value, defaults, o, field, wanted)
  if (next !== null && next !== o.offset) void house.saveOpening({ offset: next })
}
function bump(field: Field, delta: number) {
  apply(field, fieldValue(field) + (field === 'yaw' ? (delta > 0 ? YAW_STEP : -YAW_STEP) : delta))
}
function commitEdit(field: Field) {
  if (editing.value !== field) return
  editing.value = null
  const raw = Number(draft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw)) return
  // input floor: `width`/`height` never go below `MIN_OPENING_DIM` (an opening
  // of 0 would disappear); `sill`/`left`/`right` can be 0 (a door, a corner of the wall)
  apply(field, Math.max(field === 'width' || field === 'height' ? MIN_OPENING_DIM : 0, raw))
}

/** Read-only: the wall that carries the opening — its place, for its part, is adjusted just below. */
const wallLabel = computed(() => {
  const o = opening.value
  if (!o) return ''
  if (isSurfaceOpening(o.type)) return t(`opening.hosts.${o.type === 'skylight' ? 'floor' : 'roof'}`)
  return t('opening.wall', { segment: (o.segment ?? 0) + 1 })
})

// --- name: optional, entered here. Empty = clear and go back to the survey's id (same convention as
// `house.renameDevice`). `openingLabel` is THE display rule, shared with the room's list
// and the 3D label: never a window named three different ways.
const displayName = computed(() => (opening.value ? openingLabel(opening.value) : ''))
const renamingName = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
function startRename() {
  renamingName.value = true
  nameDraft.value = opening.value?.name ?? ''
  void nextTick(() => nameInput.value?.select())
}
function commitRename() {
  renamingName.value = false
  const wanted = nameDraft.value.trim()
  if (wanted === (opening.value?.name ?? '')) return
  void house.saveOpening({ name: wanted })
}

/** The label of an opening, found by its id across the rooms (to say who owns
 * the opening that already holds a candidate cover). */
function openingLabelById(id: string): string {
  for (const r of house.effective?.rooms ?? []) {
    const o = r.openings.find((x) => x.id === id)
    if (o) return openingLabel(o)
  }
  return id
}

/** Candidate covers: the devices we have the RIGHT to assign to an opening (`canTakeOpening` —
 * everything except gate and garage door, a single rule with the Covers view).
 *
 * `d.kind` alone is not enough: a device of the raw JSON (linked by `deviceId` only, never
 * auto-placed) does not carry it — it is the plugin's descriptor that decides, as everywhere else
 * in the app (`RoomPanel#row`, `DevicePanel`). Without this detour, the list stayed empty and the selector
 * fell back to the raw id of the already linked cover, for lack of options in which to find it.
 * The NAME, for its part, follows the same rule as everywhere: the house's if there is one, otherwise the one the
 * vendor declares — never the id. A cover already placed on ANOTHER opening is told apart
 * ("already placed on…") without disappearing: taking it over is a deliberate gesture, `setOpeningDevice` releases
 * the old link by itself. */
const deviceOptions = computed(() => {
  const list = (house.effective?.devices ?? [])
    .map((d) => ({ d, descriptor: d.deviceId ? devices.descriptors[d.deviceId] : undefined }))
    .filter(({ d, descriptor }) => (descriptor?.kind ?? d.kind) === 'cover' && canTakeOpening(descriptor))
    .map(({ d, descriptor }) => {
      const name = d.name ?? descriptor?.name ?? d.id
      const takenElsewhere = d.openingId && d.openingId !== opening.value?.id
      return { value: d.id, title: takenElsewhere ? t('opening.deviceTaken', { name, opening: openingLabelById(d.openingId!) }) : name }
    })
  return [{ value: '', title: t('opening.deviceNone') }, ...list]
})
const linkedDeviceId = computed(() => house.openingDevices[0]?.id ?? '')
function setDevice(id: string) { void house.setOpeningDevice(id || null) }

// --- delete: TWO-STEP gesture (arm, then confirm within 4 s), like "Forget
// device" and "Remove from house". An opening surveyed with a tape measure must not go away
// from a finger put down crookedly on a tablet, and there is nothing to restore afterwards.
const removeArmed = ref(false)
let disarm: ReturnType<typeof setTimeout> | undefined
function clickRemove() {
  if (!removeArmed.value) { removeArmed.value = true; disarm = setTimeout(() => { removeArmed.value = false }, 4000); return }
  clearTimeout(disarm)
  removeArmed.value = false
  void house.removeOpening()
}
onBeforeUnmount(() => clearTimeout(disarm))
/** The cover that the deletion would release: we SAY it beforehand, it is the moment when one decides. */
const freedName = computed(() => {
  const d = house.openingDevices[0]
  return d ? d.name ?? (d.deviceId ? devices.descriptors[d.deviceId]?.name : undefined) ?? d.id : null
})
</script>

<template>
  <template v-if="opening && room">
    <div class="panel-head">
      <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ room.name }}</button>
      <div class="head">
        <span class="icon-square icon-square--lg"><StrokeIcon name="room" :size="22" /></span>
        <div class="head__main">
          <!-- name, or input: the field takes the SAME line as the title, like renaming a
               vehicle (`VehiclesView`) — empty clears and hands back to `openingLabel` (the survey's id) -->
          <div class="head__name-row">
            <input v-if="renamingName" ref="nameInput" v-model="nameDraft" class="head__name head__name-input"
                   maxlength="60" :aria-label="$t('opening.rename')" :placeholder="opening.id"
                   @keyup.enter="commitRename" @keyup.escape="renamingName = false" @blur="commitRename">
            <template v-else>
              <MarqueeText class="head__name" :text="displayName" />
              <button type="button" class="head__pencil" :title="$t('opening.rename')" :aria-label="$t('opening.rename')" @click="startRename">
                <StrokeIcon name="pencil" :size="14" />
              </button>
            </template>
          </div>
          <div class="muted head__sub">{{ wallLabel }}</div>
        </div>
      </div>
    </div>

    <div class="card card--soft opening">
      <!-- `Segmented` was tried here: its four labels ("Garage door" included) impose
           393 px of min-content, a width that the panel (294 px usable) cannot offer — the whole
           card overflowed. A `v-select`, like the level of `PlacementControl`, squeezes into its place. -->
      <div class="opening__row">
        <span class="muted">{{ $t('opening.type') }}</span>
        <v-select class="opening__select" :model-value="opening.type" :items="typeOptions" item-title="label" item-value="value"
                  density="compact" variant="outlined" hide-details :disabled="house.savingOpening"
                  :aria-label="$t('opening.type')" @update:model-value="setType" />
      </div>

      <div v-for="f in fields" :key="f.key" class="opening__row">
        <span class="muted">{{ f.label }}</span>
        <span class="opening__turn">
          <button type="button" class="key" :disabled="house.savingOpening || (f.key === 'yaw' && yawLocked)"
                  :title="`${$t('opening.smaller')} — ${f.label}`" :aria-label="`${$t('opening.smaller')} — ${f.label}`"
                  @click="bump(f.key, -STEP)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <input class="opening__num" type="text" inputmode="decimal" enterkeyhint="done"
                 :value="shownValue(f.key, fieldValue(f.key).toFixed(2))" :disabled="house.savingOpening || (f.key === 'yaw' && yawLocked)" :aria-label="f.label"
                 @focus="startEdit(f.key, fieldValue(f.key).toFixed(2), $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="cancelEdit(); ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit(f.key)">
          <button type="button" class="key" :disabled="house.savingOpening || (f.key === 'yaw' && yawLocked)"
                  :title="`${$t('opening.bigger')} — ${f.label}`" :aria-label="`${$t('opening.bigger')} — ${f.label}`"
                  @click="bump(f.key, STEP)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <p class="muted opening__hint">{{ isSurface ? $t('opening.whereHintSurface') : $t('opening.whereHint') }}</p>

      <!-- the joinery: what is not measured with a tape measure. Three rows with the same layout as
           the kind, so that the card reads at a glance. -->
      <div class="opening__row">
        <span class="muted">{{ $t('opening.leaves') }}</span>
        <v-select class="opening__select" :model-value="leaves" :items="leafOptions" item-title="label" item-value="value"
                  density="compact" variant="outlined" hide-details :disabled="house.savingOpening"
                  :aria-label="$t('opening.leaves')" @update:model-value="setLeaves" />
      </div>
      <div class="opening__row">
        <span class="muted">{{ $t('opening.material') }}</span>
        <v-select class="opening__select" :model-value="opening.material ?? ''" :items="materialOptions" item-title="label" item-value="value"
                  density="compact" variant="outlined" hide-details :disabled="house.savingOpening"
                  :aria-label="$t('opening.material')" @update:model-value="setMaterial" />
      </div>
      <div class="opening__row">
        <span class="muted">{{ $t('opening.color') }}</span>
        <span class="opening__turn">
          <!-- RESERVED place: the button fades out without the picker moving, it does not appear -->
          <button type="button" class="opening__reset" :class="{ 'opening__reset--off': !color }"
                  :disabled="house.savingOpening || !color" :tabindex="color ? 0 : -1"
                  :title="$t('opening.colorReset')" :aria-label="$t('opening.colorReset')" @click="setColor('')">×</button>
          <input class="opening__color" type="color" :value="color || DEFAULT_SWATCH" :disabled="house.savingOpening"
                 :aria-label="$t('opening.color')" @change="setColor(($event.target as HTMLInputElement).value)">
        </span>
      </div>

      <div class="opening__row">
        <span class="muted">{{ $t('opening.device') }}</span>
        <v-select class="opening__device" :model-value="linkedDeviceId" :items="deviceOptions" item-title="title" item-value="value"
                  density="compact" variant="outlined" hide-details :disabled="house.savingOpening"
                  :aria-label="$t('opening.device')" @update:model-value="setDevice" />
      </div>

      <div class="opening__row opening__bottom">
        <button type="button" class="pill opening__remove" :class="{ 'opening__remove--armed': removeArmed }"
                :disabled="house.savingOpening" @click="clickRemove">
          {{ removeArmed ? $t('opening.removeConfirm') : $t('opening.remove') }}
        </button>
        <!-- reserved place: invisible as long as there is nothing to revert, the row does not move -->
        <button type="button" class="pill opening__revert" :class="{ 'opening__revert--off': !house.canRevertOpening }"
                :disabled="house.savingOpening || !house.canRevertOpening" :tabindex="house.canRevertOpening ? 0 : -1"
                @click="house.revertOpening()">
          {{ $t('opening.revert') }}
        </button>
      </div>
      <!-- reserved place: what the deletion would take with it, said once armed, without shifting anything -->
      <p class="muted opening__frees">{{ removeArmed && freedName ? $t('opening.removeFrees', { name: freedName }) : '' }}</p>
    </div>
  </template>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; align-self: flex-start; }
.crumb:hover { color: var(--text); }
.head { display: flex; align-items: center; gap: 12px; }
.head__main { flex: 1 1 0; min-width: 0; }
.head__name-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* `flex: 1 1 0` and not `1 1 auto`: `MarqueeText` carries `contain: inline-size` (see its comment),
   which cancels its intrinsic width — in a FLEX container, a `flex-basis: auto` then falls back
   on this zero width and the name has no room left (measured: 0 px). A flex-basis of 0 gives it
   all the remaining room whatever its content, as `.head__main` (block) already does
   for `DevicePanel`. */
.head__name { flex: 1 1 0; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; min-width: 0; }
/* the pencil takes no room until it is hovered: always at the same point, discreet */
.head__pencil {
  flex: none; display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 6px; background: none; color: var(--muted); cursor: pointer; opacity: .55;
}
.head__pencil:hover, .head__pencil:focus-visible { opacity: 1; background: var(--surface2); color: var(--text); }
.head__name-input {
  flex: 1 1 auto; min-width: 0; padding: 0 6px; margin: 0 -6px;
  border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text);
  font: inherit; font-size: inherit; font-weight: inherit;
}
/* a single line, always: safety net if the font or the translation exceeds the planned
   worst case anyway (see `whereLabel`) — the ellipsis cuts rather than pushing the card by 17 px */
.head__sub { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-square--lg { width: 44px; height: 44px; border-radius: 12px; flex: none; }

.opening { padding: 12px 14px; font-size: 13px; display: grid; gap: 10px; }
.opening__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.opening__turn { display: inline-flex; align-items: center; gap: 6px; }
.opening__hint { margin: 0; font-size: 12px; }
/* FIXED width, at the end of the row: same pattern as the level selector of `PlacementControl`
   (`place__level`, 150 px) — a segmented control imposed 393 px of min-content ("Garage door" included)
   and made the whole card overflow, a `v-select` squeezes into the width it is given */
.opening__select, .opening__device { flex: 0 0 auto; width: 150px; }
.opening__bottom { min-height: 34px; }
/* width shared by both labels: nothing moves when arming. 175 px and not 150 like "Forget
   device" — "Confirm deletion" measures 170 px, and the button grew under the finger. */
.opening__remove { flex: 0 0 auto; min-width: 175px; justify-content: center; font-size: 12px; }
.opening__remove--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
/* Two lines, reserved and never exceeded: the card keeps its height whether the warning
   is there or not, and a long cover name (60 characters allowed) is cut rather than making it grow. */
.opening__frees {
  margin: 0; font-size: 12px; min-height: 36px; line-height: 18px;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
/* reserved place for "Revert": nothing moves when it appears */
.opening__revert--off { visibility: hidden; }
/* the color picker at the layout of the −/+ keys: the row keeps the height of the others */
.opening__color { width: 72px; height: 30px; padding: 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); cursor: pointer; }
.opening__color:disabled { opacity: .4; cursor: default; }
.opening__reset {
  width: 30px; height: 30px; padding: 0; line-height: 1;
  border: 1px solid var(--line); border-radius: 9px; background: transparent; color: var(--text);
  font: inherit; font-size: 15px; cursor: pointer;
}
.opening__reset:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.opening__reset--off { visibility: hidden; }
/* fixed width ("1.20"): the value changes without moving the keys */
.opening__num {
  width: 5ch; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent;
  color: inherit; font: inherit; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -1px 0 var(--line); border-radius: 4px;
}
.opening__num:focus { outline: none; background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent); }
.opening__num:disabled { opacity: .4; box-shadow: none; }
.key {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
