<script setup lang="ts">
import type { MusicQueue } from '../../api/transport'
import { formatClock } from '../../composables/useMediaPosition'
import MusicItemRow from './MusicItemRow.vue'

// The queue of the chosen player: what is playing, what follows. Displayed in place of the
// central area, whatever the source (YouTube Music, Mixcloud, Radios): the bar's Queue button
// opens it everywhere.
defineProps<{
  queue: MusicQueue | null
  /** Tracks waiting after the current one. */
  waiting: number
  /** The current track is playing (its dot pulses); when paused, it stays still. */
  pulsing: boolean
  /** The chosen player can receive a playback. */
  canPlay: boolean
  /** Rank of the track being sent (hourglass on its row). */
  busyIndex: number | null
}>()
defineEmits<{ play: [index: number]; remove: [index: number] }>()
</script>

<template>
  <div class="list queue-list">
    <template v-if="queue">
      <MusicItemRow v-for="(qt, i) in queue.items" :key="`${i}:${qt.source}:${qt.id}`" action="play" removable :position="i + 1" :art="qt.artUrl ?? null" :title="qt.title ?? qt.id"
                    :explicit="!!qt.explicit" :meta="qt.artist ?? ''" :dur="formatClock(qt.durationS)" :selected="i === queue.index" :playing="i === queue.index && pulsing"
                    :disabled="!canPlay" :busy="busyIndex === i" :play-label="$t('ytmusic.play')"
                    @play="$emit('play', i)" @remove="$emit('remove', i)" />
      <p v-if="waiting <= 0" class="muted empty">{{ $t('music.queueNothingNext') }}</p>
    </template>
    <p v-else class="muted empty">{{ $t('music.queueEmpty') }}</p>
  </div>
</template>

<style scoped>
.list { display: grid; gap: 2px; }
.empty { padding: 16px 4px; }
</style>
