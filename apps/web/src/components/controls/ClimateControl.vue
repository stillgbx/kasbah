<script setup lang="ts">
import { computed } from 'vue'
import { CLIMATE_MODES, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import { formatPercent, formatTemp } from '../../lib/format'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'climate'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
// Everything that depends on the DEVICE is computed, not read once: the panel keeps this component
// from one zone to another, and Ecodan's zone 2 (water flow, read only) would otherwise have inherited
// the buttons, modes and range of the thermostat displayed before it.
const range = computed<[number, number]>(() => props.descriptor.meta.targetTempC ?? [10, 30])
// only the modes the device declares: offering "Cool" to a thermostat that only heats
// would promise a command the vendor would refuse
const modes = computed(() => props.descriptor.meta.climate?.modes ?? CLIMATE_MODES)
const has = (c: string) => props.descriptor.capabilities.includes(c as never)
// This control was the only one not to consult the capabilities: the simulation declared them all,
// and no real `climate` device existed. A heat pump read in READ-ONLY mode (MELCloud)
// publishes its state without accepting commands — showing the buttons would make the UI promise what
// the plugin would refuse. The VALUE is shown in every case: it is the gesture that is missing.
// In eco the device follows its own eco setpoint, set on the device: a Nest refuses any other.
// The value stays, read only, and the buttons keep their place invisible so that it does not slide.
const eco = computed(() => props.state.mode === 'eco')
const canSetTemp = computed(() => has('target_temp'))
const canSetMode = computed(() => has('hvac_mode'))
/**
 * An air-to-water heat pump zone can be set on the FLOW water rather than on the room's air
 * (`meta.climate.control`). The two figures are in the same places, but a 45 °C flow
 * is not 45 °C in a living room: only the vocabulary tells them apart.
 */
const flow = computed(() => props.descriptor.meta.climate?.control === 'flow')
const step = (d: number) => emit('command', { type: 'climate.set_target_temp', targetTempC: Math.min(range.value[1], Math.max(range.value[0], Math.round((props.state.targetTempC + d) * 2) / 2)) })
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-3">
      <div>
        <div class="text-caption text-medium-emphasis">{{ flow ? $t('climate.flowCurrent') : $t('climate.current') }}</div>
        <div class="text-h4 font-weight-medium">{{ formatTemp(state.currentTempC, $i18n.locale) }}</div>
        <div v-if="state.humidity !== undefined" class="text-caption text-medium-emphasis">{{ $t('climate.humidity') }} {{ formatPercent(state.humidity, $i18n.locale) }}</div>
      </div>
      <!-- a heat pump zone whose machine heats without saying which zone (MELCloud): the
           machine's activity, not a guess about the zone -->
      <v-chip v-if="!state.action && state.unitHeating" variant="tonal" color="warning">{{ $t('climate.unitHeating') }}</v-chip>
      <v-chip v-else variant="tonal" :color="state.action === 'heating' ? 'error' : state.action === 'cooling' ? 'info' : undefined">
        {{ $t(`climate.actions.${state.action ?? 'idle'}`) }}
      </v-chip>
    </div>
    <div class="text-caption text-medium-emphasis mb-1">{{ $t('climate.mode') }}</div>
    <v-chip-group v-if="canSetMode" :model-value="state.mode" mandatory selected-class="text-primary" column
                  @update:model-value="(m: unknown) => m && emit('command', { type: 'climate.set_mode', mode: m as typeof state.mode })">
      <v-chip v-for="m in modes" :key="m" :value="m" size="large" variant="tonal" :disabled="disabled">{{ $t(`climate.modes.${m}`) }}</v-chip>
    </v-chip-group>
    <!-- read only: the mode is read, not chosen -->
    <v-chip v-else size="large" variant="tonal" class="mode-readonly">{{ $t(`climate.modes.${state.mode}`) }}</v-chip>
    <!-- When off, no setpoint applies: we do not show it (a switched-off Nest does not even publish it).
         The mode therefore comes BEFORE it: choosing "Off" removes it at the bottom of the panel,
         without making the chip we just touched move up. -->
    <template v-if="state.mode !== 'off'">
      <div class="text-caption text-medium-emphasis mt-3">{{ flow ? $t('climate.flowTarget') : eco ? $t('climate.ecoTarget') : $t('climate.target') }}</div>
      <!-- centered between its two buttons when there are some; otherwise aligned on its label, to the left,
           rather than floating alone in the middle of the card -->
      <div class="d-flex align-center ga-4 my-2" :class="canSetTemp ? 'justify-center' : 'justify-start'">
        <v-btn v-if="canSetTemp" icon="minus" variant="tonal" size="large" :class="{ 'btn-hidden': eco }" :aria-hidden="eco" :disabled="disabled || eco" @click="step(-0.5)" />
        <span class="text-h3 font-weight-medium target">{{ formatTemp(state.targetTempC, $i18n.locale) }}</span>
        <v-btn v-if="canSetTemp" icon="plus" variant="tonal" size="large" :class="{ 'btn-hidden': eco }" :aria-hidden="eco" :disabled="disabled || eco" @click="step(0.5)" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.target { min-width: 6ch; font-variant-numeric: tabular-nums; }
.justify-center .target { text-align: center; }
.mode-readonly { margin-top: 2px; }
.btn-hidden { visibility: hidden; }
</style>
