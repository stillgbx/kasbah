<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatSensor } from '../../lib/format'
import DeviceIcon from '../DeviceIcon.vue'
import LightHistoryChart from './LightHistoryChart.vue'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'sensor'>; pending?: boolean; disabled?: boolean }>()
const { d } = useI18n()
/**
 * Panneau d'un volet solaire : son historique est tenu par le serveur (voir `LightHistoryChart`).
 * Calculé, pas lu une fois : le panneau garde ce composant d'un capteur à l'autre.
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
