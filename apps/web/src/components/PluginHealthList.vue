<script setup lang="ts">
import { computed } from 'vue'
import type { PluginHealth } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'

const devices = useDevicesStore()
const plugins = computed(() => Object.entries(devices.health?.plugins ?? {}).sort(([a], [b]) => a.localeCompare(b)))
const ICON: Record<PluginHealth['status'], { icon: string; color: string }> = {
  ok: { icon: 'checkCircle', color: 'success' },
  degraded: { icon: 'alert', color: 'warning' },
  needs_pairing: { icon: 'linkOff', color: 'warning' },
  error: { icon: 'alert', color: 'error' },
  not_implemented: { icon: 'wrench', color: 'on-surface-variant' },
  disabled: { icon: 'minusCircle', color: 'on-surface-variant' },
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
