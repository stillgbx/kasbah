<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatPercent } from '../../lib/format'
import { mowerTask } from '../../lib/mowerTask'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'mower'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { d, t } = useI18n()
// un robot à zones dit OÙ il tond (« Tonte · Devant », « En route vers Fond ») : ligne réservée
// d'après sa capacité, fixe — rien ne bouge quand la phrase change ou s'efface
const hasZones = computed(() => props.descriptor.capabilities.includes('work_areas'))
const task = computed(() => mowerTask(props.state, t))
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-2">
      <v-chip variant="tonal" :color="state.activity === 'mowing' ? 'success' : state.activity === 'error' ? 'error' : undefined">{{ $t(`mower.activities.${state.activity}`) }}</v-chip>
      <span v-if="state.nextStartAt" class="text-caption text-medium-emphasis">{{ $t('mower.nextStart', { time: d(new Date(state.nextStartAt), 'short') }) }}</span>
    </div>
    <div v-if="hasZones" class="text-caption text-medium-emphasis mower__task">{{ task }}</div>
    <div class="text-caption text-medium-emphasis">{{ $t('mower.battery') }} · {{ formatPercent(state.battery, $i18n.locale) }}</div>
    <v-progress-linear :model-value="state.battery" rounded height="8" :color="state.battery < 20 ? 'error' : 'success'" class="mb-4" />
    <div class="d-flex ga-2">
      <v-btn class="flex-grow-1" height="56" color="primary" variant="tonal" :prepend-icon="state.activity === 'mowing' ? 'pause' : 'play'" :disabled="disabled"
             @click="emit('command', state.activity === 'mowing' ? { type: 'mower.pause' } : { type: 'mower.start', durationMin: 60 })">
        {{ state.activity === 'mowing' ? $t('common.pause') : $t('mower.startFor') }}
      </v-btn>
      <v-btn class="flex-grow-1" height="56" variant="tonal" prepend-icon="parking" :disabled="disabled || state.activity === 'parked'"
             @click="emit('command', { type: 'mower.park', untilNextSchedule: true })">{{ $t('common.park') }}</v-btn>
    </div>
  </div>
</template>

<style scoped>
.mower__task { min-height: 20px; margin: -4px 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
