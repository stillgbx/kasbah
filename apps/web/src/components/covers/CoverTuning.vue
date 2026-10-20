<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { OPENING_MATERIALS, type DeviceDescriptor, type OpeningMaterial } from '@kasbah/shared'
import { coverLeaves, hasLeaves } from '../../lib/orientation'
import { useHouseStore } from '../../stores/house'

/**
 * What only the HOUSE knows about a cover: its leaves, its material, its color. The vendor says
 * nothing of all this — a Somfy motor publishes a travel in percent, not a white wooden shutter
 * with two leaves —, so these three live in `house.devices[]`, exactly as the same settings live
 * in the opening for a joinery (`OpeningPanel`).
 *
 * All three are OPTIONAL and the panel shows it: "Automatic" for the material, a cross to clear
 * the color. A cover that says nothing about them keeps what the render style gives it, and a
 * house surveyed yesterday does not change look because these settings exist.
 *
 * The leaves do not change the TRAVEL, only the drawing: a single-piece apron, or two panels
 * separated by a split — that is how a casement shutter reads. The travel stays the one the state
 * publishes.
 */
const props = defineProps<{ descriptor: DeviceDescriptor }>()
const house = useHouseStore()

const houseDevice = computed(() => house.houseDeviceFor(props.descriptor.id))
/** An awning unfolds: it has no leaves to count (`hasLeaves`). */
const leavesShown = computed(() => !!houseDevice.value && hasLeaves(houseDevice.value, props.descriptor))
const leaves = computed(() => (houseDevice.value ? coverLeaves(houseDevice.value, props.descriptor) : 1))
function setLeaves(raw: string): void {
  const next = raw === '2' ? 2 : 1
  if (next === leaves.value) return
  void house.setDeviceTuning(props.descriptor.id, { leaves: next })
}

/** `''` = automatic: the key leaves the file and the render style takes over again. */
const material = computed(() => houseDevice.value?.coverMaterial ?? '')
function setMaterial(raw: string): void {
  // `find` rather than a cast: what the selector returns is a string, and an unknown value
  // falls back to automatic instead of entering the file
  const next: OpeningMaterial | '' = OPENING_MATERIALS.find((m) => m === raw) ?? ''
  if (next === material.value) return
  void house.setDeviceTuning(props.descriptor.id, { coverMaterial: next })
}

const color = computed(() => houseDevice.value?.coverColor ?? '')
/**
 * What the native picker shows when nothing is chosen: an aluminum gray, not a black. The real
 * tint lives in the render style palette and cannot be read from here — but we can start from
 * a value that looks like what is seen (same convention as `OpeningPanel`).
 */
const DEFAULT_SWATCH = '#b8bcc0'
function setColor(value: string): void {
  if (value === color.value) return
  void house.setDeviceTuning(props.descriptor.id, { coverColor: value })
}
/**
 * The tint is seen WHILE it is being chosen: the native picker announces each shade hovered and
 * the scene puts it on the apron right away — that is how a color is judged, shutter in front
 * of the eyes. Only the validated choice (`change`) is written; an abandoned choice gives back
 * the previous tint.
 */
const preview = (value: string | null) => house.previewBodyColor(props.descriptor.id, value)
onBeforeUnmount(() => preview(null))
</script>

<template>
  <div class="card card--soft tune">
    <label v-if="leavesShown" class="tune__row">
      <span class="muted tune__k">{{ $t('opening.leaves') }}</span>
      <span class="tune__fields">
        <select :value="String(leaves)" @change="setLeaves(($event.target as HTMLSelectElement).value)">
          <option value="1">1</option>
          <option value="2">2</option>
        </select>
      </span>
    </label>
    <label class="tune__row">
      <span class="muted tune__k">{{ $t('opening.material') }}</span>
      <span class="tune__fields">
        <select :value="material" @change="setMaterial(($event.target as HTMLSelectElement).value)">
          <option value="">{{ $t('opening.materials.auto') }}</option>
          <option v-for="m in OPENING_MATERIALS" :key="m" :value="m">{{ $t(`opening.materials.${m}`) }}</option>
        </select>
      </span>
    </label>
    <!-- EXPLICIT `for`: a label without `for` activates its first labelable descendant, and the
         cross comes before the field — clicking the row would clear the choice just made. -->
    <label class="tune__row" :for="`cover-color-${descriptor.id}`">
      <span class="muted tune__k">{{ $t('opening.color') }}</span>
      <span class="tune__fields">
        <!-- RESERVED slot: the cross fades out without the picker moving, it does not appear -->
        <button type="button" class="tune__reset" :class="{ 'tune__reset--off': !color }"
                :disabled="!color" :tabindex="color ? 0 : -1"
                :title="$t('opening.colorReset')" :aria-label="$t('opening.colorReset')" @click="setColor('')">×</button>
        <input :id="`cover-color-${descriptor.id}`" type="color" :value="color || DEFAULT_SWATCH"
               @input="preview(($event.target as HTMLInputElement).value)"
               @change="setColor(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
  </div>
</template>

<style scoped>
/* same layout as the vehicle settings: both live in the collapsible card of the panel */
.tune { padding: 10px 12px; display: grid; gap: 10px; }
.tune__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.tune__k { flex: 1 1 auto; min-width: 0; }
.tune__fields { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
.tune select {
  width: 96px; padding: 4px 8px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px;
}
/* same layout as the selectors: the row does not change height from one section to another */
.tune input[type='color'] { width: 96px; height: 28px; padding: 2px; cursor: pointer; }
.tune__reset {
  width: 22px; height: 22px; padding: 0; line-height: 1;
  border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; cursor: pointer;
}
.tune__reset--off { visibility: hidden; }
</style>
