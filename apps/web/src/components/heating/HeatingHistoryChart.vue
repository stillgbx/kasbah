<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import type { HeatingPoint } from '../../api/transport'
import { bucketSlots, type ConsumptionPeriod } from '../../lib/consumption'
import { formatTemp } from '../../lib/format'
import Segmented from '../ui/Segmented.vue'

// Operating history: how much of each step (hour, day or month) the machine spent heating, and
// what the outdoor temperature was during that time. The two together make the only interesting
// story — a heat pump that runs a lot at 12 °C does not say the same thing as one
// that runs a lot at -5 °C.
//
// No kWh: this machine has no meter, and MELCloud returns empty energy readings even
// over a whole winter. What we plot is therefore RUN TIME, measured by the server as
// it polls — the only thing we honestly know.
//
// Four windows (asked for on 2026-10-21): 48 h and their hours, the week and the month in days,
// the year in months. The server keeps a week of hours and thirteen months of days; the months
// are summed here from the days.
//
// Nothing moves: the plot area has a FIXED height and each window always reserves its number of
// steps, whether the history is empty, young or complete. A step never polled stays a dashed
// DASH: a bar at zero would say "measured, it did not heat", which would be false.

const props = defineProps<{ points: HeatingPoint[]; daily: HeatingPoint[]; pollMs: number }>()
const { t, locale } = useI18n()

type Range = 'h48' | 'week' | 'month' | 'year'
const RANGES: readonly Range[] = ['h48', 'week', 'month', 'year']
const range = ref<Range>('h48')
const rangeOptions = computed(() => RANGES.map((r) => ({ value: r, label: t(`heating.history.ranges.${r}`) })))

const HOURS = 48
const HOUR_MS = 3_600_000

/** The wall clock advances: the sliding window must follow, not only the data. */
const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)

/** `share`: part of the step spent heating (0 → 1); `hours`: the run hours it stands for. */
interface Slot { t: number; share: number | null; hours: number; defrost: boolean; booster: boolean; outdoorC: number | null }
const gap = (t: number): Slot => ({ t, share: null, hours: 0, defrost: false, booster: false, outdoorC: null })
const slotOf = (t: number, p: HeatingPoint, stepHours: number): Slot =>
  ({ t, share: p.heating / p.n, hours: (p.heating / p.n) * stepHours, defrost: p.defrost > 0, booster: p.booster > 0, outdoorC: p.outdoorC })

/** Days summed into calendar months (local), the means weighted by their samples. */
function byMonth(days: readonly HeatingPoint[]): (HeatingPoint & { hours: number })[] {
  const out: (HeatingPoint & { hours: number; tempN: number })[] = []
  for (const p of days) {
    const d = new Date(p.t); d.setDate(1); d.setHours(0, 0, 0, 0)
    let m = out[out.length - 1]
    if (!m || m.t !== d.getTime()) { m = { t: d.getTime(), n: 0, heating: 0, defrost: 0, booster: 0, outdoorC: null, flowC: null, returnC: null, hours: 0, tempN: 0 }; out.push(m) }
    m.n += p.n; m.heating += p.heating; m.defrost += p.defrost; m.booster += p.booster
    m.hours += (p.heating / p.n) * 24
    if (p.outdoorC !== null) { m.outdoorC = ((m.outdoorC ?? 0) * m.tempN + p.outdoorC * p.n) / (m.tempN + p.n); m.tempN += p.n }
  }
  return out
}

const slots = computed<Slot[]>(() => {
  if (range.value === 'h48') {
    // the 48 slots from the oldest full hour to the current hour, gaps included
    const byHour = new Map(props.points.map((p) => [p.t, p]))
    const last = Math.floor(now.value / HOUR_MS) * HOUR_MS
    return Array.from({ length: HOURS }, (_, i) => {
      const at = last - (HOURS - 1 - i) * HOUR_MS
      const p = byHour.get(at)
      return p ? slotOf(at, p, 1) : gap(at)
    })
  }
  // days or months: the steps of the water chart (`lib/consumption`), which match by proximity;
  // it carries a number per step, here the INDEX of the point it found
  const period: ConsumptionPeriod = range.value
  const months = period === 'year' ? byMonth(props.daily) : null
  const pts = months ?? props.daily
  return bucketSlots(pts.map((p, i) => ({ t: p.t, litres: i })), period, now.value).map((s) => {
    if (s.litres === null) return gap(s.t)
    const p = pts[s.litres]!
    const slot = slotOf(s.t, p, 24)
    return months ? { ...slot, hours: months[s.litres]!.hours } : slot
  })
})

const VB_H = 100
/** Plot reference. `preserveAspectRatio="none"` stretches it in width; the strokes keep their thickness. */
const vbW = computed(() => slots.value.length * 10)

const measured = computed(() => slots.value.filter((s) => s.share !== null))
const empty = computed(() => measured.value.length === 0)

/** Run hours accumulated over the window. */
const runHours = computed(() => measured.value.reduce((a, s) => a + s.hours, 0))
const runLabel = computed(() => t('heating.history.runHours', { h: runHours.value.toLocaleString(locale.value, { maximumFractionDigits: runHours.value >= 100 ? 0 : 1 }) }))

/** Bounds of the outdoor curve, rounded to the degree and never flat (otherwise the curve would be a line on the floor). */
const outdoorRange = computed<[number, number] | null>(() => {
  const temps = slots.value.map((s) => s.outdoorC).filter((v): v is number => v !== null)
  if (!temps.length) return null
  const lo = Math.floor(Math.min(...temps))
  const hi = Math.ceil(Math.max(...temps))
  return hi - lo < 2 ? [lo - 1, lo + 1] : [lo, hi]
})

/** The outdoor curve, in segments: a gap in the measurement cuts the stroke instead of inventing it. */
const outdoorPath = computed(() => {
  const r = outdoorRange.value
  if (!r) return ''
  const [lo, hi] = r
  let d = ''
  let pen = false
  slots.value.forEach((s, i) => {
    if (s.outdoorC === null) { pen = false; return }
    const x = i * 10 + 5
    // 10 % margin at the top and bottom: the curve touches neither the ceiling nor the floor
    const y = VB_H - 10 - ((s.outdoorC - lo) / (hi - lo)) * (VB_H - 20)
    d += `${pen ? 'L' : 'M'}${x} ${Math.round(y * 10) / 10} `
    pen = true
  })
  return d.trim()
})

/** Few enough labels to stay readable: every six hours, every day, every week, every quarter. */
const ticks = computed(() => slots.value.map((s, i) => ({ i, t: s.t })).filter(({ t: at, i }) => {
  if (range.value === 'h48') return new Date(at).getHours() % 6 === 0
  if (range.value === 'month') return i % 7 === 0
  if (range.value === 'year') return i % 3 === 0
  return true
}))
function tickLabel(at: number): string {
  const d = new Date(at)
  if (range.value === 'h48') return `${d.getHours()}h`
  if (range.value === 'week') return d.toLocaleDateString(locale.value, { weekday: 'short' })
  if (range.value === 'year') return d.toLocaleDateString(locale.value, { month: 'short' })
  return String(d.getDate())
}
</script>

<template>
  <section class="card hist">
    <div class="hist__head">
      <div>
        <div class="hist__title">{{ $t('heating.history.title') }}</div>
        <div class="muted small">{{ $t(`heating.history.windows.${range}`) }}</div>
      </div>
      <Segmented v-model="range" :options="rangeOptions" dense class="hist__ranges" />
      <div class="hist__stat">
        <div class="hist__value">{{ empty ? '—' : runLabel }}</div>
        <div class="muted small">{{ $t('heating.history.run') }}</div>
      </div>
    </div>

    <div class="hist__body">
      <p v-if="empty" class="muted small hist__empty">{{ $t('heating.history.filling', { min: Math.round(pollMs / 60000) }) }}</p>
      <svg v-else class="hist__svg" :viewBox="`0 0 ${vbW} ${VB_H}`" preserveAspectRatio="none" role="img"
           :aria-label="$t('heating.history.title')">
        <!-- the steps never polled: a dash, not a bar at zero -->
        <line v-for="(s, i) in slots" v-show="s.share === null" :key="`gap-${s.t}`"
              class="hist__gap" :x1="i * 10 + 5" :x2="i * 10 + 5" :y1="VB_H - 4" :y2="VB_H" vector-effect="non-scaling-stroke" />
        <rect v-for="(s, i) in slots" v-show="s.share !== null" :key="`bar-${s.t}`"
              class="hist__bar" :x="i * 10 + 1.5" :width="7"
              :y="VB_H - (s.share ?? 0) * (VB_H - 4)" :height="Math.max((s.share ?? 0) * (VB_H - 4), (s.share ?? 0) > 0 ? 1.5 : 0)" />
        <!-- defrost and electric backup: two marks at the foot of the step concerned -->
        <rect v-for="(s, i) in slots" v-show="s.defrost" :key="`d-${s.t}`" class="hist__defrost" :x="i * 10 + 1.5" :y="VB_H - 2.5" width="7" height="2.5" />
        <rect v-for="(s, i) in slots" v-show="s.booster" :key="`b-${s.t}`" class="hist__booster" :x="i * 10 + 1.5" :y="VB_H - 5" width="7" height="2.5" />
        <path v-if="outdoorPath" class="hist__outdoor" :d="outdoorPath" vector-effect="non-scaling-stroke" />
      </svg>
    </div>

    <div class="hist__axis" aria-hidden="true">
      <span v-for="tk in ticks" :key="tk.t" class="hist__tick" :style="{ left: `${((tk.i * 10 + 5) / vbW) * 100}%` }">{{ tickLabel(tk.t) }}</span>
    </div>

    <div class="hist__legend muted small">
      <span class="key"><i class="swatch swatch--bar" />{{ $t('heating.history.legendRun') }}</span>
      <span class="key"><i class="swatch swatch--outdoor" />{{ $t('heating.history.legendOutdoor') }}<template v-if="outdoorRange">
        · {{ formatTemp(outdoorRange[0], $i18n.locale) }} → {{ formatTemp(outdoorRange[1], $i18n.locale) }}</template></span>
      <span class="key"><i class="swatch swatch--defrost" />{{ $t('heating.history.legendDefrost') }}</span>
      <span class="key"><i class="swatch swatch--booster" />{{ $t('heating.history.legendBooster') }}</span>
    </div>
  </section>
</template>

<style scoped>
.hist { padding: 14px 16px; display: grid; gap: 10px; min-width: 0; }
.hist__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.hist__title { font-size: 15px; font-weight: 600; }
/* between the title and the figure: the window chosen sits next to what it changes */
.hist__ranges { flex: 0 1 auto; margin-left: auto; }
.hist__stat { flex: 0 0 auto; text-align: right; min-width: 7ch; }
.hist__value { font-size: 20px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
/* FIXED height: the frame moves neither when the history is empty, nor when it fills up.
   96 px and not 132: the shape of the bars reads just as well, and the page fits on one screen. */
.hist__body { height: 96px; position: relative; }
.hist__empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; margin: 0; padding: 0 12px; }
.hist__svg { width: 100%; height: 100%; display: block; overflow: visible; }
.hist__bar { fill: var(--accent); opacity: .85; }
.hist__gap { stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 2; }
.hist__defrost { fill: #4aa3d2; }
.hist__booster { fill: #d38b22; }
.hist__outdoor { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
/* ticks placed as a percentage under the plot: they follow the viewBox's stretching */
.hist__axis { position: relative; height: 14px; }
.hist__tick { position: absolute; transform: translateX(-50%); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.hist__legend { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.key { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; flex: 0 0 auto; }
.swatch--bar { background: var(--accent); }
.swatch--outdoor { height: 2px; border-radius: 1px; background: var(--muted); }
.swatch--defrost { background: #4aa3d2; }
.swatch--booster { background: #d38b22; }
.small { font-size: 12px; }
</style>
