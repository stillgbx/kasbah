<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../../stores/settings'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatFeedAmount, formatFeedGrams, formatPercent } from '../../lib/format'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Card of a connected feeder. Only two gestures — serve a portion, call the animal —
// and the rest is read. The meal PLAN is not here: it is edited in the vendor's app, and
// a portion served from Kasbah is added to the plan without touching it.
//
// The portions offered come from the DEVICE (`meta.petFeeder`) and never from a constant — not
// even their UNIT: a Fresh Element Solo counts in tenths of a CUP (it declares
// `settings.factor: 10`), an Infinity in grams. A slider would lie on the first one, and
// writing "g" everywhere would be off by a factor of ten.
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'pet_feeder'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t } = useI18n()
const settings = useSettingsStore()

const emitted = ref<string | null>(null)
/**
 * Which button is waiting for its answer. `pending` is per DEVICE: without this local marker, the five
 * portions would spin together and we would no longer know which one we asked for.
 */
function run(key: string, cmd: CommandInput): void {
  emitted.value = key
  emit('command', cmd)
}
watch(() => props.pending, (p) => { if (!p) emitted.value = null })
const waiting = (key: string) => props.pending === true && emitted.value === key

const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const feeder = computed(() => props.descriptor.meta.petFeeder)
const portions = computed(() => feeder.value?.portions ?? [])
const canFeed = computed(() => has('feed') && portions.value.length > 0)

/** Below this threshold, the desiccant pouch gets noticed — it is replaced, not recharged. */
const DESICCANT_LOW_DAYS = 7
/** A quantity in THIS machine's unit; without a declared unit, we do not display a bare number. */
const amountText = (v?: number, locale = 'fr') =>
  (v !== undefined && feeder.value ? formatFeedAmount(v, feeder.value.unit, locale) : '—')
/**
 * The same quantity in grams, ESTIMATED from the weight of a cup set by the user — the
 * machine itself weighs nothing. Rendered `''` and not `'—'` when there is nothing to convert: it is a
 * complement, its absence is not signaled.
 */
const gramsText = (v?: number, locale = 'fr') =>
  (v !== undefined && feeder.value ? formatFeedGrams(v, feeder.value.unit, settings.cupGrams, locale) ?? '' : '')
/**
 * The most urgent fact, in a line whose space is RESERVED: a fault takes precedence over an empty
 * hopper, which takes precedence over "all is well".
 */
const alert = computed(() => {
  const s = props.state
  if (s.errorMessage) return { level: 'defect', icon: 'alert' as const, text: s.errorMessage }
  if (s.foodLow === undefined) return { level: 'unknown', icon: 'minusCircle' as const, text: t('common.unknown') }
  return s.foodLow
    ? { level: 'warning', icon: 'alert' as const, text: t('pets.foodLow') }
    : { level: 'ok', icon: 'checkCircle' as const, text: t('pets.foodOk') }
})

/** Time only: the next meal is always within the day. */
const mealTime = (at: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
</script>

<template>
  <div class="feeder">
    <!-- ONE single alert line, always present, which says the most urgent fact: the vendor's
         error message if there is one, otherwise the hopper state. The message therefore does not ADD
         a line — it replaces one —, the card does not grow, and nothing moves around.
         It is truncated to the available width (`.line__text`) with the full text in `title`,
         because a vendor label has no known length. -->
    <div class="line" :data-alert="alert.level">
      <StrokeIcon :name="alert.icon" :size="16" />
      <!-- The vendor's message has no known length: it SCROLLS with a fade at the edges
           (`MarqueeText`, the media cards' component) rather than being cut with an
           ellipsis. It is read in full, the line keeps its height, and nothing widens. -->
      <MarqueeText class="line__text" :text="alert.text" />
    </div>

    <!-- The next meal AT THE TOP: it is the only piece of information that speaks of the future, and the one
         the vendor's app highlights. Its place is reserved even when the day is
         over — the word changes, the line stays. -->
    <div class="line line--meal">
      <StrokeIcon name="clock" :size="16" />
      <span class="line__text">{{ $t('pets.nextMealLabel') }}</span>
      <span class="line__num">{{ state.nextMealAmount !== undefined ? amountText(state.nextMealAmount, $i18n.locale) : '—' }}</span>
      <span class="line__side">{{ gramsText(state.nextMealAmount, $i18n.locale) }}</span>
      <span class="line__tail">{{ state.nextMealAt !== undefined ? mealTime(state.nextMealAt, $i18n.locale) : '—' }}</span>
    </div>
    <div class="line">
      <StrokeIcon name="feeder" :size="16" />
      <span class="line__text">{{ $t('pets.servedTodayLabel') }}</span>
      <span class="line__num">{{ amountText(state.servedToday, $i18n.locale) }}</span>
      <span class="line__side">{{ gramsText(state.servedToday, $i18n.locale) }}</span>
      <span class="line__tail">{{ state.plannedToday !== undefined ? $t('pets.ofPlanned', { amount: amountText(state.plannedToday, $i18n.locale) }) : '' }}</span>
    </div>
    <!-- The EATEN only exists on models with a weighing tray. The line therefore does not appear at
         all on a Fresh Element Solo, rather than showing a dash that will never change:
         it is a property of the hardware, not a pending value — and it therefore does not move
         from one refresh to the next. -->
    <div v-if="state.eatenToday !== undefined" class="line">
      <StrokeIcon name="paw" :size="16" />
      <span class="line__text">{{ $t('pets.eatenToday') }}</span>
      <span class="line__num">{{ amountText(state.eatenToday, $i18n.locale) }}</span>
      <span class="line__side">{{ gramsText(state.eatenToday, $i18n.locale) }}</span>
      <span class="line__tail" />
    </div>
    <div v-if="has('consumables')" class="line">
      <StrokeIcon name="filtration" :size="16" />
      <span class="line__text">{{ $t('pets.desiccant') }}</span>
      <span class="line__num" :class="{ 'text-error': state.desiccantDays !== undefined && state.desiccantDays < DESICCANT_LOW_DAYS }">
        {{ state.desiccantDays !== undefined ? $t('pets.days', { n: state.desiccantDays }, state.desiccantDays) : '—' }}
      </span>
      <span class="line__side" />
      <span class="line__tail" />
    </div>
    <div v-if="has('battery')" class="line">
      <StrokeIcon name="battery" :size="16" />
      <span class="line__text">{{ $t('pets.backupBattery') }}</span>
      <span class="line__num">{{ state.batteryPct !== undefined ? formatPercent(state.batteryPct, $i18n.locale) : '—' }}</span>
      <span class="line__side" />
      <span class="line__tail" />
    </div>
    <template v-if="canFeed || has('call_pet')">
      <div class="sep" />
      <div v-if="canFeed" class="muted feeder__label">{{ $t('pets.feedNow') }}</div>
      <div class="feeder__row">
        <!-- One portion = one button. The vendor only accepts these values; offering
             them all avoids the double gesture "choose then confirm" on a wall tablet. -->
        <!-- Vuetify's `loading`, and not a spinner added beside the text: it covers the
             button without changing its size. A spinner inserted would widen the row at each
             gesture. -->
        <v-btn v-for="g in portions" :key="g" class="feeder__btn" height="48" variant="tonal" color="primary"
               :disabled="disabled || pending" :loading="waiting(`feed-${g}`)"
               @click="run(`feed-${g}`, { type: 'pet_feeder.feed', amount: g })">
          <span class="feeder__stack">
            <span>{{ amountText(g, $i18n.locale) }}</span>
            <!-- The button's height stays 48 px: the second line lives IN it, it does not
                 enlarge it — and its place is held even with no grams to display. -->
            <span class="feeder__grams">{{ gramsText(g, $i18n.locale) }}</span>
          </span>
        </v-btn>
        <v-btn v-if="has('call_pet')" height="48" variant="tonal" icon="speaker" :disabled="disabled || pending"
               :loading="waiting('call')" :aria-label="$t('pets.callPet')" :title="$t('pets.callPet')"
               @click="run('call', { type: 'pet_feeder.call_pet' })" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* `minmax(0, 1fr)` and not `auto`: an `auto` column sizes itself on the max-content of its
   content, so an error message in `nowrap` MADE THE CARD OVERFLOW horizontally
   (`scrollWidth > clientWidth`, measured). The column can no longer exceed its container, and it is
   the text that adapts — by scrolling. */
.feeder { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 0; }
.sep { height: 1px; margin: 8px 0; background: var(--line); }
.line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); height: 28px; min-width: 0; }
.line__text { flex: 1 1 auto; min-width: 0; color: var(--muted); }
/*
 * THREE right-hand columns, of fixed width and in the SAME order on all lines:
 * the quantity, its gram counterpart, then the complement. Each exists even when empty.
 *
 * This is what was missing: with the next meal's time in the first column, "13:00" sat
 * above "0.7 cup" and the units no longer aligned from one line to the next — the card was no
 * longer readable at a glance. The time moved to the LAST column, where it no longer disturbs
 * the alignment of the cups and grams.
 */
/*
 * Widths in PIXELS and not in `ch`: the `ch` depends on the font size, and the next
 * meal's time is at 13 px where the complements are at 12 px. The column was then 6 px
 * wider on that line, and everything else slid with it — measured. In pixels, the
 * three columns land in the same place on ALL lines, whatever their weight.
 * Values chosen on the worst case: "0.5 cup" (72), "~ 100 g" (62), "of 0.9 cup" (88).
 */
.line__num { flex: 0 0 auto; min-width: 72px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
/* `overflow: hidden` on the complement columns: `min-width` is a FLOOR, not a
   ceiling — "0 s on average" exceeded its 62 px and pushed the neighboring value by 25 px, one
   line in three only (measured). Bounded, they can no longer move anyone. */
.line__side { flex: 0 0 auto; min-width: 62px; max-width: 62px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
/* Last column: the next meal's time (in bold, it is the reference the eye looks for)
   or the planned total. Width reserved even when empty, so that the left columns do not move. */
.line__tail { flex: 0 0 auto; min-width: 88px; max-width: 88px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.line[data-alert='warning'] { color: rgb(var(--v-theme-warning)); }
.line[data-alert='defect'] { color: rgb(var(--v-theme-error)); }
.line[data-alert='warning'] .line__text, .line[data-alert='defect'] .line__text, .line[data-alert='ok'] .line__text { color: inherit; }
/* The next meal's time: the only figure on the card that the eye comes looking for. */
.line--meal .line__tail { font-weight: 600; font-size: 13px; color: var(--text); }
.feeder__label { font-size: 12px; margin-bottom: 6px; }
/* The portions squeeze together, they do not overflow: the 3D scene's device panel is only
   294 px wide, and Vuetify puts `flex-shrink: 0` on every `v-btn` (lesson from VacuumControl). */
.feeder__row { display: flex; gap: 8px; }
.feeder__btn { flex: 1 1 0; min-width: 0; flex-shrink: 1; padding: 0 4px; }
.feeder__stack { display: flex; flex-direction: column; align-items: center; line-height: 1.15; }
/* RESERVED footprint: the line exists even when empty, so that a setting change does not make
   the text height jump in the button. */
.feeder__grams { font-size: 10px; opacity: .7; min-height: 1.15em; font-weight: 400; }
</style>

<!--
  Same reason as WaterCard: the raw `warning` token falls below the AA threshold of 4.5:1 in the
  light theme on a white panel, for 13 px text. Darkened it stays amber and readable; the
  dark theme, already compliant, is not touched. The `.feeder` class keeps the scope local in
  practice — `:global()` in a scoped block would lose the descendant (pitfall observed on HomeView).
-->
<style>
html[data-theme='light'] .feeder .line[data-alert='warning'] { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, black); }
</style>
