<script setup lang="ts">
import { computed } from 'vue'
import { geoDistance, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import { formatDistance, formatKm, formatPercent, formatPower } from '../../lib/format'
import { useHouseStore } from '../../stores/house'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'vehicle'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const house = useHouseStore()
const HOME_RADIUS_M = 120

const distance = computed(() => {
  const o = house.house?.origin
  return o && props.state.location ? geoDistance(o, props.state.location) : null
})
const atHome = computed(() => distance.value !== null && distance.value < HOME_RADIUS_M)
const has = (c: string) => props.descriptor.capabilities.includes(c as never)
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-1">
      <div class="text-h4 font-weight-medium">{{ formatPercent(state.soc, $i18n.locale) }}</div>
      <div class="text-right">
        <div class="text-body-1">{{ formatKm(state.rangeKm, $i18n.locale) }}</div>
        <div class="text-caption text-medium-emphasis">{{ $t('vehicle.range') }}</div>
      </div>
    </div>
    <v-progress-linear :model-value="state.soc" rounded height="10" :color="state.charging ? 'success' : state.soc < 20 ? 'error' : 'primary'" class="mb-3" />
    <div class="d-flex flex-wrap ga-2 mb-3">
      <v-chip variant="tonal" size="small" :prepend-icon="state.pluggedIn ? 'plug' : 'plugOff'">{{ state.pluggedIn ? $t('vehicle.pluggedIn') : $t('vehicle.unplugged') }}</v-chip>
      <v-chip v-if="state.charging" variant="tonal" size="small" color="success">{{ $t('vehicle.charging') }} · {{ formatPower(state.chargePowerW ?? 0, $i18n.locale) }}</v-chip>
      <v-chip v-if="distance !== null" variant="tonal" size="small" :color="atHome ? 'primary' : undefined">
        {{ atHome ? $t('vehicle.atHome') : $t('vehicle.away', { distance: formatDistance(distance, $i18n.locale) }) }}
      </v-chip>
      <v-chip v-if="state.locked !== undefined" variant="tonal" size="small" :prepend-icon="state.locked ? 'lock' : 'lockOpen'">{{ state.locked ? $t('vehicle.locked') : $t('vehicle.unlocked') }}</v-chip>
    </div>
    <div class="d-flex ga-2 mb-3">
      <v-btn v-if="has('lock')" class="flex-grow-1" height="56" variant="tonal" :prepend-icon="state.locked ? 'lockOpen' : 'lock'" :disabled="disabled"
             @click="emit('command', { type: state.locked ? 'vehicle.unlock' : 'vehicle.lock' })">{{ state.locked ? $t('common.unlock') : $t('common.lock') }}</v-btn>
      <v-btn v-if="has('charging')" class="flex-grow-1" height="56" variant="tonal" color="success" :disabled="disabled || !state.pluggedIn"
             @click="emit('command', { type: state.charging ? 'vehicle.stop_charge' : 'vehicle.start_charge' })">
        {{ state.charging ? $t('vehicle.stopCharge') : $t('vehicle.startCharge') }}
      </v-btn>
    </div>
    <template v-if="has('charge_limit')">
      <div class="text-caption text-medium-emphasis">{{ $t('vehicle.chargeLimit') }} · {{ state.chargeLimit ?? 80 }} %</div>
      <v-slider :model-value="state.chargeLimit ?? 80" :min="50" :max="100" :step="5" :disabled="disabled" show-ticks
                @end="(v: number) => emit('command', { type: 'vehicle.set_charge_limit', percent: Math.round(v) })" />
    </template>
    <div v-if="state.odometerKm" class="text-caption text-medium-emphasis">{{ $t('vehicle.odometer') }} · {{ formatKm(state.odometerKm, $i18n.locale) }}</div>
  </div>
</template>
