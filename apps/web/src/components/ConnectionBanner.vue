<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDevicesStore } from '../stores/devices'

// Discreet banner at the top: visible only when the server link is not nominal.
const devices = useDevicesStore()
// no flicker on load: the initial connection is only reported after 1.5 s
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
watch(() => devices.connection, (s) => {
  if (timer) clearTimeout(timer)
  if (s === 'online') { visible.value = false; return }
  timer = setTimeout(() => { visible.value = true }, s === 'connecting' ? 1500 : 0)
}, { immediate: true })
const color = computed(() => (devices.connection === 'offline' ? 'error' : 'warning'))
const icon = computed(() => (devices.connection === 'offline' ? 'linkOff' : 'dots'))
</script>

<template>
  <v-slide-y-transition>
    <div v-if="visible" class="conn-banner" :class="`bg-${color}`" role="status">
      <v-icon :icon="icon" size="18" class="mr-2" />
      <span>{{ $t(`connection.${devices.connection}`) }}</span>
    </div>
  </v-slide-y-transition>
</template>

<style scoped>
.conn-banner {
  position: absolute; top: calc(var(--safe-top) + 8px); left: 50%; transform: translateX(-50%);
  display: inline-flex; align-items: center; padding: 6px 14px; border-radius: 999px;
  font-size: 13px; font-weight: 500; z-index: 2000; box-shadow: 0 2px 8px rgb(0 0 0 / 0.25); pointer-events: none;
}
</style>
