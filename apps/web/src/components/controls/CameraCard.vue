<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import DeviceIcon from '../DeviceIcon.vue'
import CameraVideo from './CameraVideo.vue'

// A camera's card: the live video when the camera serves a stream the server can relay
// (RTSP → fragmented MP4, see `CameraVideo.vue`), and what the vendor declares about it (kind, room,
// protocols). A WebRTC camera (recent generation, none in the house) is still awaiting its
// support: the card says so instead of promising a video.
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
