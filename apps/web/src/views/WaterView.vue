<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import WaterCard from '../components/controls/WaterCard.vue'
import WaterConsumptionChart from '../components/water/WaterConsumptionChart.vue'
import MarqueeText from '../components/ui/MarqueeText.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useConsumption } from '../composables/useConsumption'
import { headlineValue, statusLabel } from '../lib/deviceState'
import { useDevicesStore } from '../stores/devices'
import { HOUSEHOLD_SIZE_MAX, HOUSEHOLD_SIZE_MIN, useSettingsStore } from '../stores/settings'

// Water treatment view: a single device per installation, like the weather — no list to
// browse to read it, the detailed card (WaterCard, already used in the 3D scene's device
// panel) therefore takes all the room at the top of the page, preceded by a large value like
// the temperature of the Weather view. RoomBands, below, brings the link diagnostic and the
// "Place" button (same band as Lights/Covers/Energy): the station must be placeable
// in the 3D house like any other device.
const devices = useDevicesStore()
const settings = useSettingsStore()
const { t, locale } = useI18n()

/** The first AVAILABLE water device, otherwise the first one at all (greyed out) — same rule as the weather. */
const entry = computed(() => {
  const list = devices.list.filter((e) => e.state.kind === 'water')
  return list.find((e) => e.state.available) ?? list[0]
})
const state = computed(() => entry.value?.state as StateFor<'water'> | undefined)
const brand = computed(() => [entry.value?.descriptor.meta.manufacturer, entry.value?.descriptor.meta.model].filter(Boolean).join(' · '))
const headline = computed(() => (entry.value && state.value ? headlineValue(entry.value.descriptor, state.value, t, locale.value) : '—'))
const status = computed(() => (entry.value && state.value ? statusLabel(entry.value.descriptor, state.value, t, locale.value) : t('common.unknown')))

const caps = computed(() => new Set(entry.value?.descriptor.capabilities ?? []))
const hasChart = computed(() => caps.value.has('water_usage'))
const { consumption } = useConsumption(computed(() => entry.value?.descriptor.id))
</script>

<template>
  <div class="page">
    <PageHeader />
    <div class="page__scroll">
      <div v-if="!entry" class="card card--soft empty muted">{{ $t('water.noDevice') }}</div>
      <!-- Detail card + chart: side by side whenever the width allows (see
           `.water__top` below), one under the other otherwise. `--solo` (no `water_usage` capability,
           hence no chart) keeps a single column: the detail alone has no need to hug the left. -->
      <div v-else class="water__top" :class="{ 'water__top--solo': !hasChart }">
        <section class="card hero">
          <div class="hero__head">
            <span class="icon-square" :data-on="state?.available ? '1' : '0'">
              <StrokeIcon name="droplet" :size="18" />
            </span>
            <div class="hero__main">
              <MarqueeText class="hero__name" :text="entry.descriptor.name" />
              <div class="muted hero__sub">{{ brand }}</div>
            </div>
            <div class="hero__stat">
              <div class="hero__value">{{ headline }}</div>
              <div class="muted hero__status">{{ status }}</div>
            </div>
          </div>
          <WaterCard v-if="state" :descriptor="entry.descriptor" :state="state" />
          <!-- Declared household: DISPLAY setting (not a command of the device), discreet, at the foot
               of the detail card — feeds the French-average mark of the neighboring chart. Only
               shown if the chart exists (`hasChart`): without history, nothing to compare. -->
          <div v-if="hasChart" class="hero__household" :title="$t('water.referenceHint')">
            <span class="muted">{{ $t('water.household') }}</span>
            <div class="stepper">
              <button type="button" class="stepper__btn" :disabled="settings.householdSize <= HOUSEHOLD_SIZE_MIN"
                      :aria-label="$t('water.householdDec')" @click="settings.setHouseholdSize(settings.householdSize - 1)">
                <StrokeIcon name="minus" :size="14" />
              </button>
              <span class="stepper__val">{{ settings.householdSize }}</span>
              <button type="button" class="stepper__btn" :disabled="settings.householdSize >= HOUSEHOLD_SIZE_MAX"
                      :aria-label="$t('water.householdInc')" @click="settings.setHouseholdSize(settings.householdSize + 1)">
                <StrokeIcon name="plus" :size="14" />
              </button>
            </div>
          </div>
        </section>
        <WaterConsumptionChart v-if="hasChart" :consumption="consumption" :household-size="settings.householdSize"
          :today-l="state?.todayL" :week-l="state?.weekL" :month-l="state?.monthL" />
      </div>
      <RoomBands kind="water" />
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); display: grid; gap: 20px; align-content: start; }
.empty { padding: 24px; text-align: center; }
/* Below 1040px (measured threshold, see task report): one column, as before. Beyond: the detail
   card and the chart side by side, `stretch` (the default of `align-items`) giving them the same
   height — same pattern as `.energy__top` (EnergyView.vue).
   1040px and not 900 (taken as is from EnergyView): the detail card's header reserves a FIXED
   width for the right block (value + status, e.g. "Avertissement" at 32px, `.hero__stat` in
   `flex: 0 0 auto`); below ~965px of window, what remains for `.hero__main` (name + brand) falls
   below ~90px and the brand wraps onto two lines (`.hero__sub` has no ellipsis, unlike
   `.hero__name` which scrolls via `MarqueeText`) — measured with `getBoundingClientRect()`: 68px
   wide at 950px of window (brand on 2 lines, 36px tall) versus 98px at 980px (1 line, 18px).
   1040px gives margin beyond that threshold rather than hugging it to the pixel. */
.water__top { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; min-width: 0; }   /* bounded column: a long value does not widen it beyond the phone */
@media (min-width: 1040px) { .water__top:not(.water__top--solo) { grid-template-columns: 1fr 1fr; } }
.hero { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.hero__head { display: flex; align-items: center; gap: 12px; }
.hero__main { flex: 1 1 auto; min-width: 0; }
.hero__name { font-size: 15px; font-weight: 600; }
.hero__sub { font-size: 12px; margin-top: 2px; min-height: 1em; }
/* value and alert word: fixed footprint, right-aligned like the tiles of the Weather view */
.hero__stat { flex: 0 0 auto; text-align: right; }
.hero__value { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.hero__status { font-size: 12px; margin-top: 2px; }
/* Discreet setting, set apart from the data above (WaterCard) by a separator line. */
.hero__household { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 12px; }
.stepper { display: inline-flex; align-items: center; gap: 8px; }
.stepper__btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--text); cursor: pointer; }
.stepper__btn:disabled { opacity: .35; cursor: default; }
/* fixed width (2ch): "9" -> "10" does not make the buttons on either side move. */
.stepper__val { min-width: 2ch; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px; }
</style>
