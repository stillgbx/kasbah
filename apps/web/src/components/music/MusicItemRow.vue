<script setup lang="ts">
import type { IconName } from '../../lib/strokeIcons'
import ArtThumb from '../ui/ArtThumb.vue'
import PulseDot from '../ui/PulseDot.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import ArtPlay from './ArtPlay.vue'

// Catalog row: cover art, title (+ explicit badge), meta, duration / year on the right, and one
// action — open (artist, album, playlist: the whole row opens) or play (track). Playback is
// a circle in the middle of the cover art; a row that opens can also be played (`playable`). Same
// heights everywhere: row 2 keeps its place even when empty (non-breaking space).
// A track can also join the queue (`queueable`: play next, add to the end) or leave it
// (`removable`): small buttons on the right. Playback and buttons only appear on HOVER of the
// row (always there on a touch screen, which has none); their place is kept — nothing moves.
// The root is a `div`: a play button cannot live inside a `<button>`.
// `artless` (tracks of an album: the same cover art everywhere): no thumbnail; as on YouTube
// Music, the number becomes ▶ on hover, and touching the row (touch screen) starts the track.
const props = withDefaults(defineProps<{
  art: string | null
  icon?: IconName
  round?: boolean
  title: string
  explicit?: boolean
  meta?: string
  /** Fixed column on the right of the meta (duration of a track). */
  dur?: string
  /** Last column (year). */
  year?: string | null
  action: 'open' | 'play'
  /** A row that opens (album, artist) can also be played with one gesture. */
  playable?: boolean
  busy?: boolean
  disabled?: boolean
  selected?: boolean
  playLabel?: string
  queueable?: boolean
  removable?: boolean
  /** Position in the queue (1, 2…): fixed column before the cover art. */
  position?: number | null
  /** No thumbnail: the number carries playback, the whole row plays. */
  artless?: boolean
  /** The track is playing right now on the chosen player: a dot pulses before it (place always kept). */
  playing?: boolean
}>(), { icon: 'music', round: false, explicit: false, meta: '', dur: '', year: null, busy: false, disabled: false, selected: false, playLabel: undefined, queueable: false, removable: false, playable: false, position: null, artless: false, playing: false })
const emit = defineEmits<{ open: []; play: []; playNext: []; addEnd: []; remove: [] }>()
const playsOnRow = () => props.artless && props.action === 'play'
function activate() {
  if (props.action === 'open') emit('open')
  else if (playsOnRow() && !props.disabled && !props.busy) emit('play')
}
</script>

<template>
  <div class="row" :class="{ 'row--open': action === 'open' || (artless && action === 'play' && !disabled), 'row--artless': artless }" :data-selected="selected ? '1' : '0'"
       :role="action === 'open' || playsOnRow() ? 'button' : undefined" :tabindex="action === 'open' || playsOnRow() ? 0 : undefined"
       :aria-label="playsOnRow() ? playLabel : undefined"
       @click="activate" @keydown.enter.self="activate" @keydown.space.self.prevent="activate">
    <span v-if="position != null && !artless" class="pos" :class="{ 'pos--long': position > 999 }">#{{ position }}</span>
    <!-- no thumbnail: the number, which gives way to ▶ on hover (and to the hourglass while sending) -->
    <span v-if="artless" class="pos pos--play" :class="{ 'pos--long': (position ?? 0) > 999 }" :aria-busy="busy ? 'true' : undefined">
      <span class="pos__n">{{ position != null ? `#${position}` : '' }}</span>
      <v-progress-circular v-if="busy" class="pos__icon" indeterminate :size="16" :width="2" color="currentColor" />
      <StrokeIcon v-else class="pos__icon" name="play" :size="16" :stroke-width="2" />
    </span>
    <div v-if="!artless" class="row__art" :class="{ 'row__art--round': round }">
      <ArtThumb :src="art" :icon="icon" :round="round" />
      <ArtPlay v-if="action === 'play' || playable" :size="30" :disabled="disabled" :busy="busy" :label="playLabel" @click="$emit('play')" />
    </div>
    <div class="min0">
      <div class="line1">
        <!-- on a track row only: its place is kept off, the title does not jump when it lights up -->
        <PulseDot v-if="action === 'play'" :on="playing" class="now" />
        <div class="title">{{ title }}</div>
        <span v-if="explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
      </div>
      <div class="line2">
        <div class="meta muted">{{ meta || '\u00a0' }}</div>
        <span v-if="dur" class="dur muted">{{ dur }}</span>
        <span class="year muted">{{ year || '\u00a0' }}</span>
      </div>
      <slot name="extra" />
    </div>
    <StrokeIcon v-if="action === 'open'" name="chevron" :size="16" class="chev" />
    <template v-else>
      <template v-if="queueable">
        <button type="button" class="mini" :disabled="disabled" :title="$t('music.playNext')" :aria-label="$t('music.playNext')" @click.stop="$emit('playNext')">
          <StrokeIcon name="queueNext" :size="18" />
        </button>
        <button type="button" class="mini" :disabled="disabled" :title="$t('music.addToQueue')" :aria-label="$t('music.addToQueue')" @click.stop="$emit('addEnd')">
          <StrokeIcon name="queueAdd" :size="18" />
        </button>
      </template>
      <!-- the playing track does not leave the queue: its button keeps its place, invisible -->
      <button v-if="removable" type="button" class="mini" :class="{ 'is-hidden': selected }" :disabled="selected" :tabindex="selected ? -1 : 0"
              :title="$t('music.queueRemove')" :aria-label="$t('music.queueRemove')" @click.stop="$emit('remove')">
        <StrokeIcon name="close" :size="16" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.row {
  display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; padding: 8px 4px;
  border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent;
  color: inherit; text-align: left; font: inherit; cursor: default;
}
.row--open { cursor: pointer; }
.row--open:hover { background: var(--surface2); }
.row[data-selected='1'] { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.min0 { min-width: 0; flex: 1 1 0; display: grid; gap: 2px; }
.line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* the title only takes its own space: the "E" follows it, instead of being pushed to the end of the line */
.title { flex: 0 1 auto; min-width: 0; font-size: 14px; font-weight: 500; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line2 { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 12px; }
.meta { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.explicit {
  flex: 0 0 auto; display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 3px;
  border-radius: 3px; border: 1px solid var(--muted); font-size: 10px; font-weight: 700; line-height: 1; color: var(--muted);
}
.dur, .year { flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.1; }
.year { min-width: 2.75rem; text-align: right; }
.chev { color: var(--muted); flex: 0 0 auto; }
.mini {
  flex: 0 0 auto; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 10px;
  background: transparent; color: var(--muted); transition: background .15s, color .15s;
}
.mini:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); }
.mini:disabled { opacity: .35; }
.is-hidden { visibility: hidden; }
.now { color: var(--accent); }
.row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
/* position in the queue: fixed width IN PIXELS (up to #999) — in `ch` it followed the weight, and
   the current row (bold number) shifted its cover art by a pixel */
.pos { flex: 0 0 auto; width: 38px; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.pos--long { font-size: 10.5px; }
.row[data-selected='1'] .pos { color: var(--accent); font-weight: 600; }
/* no thumbnail: the number cell takes the thumbnail's height (44 px), the row keeps its own */
.pos--play { display: grid; place-items: center end; height: 44px; }
.pos--play > * { grid-area: 1 / 1; }
.pos__icon { opacity: 0; color: var(--text); }
.pos--play[aria-busy='true'] .pos__n { opacity: 0; }
.pos--play[aria-busy='true'] .pos__icon { opacity: 1; }
@media (hover: hover) {
  .row--artless:hover .pos__n { opacity: 0; }
  .row--artless:hover .pos__icon { opacity: 1; }
}
.row__art { position: relative; flex: 0 0 auto; border-radius: 8px; overflow: hidden; }
.row__art--round { border-radius: 999px; }
/* playback and queue buttons: on hover of the row only, place kept; the hourglass stays while sending */
@media (hover: hover) {
  .row :deep(.art-play), .row .mini { opacity: 0; }
  .row:hover :deep(.art-play), .row:focus-within :deep(.art-play), .row :deep(.art-play[aria-busy='true']),
  .row:hover .mini:not(:disabled), .row:focus-within .mini:not(:disabled) { opacity: 1; }
  .row:hover .mini:disabled { opacity: .35; }
}
</style>
