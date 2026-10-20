<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatFlow, formatPercent, formatVolume, waterAlertState } from '../../lib/format'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Card of a water treatment station (COMAP Proteo): read only, like the weather — no
// command is offered (see `waterStateSchema`). Each line keeps its place whether its capability
// is declared or not: the sections follow the capabilities, but within a displayed section, a
// value not yet read shows a dash rather than disappearing ("nothing moves").
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'water'>; pending?: boolean; disabled?: boolean }>()
const { t, locale } = useI18n()

const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const showConsumables = computed(() => has('consumables'))
const showUvLamp = computed(() => has('uv_lamp'))
const showUsage = computed(() => has('water_flow') || has('water_usage'))

/** 100 = new; below this threshold, the consumable gets noticed (same marker as `battery < 20`). */
const LOW_PCT = 20
const pctText = (v?: number) => (v !== undefined ? formatPercent(v, locale.value) : '—')
const isLow = (v?: number) => v !== undefined && v < LOW_PCT

const alert = computed(() => waterAlertState(props.state))
const alertIcon = computed(() => (alert.value === 'ok' ? 'checkCircle' : alert.value === 'unknown' ? 'minusCircle' : 'alert'))
const alertText = computed(() => {
  switch (alert.value) {
    case 'ok': return t('water.noAlert')
    case 'warning': return t('water.warning')
    case 'defect': return t('water.defect')
    default: return t('common.unknown')
  }
})
</script>

<template>
  <div class="water">
    <template v-if="showConsumables">
      <div class="line">
        <StrokeIcon name="filtration" :size="16" />
        <span class="line__text">{{ $t('water.prefilter') }}</span>
        <span class="line__pct" :class="{ 'text-error': isLow(state.prefilterPct) }">{{ pctText(state.prefilterPct) }}</span>
      </div>
      <div class="line">
        <StrokeIcon name="filtration" :size="16" />
        <span class="line__text">{{ $t('water.carbon1') }}</span>
        <span class="line__pct" :class="{ 'text-error': isLow(state.carbon1Pct) }">{{ pctText(state.carbon1Pct) }}</span>
      </div>
      <div class="line">
        <StrokeIcon name="filtration" :size="16" />
        <span class="line__text">{{ $t('water.carbon2') }}</span>
        <span class="line__pct" :class="{ 'text-error': isLow(state.carbon2Pct) }">{{ pctText(state.carbon2Pct) }}</span>
      </div>
      <div v-if="showUvLamp" class="line">
        <StrokeIcon name="sun" :size="16" />
        <span class="line__text">{{ $t('water.uvLamp') }}</span>
        <span class="uv" :data-on="state.uvOn === undefined ? 'unknown' : state.uvOn ? '1' : '0'">
          <span class="uv__dot" />{{ state.uvOn === undefined ? '—' : state.uvOn ? $t('water.uvOn') : $t('water.uvOff') }}
        </span>
        <span class="line__pct" :class="{ 'text-error': isLow(state.uvLampPct) }">{{ pctText(state.uvLampPct) }}</span>
      </div>
    </template>

    <div v-if="showConsumables && showUsage" class="sep" />

    <template v-if="showUsage">
      <div v-if="has('water_flow')" class="line">
        <StrokeIcon name="waves" :size="16" />
        <span class="line__text">{{ $t('water.flow') }}</span>
        <span class="line__num">{{ state.flowLph !== undefined ? formatFlow(state.flowLph, locale) : '—' }}</span>
      </div>
      <template v-if="has('water_usage')">
        <div class="line">
          <StrokeIcon name="droplet" :size="16" />
          <span class="line__text">{{ $t('water.today') }}</span>
          <span class="line__num">{{ state.todayL !== undefined ? formatVolume(state.todayL, locale) : '—' }}</span>
        </div>
        <div class="line">
          <StrokeIcon name="droplet" :size="16" />
          <span class="line__text">{{ $t('water.month') }}</span>
          <span class="line__num">{{ state.monthL !== undefined ? formatVolume(state.monthL, locale) : '—' }}</span>
        </div>
      </template>
    </template>

    <div class="sep" />

    <div class="line" :data-alert="alert">
      <StrokeIcon :name="alertIcon" :size="16" />
      <span class="line__text">{{ alertText }}</span>
    </div>
  </div>
</template>

<style scoped>
.water { display: grid; gap: 2px; }
.sep { height: 1px; margin: 8px 0; background: var(--line); }
.line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); height: 28px; }
.line__text { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); }
/* fixed width: the percentage or the number does not make the column tremble when it changes. */
.line__pct, .line__num { flex: 0 0 auto; text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
/* 9ch: percentages never exceed "100 %". */
.line__pct { min-width: 9ch; }
/* 17ch: flow and volumes now display liters AND m³ side by side ("612 L/h · 0.61 m³/h"),
   and the volume's m³ complement only appears beyond 1,000 L (see formatVolume) — the reserve
   covers the worst measured case (monthly volume at 7 digits: "1,234,567 L · 1,234.57 m³" ≈ 15.9ch
   rendered, EN a bit wider than FR) so that the complement appearing/disappearing never makes
   the column move. Measured to the pixel (not a round figure): the narrow 3D scene panel
   (294px wide) leaves only 262px to label+value once the icon and the two spacings
   are removed — a wider reserve (tried 24ch) truncates "Today"/"This month". */
.line__num { min-width: 17ch; }
.line[data-alert='warning'] { color: rgb(var(--v-theme-warning)); }
.line[data-alert='warning'] .line__text { color: inherit; }
.line[data-alert='defect'] { color: rgb(var(--v-theme-error)); }
.line[data-alert='defect'] .line__text { color: inherit; }
.line[data-alert='ok'] .line__text { color: inherit; }
/* the lamp: dot (fixed footprint, does not pulse — it is a state, not an action in progress) and word,
   width reserved for the longer of the two (FR "allumée"/"éteinte", EN "on"/"off") */
.uv { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; min-width: 9ch; font-size: 12px; color: var(--muted); }
/* fixed footprint (7x7, border included): on = solid green pill, off = solid
   muted pill (visible, normal operation), unknown = hollow ring — visually
   distinct from off, never confused with it. `--line` (separators, ~1.1:1) only served
   to disappear. */
.uv__dot { width: 7px; height: 7px; border-radius: 50%; box-sizing: border-box; background: var(--muted); flex: 0 0 auto; }
.uv[data-on='1'] .uv__dot { background: rgb(var(--v-theme-success)); }
.uv[data-on='1'] { color: rgb(var(--v-theme-success)); }
.uv[data-on='unknown'] .uv__dot { background: transparent; border: 1px dashed var(--muted); }
</style>

<!--
  Unscoped block: `:global(html[data-theme='light']) .line[...]` (the pattern already used in
  HomeView.vue/VehicleMap.vue) actually compiles to `html[data-theme='light'] { … }` on its own —
  the scoped descendant disappears in the transformation. Checked by reading the compiled CSS served by
  Vite (`?vue&type=style&lang.css`). `.water` is a class name specific to this card: the scope
  stays local in practice, here in the clear: the raw `warning` token falls to 2.81:1 on a white
  panel — 13 px text, below the AA threshold of 4.5:1 (it is the only place in the app that sets this
  token as text, elsewhere it is a background or a border). Darkened, it stays amber but readable
  (~5.3:1 measured); the dark theme, already compliant, is not touched.
-->
<style>
html[data-theme='light'] .water .line[data-alert='warning'] { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, black); }
</style>
