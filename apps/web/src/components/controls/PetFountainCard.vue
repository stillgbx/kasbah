<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { PET_PUMP_MODES } from '@kasbah/shared'
import { formatAgo, formatMilliliters, formatPercent } from '../../lib/format'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Card of a water fountain. A particularity that explains everything else: an Eversweet has no
// Wi-Fi. It is read and driven THROUGH A BLUETOOTH RELAY via a neighboring device (the
// feeder), so its values date from the last successful relay — sometimes several hours old if the
// relay was out of range. Hence the "reading …" line at the foot of the card: showing the age is worth
// more than letting people believe it is live (same trade-off as `readAt` on a sleeping vehicle).
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'pet_fountain'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t, locale } = useI18n()

const emitted = ref<string | null>(null)
/**
 * Which button is waiting for its answer. `pending` is per DEVICE: without this local marker, the three
 * buttons would spin together and we would not know which one was pushed.
 */
function run(key: string, cmd: CommandInput): void {
  emitted.value = key
  emit('command', cmd)
}
watch(() => props.pending, (p) => { if (!p) emitted.value = null })
const waiting = (key: string) => props.pending === true && emitted.value === key

/**
 * The most urgent fact, in a line whose space is RESERVED: a fault takes precedence over an empty
 * tank, which takes precedence over "all is well". The vendor's message REPLACES the line instead of
 * adding one — the card does not grow and nothing moves around.
 */
const alert = computed(() => {
  const st = props.state
  if (st.errorMessage) return { level: 'defect', icon: 'alert' as const, text: st.errorMessage }
  if (st.waterLow === undefined) return { level: 'unknown', icon: 'minusCircle' as const, text: t('common.unknown') }
  return st.waterLow
    ? { level: 'warning', icon: 'alert' as const, text: t('pets.waterLow') }
    : { level: 'ok', icon: 'checkCircle' as const, text: t('pets.waterOk') }
})

const has = (c: string) => props.descriptor.capabilities.includes(c as never)
/** Below this threshold, the filter gets noticed — same marker as the water station's consumables. */
const LOW_PCT = 20

// Local clock: the reading's age must age on its own, otherwise "2 min ago" stays displayed
// for an hour. 30 s, the same cadence as the Robots view.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 30_000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const syncedAgo = computed(() => (props.state.syncedAt !== undefined
  ? t('pets.syncedAgo', { ago: formatAgo(props.state.syncedAt, now.value, locale.value) })
  : t('pets.syncedUnknown')))
</script>

<template>
  <div class="fountain">
    <div class="line" :data-alert="alert.level">
      <StrokeIcon :name="alert.icon" :size="16" />
      <!-- Same treatment as the feeder: a vendor message scrolls with a fade rather
           than being cut, and cannot widen the card. -->
      <MarqueeText class="line__text" :text="alert.text" />
    </div>

    <!-- PASSES, not a volume: an Eversweet Max measures no milliliter, it counts
         the animal's visits and their duration. The volume stays displayed for the models that
         measure it, and these two lines never coexist on the same machine. -->
    <div v-if="has('water_usage')" class="line">
      <StrokeIcon name="paw" :size="16" />
      <span class="line__text">{{ $t('pets.drinksToday') }}</span>
      <span class="line__num">{{ state.drinksToday !== undefined ? state.drinksToday : '—' }}</span>
      <span class="line__side" />
      <span class="line__tail">{{ state.drinkAvgS !== undefined ? $t('pets.avgStay', { s: Math.round(state.drinkAvgS) }) : '' }}</span>
    </div>
    <div v-if="state.todayMl !== undefined" class="line">
      <StrokeIcon name="droplet" :size="16" />
      <span class="line__text">{{ $t('pets.drunkVolume') }}</span>
      <span class="line__num">{{ formatMilliliters(state.todayMl, $i18n.locale) }}</span>
      <span class="line__side" />
      <span class="line__tail" />
    </div>
    <div v-if="has('consumables')" class="line">
      <StrokeIcon name="filtration" :size="16" />
      <span class="line__text">{{ $t('pets.filter') }}</span>
      <!-- The VALUE in the first column and its complement in the second, as on all the
           other lines of the two cards: it is this constant order that lets a card be read
           at a glance, the units falling one under the other. -->
      <span class="line__num" :class="{ 'text-error': state.filterPct !== undefined && state.filterPct < LOW_PCT }">
        {{ state.filterPct !== undefined ? formatPercent(state.filterPct, $i18n.locale) : '—' }}
      </span>
      <span class="line__side">{{ state.filterDays !== undefined ? $t('pets.days', { n: state.filterDays }, state.filterDays) : '' }}</span>
      <span class="line__tail" />
    </div>
    <div v-if="has('battery')" class="line">
      <StrokeIcon name="battery" :size="16" />
      <span class="line__text">{{ $t('pets.battery') }}</span>
      <span class="line__num" :class="{ 'text-error': state.batteryPct !== undefined && state.batteryPct < LOW_PCT }">
        {{ state.batteryPct !== undefined ? formatPercent(state.batteryPct, $i18n.locale) : '—' }}
      </span>
      <span class="line__side" />
      <span class="line__tail" />
    </div>
    <div class="sep" />

    <div class="fountain__row">
      <!-- A VERB, not a state: "Off" read as the pump's status, next to the two
           modes. And no "primary" tint here — it is reserved for the SELECTED mode, otherwise
           two colored buttons side by side no longer say which is a choice and which is a gesture. -->
      <!-- Vuetify's `loading` rather than a spinner added beside the text: it covers the
           button without changing its size, so the row does not move during the wait. -->
      <v-btn v-if="has('on_off')" class="fountain__btn" height="48" variant="tonal"
             :disabled="disabled || pending" :loading="waiting('power')"
             @click="run('power', { type: 'pet_fountain.set_power', on: !state.on })">
        {{ state.on ? $t('pets.stopPump') : $t('pets.startPump') }}
      </v-btn>
      <!-- The pump's two modes, side by side: two buttons beat a menu for two
           choices, and the active one is visible without opening it. Greyed out with the pump off — setting the mode of a
           pump that is off makes no sense, and the vendor would refuse. -->
      <v-btn v-for="m in (has('pump_mode') ? PET_PUMP_MODES : [])" :key="m" class="fountain__btn" height="48" variant="tonal"
             :color="state.mode === m ? 'primary' : undefined" :disabled="disabled || pending || !state.on"
             :loading="waiting(`mode-${m}`)" @click="run(`mode-${m}`, { type: 'pet_fountain.set_mode', mode: m })">
        {{ $t(`pets.mode.${m}`) }}
      </v-btn>
    </div>

    <div class="muted fountain__synced">{{ syncedAgo }}</div>
  </div>
</template>

<style scoped>
/* `minmax(0, 1fr)`: an `auto` column would size itself on the max-content, and a single-line
   error message would make the card overflow (measured on the feeder). */
.fountain { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 0; }
.sep { height: 1px; margin: 8px 0; background: var(--line); }
.line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); height: 28px; min-width: 0; }
.line__text { flex: 1 1 auto; min-width: 0; color: var(--muted); }
/*
 * Same columns as the feeder card, and in PIXELS for the same reason: a `ch` follows the font size,
 * and a column that changes width from one line to the next breaks the vertical alignment
 * of the units — the card is no longer readable at a glance.
 */
/*
 * EXACTLY the same three columns as the feeder card, at the same widths in pixels: the
 * value, its complement, then a reserve. Two cards side by side in the Pets view — if their
 * columns did not land in the same place, the eye would no longer know where to look.
 */
.line__num, .line__side, .line__tail { flex: 0 0 auto; text-align: right; font-variant-numeric: tabular-nums; }
.line__num { min-width: 72px; font-weight: 500; }
/* `overflow: hidden` on the complement columns: `min-width` is a FLOOR, not a
   ceiling — "0 s on average" exceeded its 62 px and pushed the neighboring value by 25 px, one
   line in three only (measured). Bounded, they can no longer move anyone. */
.line__side { min-width: 62px; max-width: 62px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; color: var(--muted); }
.line__tail { min-width: 88px; max-width: 88px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; color: var(--muted); }
.line[data-alert='warning'] { color: rgb(var(--v-theme-warning)); }
.line[data-alert='defect'] { color: rgb(var(--v-theme-error)); }
.line[data-alert='warning'] .line__text, .line[data-alert='defect'] .line__text, .line[data-alert='ok'] .line__text { color: inherit; }
/* Same lesson as VacuumControl: Vuetify puts `flex-shrink: 0` on every `v-btn`, and the 3D scene's
   device panel is only 294 px — three buttons must be able to squeeze together. */
.fountain__row { display: flex; gap: 8px; }
.fountain__btn { flex: 1 1 0; min-width: 0; flex-shrink: 1; padding: 0 4px; }
/* Reserved height: the line exists even when the date is unknown, it does not make the card jump. */
.fountain__synced { font-size: 11px; margin-top: 8px; min-height: 1.2em; text-align: right; }
</style>

<!--
  Same contrast fix as WaterCard and PetFeederCard: the raw `warning` token falls below
  the AA threshold in the light theme for 13 px text.
-->
<style>
html[data-theme='light'] .fountain .line[data-alert='warning'] { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, black); }
</style>
