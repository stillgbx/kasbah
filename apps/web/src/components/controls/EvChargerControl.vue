<script setup lang="ts">
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatEnergy, formatPower } from '../../lib/format'
import EvChargerCommands from './EvChargerCommands.vue'

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
      <!-- même place que le courant max : en mode sécurisé, ce courant-là ne vaut plus -->
      <span v-if="state.safeLimit" class="text-warning d-inline-flex align-center ga-1" :title="$t('charger.safeLimitHint')">
        <v-icon icon="alert" size="16" />{{ $t('charger.safeLimit') }}
      </span>
      <span v-else-if="state.maxCurrentA">{{ $t('charger.maxCurrent') }} · {{ state.maxCurrentA }} A</span>
    </div>
    <EvChargerCommands :descriptor="descriptor" :state="state" :disabled="disabled" @command="(cmd) => emit('command', cmd)" />
  </div>
</template>
