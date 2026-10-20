<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatSensor } from '../../lib/format'
import DeviceIcon from '../DeviceIcon.vue'
import LightHistoryChart from './LightHistoryChart.vue'

// Two roots (nothing to inherit): the dispatch passes `@command` and `relay-from` to all the controls, useless here
defineOptions({ inheritAttrs: false })
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'sensor'>; pending?: boolean; disabled?: boolean }>()
const { d } = useI18n()
/**
 * Panel of a solar shutter: its history is kept by the server (see `LightHistoryChart`).
 * Computed, not read once: the panel keeps this component from one sensor to another.
 */
const hasLightHistory = computed(() => props.descriptor.meta.sensor?.deviceClass === 'illuminance' && !!props.descriptor.meta.linkedTo)
</script>

<template>
  <div class="d-flex align-center ga-4">
    <DeviceIcon :descriptor="descriptor" :state="state" :size="40" />
    <div>
      <div class="text-h4 font-weight-medium">{{ formatSensor(descriptor, state.value, $i18n.locale) }}</div>
      <div class="text-caption text-medium-emphasis">{{ $t('device.lastUpdate', { time: d(new Date(state.updatedAt), 'time') }) }}</div>
    </div>
  </div>
  <LightHistoryChart v-if="hasLightHistory" :descriptor="descriptor" :state="state" />
</template>
