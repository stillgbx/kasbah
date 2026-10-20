<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StateFor } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'

// The four tyre pressures, shared by the Vehicles view's card and the 3D panel. A wheel the car
// itself flags (`tireWarning`, the `tire_low` alert) takes the warning colour, and the title gets
// the alert mark: both fit in place, nothing moves when the warning comes or goes.

const props = defineProps<{ state: StateFor<'vehicle'> }>()
const { t, locale } = useI18n()

/** In the order you look at a car from above. */
const TIRES = ['fl', 'fr', 'rl', 'rr'] as const

const value = (k: (typeof TIRES)[number]) => {
  const v = props.state.tirePressureBar?.[k]
  return v === undefined ? '—' : `${new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} bar`
}
const warned = computed(() => TIRES.filter((k) => props.state.tireWarning?.[k]))
const level = computed(() => warned.value.some((k) => props.state.tireWarning?.[k] === 'hard') ? 'hard' : warned.value.length ? 'soft' : undefined)
const alertText = computed(() => warned.value.length ? t('alerts.tireLow', { tires: warned.value.map((k) => t(`vehicle.tire.${k}`)).join(', ') }) : undefined)
</script>

<template>
  <!-- four wheels, four fixed cells -->
  <div class="card card--soft tires">
    <StrokeIcon class="wm" name="tire" :size="56" />
    <div class="muted tires__title">
      <span>{{ $t('vehicle.tires') }}</span>
      <span v-if="level" class="tires__alert" :data-warn="level" role="img" :aria-label="alertText" :title="alertText"><StrokeIcon name="alert" :size="12" /></span>
    </div>
    <div class="tires__grid">
      <div v-for="k in TIRES" :key="k" class="tire"><span class="muted tire__k">{{ $t(`vehicle.tire.${k}`) }}</span><span class="tire__v" :data-warn="state.tireWarning?.[k]">{{ value(k) }}</span></div>
    </div>
  </div>
</template>

<style scoped>
/* Section watermark, as on the Vehicles view's sections: monochrome, very pale, cropped at the
   bottom right, under the text (`isolation` keeps the `z-index: -1` inside the section). */
.tires { position: relative; overflow: hidden; isolation: isolate; padding: 10px 12px; display: grid; gap: 6px; }
.wm { position: absolute; right: -8px; bottom: -8px; z-index: -1; color: var(--text); opacity: .07; pointer-events: none; }
/* a fixed-height title row: the alert mark appears without pushing anything */
.tires__title { display: flex; align-items: center; gap: 4px; height: 16px; font-size: 11px; }
.tires__alert { display: inline-flex; }
.tires__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.tire { display: grid; gap: 2px; min-width: 0; font-variant-numeric: tabular-nums; }
.tire__k { font-size: 11px; }
.tire__v { font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* the car's tyre warning: the warning orange, darkened in light theme for contrast like the pet
   cards; red when much lower */
[data-warn='soft'] { color: rgb(var(--v-theme-warning)); }
html[data-theme='light'] [data-warn='soft'] { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, black); }
[data-warn='hard'] { color: rgb(var(--v-theme-error)); }
</style>
