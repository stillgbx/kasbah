<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatTemp } from '../../lib/format'
import { compassPoint, conditionIcon } from '../../lib/weather'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Carte d'un appareil météo dans le panneau détail : l'essentiel de l'actuel et le crédit de la
// source. La vue Météo, elle, montre tout (prévisions, air, soleil).
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'weather'>; pending?: boolean; disabled?: boolean }>()
const { d, locale } = useI18n()
const icon = computed(() => conditionIcon(props.state.condition, props.state.isDay))
const nf = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))
</script>

<template>
  <div class="d-flex flex-column ga-3">
    <div class="d-flex align-center ga-4">
      <StrokeIcon :name="icon" :size="40" />
      <div>
        <div class="text-h4 font-weight-medium">{{ formatTemp(state.tempC, locale) }}</div>
        <div class="text-body-2">{{ $t(`weather.conditions.${state.condition}`) }}</div>
        <div class="text-caption text-medium-emphasis">
          {{ $t('weather.wind') }} {{ nf.format(state.windKmh) }} km/h {{ compassPoint(state.windDirDeg) }} · {{ $t('weather.humidity') }} {{ nf.format(state.humidity) }} %
        </div>
      </div>
    </div>
    <div class="text-caption text-medium-emphasis">
      {{ $t('weather.observed', { time: d(new Date(state.observedAt), 'time') }) }}
      <template v-if="descriptor.meta.weather"> · {{ $t('weather.attribution', { source: descriptor.meta.weather.attribution }) }}</template>
    </div>
  </div>
</template>
