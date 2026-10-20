<script setup lang="ts">
import { computed, ref } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { HeatingPoint } from '../../api/transport'
import { formatTemp } from '../../lib/format'

// Operating history over 48 h: how much of each hour the machine spent heating, and
// what the outdoor temperature was during that time. The two together make the only interesting
// story — a heat pump that runs a lot at 12 °C does not say the same thing as one
// that runs a lot at -5 °C.
//
// No kWh: this machine has no meter, and MELCloud returns empty energy readings even
// over a whole winter. What we plot is therefore RUN TIME, measured by the server as
// it polls — the only thing we honestly know.
//
// Nothing moves: the plot area has a FIXED height and always 48 slots, whether the history
// is empty, young or complete. An hour never polled stays a dashed DASH: a bar at
// zero would say "measured, it did not heat", which would be false.

const props = defineProps<{ points: HeatingPoint[]; pollMs: number }>()

const HOURS = 48
const HOUR_MS = 3_600_000
/** Plot reference. `preserveAspectRatio="none"` stretches it in width; the strokes keep their thickness. */
const VB_W = HOURS * 10
const VB_H = 100

/** The wall clock advances: the sliding window must follow, not only the data. */
const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)

interface Slot { t: number; share: number | null; defrost: boolean; booster: boolean; outdoorC: number | null }

/** The 48 slots from the oldest full hour to the current hour, gaps included. */
const slots = computed<Slot[]>(() => {
  const byHour = new Map(props.points.map((p) => [p.t, p]))
  const last = Math.floor(now.value / HOUR_MS) * HOUR_MS
  return Array.from({ length: HOURS }, (_, i) => {
    const t = last - (HOURS - 1 - i) * HOUR_MS
    const p = byHour.get(t)
    if (!p) return { t, share: null, defrost: false, booster: false, outdoorC: null }
    return { t, share: p.heating / p.n, defrost: p.defrost > 0, booster: p.booster > 0, outdoorC: p.outdoorC }
  })
})

const measured = computed(() => slots.value.filter((s) => s.share !== null))
const empty = computed(() => measured.value.length === 0)

/** Run hours accumulated over the window: the sum of the shares, each worth one hour. */
const runHours = computed(() => measured.value.reduce((a, s) => a + (s.share ?? 0), 0))

/** Bounds of the outdoor curve, rounded to the degree and never flat (otherwise the curve would be a line on the floor). */
const outdoorRange = computed<[number, number] | null>(() => {
  const temps = slots.value.map((s) => s.outdoorC).filter((t): t is number => t !== null)
  if (!temps.length) return null
  const lo = Math.floor(Math.min(...temps))
  const hi = Math.ceil(Math.max(...temps))
  return hi - lo < 2 ? [lo - 1, lo + 1] : [lo, hi]
})

/** The outdoor curve, in segments: a gap in the measurement cuts the stroke instead of inventing it. */
const outdoorPath = computed(() => {
  const range = outdoorRange.value
  if (!range) return ''
  const [lo, hi] = range
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

const hourLabel = (t: number) => new Date(t).getHours()
/** A tick every six hours: enough to get one's bearings, few enough to stay readable. */
const ticks = computed(() => slots.value.map((s, i) => ({ i, t: s.t })).filter(({ t }) => new Date(t).getHours() % 6 === 0))
</script>

<template>
  <section class="card hist">
    <div class="hist__head">
      <div>
        <div class="hist__title">{{ $t('heating.history.title') }}</div>
        <div class="muted small">{{ $t('heating.history.window') }}</div>
      </div>
      <div class="hist__stat">
        <div class="hist__value">{{ empty ? '—' : $t('heating.history.runHours', { h: runHours.toFixed(1) }) }}</div>
        <div class="muted small">{{ $t('heating.history.run') }}</div>
      </div>
    </div>

    <div class="hist__body">
      <p v-if="empty" class="muted small hist__empty">{{ $t('heating.history.filling', { min: Math.round(pollMs / 60000) }) }}</p>
      <svg v-else class="hist__svg" :viewBox="`0 0 ${VB_W} ${VB_H}`" preserveAspectRatio="none" role="img"
           :aria-label="$t('heating.history.title')">
        <!-- the hours never polled: a dash, not a bar at zero -->
        <line v-for="(s, i) in slots" v-show="s.share === null" :key="`gap-${s.t}`"
              class="hist__gap" :x1="i * 10 + 5" :x2="i * 10 + 5" :y1="VB_H - 4" :y2="VB_H" vector-effect="non-scaling-stroke" />
        <rect v-for="(s, i) in slots" v-show="s.share !== null" :key="`bar-${s.t}`"
              class="hist__bar" :x="i * 10 + 1.5" :width="7"
              :y="VB_H - (s.share ?? 0) * (VB_H - 4)" :height="Math.max((s.share ?? 0) * (VB_H - 4), (s.share ?? 0) > 0 ? 1.5 : 0)" />
        <!-- defrost and electric backup: two marks at the foot of the hour concerned -->
        <rect v-for="(s, i) in slots" v-show="s.defrost" :key="`d-${s.t}`" class="hist__defrost" :x="i * 10 + 1.5" :y="VB_H - 2.5" width="7" height="2.5" />
        <rect v-for="(s, i) in slots" v-show="s.booster" :key="`b-${s.t}`" class="hist__booster" :x="i * 10 + 1.5" :y="VB_H - 5" width="7" height="2.5" />
        <path v-if="outdoorPath" class="hist__outdoor" :d="outdoorPath" vector-effect="non-scaling-stroke" />
      </svg>
    </div>

    <div class="hist__axis" aria-hidden="true">
      <span v-for="tk in ticks" :key="tk.t" class="hist__tick" :style="{ left: `${((tk.i * 10 + 5) / VB_W) * 100}%` }">{{ hourLabel(tk.t) }}h</span>
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
.hist__stat { flex: 0 0 auto; text-align: right; }
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
.hist__tick { position: absolute; transform: translateX(-50%); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.hist__legend { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.key { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; flex: 0 0 auto; }
.swatch--bar { background: var(--accent); }
.swatch--outdoor { height: 2px; border-radius: 1px; background: var(--muted); }
.swatch--defrost { background: #4aa3d2; }
.swatch--booster { background: #d38b22; }
.small { font-size: 12px; }
</style>
