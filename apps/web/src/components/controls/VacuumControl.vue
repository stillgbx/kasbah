<script setup lang="ts">
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatPercent } from '../../lib/format'

defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'vacuum'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-2">
      <v-chip variant="tonal" :color="state.activity === 'cleaning' ? 'primary' : state.activity === 'error' ? 'error' : undefined">{{ $t(`vacuum.activities.${state.activity}`) }}</v-chip>
      <v-chip v-if="state.binFull" variant="tonal" color="warning" size="small">{{ $t('vacuum.binFull') }}</v-chip>
    </div>
    <div class="text-caption text-medium-emphasis">{{ $t('vacuum.battery') }} · {{ formatPercent(state.battery, $i18n.locale) }}</div>
    <v-progress-linear :model-value="state.battery" rounded height="8" :color="state.battery < 20 ? 'error' : 'success'" class="mb-4" />
    <div class="d-flex ga-2">
      <v-btn class="flex-grow-1" height="56" color="primary" variant="tonal" :prepend-icon="state.activity === 'cleaning' ? 'pause' : 'play'" :disabled="disabled"
             @click="emit('command', { type: state.activity === 'cleaning' ? 'vacuum.pause' : 'vacuum.start' })">
        {{ state.activity === 'cleaning' ? $t('common.pause') : $t('common.start') }}
      </v-btn>
      <v-btn class="flex-grow-1" height="56" variant="tonal" prepend-icon="home" :disabled="disabled || state.activity === 'docked'"
             @click="emit('command', { type: 'vacuum.dock' })">{{ $t('common.dock') }}</v-btn>
      <v-btn v-if="descriptor.capabilities.includes('locate')" height="56" variant="tonal" icon="crosshair" :disabled="disabled"
             :aria-label="$t('common.locate')" @click="emit('command', { type: 'vacuum.locate' })" />
    </div>
  </div>
</template>
