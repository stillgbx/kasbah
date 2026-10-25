<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize, useIntervalFn } from '@vueuse/core'
import type { DeviceConsumption } from '@kasbah/shared'
import { bucketSlots, calendarTitle, CONSUMPTION_PERIODS, frenchAverageDailyLitres, frenchAverageReference, niceAxisTicks, seriesFor, slotsMax, slotsTotal, type ConsumptionPeriod, type ConsumptionSlot, type PeriodMode } from '../../lib/consumption'
import { formatVolume, formatVolumeAxisTick, volumeAxisUnit } from '../../lib/format'
import Segmented from '../ui/Segmented.vue'

// Consumption history (`GET /api/devices/:id/consumption`), in bars — a step measures a
// VOLUME OVER a duration, a bar is the natural language for that (unlike a curve,
// which would suggest a continuous value between two steps). Day/week/month/year read the three
// series of the contract; week and month share `daily`, only the number of columns changes.
//
// Nothing moves: `.chart__body` has a FIXED height, whether it shows the "it is filling up" message, or
// bars — 24, 7, 31 or 12, never more nor fewer than what the period reserves (28 to 31 for the calendar
// month). A step never measured (server silence, history still young) stays a dotted vertical DASH: a
// full bar would say "measured at 0 L", which would be false. A step still to come stays empty.

const props = withDefaults(defineProps<{
  consumption: DeviceConsumption | null
  /** Household size set in the settings (Water view): feeds the French-average marker. */
  householdSize?: number
  /**
   * EXACT totals that the station keeps itself (day/week/month, `waterStateSchema`): source of
   * truth for the displayed total, NEVER derived from the sum of the measured steps — a still
   * young history only measures a few hours/days, its sum would largely undercount the real
   * consumption (154 L on the meter, 16 L of bars over the 3 hours already measured). The year
   * has no equivalent (the station only keeps a sliding counter per month): it keeps the sum
   * of the monthly points, already complete.
   */
  todayL?: number
  weekL?: number
  monthL?: number
}>(), { householdSize: 3, todayL: undefined, weekL: undefined, monthL: undefined })
const { t, d, locale } = useI18n()
const householdSize = computed(() => props.householdSize)

const period = ref<ConsumptionPeriod>('day')
const periodOptions = computed(() => CONSUMPTION_PERIODS.map((p) => ({ value: p, label: t(`water.period.${p}`) })))
/** Rolling (the last 7 days, 31 days, 12 months) or calendar (this week, this month, this year): greyed
 * rather than hidden for the day, which stays the last 24 hours — the row keeps its shape. */
const mode = ref<PeriodMode>('rolling')
const modeOptions = computed(() => (['rolling', 'calendar'] as const).map((m) => ({
  value: m, label: t(`energy.modes.${m}`), disabled: period.value === 'day',
})))
const cutMode = computed<PeriodMode>(() => (period.value === 'day' ? 'rolling' : mode.value))

/** The contract series that feeds the chosen period, and the key of the matching "it is starting" message. */
const EMPTY_KEY: Record<ConsumptionPeriod, 'hourly' | 'daily' | 'monthly'> = { day: 'hourly', week: 'daily', month: 'daily', year: 'monthly' }
const series = computed(() => seriesFor(props.consumption, period.value))
/** No point received for this series: no point drawing an entirely dotted frame. */
const empty = computed(() => series.value.length === 0)

/** The wall clock advances: the sliding window (last 24 h, 7 d…) must follow, not just the data. */
const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)

const slots = computed<ConsumptionSlot[]>(() => bucketSlots(series.value, period.value, now.value, cutMode.value))
/** Sum of the measured steps only: last resort when the station has not yet published the exact counter (see `exactTotalL`). */
const total = computed(() => slotsTotal(slots.value))
const measuredCount = computed(() => slots.value.filter((s) => s.litres !== null).length)
/** Steps already begun: all of them in rolling mode, those up to today in calendar mode — a step still
 * to come is neither measured nor missing. */
const elapsedCount = computed(() => slots.value.filter((s) => s.t <= now.value).length)

/** The station's exact counter for the chosen period; `null` for the year (no equivalent). */
const exactTotalL = computed<number | null>(() => {
  const v = period.value === 'day' ? props.todayL : period.value === 'week' ? props.weekL : period.value === 'month' ? props.monthL : undefined
  return v ?? null
})
/** The total to DISPLAY, and for the accessible summary: the exact counter if known, otherwise the
 * sum of the measured steps, otherwise `null` (nothing known — neither counter, nor the slightest step). Never two
 * different figures for the same cell. */
const displayTotalL = computed<number | null>(() => exactTotalL.value ?? (empty.value ? null : total.value))
const totalText = computed(() => (displayTotalL.value === null ? '—' : formatVolume(displayTotalL.value, locale.value)))
/** The total's line: the period in rolling mode, the calendar window by its name otherwise ("Octobre 2026"). */
const totalLine = computed(() => {
  const p = period.value
  if (cutMode.value === 'rolling' || p === 'day') return t('water.consumptionTotal', { period: t(`water.period.${p}`), value: totalText.value })
  const scale = p === 'week' ? t('energy.scale.thisWeek') : calendarTitle(p, now.value, locale.value)
  return t('water.consumptionTotalIn', { scale, value: totalText.value })
})

/**
 * French average consumption marker (SISPEA 2023): `null` for the day period (an hourly line
 * would lie, see `frenchAverageReference`), otherwise one value per step — a STRAIGHT LINE in the
 * four other periods (the year included: see `frenchAverageReference`). The axis scale
 * (`maxLitres`) integrates it so that the line is never clipped when the household consumes LESS than
 * the marker (the normal case).
 */
const refPerSlot = computed<(number | null)[]>(() => slots.value.map(() => frenchAverageReference(period.value, householdSize.value)))
const refMax = computed(() => Math.max(0, ...refPerSlot.value.filter((v): v is number => v !== null)))
const maxLitres = computed(() => Math.max(slotsMax(slots.value), refMax.value))

const stage = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(stage)
const measured = computed(() => width.value > 0 && height.value > 0)

const PAD_TOP = 14
const PAD_BOTTOM = 4
/** Height of the dash of an unmeasured step: FIXED, it represents no value. */
const MISSING_H = 16
/** Number of columns that carry a label, so as not to stack 31 unreadable dates. */
const LABEL_EVERY: Record<ConsumptionPeriod, number> = { day: 4, week: 1, month: 5, year: 1 }

interface BarGeom { i: number; x: number; barW: number; cx: number; baseline: number; known: boolean; future: boolean; barH: number }

const baseline = computed(() => Math.max(0, height.value - PAD_BOTTOM))
const plotH = computed(() => Math.max(1, height.value - PAD_TOP - PAD_BOTTOM))
const barGeom = computed<BarGeom[]>(() => {
  if (!measured.value) return []
  const count = Math.max(1, slots.value.length)
  const slotW = width.value / count
  const barW = Math.max(2, slotW * 0.6)
  return slots.value.map((s, i) => {
    const x = i * slotW + (slotW - barW) / 2
    const known = s.litres !== null
    const barH = known ? Math.max(3, (s.litres! / maxLitres.value) * plotH.value) : 0
    return { i, x, barW, cx: x + barW / 2, baseline: baseline.value, known, future: s.t > now.value, barH }
  })
})

const labelled = computed(() => barGeom.value.filter((g) => g.i % LABEL_EVERY[period.value] === 0 || g.i === barGeom.value.length - 1))

/**
 * One horizontal segment per step that has a marker (see `refPerSlot`): the exact width of the step, not
 * the narrower one of the bar — visually BACKGROUND (color and dotting distinct from the
 * full bar and the "unmeasured step" dash), never confused with a measurement. Drawn ON TOP OF
 * the bars (see the template) to stay visible even when a bar approaches or exceeds it.
 */
interface RefSeg { i: number; x0: number; x1: number; y: number; value: number }
const refSegs = computed<RefSeg[]>(() => {
  if (!measured.value) return []
  const count = Math.max(1, slots.value.length)
  const slotW = width.value / count
  const segs: RefSeg[] = []
  refPerSlot.value.forEach((v, i) => {
    if (v === null) return
    segs.push({ i, x0: i * slotW, x1: (i + 1) * slotW, y: baseline.value - (v / maxLitres.value) * plotH.value, value: v })
  })
  return segs
})
const hasReference = computed(() => refSegs.value.length > 0)
/** Daily marker (N × 145 L) displayed in the legend, independent of the period — never a layout jump on tab change. */
const dailyReferenceL = computed(() => frenchAverageDailyLitres(householdSize.value))

/**
 * Y-axis tick: 3-4 round values (`niceAxisTicks`), never the raw maximum.
 * The unit (L or m³) follows the same threshold as `formatVolume` and is read once, at the column's head —
 * each tick stays a bare number (see `chart__yaxis-unit` in the template).
 */
const axisUnit = computed(() => volumeAxisUnit(maxLitres.value))
interface AxisTick { value: number; y: number; text: string }
const axisTicks = computed<AxisTick[]>(() => {
  if (!measured.value) return []
  return niceAxisTicks(maxLitres.value).map((value) => ({
    value,
    y: baseline.value - (value / maxLitres.value) * plotH.value,
    text: formatVolumeAxisTick(value, axisUnit.value, locale.value),
  }))
})

/** Short label of a step: hour for the day, month for the year, weekday otherwise (week AND month read `daily`). */
function axisLabel(tMs: number): string {
  if (period.value === 'day') return d(new Date(tMs), 'hour')
  if (period.value === 'year') return d(new Date(tMs), 'month')
  return d(new Date(tMs), 'weekday')
}
/** Tooltip of a bar: the date in full (never cut like the axis label) and the value, or the absence of a measurement. */
function tooltip(s: ConsumptionSlot): string {
  const when = period.value === 'day' ? d(new Date(s.t), 'short') : period.value === 'year' ? d(new Date(s.t), 'month') : d(new Date(s.t), 'date')
  return s.litres === null ? `${when} · ${t('water.noReading')}` : `${when} · ${formatVolume(s.litres, locale.value)}`
}

/** Real unit of each period's step, for the mention "X <unit> out of N measured" — never
 * the generic word "pas" (see `measuredFragment`), and the agreement (hour/day/month) depends on it. */
const MEASURED_UNIT_KEY: Record<ConsumptionPeriod, 'hours' | 'days' | 'months'> = { day: 'hours', week: 'days', month: 'days', year: 'months' }

/**
 * Fragment "X <unit> out of N measured", in the real unit of the step (hours/days/months) — never
 * the generic word "pas" (step), which in French reads as a negation: "9/12 pas mesurés" reads
 * spontaneously as "nine twelfths ARE NOT measured", the exact opposite of what it means.
 * vue-i18n pitfall: the total number of steps is called `steps`, never `count` nor `n` — these two names
 * are reserved by `getPluralIndex` and would silently overwrite the 3rd argument (experienced: with
 * `count`, the agreement followed the number of columns of the period, not the number of measured steps).
 */
const measuredFragment = computed(() => t(`water.measuredFragment.${MEASURED_UNIT_KEY[period.value]}`, {
  measured: measuredCount.value,
  steps: elapsedCount.value,
}, measuredCount.value))

/**
 * Summary readable by a screen reader: the SVG is decorative (`aria-hidden`), everything is said here.
 * The axis ticks add nothing a screen reader must hear in addition: they only
 * visually redraw the total and the values already said by each tooltip.
 */
const summary = computed(() => t('water.chartSummary', {
  period: t(`water.period.${period.value}`),
  total: totalText.value,
  fragment: measuredFragment.value,
}))

/**
 * VISIBLE reminder (not only accessible) that the bars only cover part of the period
 * when the history is still young: a total of 154 L above bars that add up to only
 * 16 must explain itself. Omitted when everything is measured: saying "24 hours out of 24 measured"
 * teaches nothing and clutters — the disappearance only shortens the end of `.chart__total`,
 * never moves its height or position (see the template, `v-if` on `.chart__totalNote`).
 */
const fullyMeasured = computed(() => measuredCount.value === elapsedCount.value)
const measuredNote = computed(() => (fullyMeasured.value ? '' : t('water.measuredNote', { fragment: measuredFragment.value })))
</script>

<template>
  <section class="card chart" :aria-label="t('water.consumption')">
    <div class="chart__head">
      <div class="chart__title">{{ t('water.consumption') }}</div>
      <div class="chart__controls">
        <Segmented v-model="period" :options="periodOptions" dense />
        <Segmented v-model="mode" :options="modeOptions" dense :label="t('energy.modeLabel')" />
      </div>
    </div>
    <div class="muted chart__total">
      {{ totalLine }}
      <span v-if="measuredNote" class="chart__totalNote">· {{ measuredNote }}</span>
    </div>
    <!-- French average marker: SAME text whatever the period (only depends on the
         household set) — never a layout jump on tab change. Visible source
         (SISPEA 2023), nuance in a tooltip (order of magnitude, not a verdict). -->
    <div class="muted chart__reference" :title="t('water.referenceHint')">
      {{ t('water.referenceLegend', { value: formatVolume(dailyReferenceL, locale), n: householdSize }) }}
    </div>
    <p class="chart__sr">{{ summary }}</p>
    <div class="chart__body">
      <div v-if="empty" class="muted chart__empty">{{ t(`water.consumptionEmpty.${EMPTY_KEY[period]}`) }}</div>
      <template v-else>
        <div class="chart__plot">
          <!-- FIXED width, reserved whether the unit is "L" or "m³": otherwise the bars area changes
               width at the very moment the axis changes unit (see formatVolumeAxisTick). -->
          <div class="chart__yaxis">
            <span class="chart__yaxis-unit">{{ axisUnit }}</span>
            <span v-for="tk in axisTicks" :key="tk.value" class="chart__yaxis-tick" :style="{ top: `${tk.y}px` }">{{ tk.text }}</span>
          </div>
          <div class="chart__stagecol">
            <div ref="stage" class="chart__stage">
              <svg v-if="measured" class="chart__bars" :viewBox="`0 0 ${Math.round(width)} ${Math.round(height)}`" aria-hidden="true">
                <line v-for="tk in axisTicks" :key="`grid-${tk.value}`" class="chart__gridline" x1="0" :y1="tk.y" :x2="width" :y2="tk.y" />
                <line class="chart__baseline" x1="0" :y1="baseline" :x2="width" :y2="baseline" />
                <template v-for="g in barGeom" :key="g.i">
                  <rect v-if="g.known" class="chart__bar" :x="g.x" :y="g.baseline - g.barH" :width="g.barW" :height="g.barH" rx="2"><title>{{ tooltip(slots[g.i]!) }}</title></rect>
                  <line v-else-if="!g.future" class="chart__missing" :x1="g.cx" :y1="g.baseline" :x2="g.cx" :y2="g.baseline - MISSING_H"><title>{{ tooltip(slots[g.i]!) }}</title></line>
                </template>
                <!-- French average marker: ON TOP OF the bars (stays visible even when exceeded),
                     background by color and dotting — never the full tint of a bar. -->
                <template v-if="hasReference">
                  <line v-for="seg in refSegs" :key="`ref-${seg.i}`" class="chart__reference-line" :x1="seg.x0" :y1="seg.y" :x2="seg.x1" :y2="seg.y">
                    <title>{{ t('water.referenceMark', { value: formatVolume(seg.value, locale) }) }}</title>
                  </line>
                </template>
              </svg>
            </div>
            <div class="chart__axis">
              <span v-for="g in labelled" :key="g.i" class="muted chart__axis-label" :style="{ left: `${g.cx}px` }">{{ axisLabel(slots[g.i]!.t) }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.chart { padding: 18px 20px; display: flex; flex-direction: column; gap: 4px; }
.chart__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
.chart__title { font-weight: 600; font-size: 14px; }
/* the selectors go under the title, and the cut under the periods, when they do not fit side by side:
   the width decides, never the choice. Aligned to the start: a selector wider than the card then
   overflows on the right, never off the left edge of the screen. */
.chart__controls { display: flex; flex-wrap: wrap; gap: 6px 8px; min-width: 0; }
.chart__total { font-size: 12px; font-variant-numeric: tabular-nums; }
/* absent when everything is measured (v-if): only shortens the end of `.chart__total`, never changes
   its height or position — see `measuredNote`. */
.chart__totalNote { opacity: .75; }
/* Marker legend: same text whatever the period (only depends on the household set), so
   never a layout jump on tab change — see `dailyReferenceL`. */
.chart__reference { font-size: 11px; margin-top: 1px; }
/* screen-reader-only summary: out of the visual flow, but never display:none (lost to readers) */
.chart__sr { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
/* MINIMUM height, never less: neither the period, nor the number of columns, nor the empty state
   make it fall below 192px. It may rise beyond that when the card is stretched by its neighbor in
   a two-column layout (`WaterView.vue`, `align-items: stretch` on `.water__top`) — the root
   `.chart` then receives a height imposed by the grid, and `flex: 1 1 192px` carries it over
   here rather than onto the header or the total, whose height must never depend on the neighborhood. */
.chart__body { min-height: 192px; flex: 1 1 192px; margin-top: 8px; display: flex; flex-direction: column; }
.chart__empty { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 13px; padding: 0 12px; }
.chart__plot { display: flex; flex: 1 1 auto; min-height: 0; gap: 8px; }
/* FIXED width (never computed from the ticks' text): it must not move when
   the axis switches from "L" to "m³" (`formatVolumeAxisTick`) on a period change. 44px measured
   for the worst realistic text ("1 000", FR thousands separator included) without ever truncating. */
.chart__yaxis { flex: 0 0 44px; width: 44px; position: relative; }
.chart__yaxis-unit { position: absolute; top: 0; right: 0; font-size: 10px; color: var(--muted); }
.chart__yaxis-tick { position: absolute; right: 0; transform: translateY(-50%); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.chart__stagecol { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.chart__stage { flex: 1 1 auto; min-height: 0; min-width: 0; position: relative; }
.chart__bars { position: absolute; inset: 0; width: 100%; height: 100%; }
.chart__baseline { stroke: var(--line); stroke-width: 1; }
/* Discreet background markers: they must not compete with the bars (doc/4_ui/4_0_langage-visuel.md). */
.chart__gridline { stroke: var(--line); stroke-width: 1; stroke-dasharray: 1 3; }
.chart__bar { fill: var(--accent); }
.chart__missing { stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 1.5 3; opacity: .55; }
/* French average marker: color AND dotting distinct from the bar (solid fill) as from the
   "unmeasured" dash (thin, rounded) — never confused with a measurement. Same token as the markers
   of the Vehicles view (`VehicleBattery.vue .soc__tick`), already established for this role. */
.chart__reference-line { stroke: rgb(var(--v-theme-warning)); stroke-width: 1.5; stroke-dasharray: 5 3; opacity: .85; }
.chart__axis { position: relative; flex: 0 0 20px; }
.chart__axis-label { position: absolute; top: 2px; transform: translateX(-50%); font-size: 11px; white-space: nowrap; }
</style>
