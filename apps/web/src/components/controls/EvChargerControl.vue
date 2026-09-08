<script setup lang="ts">
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatEnergy, formatPower } from '../../lib/format'

defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'ev_charger'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-3">
      <v-chip variant="tonal" :color="state.status === 'charging' ? 'success' : state.status === 'error' ? 'error' : undefined">{{ $t(`charger.status.${state.status}`) }}</v-chip>
      <div class="text-h5 font-weight-medium">{{ formatPower(state.powerW, $i18n.locale) }}</div>
    </div>
    <div class="d-flex justify-space-between text-body-2 text-medium-emphasis mb-3">
      <span>{{ $t('charger.session') }} · {{ formatEnergy(state.sessionWh, $i18n.locale) }}</span>
      <span v-if="state.maxCurrentA">{{ $t('charger.maxCurrent') }} · {{ state.maxCurrentA }} A</span>
    </div>
    <div class="d-flex ga-2 mb-3">
      <v-btn class="flex-grow-1" height="56" variant="tonal" color="success" prepend-icon="bolt" :disabled="disabled || state.status === 'disconnected'"
             @click="emit('command', { type: 'ev_charger.start' })">{{ $t('common.start') }}</v-btn>
      <v-btn class="flex-grow-1" height="56" variant="tonal" prepend-icon="boltOff" :disabled="disabled || state.status !== 'charging'"
             @click="emit('command', { type: 'ev_charger.stop' })">{{ $t('common.stop') }}</v-btn>
    </div>
    <template v-if="descriptor.capabilities.includes('charge_current')">
      <div class="text-caption text-medium-emphasis">{{ $t('charger.maxCurrent') }}</div>
      <v-slider :model-value="state.maxCurrentA ?? 16" :min="6" :max="32" :step="1" :disabled="disabled" thumb-label
                @end="(v: number) => emit('command', { type: 'ev_charger.set_current', amps: Math.round(v) })" />
    </template>
  </div>
</template>
