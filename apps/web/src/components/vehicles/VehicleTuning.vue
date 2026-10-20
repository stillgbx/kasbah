<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vehicleLeaseSchema, type DeviceDescriptor, type VehicleLease } from '@kasbah/shared'
import { getTransport } from '../../api'
import type { RenaultContract } from '../../api/transport'
import { useHouseStore } from '../../stores/house'
import { bodyColorOf, bodyFinishOf, needsCapacity, tunableVehicle } from '../../lib/vehicleTuning'
import { VEHICLE_FINISHES, type VehicleFinish } from '@kasbah/shared'
import { modelsFor, NO_MODEL, resolveModel } from '../../three/models/catalog'

/**
 * What only the user can know about a vehicle: the offset of its computed place, the
 * correction of its heading, the capacity of its battery. These values live in the HOUSE
 * (`house.devices[]`) and not in the state, which is the vendor's truth, rewritten on each read.
 *
 * The offset (m, house reference frame): neither the car's GPS nor the house's origin is exact
 * to the meter, and the gap measured by eye in the scene is entered here once and for all.
 * The rotation (°): it is ADDED to the heading the scene deduces (the vendor's, or the axis of the
 * room) — neither says which way the car parked; a U-turn is entered here.
 * The capacity (kWh): NO vendor gives it — neither Tesla nor Renault — and without it one cannot
 * estimate the charging power of a vehicle that does not say it.
 *
 * The 3D body and its color fall under the same rule: the catalog knows which shapes are
 * shipped, but not which one is parked there — a brand plugin can cover several models — and
 * NO vendor publishes a vehicle's tint. The select only offers the bodies of the
 * vehicle's plugin — one does not park a Model S in an R5's garage —, failing that those of its
 * brand, for the car that a generic plugin publishes (the simulation, for example).
 *
 * Two surfaces display it: the Vehicles view card (folded behind "Adjust") and the
 * selected device's panel, where one sees the car MOVE in the scene while adjusting it.
 */
const props = defineProps<{ descriptor: DeviceDescriptor }>()
const house = useHouseStore()
const { locale } = useI18n()

const houseDevice = computed(() => house.houseDeviceFor(props.descriptor.id))
const tunable = computed(() => tunableVehicle(props.descriptor, houseDevice.value))
/** Nothing to correct for a vehicle that was PLACED by hand in the house: its entry already is authoritative. */
const gpsPlaced = computed(() => houseDevice.value?.position === undefined)
const capacityNeeded = computed(() => needsCapacity(props.descriptor))
const rotation = computed(() => houseDevice.value?.yawOffset ?? 0)
const capacity = computed(() => houseDevice.value?.batteryKwh ?? 0)
const offsetOf = (axis: 0 | 1) => houseDevice.value?.gpsOffset?.[axis] ?? 0

/** An emptied field is worth 0, and 0 CLEARS the setting — that is what the write contract says. */
const typed = (raw: string) => (raw.trim() === '' ? 0 : Number(raw.replace(',', '.')))
function setOffset(axis: 0 | 1, raw: string): void {
  const value = typed(raw)
  if (!Number.isFinite(value) || value === offsetOf(axis)) return
  const next: [number, number] = axis === 0 ? [value, offsetOf(1)] : [offsetOf(0), value]
  void house.setDeviceTuning(props.descriptor.id, { gpsOffset: next })
}
/** Brought back into [-180, 180[: 200° and -160° are the same rotation, and the contract refuses the first. */
function setRotation(raw: string): void {
  const typedValue = typed(raw)
  if (!Number.isFinite(typedValue)) return
  const value = ((((typedValue + 180) % 360) + 360) % 360) - 180
  if (value === rotation.value) return
  void house.setDeviceTuning(props.descriptor.id, { yawOffset: value })
}
function setCapacity(raw: string): void {
  const value = typed(raw)
  if (!Number.isFinite(value) || value < 0 || value === capacity.value) return
  void house.setDeviceTuning(props.descriptor.id, { batteryKwh: value })
}

/**
 * The LEASE is entered as a DRAFT: start, end and package only make sense together, and the write
 * contract takes it as a block. Each modified field writes as soon as the whole is valid; clearing everything
 * clears it. The draft follows the house ("Revert", the other surface) as long as it is not touched.
 */
const lease = computed(() => houseDevice.value?.lease)
const draft = reactive({ start: '', end: '', km: '', startKm: '' })
function syncDraft(l: VehicleLease | undefined): void {
  draft.start = l?.start ?? ''
  draft.end = l?.end ?? ''
  draft.km = l ? String(l.km) : ''
  draft.startKm = l?.startKm ? String(l.startKm) : ''
}
watch(lease, syncDraft, { immediate: true })
function writeLease(): void {
  if (!draft.start && !draft.end && !draft.km && !draft.startKm) {
    if (lease.value) void house.setDeviceTuning(props.descriptor.id, { lease: '' })
    return
  }
  const startKm = typed(draft.startKm)
  const parsed = vehicleLeaseSchema.safeParse({
    start: draft.start, end: draft.end, km: typed(draft.km), ...(startKm ? { startKm } : {}),
  })
  // incomplete: the draft awaits the rest, nothing is written
  if (!parsed.success || JSON.stringify(parsed.data) === JSON.stringify(lease.value)) return
  void house.setDeviceTuning(props.descriptor.id, { lease: parsed.data })
}
function setLeaseField(field: keyof typeof draft, raw: string): void {
  draft[field] = raw.trim()
  writeLease()
}
function clearLease(): void {
  syncDraft(undefined)
  writeLease()
}

/**
 * "Look up at Renault": a maintenance contract capped in km is often aligned with the lease,
 * but nothing guarantees it — it is PROPOSED, never written automatically. Read on click only.
 */
const renaultVin = computed(() => (props.descriptor.pluginId === 'renault' ? props.descriptor.externalId : null))
const contracts = ref<RenaultContract[] | null>(null)
const checking = ref(false)
const checkError = ref<string | null>(null)
async function checkRenault(): Promise<void> {
  if (!renaultVin.value || checking.value) return
  checking.value = true
  checkError.value = null
  try { contracts.value = (await getTransport().renaultContracts(renaultVin.value, locale.value.slice(0, 2))).contracts }
  catch (err) { checkError.value = (err as Error).message }
  finally { checking.value = false }
}
function useContract(c: RenaultContract): void {
  if (c.start) draft.start = c.start
  if (c.end) draft.end = c.end
  draft.km = String(c.maxKm)
  writeLease()
}
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale.value) : '—')
const km = (n: number) => new Intl.NumberFormat(locale.value).format(n)

/** Nothing to offer when no body matches: both rows disappear. */
const models = computed(() => modelsFor(props.descriptor.pluginId, props.descriptor.meta.manufacturer))
/** What the scene draws TODAY, including when the user has chosen nothing. */
const model3d = computed(() => resolveModel(houseDevice.value?.model3d, props.descriptor.pluginId, props.descriptor.meta.manufacturer)?.id ?? NO_MODEL)
function setModel3d(value: string): void {
  if (value === model3d.value) return
  void house.setDeviceTuning(props.descriptor.id, { model3d: value })
}

/** The manual setting, alone: it is what we write, and what the cross alone clears. */
/**
 * The paint finish, in the vocabulary of the car itself (a Tesla's "Colorizer"
 * says Solid / Metallic / Matte). The select shows what is PAINTED today — the manual
 * choice, otherwise what the vendor says — and writing makes that choice explicit.
 */
const bodyFinish = computed(() => bodyFinishOf(props.descriptor, houseDevice.value))
/** The manual choice ALONE — the select, for its part, shows what is painted, wherever it comes from. */
const chosenFinish = computed(() => houseDevice.value?.bodyFinish)
function setBodyFinish(value: string): void {
  // `''` clears, as for the color; otherwise a finish identical to the displayed one writes nothing... EXCEPT
  // if it comes from the vendor: choosing it explicitly FREEZES it, and that is a useful gesture.
  const finish = value as VehicleFinish | ''
  if (finish && finish === chosenFinish.value) return
  void house.setDeviceTuning(props.descriptor.id, { bodyFinish: finish })
}

const bodyColor = computed(() => houseDevice.value?.bodyColor)
/**
 * What the scene paints TODAY. Without a manual setting, it is the tint the plugin deduced —
 * the picker therefore starts from the vehicle's real color, not from an arbitrary gray — and failing that a
 * neutral gray, for lack of knowing what to show.
 */
const painted = computed(() => bodyColorOf(props.descriptor, houseDevice.value) ?? '#9aa4b2')
function setBodyColor(value: string): void {
  if (value === bodyColor.value) return
  void house.setDeviceTuning(props.descriptor.id, { bodyColor: value })
}
/**
 * The tint is seen WHILE it is being chosen: the native picker announces each shade hovered, and
 * the scene paints it right away — that is how a color is judged, on the car. Only the
 * validated choice (`change`) is written; an abandoned choice gives back the previous tint, like closing
 * the panel.
 */
const preview = (value: string | null) => house.previewBodyColor(props.descriptor.id, value)
onBeforeUnmount(() => preview(null))

/**
 * "REVERT": the settings as they were when the section was OPENED — the component is born
 * with it (both surfaces mount it with `v-if`), hence the snapshot taken here. Each field
 * is written as you type, with no "Save" button: it is this rollback that stands
 * in for undo, as "Revert" does for a device's location.
 *
 * A single call gives back all six at once, including those just added: `[0, 0]`, `0` and the
 * empty string CLEAR, that is what the write contract says.
 */
const tuned = () => {
  const hd = houseDevice.value
  return {
    gpsOffset: hd?.gpsOffset ? ([...hd.gpsOffset] as [number, number]) : undefined,
    yawOffset: hd?.yawOffset, batteryKwh: hd?.batteryKwh,
    model3d: hd?.model3d, bodyColor: hd?.bodyColor, bodyFinish: hd?.bodyFinish, lease: hd?.lease,
  }
}
const opened = tuned()
const changed = computed(() => JSON.stringify(tuned()) !== JSON.stringify(opened))
function revert(): void {
  void house.setDeviceTuning(props.descriptor.id, {
    gpsOffset: opened.gpsOffset ?? [0, 0], yawOffset: opened.yawOffset ?? 0, batteryKwh: opened.batteryKwh ?? 0,
    model3d: opened.model3d ?? '', bodyColor: opened.bodyColor ?? '', bodyFinish: opened.bodyFinish ?? '',
    lease: opened.lease ?? '',
  })
}
</script>

<template>
  <div v-if="tunable" class="card card--soft tune">
    <!-- RESERVED place: invisible as long as there is nothing to revert, the row does not move -->
    <div class="tune__top">
      <button type="button" class="pill tune__revert" :class="{ 'tune__revert--off': !changed }"
              :disabled="!changed" :tabindex="changed ? 0 : -1" @click="revert">{{ $t('place.revert') }}</button>
    </div>
    <!-- offset and rotation only concern a car placed by its GPS: the one placed by
         hand in the house already holds its place and heading from the JSON -->
    <label v-if="gpsPlaced" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.offset') }}</span>
      <span class="tune__fields">
        <span v-for="(axis, i) in (['x', 'y'] as const)" :key="axis" class="tune__axis">
          <span class="muted">{{ $t(`vehicle.offset${axis.toUpperCase()}`) }}</span>
          <input type="number" step="0.5" inputmode="decimal" :value="offsetOf(i as 0 | 1)"
                 @change="setOffset(i as 0 | 1, ($event.target as HTMLInputElement).value)" />
        </span>
      </span>
    </label>
    <label v-if="gpsPlaced" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.rotation') }}</span>
      <span class="tune__fields">
        <input type="number" step="15" inputmode="decimal" :value="rotation"
               @change="setRotation(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <label v-if="capacityNeeded" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.capacity') }}</span>
      <span class="tune__fields">
        <input type="number" step="1" min="0" inputmode="decimal" :value="capacity || ''"
               placeholder="—" @change="setCapacity(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <p v-if="capacityNeeded" class="muted tune__hint">{{ $t('vehicle.capacityHint') }}</p>
    <!-- body: the models of THIS vehicle (its plugin, failing that its brand), plus the silhouette -->
    <label v-if="models.length" class="tune__row">
      <span class="muted tune__k">{{ $t('vehicle.model3d') }}</span>
      <span class="tune__fields">
        <select :value="model3d" @change="setModel3d(($event.target as HTMLSelectElement).value)">
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
          <option :value="NO_MODEL">{{ $t('vehicle.model3dNone') }}</option>
        </select>
      </span>
    </label>
    <!-- EXPLICIT `for` on the two rows that carry a cross: a label without `for` activates its
         first labelable descendant, and the cross comes before the field — clicking the row to
         leave the color picker therefore cleared the choice just made. -->
    <label v-if="models.length" class="tune__row" :for="`tune-finish-${descriptor.id}`">
      <span class="muted tune__k">{{ $t('vehicle.bodyFinish') }}</span>
      <span class="tune__fields">
        <!-- same rule as the color: the cross only clears the MANUAL choice, and hands back to
             what the plugin deduced — not to an arbitrary default -->
        <button v-if="chosenFinish" type="button" class="tune__reset" :title="$t('vehicle.bodyFinishReset')"
                @click="setBodyFinish('')">×</button>
        <select :id="`tune-finish-${descriptor.id}`" :value="bodyFinish" @change="setBodyFinish(($event.target as HTMLSelectElement).value)">
          <option v-for="f in VEHICLE_FINISHES" :key="f" :value="f">{{ $t(`vehicle.finish.${f}`) }}</option>
        </select>
      </span>
    </label>
    <label v-if="models.length" class="tune__row" :for="`tune-color-${descriptor.id}`">
      <span class="muted tune__k">{{ $t('vehicle.bodyColor') }}</span>
      <span class="tune__fields">
        <!-- with no color chosen, the scene applies its own, which follows the theme: the button hands back -->
        <button v-if="bodyColor" type="button" class="tune__reset" :title="$t('vehicle.bodyColorReset')"
                @click="setBodyColor('')">×</button>
        <input :id="`tune-color-${descriptor.id}`" type="color" :value="painted"
               @input="preview(($event.target as HTMLInputElement).value)"
               @change="setBodyColor(($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <!-- lease: entered by hand, the manufacturer does not publish the financing contract -->
    <div class="tune__section">
      <span class="tune__title">{{ $t('vehicle.lease.title') }}</span>
      <button v-if="lease" type="button" class="tune__reset" :title="$t('vehicle.lease.clear')"
              :aria-label="$t('vehicle.lease.clear')" @click="clearLease">×</button>
    </div>
    <label v-for="f in (['start', 'end'] as const)" :key="f" class="tune__row">
      <span class="muted tune__k">{{ $t(`vehicle.lease.${f}`) }}</span>
      <span class="tune__fields">
        <input type="date" class="tune__date" :value="draft[f]" @change="setLeaseField(f, ($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <label v-for="f in (['km', 'startKm'] as const)" :key="f" class="tune__row">
      <span class="muted tune__k">{{ $t(`vehicle.lease.${f}`) }}</span>
      <span class="tune__fields">
        <input type="number" step="1000" min="0" inputmode="numeric" class="tune__km" :value="draft[f]" placeholder="—"
               @change="setLeaseField(f, ($event.target as HTMLInputElement).value)" />
      </span>
    </label>
    <p class="muted tune__hint">{{ $t('vehicle.lease.hint') }}</p>
    <template v-if="renaultVin">
      <button type="button" class="pill tune__check" :disabled="checking" :aria-busy="checking" @click="checkRenault">
        <v-progress-circular v-if="checking" indeterminate size="14" width="2" />
        {{ $t('vehicle.lease.check') }}
      </button>
      <p v-if="checkError" class="muted tune__hint">{{ $t('vehicle.lease.checkError', { message: checkError }) }}</p>
      <p v-else-if="contracts && !contracts.length" class="muted tune__hint">{{ $t('vehicle.lease.none') }}</p>
      <div v-for="(c, i) in contracts ?? []" :key="i" class="tune__found">
        <span class="tune__found-text">{{ $t('vehicle.lease.found', { name: c.description, km: km(c.maxKm), start: day(c.start), end: day(c.end) }) }}</span>
        <button type="button" class="pill tune__use" @click="useContract(c)">{{ $t('vehicle.lease.use') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tune { padding: 10px 12px; display: grid; gap: 10px; }
.tune__row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
.tune__k { flex: 1 1 auto; min-width: 0; }
.tune__fields { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
.tune__axis { display: flex; align-items: center; gap: 6px; }
.tune input {
  width: 72px; padding: 4px 8px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; font-variant-numeric: tabular-nums;
}
.tune__hint { margin: 0; font-size: 11px; }
.tune__top { display: flex; justify-content: flex-end; }
/* at the card's scale (28 px fields), and not the 40 px of a full-size pill */
.tune__revert { height: 28px; padding: 0 12px; font-size: 12px; }
.tune__revert--off { visibility: hidden; }
.tune select {
  padding: 4px 8px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px;
}
/* the lease: a subheading, then rows with the same layout as the other settings */
.tune__section { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--line); }
.tune__title { font-size: 12px; font-weight: 600; }
.tune input.tune__date { width: 140px; }
.tune input.tune__km { width: 96px; }
.tune__check { justify-self: start; height: 28px; padding: 0 12px; font-size: 12px; gap: 6px; }
.tune__found { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: var(--accent-soft); font-size: 12px; }
.tune__found-text { flex: 1 1 auto; min-width: 0; }
.tune__use { flex: none; height: 28px; padding: 0 12px; font-size: 12px; }
/* same layout as the number fields: the row does not change height from one section to another */
.tune input[type='color'] { width: 72px; height: 28px; padding: 2px; cursor: pointer; }
.tune__reset {
  width: 22px; height: 22px; padding: 0; line-height: 1;
  border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text);
  font: inherit; font-size: 13px; cursor: pointer;
}
</style>
