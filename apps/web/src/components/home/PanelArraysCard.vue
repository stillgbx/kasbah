<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PANEL_PEAK_W, PANEL_SIZE, panelDeviceId, type PanelArray, type Vec3 } from '@kasbah/shared'
import { shortInverterId } from '../../lib/energy'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Panel arrays of a solar installation: the list, then the adjustment of one of them. An array
// is a GRID (`house.arrays`) — rows, columns, orientation of the module, of the array, tilt —
// and its modules are derived from it: two arrays of ten panels fit in two objects of the JSON.
// It moves by dragging any of its modules in the 3D, like a device.
//
// The card lives at the bottom of the installation's panel ("Solar installation"), above
// "Location": it is where one comes when declaring one's installation.
const props = defineProps<{ siteDeviceId: string }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

/** The arrays of THIS installation (see `arraysOf`: those that name it, plus the anonymous ones). */
const fields = computed(() => house.arraysOf(props.siteDeviceId))
const editing = computed(() => house.editingArray)
/** Displayed name: the JSON's, otherwise "Array n" — an array created here does not carry one. */
const arrayName = (a: PanelArray, i: number) => a.name ?? t('arrays.field', { n: i + 1 })
const boundCount = (a: PanelArray) => a.panels.filter(Boolean).length

// --- numeric settings: same keys as the "Move" mode, value editable by keyboard.
const LIMITS = { rows: { min: 1, max: 20 }, cols: { min: 1, max: 20 }, slope: { min: 0, max: 90 }, tilt: { min: -90, max: 90 }, z: { min: 0, max: 5 }, peak: { min: 50, max: 1000 }, out: { min: 0, max: 1000 } } as const
type Field = keyof typeof LIMITS | 'yaw'
const STEP: Record<Field, number> = { rows: 1, cols: 1, slope: 5, tilt: 5, z: 0.05, yaw: 45, peak: 10, out: 10 }

/**
 * Height of the array above the level's floor. It exists because a roof is THICK: placed at 0 on
 * a flat roof, an array is buried in the slab. An array created here is born already on top of the roof
 * (`panelBaseZ`); this line serves tilted frames and hand-written files.
 */
const z = computed(() => editing.value?.origin[2] ?? 0)
function setZ(next: number) {
  const a = editing.value
  if (!a) return
  const v = Math.min(LIMITS.z.max, Math.max(LIMITS.z.min, Math.round(next * 100) / 100))
  if (v !== a.origin[2]) void house.saveArray({ origin: [a.origin[0], a.origin[1], v] })
}

/**
 * Peak power of a module (Wp), the one printed on the back of the panel. It measures nothing: it serves
 * as the SCALE of the color — the module's slab in the 3D, the gauge of its row in the Energy view.
 * A micro-inverter often clips below it, so that a 500 Wp array never quite fills
 * its gauges: that is precisely why the value is adjusted here, array by array.
 */
const peak = computed(() => editing.value?.panel.peakW ?? PANEL_PEAK_W)
function setPeak(next: number) {
  const a = editing.value
  if (!a) return
  const v = Math.min(LIMITS.peak.max, Math.max(LIMITS.peak.min, Math.round(next)))
  // PARTIAL patch of the module: its size stays what it was (see `putArrayInJson`)
  if (v !== a.panel.peakW) void house.saveArray({ panel: { peakW: v } })
}

/**
 * MAX output power of the array's inverters, the datasheet term: what a
 * micro-inverter can output at best (480 W for an IQ8P), whatever the peak of the glass
 * above it. It is entered because the gateway does not publish it: it only gives the maximum
 * ever REPORTED by each inverter, which tells the past weather and not the device. 0 = unknown,
 * and the Energy view then marks no ceiling.
 */
const maxOut = computed(() => editing.value?.maxOutputW ?? 0)
function setMaxOut(next: number) {
  const a = editing.value
  if (!a) return
  const v = Math.min(LIMITS.out.max, Math.max(LIMITS.out.min, Math.round(next)))
  if (v !== a.maxOutputW) void house.saveArray({ maxOutputW: v })
}

const steppers = computed(() => {
  const a = editing.value
  if (!a) return []
  return [
    { key: 'rows' as const, label: t('arrays.rows'), value: a.rows, text: String(a.rows), hint: '' },
    { key: 'cols' as const, label: t('arrays.cols'), value: a.cols, text: String(a.cols), hint: '' },
    { key: 'z' as const, label: t('arrays.height'), value: z.value, text: `${z.value.toFixed(2)} m`, hint: t('arrays.heightHint') },
    // two angles, and the order explains them: the support first (the roof), the frame next
    { key: 'slope' as const, label: t('arrays.slope'), value: a.slope, text: `${a.slope}°`, hint: t('arrays.slopeHint') },
    { key: 'tilt' as const, label: t('arrays.tilt'), value: a.tilt, text: `${a.tilt}°`, hint: t('arrays.tiltHint') },
  ]
})

/**
 * Shrinking the grid RELEASES the inverters that no longer have a slot (the server cuts them), and
 * enlarging it leaves the new slots empty: it is up to the user to say who goes where.
 */
function bump(field: 'rows' | 'cols' | 'slope' | 'tilt' | 'z' | 'peak' | 'out', delta: number) {
  const a = editing.value
  if (!a) return
  if (field === 'z') { setZ(z.value + delta); return }
  if (field === 'peak') { setPeak(peak.value + delta); return }
  if (field === 'out') { setMaxOut(maxOut.value + delta); return }
  const { min, max } = LIMITS[field]
  const next = Math.min(max, Math.max(min, a[field] + delta))
  if (next !== a[field]) void house.saveArray({ [field]: next })
}
function rotate(delta: number) {
  const a = editing.value
  if (!a) return
  void house.saveArray({ yaw: (((a.yaw + delta) % 360) + 360) % 360 })
}

// Direct input, as for the size of an opening: the field only commits on validation, and
// while typing it is the draft that is displayed (otherwise the reread house would overwrite the typing).
const editingField = ref<Field | null>(null)
const draft = ref('')
/**
 * The content gets SELECTED on focus: without that, typing 500 in a field at 450 gave
 * "450500" — the cursor landed where one had clicked and the typing was appended to the value. The
 * `@mouseup.prevent` of the fields goes with it: the mouse RELEASE puts the cursor back and undoes
 * the selection made on focus, so that `select()` alone does not hold on a click.
 */
function startEdit(field: Field, shown: string, ev?: FocusEvent) {
  editingField.value = field
  draft.value = shown
  // AFTER the render: setting the draft changes the field's bound value, and Vue, by rewriting
  // `value`, clears any selection — selecting before therefore did not hold for a single frame.
  const el = ev?.target as HTMLInputElement | undefined
  if (el) void nextTick(() => el.select())
}
const shownValue = (field: Field, value: string) => (editingField.value === field ? draft.value : value)
function commitEdit(field: Field) {
  const a = editing.value
  if (editingField.value !== field || !a) return
  editingField.value = null
  const raw = Number(draft.value.replace(',', '.').trim())
  if (!Number.isFinite(raw)) return
  if (field === 'yaw') {
    const next = (((Math.round(raw) % 360) + 360) % 360)
    if (next !== a.yaw) void house.saveArray({ yaw: next })
    return
  }
  if (field === 'z') { setZ(raw); return }
  if (field === 'peak') { setPeak(raw); return }
  if (field === 'out') { setMaxOut(raw); return }
  const { min, max } = LIMITS[field]
  const next = Math.min(max, Math.max(min, Math.round(raw)))
  if (next !== a[field]) void house.saveArray({ [field]: next })
}

// --- orientation of the MODULE: portrait (upright) or landscape (lying down). It is the same module, turned
// by a quarter turn: its two dimensions swap.
const layout = computed<'portrait' | 'landscape'>(() => (editing.value && editing.value.panel.width > editing.value.panel.height ? 'landscape' : 'portrait'))
const layoutOptions = computed(() => [
  { value: 'portrait' as const, label: t('arrays.portrait') },
  { value: 'landscape' as const, label: t('arrays.landscape') },
])
function setLayout(next: 'portrait' | 'landscape') {
  const a = editing.value
  if (!a || next === layout.value) return
  void house.saveArray({ panel: { width: a.panel.height, height: a.panel.width } })
}

// --- inverters: one per slot, row by row. The fill at creation follows the order of
// the serial numbers; here we correct the slot that does not match the real roof.
const free = computed(() => house.freeInverters(props.siteDeviceId))
const slots = computed(() => {
  const a = editing.value
  if (!a) return []
  return Array.from({ length: a.rows * a.cols }, (_, i) => {
    const deviceId = a.panels[i] ?? null
    const row = Math.floor(i / a.cols), col = i % a.cols
    // An empty cell carries its place — the same numbers as the module's pill in the 3D
    // ("Slot 2-5"): it is what links the panel's grid to what one sees on the roof.
    return {
      i, deviceId, key: panelDeviceId(a.id, row, col),
      label: deviceId ? shortInverterId(deviceId) : `${row + 1}-${col + 1}`,
      name: deviceId ? devices.descriptors[deviceId]?.name ?? deviceId : t('arrays.cell', { r: row + 1, c: col + 1 }),
    }
  })
})
function setSlot(i: number, deviceId: string | null) {
  const a = editing.value
  if (!a) return
  const panels: (string | null)[] = Array.from({ length: a.rows * a.cols }, (_, k) => a.panels[k] ?? null)
  panels[i] = deviceId
  void house.saveArray({ panels })
}
/** The house device behind a slot: selecting it opens that module's panel. */
function selectSlot(i: number) {
  const a = editing.value
  if (!a) return
  house.selectDevice(panelDeviceId(a.id, Math.floor(i / a.cols), i % a.cols))
}

// Two-step removal, like "Remove from house": an array takes all its modules with it.
const removeArmed = ref(false)
let disarm: ReturnType<typeof setTimeout> | undefined
function removeClick() {
  const a = editing.value
  if (!a) return
  if (!removeArmed.value) { removeArmed.value = true; disarm = setTimeout(() => { removeArmed.value = false }, 4000); return }
  clearTimeout(disarm)
  removeArmed.value = false
  void house.removeArray(a.id)
}
onBeforeUnmount(() => clearTimeout(disarm))

const origin = computed<Vec3>(() => house.arrayDraft ?? editing.value?.origin ?? [0, 0, 0])
const levelName = computed(() => {
  const id = editing.value?.levelId
  const level = id ? house.index?.levelsById.get(id) : undefined
  return level?.shortName ?? level?.name ?? ''
})
/** A portrait module measures 1.13 × 1.76 m: the written size reads in clear under the grid. */
const moduleSize = computed(() => {
  const p = editing.value?.panel ?? PANEL_SIZE
  return `${p.width.toFixed(2)} × ${p.height.toFixed(2)} m`
})
</script>

<template>
  <div class="card card--soft arrays">
    <div class="arrays__row arrays__head">
      <span class="muted">{{ $t('arrays.title') }}</span>
      <button v-if="!editing" type="button" class="pill arrays__cta" :disabled="house.saving" :title="$t('arrays.addHint')" @click="house.addArray(props.siteDeviceId)">
        <StrokeIcon name="plus" :size="16" /> {{ $t('arrays.add') }}
      </button>
      <button v-else type="button" class="pill arrays__cta" data-on="1" @click="house.stopEditingArray()">{{ $t('arrays.done') }}</button>
    </div>

    <p v-if="fields.length === 0" class="muted arrays__hint">{{ $t('arrays.none') }}</p>

    <!-- the list stays visible during the adjustment: one goes from one array to another without closing -->
    <button v-for="(a, i) in fields" :key="a.id" type="button" class="arrays__item" :data-on="a.id === house.editingArrayId ? '1' : '0'"
            @click="a.id === house.editingArrayId ? house.stopEditingArray() : house.startEditingArray(a.id, props.siteDeviceId)">
      <span class="icon-square"><StrokeIcon name="solar" :size="16" /></span>
      <span class="min0 arrays__item-main">
        <span class="arrays__item-name">{{ arrayName(a, i) }}</span>
        <span class="muted arrays__item-sub">{{ $t('arrays.count', { rows: a.rows, cols: a.cols, n: boundCount(a) }) }}</span>
      </span>
      <span class="arrays__item-cta">
        <StrokeIcon :name="a.id === house.editingArrayId ? 'check' : 'move'" :size="13" />
        {{ a.id === house.editingArrayId ? $t('arrays.done') : $t('arrays.edit') }}
      </span>
    </button>

    <template v-if="editing">
      <p class="muted arrays__hint">{{ $t('arrays.hint') }}</p>
      <div v-for="s in steppers" :key="s.key" class="arrays__row">
        <span class="muted" :title="s.hint">{{ s.label }}</span>
        <span class="arrays__turn">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.smaller')} — ${s.label}`" :aria-label="`${$t('place.smaller')} — ${s.label}`" @click="bump(s.key, -STEP[s.key])">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <input class="arrays__num" type="text" :inputmode="s.key === 'z' ? 'decimal' : 'numeric'" enterkeyhint="done"
                 :value="shownValue(s.key, s.text)" :disabled="house.saving" :aria-label="s.label"
                 @focus="startEdit(s.key, String(s.value), $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="editingField = null; ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit(s.key)">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.bigger')} — ${s.label}`" :aria-label="`${$t('place.bigger')} — ${s.label}`" @click="bump(s.key, STEP[s.key])">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>
      <!-- orientation of the array: same keys and same direction as the "Move" mode -->
      <div class="arrays__row">
        <span class="muted" :title="$t('arrays.azimuthHint')">{{ $t('place.orientation') }}</span>
        <span class="arrays__turn">
          <button type="button" class="key" :disabled="house.saving" :title="$t('place.rotateLeft')" :aria-label="$t('place.rotateLeft')" @click="rotate(STEP.yaw)">
            <StrokeIcon name="rotateLeft" :size="16" />
          </button>
          <input class="arrays__num" type="text" inputmode="numeric" enterkeyhint="done"
                 :value="shownValue('yaw', `${editing.yaw}°`)" :disabled="house.saving" :aria-label="$t('place.orientation')"
                 @focus="startEdit('yaw', String(editing!.yaw), $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="editingField = null; ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit('yaw')">
          <button type="button" class="key" :disabled="house.saving" :title="$t('place.rotateRight')" :aria-label="$t('place.rotateRight')" @click="rotate(-STEP.yaw)">
            <StrokeIcon name="rotateRight" :size="16" />
          </button>
        </span>
      </div>
      <div class="arrays__row">
        <span class="muted">{{ $t('arrays.module') }}<span class="arrays__size"> · {{ moduleSize }}</span></span>
        <Segmented dense class="arrays__layout" :model-value="layout" :options="layoutOptions" @update:model-value="setLayout" />
      </div>
      <!-- Under the module, because it is a property of the module: what it gives at best; then
           what the inverter under it can output, which is often lower. -->
      <div class="arrays__row">
        <span class="muted" :title="$t('arrays.peakHint')">{{ $t('arrays.peak') }}</span>
        <span class="arrays__turn">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.smaller')} — ${$t('arrays.peak')}`" :aria-label="`${$t('place.smaller')} — ${$t('arrays.peak')}`" @click="bump('peak', -STEP.peak)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <input class="arrays__num" type="text" inputmode="numeric" enterkeyhint="done"
                 :value="shownValue('peak', `${peak} Wc`)" :disabled="house.saving" :aria-label="$t('arrays.peak')"
                 @focus="startEdit('peak', String(peak), $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="editingField = null; ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit('peak')">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.bigger')} — ${$t('arrays.peak')}`" :aria-label="`${$t('place.bigger')} — ${$t('arrays.peak')}`" @click="bump('peak', STEP.peak)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <div class="arrays__row">
        <span class="muted" :title="$t('arrays.maxOutputHint')">{{ $t('arrays.maxOutput') }}</span>
        <span class="arrays__turn">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.smaller')} — ${$t('arrays.maxOutput')}`" :aria-label="`${$t('place.smaller')} — ${$t('arrays.maxOutput')}`" @click="bump('out', -STEP.out)">
            <StrokeIcon name="minus" :size="16" />
          </button>
          <!-- 0 = unknown, and that is said with a dash: "0 W" would claim that no inverter outputs anything -->
          <input class="arrays__num" type="text" inputmode="numeric" enterkeyhint="done"
                 :value="shownValue('out', maxOut > 0 ? `${maxOut} W` : '—')" :disabled="house.saving" :aria-label="$t('arrays.maxOutput')"
                 @focus="startEdit('out', maxOut > 0 ? String(maxOut) : '', $event)"
                 @mouseup.prevent
                 @input="draft = ($event.target as HTMLInputElement).value"
                 @keydown.enter="($event.target as HTMLInputElement).blur()"
                 @keydown.esc="editingField = null; ($event.target as HTMLInputElement).blur()"
                 @blur="commitEdit('out')">
          <button type="button" class="key" :disabled="house.saving" :title="`${$t('place.bigger')} — ${$t('arrays.maxOutput')}`" :aria-label="`${$t('place.bigger')} — ${$t('arrays.maxOutput')}`" @click="bump('out', STEP.out)">
            <StrokeIcon name="plus" :size="16" />
          </button>
        </span>
      </div>

      <!-- the grid of slots, row by row: it is the layout of the array. A cell carries
           the last four characters of the inverter; one touches it to change it. -->
      <div class="arrays__row arrays__slots-head">
        <span class="muted">{{ $t('arrays.inverters') }}</span>
        <span class="muted arrays__free">{{ $t('arrays.freeCount', { n: free.length }) }}</span>
      </div>
      <div class="arrays__grid" :style="{ '--cols': editing.cols }">
        <v-menu v-for="s in slots" :key="s.i" location="bottom start"
                @update:model-value="(open: boolean) => house.hoverSlot(open ? s.key : null)">
          <template #activator="{ props: menu }">
            <!-- hovering a cell lights up its module in the 3D: without this link, one fills the grid
                 without knowing which roof panel each cell corresponds to -->
            <button v-bind="menu" type="button" class="slot" :data-on="s.deviceId ? '1' : '0'" :disabled="house.saving" :title="s.name"
                    @mouseenter="house.hoverSlot(s.key)" @mouseleave="house.hoverSlot(null)"
                    @focus="house.hoverSlot(s.key)" @blur="house.hoverSlot(null)">{{ s.label }}</button>
          </template>
          <div class="card slot-list">
            <div class="section-label">{{ $t('arrays.inverters') }}</div>
            <button v-if="s.deviceId" type="button" class="slot-item" @click="selectSlot(s.i)">
              <StrokeIcon name="solar" :size="14" /> <span class="min0">{{ s.name }}</span>
            </button>
            <button type="button" class="slot-item" @click="setSlot(s.i, null)">{{ $t('arrays.slotNone') }}</button>
            <button v-for="d in free" :key="d.id" type="button" class="slot-item" @click="setSlot(s.i, d.id)">
              <span class="min0">{{ d.name }}</span>
            </button>
          </div>
        </v-menu>
      </div>

      <div class="arrays__row arrays__bottom">
        <div class="muted arrays__coords">x {{ origin[0].toFixed(2) }} · y {{ origin[1].toFixed(2) }} · {{ levelName }}</div>
        <button type="button" class="pill arrays__remove" :class="{ 'arrays__remove--armed': removeArmed }" :disabled="house.saving"
                :title="$t('arrays.removeHint')" @click="removeClick">
          {{ removeArmed ? $t('arrays.removeConfirm') : $t('arrays.remove') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.arrays { padding: 12px 14px; font-size: 13px; display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
.arrays__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.arrays__head { min-height: 34px; }
/* same width in both states: the button changes neither place nor size. 104 px, no
   more: beyond that, the card's title no longer fits on one line in the panel's 295 px */
.arrays__cta { flex: 0 0 auto; min-width: 104px; justify-content: center; font-size: 12px; }
.arrays__head > .muted { white-space: nowrap; }
.arrays__hint { margin: 0; font-size: 12px; }
.arrays__item {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px;
  border-radius: 12px; border: 1px solid var(--line); background: transparent; color: var(--text);
  transition: background .15s, border-color .15s;
}
.arrays__item:hover { background: var(--accent-soft); }
.arrays__item[data-on='1'] { border-color: var(--accent); background: var(--accent-soft); }
.arrays__item-main { display: grid; }
.arrays__item-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arrays__item-sub { font-size: 12px; }
/* a pill, not a label: "Adjust" is what opens the array (and its dragging in the 3D) */
.arrays__item-cta {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; font-size: 12px;
  padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted);
}
.arrays__item:hover .arrays__item-cta, .arrays__item[data-on='1'] .arrays__item-cta { border-color: var(--accent); color: var(--accent); }
.arrays__turn { display: inline-flex; align-items: center; gap: 6px; }
/* fixed width ("180°", "20"): the value changes without moving the keys */
.arrays__num {
  width: 5.5ch; min-width: 0; height: 30px; padding: 0; border: 0; background: transparent;
  color: inherit; font: inherit; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums;
  box-shadow: inset 0 -1px 0 var(--line); border-radius: 4px;
}
.arrays__num:focus { outline: none; background: var(--accent-soft); box-shadow: inset 0 -1px 0 var(--accent); }
.arrays__num:disabled { opacity: .4; box-shadow: none; }
.arrays__layout { flex: 0 0 auto; }
.arrays__size { font-variant-numeric: tabular-nums; }
.arrays__slots-head { margin-top: 2px; }
.arrays__free { font-size: 12px; }
.arrays__grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 4px; }
.slot {
  height: 26px; min-width: 0; border-radius: 7px; border: 1px solid var(--line); background: transparent;
  color: var(--muted); font: 600 11px/1 var(--font); font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px;
}
.slot[data-on='1'] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.slot:disabled { opacity: .4; }
.slot-list { padding: 8px; display: grid; gap: 2px; max-height: 320px; overflow-y: auto; min-width: 200px; }
/* FIXED-WIDTH font for the list: one looks there for a serial number read off a plan, and
   digits that line up in columns are compared at a glance. The grid's cells, for their part,
   are already in tabular digits — the two are read together. */
.slot-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 0; border-radius: 9px;
  background: transparent; color: var(--text); text-align: left; width: 100%;
  font: 13px/1.35 ui-monospace, 'SFMono-Regular', 'Menlo', 'Consolas', monospace;
  letter-spacing: -0.01em;
}
.slot-item:hover { background: var(--accent-soft); }
.arrays__coords { font-size: 12px; font-variant-numeric: tabular-nums; min-width: 0; }
/* fixed width for both labels ("Remove the array" / "Confirm removal"): nothing moves */
.arrays__remove { flex: 0 0 auto; min-width: 150px; justify-content: center; font-size: 12px; }
.arrays__remove--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
.key {
  display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
