<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize, useIntervalFn } from '@vueuse/core'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { getTransport } from '../../api'
import type { LightHistory } from '../../api/transport'
import { bucketSlots, calendarTitle, niceAxisTicks, slotsMax, type ConsumptionPeriod, type PeriodMode } from '../../lib/consumption'
import { formatSensor } from '../../lib/format'
import Segmented from '../ui/Segmented.vue'

// Brightness of a solar shutter: the current value, and the MAXIMUM reached per hour (day), per
// day (month) and per month (year) — the three views of the Somfy app. The history is kept by the
// server as the frames arrive (`GET /api/plugins/tahoma/light/:id`); it is re-read every 5 min.
//
// The split into steps is that of the water consumption chart (`lib/consumption`), which speaks in
// `litres`: we store lux in it, only the field name does not fit.
//
// Nothing moves: the plot has a FIXED height, and each period always reserves its number of
// columns. A step never measured (server stopped) stays a dashed dash, not a bar at 0; a step still
// to come (the calendar month or year) stays empty.

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'sensor'> }>()
const { t, d, locale } = useI18n()

type Period = Extract<ConsumptionPeriod, 'day' | 'month' | 'year'>
const PERIODS: readonly Period[] = ['day', 'month', 'year']
const period = ref<Period>('day')
const periodOptions = computed(() => PERIODS.map((p) => ({ value: p, label: t(`lightHistory.period.${p}`) })))
/** Rolling (the last 31 days, 12 months) or calendar (this month, this year): greyed rather than hidden
 * for the day, which stays the last 24 hours — the row keeps its shape. */
const mode = ref<PeriodMode>('rolling')
const modeOptions = computed(() => (['rolling', 'calendar'] as const).map((m) => ({
  value: m, label: t(`energy.modes.${m}`), disabled: period.value === 'day',
})))
const cutMode = computed<PeriodMode>(() => (period.value === 'day' ? 'rolling' : mode.value))

const history = ref<LightHistory | null>(null)
async function load() {
  try { history.value = await getTransport().lightHistory(props.descriptor.id) }
  catch { history.value = null }
}
watch(() => props.descriptor.id, load, { immediate: true })
useIntervalFn(load, 5 * 60_000)

const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)

const series = computed(() => {
  const h = history.value
  if (!h) return []
  const pts = period.value === 'day' ? h.hourly : period.value === 'month' ? h.daily : h.monthly
  return pts.map((p) => ({ t: p.t, litres: p.maxLux }))
})
const slots = computed(() => bucketSlots(series.value, period.value, now.value, cutMode.value))
/** The peak's sentence: the rolling window, or the calendar month or year by its name. */
const peakText = computed(() => {
  const value = peak.value === null ? '—' : lux(peak.value)
  const p = period.value
  return cutMode.value === 'calendar' && p !== 'day'
    ? t('lightHistory.peakIn', { scale: calendarTitle(p, now.value, locale.value), value })
    : t(`lightHistory.peak.${p}`, { value })
})
const known = computed(() => slots.value.filter((s) => s.litres !== null))
const empty = computed(() => known.value.length === 0)
const peak = computed(() => (empty.value ? null : Math.max(...known.value.map((s) => s.litres!))))
const lux = (v: number) => formatSensor(props.descriptor, v, locale.value)

const stage = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(stage)
const measured = computed(() => width.value > 0 && height.value > 0)
const PAD_TOP = 8
const MISSING_H = 12
const maxLux = computed(() => slotsMax(slots.value))
const bars = computed(() => {
  if (!measured.value) return []
  const slotW = width.value / slots.value.length
  const barW = Math.max(2, slotW * 0.6)
  const plotH = Math.max(1, height.value - PAD_TOP)
  return slots.value.map((s, i) => {
    const x = i * slotW + (slotW - barW) / 2
    const barH = s.litres === null ? 0 : s.litres > 0 ? Math.max(2, (s.litres / maxLux.value) * plotH) : 0
    return { i, x, barW, cx: x + barW / 2, known: s.litres !== null, future: s.t > now.value, barH }
  })
})
const gridlines = computed(() => {
  if (!measured.value) return []
  const plotH = Math.max(1, height.value - PAD_TOP)
  return niceAxisTicks(maxLux.value).map((v) => height.value - (v / maxLux.value) * plotH)
})

const LABEL_EVERY: Record<Period, number> = { day: 6, month: 7, year: 3 }
const labelled = computed(() => bars.value.filter((b) => b.i % LABEL_EVERY[period.value] === 0))
function axisLabel(ms: number): string {
  if (period.value === 'day') return d(new Date(ms), 'hour')
  if (period.value === 'year') return d(new Date(ms), 'month')
  return String(new Date(ms).getDate())
}
function tooltip(i: number): string {
  const s = slots.value[i]!
  const when = period.value === 'day' ? d(new Date(s.t), 'short') : period.value === 'year' ? d(new Date(s.t), 'month') : d(new Date(s.t), 'date')
  return s.litres === null ? `${when} · ${t('lightHistory.noReading')}` : `${when} · ${lux(s.litres)}`
}
</script>

<template>
  <section class="lh" :aria-label="t('lightHistory.title')">
    <div class="lh__head">
      <div class="lh__title">{{ t('lightHistory.title') }}</div>
      <div class="lh__now">{{ lux(state.value) }}</div>
    </div>
    <div class="lh__controls">
      <Segmented v-model="period" :options="periodOptions" dense />
      <Segmented v-model="mode" :options="modeOptions" dense :label="t('energy.modeLabel')" />
    </div>
    <div class="muted lh__peak">{{ peakText }}</div>
    <div class="lh__body">
      <div v-if="empty" class="muted lh__empty">{{ t('lightHistory.empty') }}</div>
      <div v-show="!empty" ref="stage" class="lh__stage">
        <svg v-if="measured" class="lh__svg" :viewBox="`0 0 ${Math.round(width)} ${Math.round(height)}`" aria-hidden="true">
          <line v-for="y in gridlines" :key="y" class="lh__grid" x1="0" :y1="y" :x2="width" :y2="y" />
          <template v-for="b in bars" :key="b.i">
            <rect v-if="b.known" class="lh__bar" :x="b.x" :y="height - b.barH" :width="b.barW" :height="b.barH" rx="1.5"><title>{{ tooltip(b.i) }}</title></rect>
            <line v-else-if="!b.future" class="lh__missing" :x1="b.cx" :y1="height" :x2="b.cx" :y2="height - MISSING_H"><title>{{ tooltip(b.i) }}</title></line>
          </template>
        </svg>
      </div>
    </div>
    <div class="lh__axis" aria-hidden="true">
      <span v-for="b in labelled" :key="b.i" class="muted lh__label" :style="{ left: `${b.cx}px` }">{{ axisLabel(slots[b.i]!.t) }}</span>
    </div>
  </section>
</template>

<style scoped>
.lh { display: grid; gap: 6px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.lh__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.lh__title { font-size: 13px; font-weight: 600; }
.lh__now { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
/* the cut goes under the periods when the two do not fit side by side: the width decides, never the choice */
.lh__controls { display: flex; flex-wrap: wrap; gap: 6px 8px; min-width: 0; }
.lh__peak { font-size: 12px; font-variant-numeric: tabular-nums; }
/* FIXED height: neither the period nor the empty state changes it */
.lh__body { height: 96px; position: relative; }
.lh__empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; padding: 0 12px; }
.lh__stage { position: absolute; inset: 0; }
.lh__svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.lh__grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 1 3; }
.lh__bar { fill: rgb(var(--v-theme-warning)); opacity: .85; }
.lh__missing { stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-dasharray: 1.5 3; opacity: .55; }
.lh__axis { position: relative; height: 16px; }
.lh__label { position: absolute; transform: translateX(-50%); font-size: 11px; white-space: nowrap; }
</style>
