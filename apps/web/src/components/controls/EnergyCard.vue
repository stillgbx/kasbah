<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatEnergy, formatPercent, formatPower } from '../../lib/format'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'energy'>; pending?: boolean; disabled?: boolean }>()
const selfConsumption = computed(() => {
  const p = props.state.todayProductionWh ?? 0, c = props.state.todayConsumptionWh ?? 0
  return p > 0 ? Math.min(100, Math.round((Math.min(p, c) / p) * 100)) : 0
})
</script>

<template>
  <div>
    <div class="energy-grid">
      <div class="tile">
        <v-icon icon="solar" color="warning" /><div class="text-caption">{{ $t('energy.production') }}</div>
        <div class="text-h6">{{ formatPower(state.productionW, $i18n.locale) }}</div>
      </div>
      <div class="tile">
        <v-icon icon="homeBolt" color="primary" /><div class="text-caption">{{ $t('energy.consumption') }}</div>
        <div class="text-h6">{{ formatPower(state.consumptionW, $i18n.locale) }}</div>
      </div>
      <div class="tile">
        <v-icon icon="grid" :color="state.gridW > 0 ? 'error' : 'success'" />
        <div class="text-caption">{{ $t('energy.grid') }} · {{ state.gridW > 0 ? $t('energy.import') : $t('energy.export') }}</div>
        <div class="text-h6">{{ formatPower(Math.abs(state.gridW), $i18n.locale) }}</div>
      </div>
      <div v-if="state.batterySoc !== undefined" class="tile">
        <v-icon icon="battery" :color="(state.batteryW ?? 0) >= 0 ? 'success' : 'info'" />
        <div class="text-caption">{{ $t('energy.battery') }} · {{ (state.batteryW ?? 0) >= 0 ? $t('energy.charging') : $t('energy.discharging') }}</div>
        <div class="text-h6">{{ formatPercent(state.batterySoc, $i18n.locale) }} <span class="text-body-2 text-medium-emphasis">{{ formatPower(Math.abs(state.batteryW ?? 0), $i18n.locale) }}</span></div>
        <v-progress-linear :model-value="state.batterySoc" rounded height="6" color="success" class="mt-1" />
      </div>
    </div>
    <div v-if="state.todayProductionWh !== undefined" class="d-flex justify-space-between text-caption text-medium-emphasis mt-3">
      <span>{{ $t('energy.today') }} · ☀ {{ formatEnergy(state.todayProductionWh, $i18n.locale) }} · ⌂ {{ formatEnergy(state.todayConsumptionWh ?? 0, $i18n.locale) }}</span>
      <span>{{ $t('energy.selfConsumption') }} {{ selfConsumption }} %</span>
    </div>
  </div>
</template>

<style scoped>
.energy-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.tile { padding: 10px 12px; border-radius: 16px; background: rgb(var(--v-theme-surface-variant) / 0.5); }
</style>
