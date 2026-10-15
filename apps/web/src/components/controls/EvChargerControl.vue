<script setup lang="ts">
import { SETTABLE_CHARGE_MODES, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
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
      <!-- même place que le courant max : en mode sécurisé, ce courant-là ne vaut plus -->
      <span v-if="state.safeLimit" class="text-warning d-inline-flex align-center ga-1" :title="$t('charger.safeLimitHint')">
        <v-icon icon="alert" size="16" />{{ $t('charger.safeLimit') }}
      </span>
      <span v-else-if="state.maxCurrentA">{{ $t('charger.maxCurrent') }} · {{ state.maxCurrentA }} A</span>
    </div>
    <!-- le mode de la borne, comme dans l'appli du fabricant : ni programmé ni intelligent, jamais essayés -->
    <div v-if="descriptor.capabilities.includes('charge_mode')" class="d-flex ga-2 mb-3">
      <v-btn v-for="m in SETTABLE_CHARGE_MODES" :key="m" class="flex-grow-1" height="48" variant="tonal"
             :color="state.chargeMode === m ? 'primary' : undefined" :disabled="disabled" :title="$t(`charger.modeHint.${m}`)"
             @click="emit('command', { type: 'ev_charger.set_mode', mode: m })">{{ $t(`charger.mode.${m}`) }}</v-btn>
    </div>
    <div v-if="descriptor.capabilities.includes('charge_control')" class="d-flex ga-2 mb-3">
      <v-btn class="flex-grow-1" height="56" variant="tonal" color="success" prepend-icon="bolt" :disabled="disabled || state.status === 'disconnected'"
             @click="emit('command', { type: 'ev_charger.start' })">{{ $t('common.start') }}</v-btn>
      <v-btn class="flex-grow-1" height="56" variant="tonal" prepend-icon="boltOff" :disabled="disabled || state.status !== 'charging'"
             @click="emit('command', { type: 'ev_charger.stop' })">{{ $t('common.stop') }}</v-btn>
    </div>
    <!-- l'aide et l'annulation dans la MÊME cellule, seule la visibilité change : la carte ne saute pas -->
    <div v-if="descriptor.capabilities.includes('charge_control') && (descriptor.meta.evCharger?.stopUntilUnplug || state.manualOverride !== undefined)"
         class="charger-note mb-3">
      <div v-if="descriptor.meta.evCharger?.stopUntilUnplug" class="text-caption text-medium-emphasis"
           :style="{ visibility: state.manualOverride ? 'hidden' : 'visible' }">{{ $t('charger.stopUntilUnplug') }}</div>
      <div v-if="state.manualOverride !== undefined" class="d-flex align-center ga-2" :title="$t('charger.manualOverrideHint')"
           :style="{ visibility: state.manualOverride ? 'visible' : 'hidden' }">
        <v-icon icon="alert" size="16" color="warning" />
        <span class="text-caption flex-grow-1">{{ $t('charger.manualOverride') }}</span>
        <v-btn size="small" variant="tonal" color="warning" :disabled="disabled || !state.manualOverride"
               @click="emit('command', { type: 'ev_charger.resume_mode' })">{{ $t('charger.resumeMode') }}</v-btn>
      </div>
    </div>
    <template v-if="descriptor.capabilities.includes('charge_current')">
      <div class="text-caption text-medium-emphasis">{{ $t('charger.maxCurrent') }}</div>
      <v-slider :model-value="state.maxCurrentA ?? 16" :min="6" :max="32" :step="1" :disabled="disabled" thumb-label
                @end="(v: number) => emit('command', { type: 'ev_charger.set_current', amps: Math.round(v) })" />
    </template>
  </div>
</template>

<style scoped>
.charger-note { display: grid; }
.charger-note > * { grid-area: 1 / 1; }
</style>
