<script setup lang="ts">
import { ref, watch } from 'vue'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'media_player'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const volume = ref(props.state.volume)
watch(() => props.state.volume, (v) => { volume.value = v })
const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const fmt = (s?: number) => (s === undefined ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)
</script>

<template>
  <div>
    <div class="now-playing mb-3">
      <template v-if="state.nowPlaying">
        <div class="text-subtitle-1 font-weight-medium text-truncate">{{ state.nowPlaying.title }}</div>
        <div class="text-body-2 text-medium-emphasis text-truncate">{{ state.nowPlaying.artist }}<span v-if="state.nowPlaying.album"> · {{ state.nowPlaying.album }}</span></div>
        <v-progress-linear v-if="state.nowPlaying.durationS" class="mt-2" rounded height="4" color="primary"
                           :model-value="((state.nowPlaying.positionS ?? 0) / state.nowPlaying.durationS) * 100" />
        <div class="d-flex justify-space-between text-caption text-medium-emphasis mt-1">
          <span>{{ fmt(state.nowPlaying.positionS) }}</span><span>{{ fmt(state.nowPlaying.durationS) }}</span>
        </div>
      </template>
      <div v-else class="text-body-2 text-medium-emphasis">{{ $t('media.nothing') }} · {{ $t(`media.${state.playback}`) }}</div>
    </div>
    <div class="d-flex align-center justify-center ga-3 mb-3">
      <v-btn v-if="has('track_skip')" icon="skipPrev" variant="tonal" size="large" :disabled="disabled" @click="emit('command', { type: 'media_player.previous' })" />
      <v-btn :icon="state.playback === 'playing' ? 'pause' : 'play'" color="primary" size="x-large" :disabled="disabled"
             @click="emit('command', { type: state.playback === 'playing' ? 'media_player.pause' : 'media_player.play' })" />
      <v-btn v-if="has('track_skip')" icon="skipNext" variant="tonal" size="large" :disabled="disabled" @click="emit('command', { type: 'media_player.next' })" />
    </div>
    <div v-if="has('volume')" class="d-flex align-center ga-2">
      <v-btn v-if="has('mute')" :icon="state.muted ? 'volumeOff' : 'volume'" variant="text" :disabled="disabled"
             @click="emit('command', { type: 'media_player.set_mute', muted: !state.muted })" />
      <v-slider v-model="volume" class="flex-grow-1" :min="0" :max="100" :step="1" :disabled="disabled || state.muted"
                @end="(v: number) => emit('command', { type: 'media_player.set_volume', volume: Math.round(v) })" />
      <span class="text-caption" style="width: 3ch; text-align: right">{{ Math.round(volume) }}</span>
    </div>
  </div>
</template>
