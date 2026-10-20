<script setup lang="ts">
import type { IconName } from '../../lib/strokeIcons'
import ArtThumb from '../ui/ArtThumb.vue'
import ExplicitBadge from '../ui/ExplicitBadge.vue'
import { artAt } from '../../lib/artUrl'
import ArtPlay from './ArtPlay.vue'

// Tile of the simple search: large cover art, two lines of fixed-height text. An artist
// or an album opens (the whole tile) and, `playable`, also plays; a track plays. Playback
// is a circle in the middle of the cover art, revealed on hover (always there on a touch screen).
// The root is a `div`: a play button cannot live inside a `<button>`.
const props = withDefaults(defineProps<{
  art: string | null
  icon?: IconName
  round?: boolean
  title: string
  /** Flagged explicit by the catalog: the "E" follows the title, as on the rows. */
  explicit?: boolean
  meta?: string
  action: 'open' | 'play'
  /** A tile that opens (album, artist) can also be played with one gesture. */
  playable?: boolean
  busy?: boolean
  disabled?: boolean
  playLabel?: string
  /** Small label set on the cover art, bottom right (duration of a mix). */
  badge?: string
}>(), { icon: 'music', round: false, explicit: false, meta: '', playable: false, busy: false, disabled: false, playLabel: undefined, badge: '' })
const emit = defineEmits<{ open: []; play: [] }>()
const open = () => { if (props.action === 'open') emit('open') }
</script>

<template>
  <div class="tile" :class="{ 'tile--open': action === 'open' }" :role="action === 'open' ? 'button' : undefined"
       :tabindex="action === 'open' ? 0 : undefined" @click="open" @keydown.enter.self="open" @keydown.space.self.prevent="open">
    <div class="tile__art" :class="{ 'tile__art--round': round }">
      <!-- the tile is 128 px, the catalog cover art 120: it is requested again at double size, sharp on a dense screen -->
      <ArtThumb :src="artAt(art, 256)" :icon="icon" :round="round" :size="128" />
      <span v-if="badge" class="tile__badge">{{ badge }}</span>
      <ArtPlay v-if="action === 'play' || playable" :size="48" :disabled="disabled" :busy="busy" :label="playLabel" @click="$emit('play')" />
    </div>
    <div class="tile__line1">
      <div class="tile__title">{{ title }}</div>
      <ExplicitBadge v-if="explicit" />
    </div>
    <div class="tile__meta muted">{{ meta || '\u00a0' }}</div>
    <slot name="extra" />
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
/* on the cover art: it takes no space from the text, and is not truncated with it */
.tile__badge {
  position: absolute; right: 6px; bottom: 6px; z-index: 1; padding: 1px 6px; border-radius: 6px;
  background: rgb(0 0 0 / 0.68); color: #fff; font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums; pointer-events: none;
}
/* the badge shifts nothing: same height as the title line, the title shortens for it */
.tile__line1 { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 4px; }
.tile__title { flex: 1 1 auto; min-width: 0; font-size: 13.5px; font-weight: 500; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile__meta { font-size: 12px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* playback only clutters the row on hover; while sending it stays, with its hourglass */
@media (hover: hover) {
  .tile :deep(.art-play) { opacity: 0; }
  .tile:hover :deep(.art-play), .tile:focus-within :deep(.art-play), .tile :deep(.art-play[aria-busy='true']) { opacity: 1; }
}
</style>
