<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor, DeviceState } from '@kasbah/shared'
import { deviceColor, deviceIcon } from '../lib/deviceIcons'

const props = withDefaults(defineProps<{ descriptor?: DeviceDescriptor; state?: DeviceState; size?: number | string }>(), { descriptor: undefined, state: undefined, size: 24 })
const icon = computed(() => deviceIcon(props.descriptor, props.state))
const color = computed(() => deviceColor(props.state))
</script>

<template>
  <v-icon :icon="icon" :size="size" :color="color" :class="{ 'opacity-50': state && !state.available }" />
</template>
