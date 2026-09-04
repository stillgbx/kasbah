<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatSensor } from '../../lib/format'
import DeviceIcon from '../DeviceIcon.vue'

defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'sensor'>; pending?: boolean; disabled?: boolean }>()
const { d } = useI18n()
</script>

<template>
  <div class="d-flex align-center ga-4">
    <DeviceIcon :descriptor="descriptor" :state="state" :size="40" />
    <div>
      <div class="text-h4 font-weight-medium">{{ formatSensor(descriptor, state.value, $i18n.locale) }}</div>
      <div class="text-caption text-medium-emphasis">{{ $t('device.lastUpdate', { time: d(new Date(state.updatedAt), 'time') }) }}</div>
    </div>
  </div>
</template>
