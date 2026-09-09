<script setup lang="ts">
import { CLIMATE_MODES, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import { formatPercent, formatTemp } from '../../lib/format'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'climate'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const [tMin, tMax] = props.descriptor.meta.targetTempC ?? [10, 30]
// seuls les modes que l'appareil déclare : proposer « Refroidir » à un thermostat qui ne chauffe
// que promettrait une commande que le fabricant refuserait
const modes = props.descriptor.meta.climate?.modes ?? CLIMATE_MODES
const step = (d: number) => emit('command', { type: 'climate.set_target_temp', targetTempC: Math.min(tMax, Math.max(tMin, Math.round((props.state.targetTempC + d) * 2) / 2)) })
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-3">
      <div>
        <div class="text-caption text-medium-emphasis">{{ $t('climate.current') }}</div>
        <div class="text-h4 font-weight-medium">{{ formatTemp(state.currentTempC, $i18n.locale) }}</div>
        <div v-if="state.humidity !== undefined" class="text-caption text-medium-emphasis">{{ $t('climate.humidity') }} {{ formatPercent(state.humidity, $i18n.locale) }}</div>
      </div>
      <v-chip variant="tonal" :color="state.action === 'heating' ? 'error' : state.action === 'cooling' ? 'info' : undefined">
        {{ $t(`climate.actions.${state.action ?? 'idle'}`) }}
      </v-chip>
    </div>
    <div class="text-caption text-medium-emphasis">{{ $t('climate.target') }}</div>
    <div class="d-flex align-center justify-center ga-4 my-2">
      <v-btn icon="minus" variant="tonal" size="large" :disabled="disabled || state.mode === 'off'" @click="step(-0.5)" />
      <span class="text-h3 font-weight-medium target">{{ formatTemp(state.targetTempC, $i18n.locale) }}</span>
      <v-btn icon="plus" variant="tonal" size="large" :disabled="disabled || state.mode === 'off'" @click="step(0.5)" />
    </div>
    <div class="text-caption text-medium-emphasis mb-1">{{ $t('climate.mode') }}</div>
    <v-chip-group :model-value="state.mode" mandatory selected-class="text-primary" column
                  @update:model-value="(m: unknown) => m && emit('command', { type: 'climate.set_mode', mode: m as typeof state.mode })">
      <v-chip v-for="m in modes" :key="m" :value="m" size="large" variant="tonal" :disabled="disabled">{{ $t(`climate.modes.${m}`) }}</v-chip>
    </v-chip-group>
  </div>
</template>

<style scoped>
.target { min-width: 6ch; text-align: center; font-variant-numeric: tabular-nums; }
</style>
