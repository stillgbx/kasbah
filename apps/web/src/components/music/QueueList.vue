<script setup lang="ts">
import type { MusicQueue } from '../../api/transport'
import { formatClock } from '../../composables/useMediaPosition'
import MusicItemRow from './MusicItemRow.vue'

// La file du lecteur choisi : ce qui joue, ce qui suit. Affichée à la place de la zone centrale, quelle
// que soit la source (YouTube Music, Mixcloud, Radios) : la touche File de la barre l'ouvre partout.
defineProps<{
  queue: MusicQueue | null
  /** Titres qui attendent après le courant. */
  waiting: number
  /** Le titre courant joue (son point pulse) ; en pause, il reste immobile. */
  pulsing: boolean
  /** Le lecteur choisi peut recevoir une lecture. */
  canPlay: boolean
  /** Rang du titre en cours d'envoi (sablier sur sa ligne). */
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
