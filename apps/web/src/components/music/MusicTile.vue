<script setup lang="ts">
import type { IconName } from '../../lib/strokeIcons'
import ArtThumb from '../ui/ArtThumb.vue'
import ExplicitBadge from '../ui/ExplicitBadge.vue'
import ArtPlay from './ArtPlay.vue'

// Tuile de la recherche simple : grande pochette, deux lignes de texte de hauteur fixe. Un artiste
// ou un album s'ouvre (toute la tuile) et, `playable`, se joue aussi ; un titre se joue. La lecture
// est un cercle au milieu de la pochette, révélé au survol (toujours là sur un écran tactile).
// La racine est un `div` : un bouton de lecture ne peut pas vivre dans un `<button>`.
const props = withDefaults(defineProps<{
  art: string | null
  icon?: IconName
  round?: boolean
  title: string
  /** Marqué explicit par le catalogue : le « E » suit le titre, comme sur les lignes. */
  explicit?: boolean
  meta?: string
  action: 'open' | 'play'
  /** Une tuile qui s'ouvre (album, artiste) peut aussi se jouer d'un geste. */
  playable?: boolean
  busy?: boolean
  disabled?: boolean
  playLabel?: string
}>(), { icon: 'music', round: false, explicit: false, meta: '', playable: false, busy: false, disabled: false, playLabel: undefined })
const emit = defineEmits<{ open: []; play: [] }>()
const open = () => { if (props.action === 'open') emit('open') }
</script>

<template>
  <div class="tile" :class="{ 'tile--open': action === 'open' }" :role="action === 'open' ? 'button' : undefined"
       :tabindex="action === 'open' ? 0 : undefined" @click="open" @keydown.enter.self="open" @keydown.space.self.prevent="open">
    <div class="tile__art" :class="{ 'tile__art--round': round }">
      <ArtThumb :src="art" :icon="icon" :round="round" :size="128" />
      <ArtPlay v-if="action === 'play' || playable" :size="48" :disabled="disabled" :busy="busy" :label="playLabel" @click="$emit('play')" />
    </div>
    <div class="tile__line1">
      <div class="tile__title">{{ title }}</div>
      <ExplicitBadge v-if="explicit" />
    </div>
    <div class="tile__meta muted">{{ meta || '\u00a0' }}</div>
  </div>
</template>

<style scoped>
.tile {
  width: 128px; flex: 0 0 auto; display: grid; gap: 4px; padding: 0; border: 0; background: transparent;
  color: inherit; text-align: left; font: inherit; cursor: default; scroll-snap-align: start;
}
.tile--open { cursor: pointer; }
.tile--open:hover .tile__title { color: var(--accent); }
.tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 10px; }
.tile__art { position: relative; width: 128px; height: 128px; border-radius: 10px; overflow: hidden; }
.tile__art--round { border-radius: 999px; }
/* le badge ne décale rien : même hauteur que la ligne de titre, le titre se raccourcit pour lui */
.tile__line1 { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 4px; }
.tile__title { flex: 1 1 auto; min-width: 0; font-size: 13.5px; font-weight: 500; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile__meta { font-size: 12px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* la lecture n'encombre la rangée qu'au survol ; pendant l'envoi elle reste, avec son sablier */
@media (hover: hover) {
  .tile :deep(.art-play) { opacity: 0; }
  .tile:hover :deep(.art-play), .tile:focus-within :deep(.art-play), .tile :deep(.art-play[aria-busy='true']) { opacity: 1; }
}
</style>
