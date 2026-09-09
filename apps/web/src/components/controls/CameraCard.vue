<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import DeviceIcon from '../DeviceIcon.vue'
import CameraVideo from './CameraVideo.vue'

// Carte d'une caméra : la vidéo en direct quand la caméra sert un flux que le serveur sait relayer
// (RTSP → MP4 fragmenté, voir `CameraVideo.vue`), et ce que le fabricant en déclare (nature, pièce,
// protocoles). Une caméra WebRTC (génération récente, aucune dans la maison) attend encore sa
// prise en charge : la carte le dit au lieu de promettre une vidéo.
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'camera'>; pending?: boolean; disabled?: boolean }>()
const camera = computed(() => props.descriptor.meta.camera)
const protocols = computed(() => camera.value?.protocols ?? [])
const streamable = computed(() => props.descriptor.capabilities.includes('live_stream') && protocols.value.includes('rtsp'))
</script>

<template>
  <div class="d-flex flex-column ga-3">
    <CameraVideo v-if="streamable && state.available" :device-id="descriptor.id" />
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
    <div v-if="descriptor.capabilities.includes('live_stream') && !streamable" class="text-caption text-medium-emphasis">{{ $t('camera.video.webrtcLater') }}</div>
  </div>
</template>
