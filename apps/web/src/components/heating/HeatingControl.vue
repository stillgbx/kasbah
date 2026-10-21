<script setup lang="ts">
import { computed } from 'vue'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { formatPercent } from '../../lib/format'

// The commands of a heating device, on its room's line (`control` slot of `RoomBands`).
//
// Two errors fixed here, both visible on screen:
//
//  1. OVERLAP. The previous version put the buttons in the STATUS column, in
//     `flex: 0 0 auto`: they never shrank and overflowed onto the link pill
//     and onto the state as soon as the card tightened. The commands now take their own
//     row (`grid-column: 1 / -1`), like a light's slider or a cover's keys:
//     nothing can step on anything else anymore, whatever the width.
//  2. VOCABULARY. Round buttons and a state pill: two shapes this application uses
//     nowhere else. The Covers and Media views have SQUARE keys with rounded corners of
//     36 px (`.key`), and their state is text following the status. It is taken as is.
//
// The setpoint is repeated BETWEEN the two keys: what you set must be under the fingers that
// set it, and the line above keeps saying "measured → setpoint" like all the other
// devices of the house.
//
// When OFF, no setpoint at all, neither here nor on the line above: none applies, and
// a thermostat that does not publish it when off (Nest) displayed the same temperature three times. The
// modes therefore come BEFORE the setpoint: choosing "Off" removes it at the end of the row, without
// moving the key just touched.

const props = defineProps<{ entry: DeviceEntry }>()
const emit = defineEmits<{ command: [deviceId: string, cmd: CommandInput] }>()

const state = computed(() => props.entry.state as StateFor<'climate'>)
const caps = computed(() => props.entry.descriptor.capabilities as readonly string[])
const canSetTemp = computed(() => caps.value.includes('target_temp'))
const canSetMode = computed(() => caps.value.includes('hvac_mode'))
const modes = computed(() => props.entry.descriptor.meta.climate?.modes ?? [])
const bounds = computed<[number, number]>(() => props.entry.descriptor.meta.targetTempC ?? [10, 30])
const off = computed(() => state.value.mode === 'off')
// In eco the device follows its own eco setpoint (a Nest refuses any other): read, not set.
const eco = computed(() => state.value.mode === 'eco')

function step(d: number) {
  const [lo, hi] = bounds.value
  const next = Math.min(hi, Math.max(lo, Math.round((state.value.targetTempC + d) * 2) / 2))
  emit('command', props.entry.descriptor.id, { type: 'climate.set_target_temp', targetTempC: next })
}
const setMode = (mode: string) => emit('command', props.entry.descriptor.id, { type: 'climate.set_mode', mode: mode as StateFor<'climate'>['mode'] })

const target = computed(() => `${state.value.targetTempC.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`)
/** Indoor humidity, when the device measures it (Nest): on the setpoint's row, at its right end. */
const humidity = computed(() => state.value.humidity)
const showTarget = computed(() => canSetTemp.value && !off.value)
</script>

<template>
  <!-- nothing to set nor to read: no empty row either (the heat pump zones are read) -->
  <div v-if="canSetTemp || canSetMode || humidity !== undefined" class="controls">
    <!-- the modes take the whole width, in keys of the same size -->
    <div v-if="canSetMode" class="keys keys--modes">
      <button v-for="m in modes" :key="m" type="button" class="key key--text" :data-on="state.mode === m ? '1' : '0'"
              :disabled="!entry.state.available" @click="setMode(m)">
        {{ $t(`climate.modes.${m}`) }}
      </button>
    </div>

    <!-- unreachable: greyed out, the gesture would be refused further down -->
    <div v-if="showTarget" class="keys keys--target">
      <!-- in eco the keys keep their place, invisible: the setpoint does not slide when switching -->
      <button type="button" class="key" :class="{ 'key--hidden': eco }" :aria-hidden="eco" :disabled="!entry.state.available || eco" :title="$t('heating.lower')" :aria-label="$t('heating.lower')" @click="step(-0.5)">
        <StrokeIcon name="minus" :size="18" />
      </button>
      <!-- the setpoint between its two keys: you set a number by looking at it -->
      <span class="target" :title="eco ? $t('climate.ecoTarget') : undefined">{{ target }}</span>
      <button type="button" class="key" :class="{ 'key--hidden': eco }" :aria-hidden="eco" :disabled="!entry.state.available || eco" :title="$t('heating.raise')" :aria-label="$t('heating.raise')" @click="step(0.5)">
        <StrokeIcon name="plus" :size="18" />
      </button>
    </div>
    <!-- pushed to the right end: it stays in place when the setpoint goes away (off) -->
    <span v-if="humidity !== undefined" class="humidity" :title="$t('climate.humidity')">
      <StrokeIcon name="droplet" :size="16" />{{ formatPercent(humidity, $i18n.locale) }}
    </span>
  </div>
</template>

<style scoped>
/* Taken from the Covers and Media views: a separate row, the full width of the line. This is what
   prevents any overlap — the commands no longer share a column with the status. */
.controls { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin: 2px 4px 0; }
.keys { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
/* The modes fill their row with keys of the SAME width (`flex: 1 1 0`); a word longer than its
   share ("Refroidissement") keeps its width (`min-width`) and the five modes of the simulated
   thermostat wrap instead of leaving the card. */
.keys--modes { gap: 6px; flex: 1 1 100%; flex-wrap: wrap; }
.keys--modes .key--text { flex: 1 1 0; min-width: max-content; }
/* the height of a key: when off takes the setpoint away, the row keeps its height and the
   humidity does not move up */
.humidity { margin-left: auto; min-height: 36px; display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.key {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
.key--hidden { visibility: hidden; }
/* a key that carries a word and not a sign: same height and same corner, free width */
.key--text { width: auto; padding: 0 14px; font: inherit; font-size: 13px; }
.key--text[data-on="1"] { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
/* fixed width: going from 9.5 to 10.0 must not spread the two keys apart */
.target { min-width: 6.5ch; text-align: center; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; margin: 0 2px; }
</style>
