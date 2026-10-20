<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StateFor } from '@kasbah/shared'
import { formatKm, formatPercent } from '../../lib/format'

/**
 * A vehicle's RANGE, shared by the Vehicles view card and a vehicle's panel
 * in the House view (like `ChargeLimitCard`): the battery in large, the kilometers, the gauge and
 * its marks — the charge target, and the desired floor when the vendor has that notion (the R5;
 * Tesla does not, and a single mark is then drawn).
 *
 * `limit`: the SHOWN target, which the parent makes follow the slider while it is dragged; by
 * default, the vehicle's. The mark only exists if the vehicle has a target.
 */
const props = defineProps<{ state: StateFor<'vehicle'>; limit?: number }>()
const { t, locale } = useI18n()
const EMPTY = '—'
/** Below this level, the gauge turns red (outside charging: a battery that is going up does not alarm). */
const LOW_SOC = 20

/**
 * Never read: a vehicle discovered ASLEEP has only delivered its standby so far, and its state carries the
 * contract's defaults (0 %, 0 km). Displaying them would read as an empty battery; "—" tells the truth.
 * A real vehicle at 0 % would at least have a mileage or a position.
 */
const unread = computed(() => {
  const s = props.state
  return s.soc === 0 && s.rangeKm === 0 && s.odometerKm === undefined && s.location === undefined
})
const target = computed(() => props.limit ?? props.state.chargeLimit)
</script>

<template>
  <div class="battery">
    <div class="battery__head">
      <div class="battery__soc">{{ unread ? EMPTY : formatPercent(state.soc, locale) }}</div>
      <div class="battery__range">
        <div class="battery__km">{{ unread ? EMPTY : formatKm(state.rangeKm, locale) }}</div>
        <div class="muted battery__k">{{ t('vehicle.range') }}</div>
      </div>
    </div>
    <div class="battery__bar">
      <!-- while charging, a glint runs along the fill: active charging is seen at a glance -->
      <div class="battery__fill" :data-charging="state.charging ? '1' : '0'"
           :data-low="!state.charging && state.soc < LOW_SOC ? '1' : '0'" :style="{ width: `${state.soc}%` }" />
      <span v-if="state.socMin !== undefined" class="soc__tick" :style="{ left: `${state.socMin}%` }"
            :title="t('vehicle.floorMark', { percent: formatPercent(state.socMin, locale) })" />
      <span v-if="state.chargeLimit !== undefined && target !== undefined" class="soc__tick" :style="{ left: `${target}%` }"
            :title="t('vehicle.targetMark', { percent: formatPercent(target, locale) })" />
    </div>
  </div>
</template>

<style scoped>
.battery { display: grid; gap: 10px; }
.battery__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.battery__soc { font-size: 40px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.battery__range { text-align: right; }
.battery__km { font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums; }
.battery__k { font-size: 11px; }
/* no `overflow: hidden`: the marks OVERFLOW the gauge, that is what makes them readable.
   The fill has its own rounding, it never needed to be cropped. */
.battery__bar { position: relative; height: 8px; border-radius: 999px; background: var(--line); }
.battery__fill { position: relative; height: 100%; background: var(--accent); border-radius: 999px; transition: width .4s, background .2s; }
.battery__fill[data-low='1'] { background: rgb(var(--v-theme-error)); }
/* the glint is cropped to the fill, not to the gauge: the marks always overflow */
.battery__fill[data-charging='1'] { overflow: hidden; }
.battery__fill[data-charging='1']::after {
  content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / .65), transparent);
  animation: battery-flow 1.8s ease-in-out infinite;
}
@keyframes battery-flow { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .battery__fill[data-charging='1']::after { animation: none; } }
/* Limit marks: the line of a cover's FAVORITE POSITION (see `.cover-slider` in
   app.css), but shorter — and placed OVER the gauge, which has no thumb to hide it. */
.soc__tick {
  position: absolute; top: 50%; width: 3px; height: 16px; border-radius: 2px;
  transform: translate(-50%, -50%); background: rgb(var(--v-theme-warning));
}
</style>
