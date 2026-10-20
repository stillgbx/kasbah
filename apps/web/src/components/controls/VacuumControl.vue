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
    <!-- Mop, for a robot that washes: is the pad fitted, and is there water left. A
         single line, at a fixed place, rather than a section — it is information, not a setting. -->
    <div v-if="descriptor.capabilities.includes('mop')" class="d-flex ga-4 mb-4 text-caption text-medium-emphasis">
      <span>{{ $t('vacuum.mopPad') }} · {{ state.mopAttached === undefined ? '—' : state.mopAttached ? $t('vacuum.mopOn') : $t('vacuum.mopOff') }}</span>
      <span>{{ $t('vacuum.tank') }} · {{ state.tankLevel === undefined || state.tankLevel === null ? '—' : formatPercent(state.tankLevel, $i18n.locale) }}</span>
    </div>
    <div class="d-flex ga-2">
      <v-btn class="flex-grow-1 vac__wide" height="56" color="primary" variant="tonal" :prepend-icon="state.activity === 'cleaning' ? 'pause' : 'play'" :disabled="disabled"
             @click="emit('command', { type: state.activity === 'cleaning' ? 'vacuum.pause' : 'vacuum.start' })">
        {{ state.activity === 'cleaning' ? $t('common.pause') : $t('common.start') }}
      </v-btn>
      <v-btn class="flex-grow-1 vac__wide" height="56" variant="tonal" prepend-icon="home" :disabled="disabled || state.activity === 'docked'"
             @click="emit('command', { type: 'vacuum.dock' })">{{ $t('common.dock') }}</v-btn>
      <v-btn v-if="descriptor.capabilities.includes('locate')" height="56" variant="tonal" icon="crosshair" :disabled="disabled"
             :aria-label="$t('common.locate')" @click="emit('command', { type: 'vacuum.locate' })" />
    </div>
  </div>
</template>

<style scoped>
/*
 * Vuetify puts `flex-shrink: 0` on every `v-btn`: its buttons know how to grow, never shrink.
 * With three buttons — and the vacuum is the only control that has three, the mower only has
 * two — the row demands 342 px where the device panel offers 294, and "Locate" goes
 * out of the frame, unreachable. Measured on a real Roomba on 19/09/2026, at 1024 as at 1280 wide:
 * the panel is of fixed width, enlarging the window changes nothing.
 *
 * We therefore give back their elasticity to the two text buttons. The height does not move (56 px):
 * the labels squeeze together, the row keeps its template.
 */
.vac__wide { flex-shrink: 1; min-width: 0; }
</style>
