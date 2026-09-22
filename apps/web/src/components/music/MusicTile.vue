<script setup lang="ts">
import type { IconName } from '../../lib/strokeIcons'
import ArtThumb from '../ui/ArtThumb.vue'
import PlayButton from '../ui/PlayButton.vue'

// Tuile de la recherche simple : grande pochette, deux lignes de texte de hauteur fixe. Un artiste
// ou un album s'ouvre (toute la tuile) ; un titre se joue (bouton posé sur la pochette).
withDefaults(defineProps<{
  art: string | null
  icon?: IconName
  round?: boolean
  title: string
  meta?: string
  action: 'open' | 'play'
  busy?: boolean
  disabled?: boolean
  playLabel?: string
}>(), { icon: 'music', round: false, meta: '', busy: false, disabled: false, playLabel: undefined })
defineEmits<{ open: []; play: [] }>()
</script>

<template>
  <component :is="action === 'open' ? 'button' : 'div'" :type="action === 'open' ? 'button' : undefined"
             class="tile" :class="{ 'tile--open': action === 'open' }" @click="action === 'open' && $emit('open')">
    <div class="tile__art">
      <ArtThumb :src="art" :icon="icon" :round="round" :size="128" />
      <PlayButton v-if="action === 'play'" class="tile__play" :disabled="disabled" :busy="busy" :label="playLabel" @click="$emit('play')" />
    </div>
    <div class="tile__title">{{ title }}</div>
    <div class="tile__meta muted">{{ meta || '\u00a0' }}</div>
  </component>
</template>

<style scoped>
.tile {
  width: 128px; flex: 0 0 auto; display: grid; gap: 4px; padding: 0; border: 0; background: transparent;
  color: inherit; text-align: left; font: inherit; cursor: default; scroll-snap-align: start;
}
.tile--open { cursor: pointer; }
.tile--open:hover .tile__title { color: var(--accent); }
.tile__art { position: relative; width: 128px; height: 128px; border-radius: 10px; overflow: hidden; }
.tile__play { position: absolute; right: 8px; bottom: 8px; box-shadow: var(--shadow); }
.tile__title { font-size: 13.5px; font-weight: 500; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
.tile__meta { font-size: 12px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
