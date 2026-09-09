<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import DeviceIcon from '../DeviceIcon.vue'

// Carte d'une caméra : ce que le fabricant en déclare (nature, pièce, protocoles de flux). Le flux
// vidéo lui-même viendra dans une phase suivante ; d'ici là la carte annonce ce qui sera possible.
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'camera'>; pending?: boolean; disabled?: boolean }>()
const camera = computed(() => props.descriptor.meta.camera)
const protocols = computed(() => camera.value?.protocols ?? [])
</script>

<template>
  <div class="d-flex flex-column ga-3">
    <div class="d-flex align-center ga-4">
      <DeviceIcon :descriptor="descriptor" :state="state" :size="40" />
      <div>
        <div class="text-h6 font-weight-medium">{{ $t(`camera.classes.${camera?.deviceClass ?? 'camera'}`) }}</div>
        <div class="text-caption text-medium-emphasis">
          <template v-if="descriptor.meta.room">{{ $t('camera.vendorRoom', { room: descriptor.meta.room }) }} · </template>
          <template v-if="descriptor.capabilities.includes('chime')">{{ $t('camera.chime') }} · </template>
          <span v-if="descriptor.capabilities.includes('live_stream')">{{ $t('camera.stream', { protocols: protocols.map((p) => $t(`camera.protocols.${p}`)).join(', ') || '—' }) }}</span>
          <span v-else>{{ $t('camera.noStream') }}</span>
        </div>
      </div>
    </div>
    <div class="text-caption text-medium-emphasis">{{ $t('camera.videoLater') }}</div>
  </div>
</template>
