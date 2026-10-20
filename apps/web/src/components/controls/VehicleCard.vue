<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { HOME_RADIUS_M, geoDistance, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import { formatDistance, formatKm, formatPower } from '../../lib/format'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import StrokeIcon from '../ui/StrokeIcon.vue'
import ChargeLimitCard from '../vehicles/ChargeLimitCard.vue'
import VehicleBattery from '../vehicles/VehicleBattery.vue'
import VehicleClimate from '../vehicles/VehicleClimate.vue'
import VehicleSoftware from '../vehicles/VehicleSoftware.vue'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'vehicle'>; pending?: boolean; disabled?: boolean }>()
/** Charge requested, not yet observed: the same wait as the Vehicles view (held by the store). */
const devices = useDevicesStore()
const chargeRequested = computed(() => devices.isChargeRequested(props.descriptor.id))
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const house = useHouseStore()

const distance = computed(() => {
  const o = house.house?.origin
  return o && props.state.location ? geoDistance(o, props.state.location) : null
})
const atHome = computed(() => distance.value !== null && distance.value < HOME_RADIUS_M)
const has = (c: string) => props.descriptor.capabilities.includes(c as never)

/** The value we HOLD during the back-and-forth: without it, the slider would go back. */
const dragged = ref<number | null>(null)
const limit = computed(() => dragged.value ?? props.state.chargeLimit ?? 80)
function setLimit(percent: number): void {
  dragged.value = percent
  emit('command', { type: 'vehicle.set_charge_limit', percent })
}
// control handed back to the state as soon as the command has finished: accepted it carries the target, refused it has
// gone back to the old one
watch(() => [props.state.chargeLimit, props.pending], () => { dragged.value = null })
</script>

<template>
  <div>
    <!-- the range: the component shared with the Vehicles view's card; the target mark follows the slider -->
    <VehicleBattery class="mb-3" :state="state" :limit="limit" />
    <div class="d-flex flex-wrap ga-2 mb-3">
      <v-chip variant="tonal" size="small" :prepend-icon="state.pluggedIn ? 'plug' : 'plugOff'">{{ state.pluggedIn ? $t('vehicle.pluggedIn') : $t('vehicle.unplugged') }}</v-chip>
      <v-chip v-if="state.charging" variant="tonal" size="small" color="success">{{ $t('vehicle.charging') }} · {{ formatPower(state.chargePowerW ?? 0, $i18n.locale) }}</v-chip>
      <v-chip v-if="distance !== null" variant="tonal" size="small" :color="atHome ? 'primary' : undefined">
        {{ atHome ? $t('vehicle.atHome') : $t('vehicle.away', { distance: formatDistance(distance, $i18n.locale) }) }}
      </v-chip>
      <v-chip v-if="state.locked !== undefined" variant="tonal" size="small" :prepend-icon="state.locked ? 'lock' : 'lockOpen'">{{ state.locked ? $t('vehicle.locked') : $t('vehicle.unlocked') }}</v-chip>
    </div>
    <!-- the Vehicles view's tiles: two identical columns, ALWAYS there, greyed out with their reason
         when the vehicle cannot (user's rule) or the cable is unplugged -->
    <div class="tiles mb-3">
      <button type="button" class="pill" :disabled="disabled || !has('lock')" :title="has('lock') ? undefined : $t('vehicle.unsupported')"
              @click="emit('command', { type: state.locked ? 'vehicle.unlock' : 'vehicle.lock' })">
        <StrokeIcon :name="state.locked ? 'lockOpen' : 'lock'" :size="16" /><span class="tiles__label">{{ state.locked ? $t('common.unlock') : $t('common.lock') }}</span>
      </button>
      <!-- requested, the charge spins until the car SAYS it is active (see the store) -->
      <button type="button" class="pill" :data-on="state.charging ? '1' : '0'"
              :disabled="disabled || !has('charging') || !state.pluggedIn || pending || chargeRequested" :aria-busy="chargeRequested"
              :title="!has('charging') ? $t('vehicle.unsupported') : state.pluggedIn ? undefined : $t('vehicle.unplugged')"
              @click="emit('command', { type: state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
        <v-progress-circular v-if="chargeRequested" indeterminate size="16" width="2" />
        <StrokeIcon v-else :name="state.charging ? 'boltOff' : 'bolt'" :size="16" />
        <span class="tiles__label">{{ state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}</span>
      </button>
    </div>
    <!-- the charge target: the Vehicles view's block, taken as is -->
    <ChargeLimitCard v-if="has('charge_limit')" class="mb-3" :value="limit" :disabled="disabled"
                     @preview="dragged = $event" @change="setLimit" />
    <!-- the climate control: the common panel of the Vehicles view, which sends its own commands -->
    <VehicleClimate v-if="has('climate_precondition')" class="card card--soft mb-3" :descriptor="descriptor" :state="state" />
    <!-- the software: the Vehicles view's line and its dialog (notes, installation). Always there, greyed out
         for a vehicle that says nothing about it; wrapped because the component has several roots -->
    <div class="mb-3"><VehicleSoftware :descriptor="descriptor" :state="state" /></div>
    <div v-if="state.odometerKm" class="text-caption text-medium-emphasis">{{ $t('vehicle.odometer') }} · {{ formatKm(state.odometerKm, $i18n.locale) }}</div>
  </div>
</template>

<style scoped>
/* same tiles as the Vehicles view: icon above the label, "Stop charging" fits without being cut */
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.tiles .pill { min-width: 0; height: 56px; padding: 0 8px; border-radius: 12px; flex-direction: column; justify-content: center; gap: 3px; font-size: 13px; }
.tiles .pill[aria-busy='true']:disabled { opacity: .7; }
.tiles__label { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
