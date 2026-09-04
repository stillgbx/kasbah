<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { mdiParking, mdiPause, mdiPlay } from '@mdi/js'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatPercent } from '../../lib/format'

defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'mower'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { d } = useI18n()
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-2">
      <v-chip variant="tonal" :color="state.activity === 'mowing' ? 'success' : state.activity === 'error' ? 'error' : undefined">{{ $t(`mower.activities.${state.activity}`) }}</v-chip>
      <span v-if="state.nextStartAt" class="text-caption text-medium-emphasis">{{ $t('mower.nextStart', { time: d(new Date(state.nextStartAt), 'short') }) }}</span>
    </div>
    <div class="text-caption text-medium-emphasis">{{ $t('mower.battery') }} · {{ formatPercent(state.battery, $i18n.locale) }}</div>
    <v-progress-linear :model-value="state.battery" rounded height="8" :color="state.battery < 20 ? 'error' : 'success'" class="mb-4" />
    <div class="d-flex ga-2">
      <v-btn class="flex-grow-1" height="56" color="primary" variant="tonal" :prepend-icon="state.activity === 'mowing' ? mdiPause : mdiPlay" :disabled="disabled"
             @click="emit('command', state.activity === 'mowing' ? { type: 'mower.pause' } : { type: 'mower.start', durationMin: 60 })">
        {{ state.activity === 'mowing' ? $t('common.pause') : $t('mower.startFor') }}
      </v-btn>
      <v-btn class="flex-grow-1" height="56" variant="tonal" :prepend-icon="mdiParking" :disabled="disabled || state.activity === 'parked'"
             @click="emit('command', { type: 'mower.park', untilNextSchedule: true })">{{ $t('common.park') }}</v-btn>
    </div>
  </div>
</template>
