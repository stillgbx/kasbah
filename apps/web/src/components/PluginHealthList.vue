<script setup lang="ts">
import { computed } from 'vue'
import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiLinkVariantOff, mdiMinusCircleOutline, mdiProgressWrench } from '@mdi/js'
import type { PluginHealth } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'

const devices = useDevicesStore()
const plugins = computed(() => Object.entries(devices.health?.plugins ?? {}).sort(([a], [b]) => a.localeCompare(b)))
const ICON: Record<PluginHealth['status'], { icon: string; color: string }> = {
  ok: { icon: mdiCheckCircleOutline, color: 'success' },
  degraded: { icon: mdiAlertCircleOutline, color: 'warning' },
  needs_pairing: { icon: mdiLinkVariantOff, color: 'warning' },
  error: { icon: mdiAlertCircleOutline, color: 'error' },
  not_implemented: { icon: mdiProgressWrench, color: 'on-surface-variant' },
  disabled: { icon: mdiMinusCircleOutline, color: 'on-surface-variant' },
}
</script>

<template>
  <v-list density="comfortable" bg-color="transparent">
    <v-list-item v-for="[id, h] in plugins" :key="id" rounded="lg">
      <template #prepend><v-icon :icon="ICON[h.status].icon" :color="ICON[h.status].color" /></template>
      <v-list-item-title class="text-capitalize">{{ id.replace('_', ' ') }}</v-list-item-title>
      <v-list-item-subtitle>
        {{ $t(`settings.pluginStatus.${h.status}`) }}<span v-if="h.deviceCount"> · {{ $t('settings.devicesCount', { n: h.deviceCount }, h.deviceCount) }}</span>
        <span v-if="h.detail" class="text-medium-emphasis"> · {{ h.detail }}</span>
      </v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="plugins.length === 0"><v-list-item-title class="text-medium-emphasis">{{ $t('common.loading') }}</v-list-item-title></v-list-item>
  </v-list>
</template>
