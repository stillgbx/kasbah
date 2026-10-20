<script setup lang="ts">
import { computed } from 'vue'
import { useAppUpdateStore } from '../stores/appUpdate'
import { useDevicesStore } from '../stores/devices'

// Pill at the bottom: a new version is being served. Not at the top like the connection one: it is
// clickable and would hide the level selector there until the page is reloaded; and above the
// home search bar (16 px from the bottom, 44 tall). Shown only online (reloading offline would
// lead nowhere). Overlaid: nothing moves beneath it.
const update = useAppUpdateStore()
const devices = useDevicesStore()
const visible = computed(() => update.available && devices.connection === 'online')
</script>

<template>
  <v-slide-y-reverse-transition>
    <div v-if="visible" class="update-banner bg-primary" role="status">
      <v-icon icon="rotateRight" size="18" class="mr-2" />
      <span class="update-banner__text">{{ $t('appUpdate.available') }}</span>
      <v-btn variant="tonal" size="small" class="ml-3" @click="update.reload()">{{ $t('appUpdate.reload') }}</v-btn>
    </div>
  </v-slide-y-reverse-transition>
</template>

<style scoped>
.update-banner {
  position: absolute; bottom: calc(max(var(--dock-h), var(--safe-bottom)) + 72px); left: 50%; transform: translateX(-50%);
  display: inline-flex; align-items: center; padding: 4px 6px 4px 14px; border-radius: 999px; white-space: nowrap;
  max-width: calc(100vw - 32px);
  font-size: 13px; font-weight: 500; z-index: 2000; box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
}
/* narrow or zoomed screen: the text is shortened, the button stays whole */
.update-banner__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.update-banner :deep(.v-btn) { flex-shrink: 0; }
</style>
