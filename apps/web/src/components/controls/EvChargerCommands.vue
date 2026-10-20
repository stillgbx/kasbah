<script setup lang="ts">
import { SETTABLE_CHARGE_MODES, type CommandInput, type DeviceDescriptor, type StateFor } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'

// A charger's commands, without its state, in two renderings:
//
//  - `panel` (default): the device panel (`EvChargerControl`), big buttons under its header;
//  - `row`: the charger's line in a room card (`RoomBands`, Energy view), in the
//    vocabulary of the other lines — 36 px square keys (`.key`), modes in words, on their own
//    row like heating (`HeatingControl`). The panel's big buttons crushed the card there.
//    Cancellation reads on the status line there (the view writes it) and on the current mode's key.
withDefaults(defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'ev_charger'>; disabled?: boolean; variant?: 'panel' | 'row' }>(), {
  variant: 'panel',
})
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
</script>

<template>
  <!-- in-line: modes on the left, start / stop at the end. No "Resume" key: under
       cancellation, it is the current mode's key that turns to alert, and touching it hands it back to the charger
       (`set_mode` of the same mode = resume). One more key, even reserved, sent start /
       stop onto a second row (measured: 331 px of line). -->
  <div v-if="variant === 'row'" class="ctl">
    <div class="keys">
      <button v-for="m in (descriptor.capabilities.includes('charge_mode') ? SETTABLE_CHARGE_MODES : [])" :key="m" type="button"
              class="key key--text" :data-on="state.chargeMode === m ? (state.manualOverride ? 'warn' : '1') : '0'" :disabled="disabled"
              :title="state.chargeMode === m && state.manualOverride ? $t('charger.overrideKeyHint') : $t(`charger.modeHint.${m}`)"
              @click="emit('command', { type: 'ev_charger.set_mode', mode: m })">
        {{ $t(`charger.mode.${m}`) }}
      </button>
    </div>
    <span class="ctl__gap" />
    <div v-if="descriptor.capabilities.includes('charge_control')" class="keys">
      <button type="button" class="key" :disabled="disabled || state.status === 'disconnected'"
              :title="$t('common.start')" :aria-label="$t('common.start')" @click="emit('command', { type: 'ev_charger.start' })">
        <StrokeIcon name="bolt" :size="18" />
      </button>
      <!-- the panel's "stopping blocks the charger…" help becomes the key's tooltip -->
      <button type="button" class="key" :disabled="disabled || state.status !== 'charging'"
              :title="descriptor.meta.evCharger?.stopUntilUnplug ? `${$t('common.stop')} — ${$t('charger.stopUntilUnplug')}` : $t('common.stop')"
              :aria-label="$t('common.stop')" @click="emit('command', { type: 'ev_charger.stop' })">
        <StrokeIcon name="boltOff" :size="18" />
      </button>
    </div>
    <v-slider v-if="descriptor.capabilities.includes('charge_current')" class="ctl__slider" :model-value="state.maxCurrentA ?? 16"
              :min="6" :max="32" :step="1" :disabled="disabled" density="compact" hide-details thumb-label
              :aria-label="$t('charger.maxCurrent')"
              @end="(v: number) => emit('command', { type: 'ev_charger.set_current', amps: Math.round(v) })" />
  </div>

  <div v-else>
    <!-- the charger's mode, as in the vendor's app: neither scheduled nor smart, never tried -->
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
    <!-- help and cancellation in the SAME cell, only the visibility changes: the card does not jump -->
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

/* `row` rendering: taken from `HeatingControl` (itself taken from the Covers and Media views) — a separate
   row, the full width of the line, which wraps rather than leaving the card. */
.ctl { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; margin: 2px 4px 0; }
.ctl__gap { flex: 1 1 auto; }
.ctl__slider { flex: 1 1 100%; }
.keys { display: flex; align-items: center; gap: 6px; flex: 0 1 auto; flex-wrap: wrap; }
.key {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
/* a key that carries a word and not a sign: same height and same corner, free width */
.key--text { width: auto; padding: 0 14px; font: inherit; font-size: 13px; }
.key--text[data-on="1"] { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
/* the current mode under cancellation: the theme's alert color, like the panel's warning */
.key--text[data-on="warn"] { color: rgb(var(--v-theme-warning)); border-color: rgb(var(--v-theme-warning)); }
</style>
