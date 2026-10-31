<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { EnergyHistoryPoint, StateFor } from '@kasbah/shared'
import { formatApparent, formatPower } from '../../lib/format'

/**
 * The grid PHASE BY PHASE: what each phase draws now, against its share of the subscription, and
 * the highest draw of each hour of the last day. A three-phase meter cuts as soon as ONE phase goes
 * over its share, whatever the total: the site's single figure cannot say it.
 *
 * Apparent power (kVA), the one the meter limits. An exporting phase draws nothing: its bar stays
 * empty and its line says how much it gives back. Without a limit (subscription not entered on the
 * Enphase card), the bars are scaled on the highest value shown and the head says where to set it.
 */
const props = defineProps<{ energy: StateFor<'energy'>; points: EnergyHistoryPoint[] }>()
const { locale, t } = useI18n()

const HOURS = 24
/** Share of the limit from which a draw is shown as close, then as at the limit. */
const WARN = 0.8
const HIGH = 0.95

const limit = computed(() => props.energy.phaseLimitVa)
const phases = computed(() => props.energy.gridPhases ?? [])
const hourStart = () => Math.floor(Date.now() / 3_600_000) * 3_600_000

/** The 24 hours ending with the current one, each with its peaks (absent = no reading that hour). */
const hours = computed(() => {
  const now = hourStart()
  const byHour = new Map(props.points.map((p) => [p.t, p.phasePeakVa]))
  return Array.from({ length: HOURS }, (_, i) => {
    const t0 = now - (HOURS - 1 - i) * 3_600_000
    return { t: t0, peaks: byHour.get(t0) }
  })
})
const currentPeaks = computed(() => hours.value[HOURS - 1]?.peaks)

const scale = computed(() => {
  if (limit.value) return limit.value
  const seen = [...phases.value.map((p) => p.va), ...hours.value.flatMap((h) => h.peaks ?? [])]
  return Math.max(1000, ...seen) * 1.1
})
const level = (va: number) => !limit.value ? 'ok' : va >= limit.value * HIGH ? 'high' : va >= limit.value * WARN ? 'warn' : 'ok'
const pct = (va: number) => `${Math.min(100, (Math.max(0, va) / scale.value) * 100)}%`

const rows = computed(() => phases.value.map((p, i) => {
  // the history is re-read every minute, the phases every few seconds: the hour's peak is at least now
  const held = currentPeaks.value?.[i]
  const peak = held === undefined ? undefined : Math.max(held, p.va)
  return {
    key: `L${i + 1}`,
    fill: pct(p.va),
    level: level(p.va),
    value: p.va < 0 ? t('energy.phases.exporting', { value: formatPower(-p.w, locale.value) }) : formatApparent(p.va, locale.value),
    exporting: p.va < 0,
    peak: peak === undefined ? undefined : { at: pct(peak), text: t('energy.phases.peak', { value: formatApparent(peak, locale.value) }) },
  }
}))

const hourLabel = (at: number) => new Date(at).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
const axis = computed(() => [hours.value[0]!.t, hours.value[12]!.t, hours.value[HOURS - 1]!.t].map(hourLabel))
const barTitle = (phase: string, at: number, va: number | undefined) =>
  `${phase} · ${hourLabel(at)} · ${va === undefined ? '—' : formatApparent(va, locale.value)}`
</script>

<template>
  <section class="card phases">
    <div class="phases__head">
      <!-- singular on a single-phase meter: "limit 9 kVA", not "per phase" -->
      <div class="phases__title">{{ $t('energy.phases.title', phases.length) }}</div>
      <div class="muted phases__limit">
        {{ limit ? $t('energy.phases.limit', { value: formatApparent(limit, locale) }, phases.length) : $t('energy.phases.noLimit') }}
      </div>
    </div>

    <!-- now: one row per phase, the track ends at the phase's limit -->
    <div class="phases__rows">
      <div v-for="r in rows" :key="r.key" class="row">
        <span class="row__k">{{ r.key }}</span>
        <div class="row__track">
          <div class="row__fill" :data-level="r.level" :style="{ width: r.fill }" />
          <span v-if="r.peak" class="row__peak" :style="{ left: r.peak.at }" />
        </div>
        <span class="row__v" :class="{ muted: r.exporting }">{{ r.value }}</span>
        <span class="muted row__p">{{ r.peak?.text ?? '' }}</span>
      </div>
    </div>

    <!-- the last day, hour by hour: the highest draw of each phase -->
    <div class="muted phases__sub">{{ $t('energy.phases.hourlyPeaks') }}</div>
    <div class="phases__hours">
      <div v-for="(r, i) in rows" :key="r.key" class="hrow">
        <span class="row__k">{{ r.key }}</span>
        <div class="hrow__bars">
          <div v-for="h in hours" :key="h.t" class="hbar" :title="barTitle(r.key, h.t, h.peaks?.[i])">
            <div v-if="h.peaks?.[i] !== undefined" class="hbar__fill" :data-level="level(h.peaks[i]!)" :style="{ height: pct(h.peaks[i]!) }" />
          </div>
        </div>
      </div>
      <div class="hrow">
        <span />
        <div class="muted phases__axis"><span v-for="a in axis" :key="a">{{ a }}</span></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* FIXED rows: three phases, three lines, whatever the values — nothing moves when a phase exports */
.phases { padding: 18px 20px; display: grid; gap: 12px; min-width: 0; }
.phases__head { display: flex; align-items: baseline; justify-content: space-between; gap: 4px 12px; flex-wrap: wrap; }
.phases__title { font-weight: 600; font-size: 14px; }
.phases__limit { font-size: 12px; }
.phases__rows { display: grid; gap: 10px; }
.row { display: grid; grid-template-columns: 22px minmax(0, 1fr) 76px 84px; align-items: center; gap: 10px; }
.row__k { font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
.row__track { position: relative; height: 10px; border-radius: 999px; background: var(--line); }
.row__fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: var(--accent); transition: width .4s; }
.row__fill[data-level='warn'], .hbar__fill[data-level='warn'] { background: rgb(var(--v-theme-warning)); }
.row__fill[data-level='high'], .hbar__fill[data-level='high'] { background: rgb(var(--v-theme-error)); }
/* the hour's peak: a tick across the track, in the text colour */
.row__peak { position: absolute; top: -3px; bottom: -3px; width: 2px; transform: translateX(-1px); background: var(--text); opacity: .7; }
.row__v { font-size: 13px; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row__p { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.phases__sub { font-size: 12px; }
.phases__hours { display: grid; gap: 6px; }
.hrow { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: end; gap: 10px; }
.hrow__bars { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 2px; height: 28px; }
.hbar { height: 100%; display: flex; align-items: flex-end; border-radius: 2px; background: color-mix(in srgb, var(--line) 45%, transparent); }
.hbar__fill { width: 100%; border-radius: 2px; background: var(--accent); }
.phases__axis { display: flex; justify-content: space-between; font-size: 11px; font-variant-numeric: tabular-nums; }
/* a phone: the peak goes under the value rather than squeezing the bar */
@media (max-width: 460px) {
  .row { grid-template-columns: 22px minmax(0, 1fr) 76px; }
  .row__p { grid-column: 3; text-align: right; margin-top: -6px; }
}
</style>
