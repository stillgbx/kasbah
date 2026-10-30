<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useLocalStorage } from '@vueuse/core'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import type { MusicRepeat } from '../../api/transport'
import { formatClock, useMediaPosition, useSeekHold } from '../../composables/useMediaPosition'
import { useMusicSession } from '../../composables/useMusicSession'
import { streamQuality } from '../../lib/streamQuality'
import { useNotificationsStore } from '../../stores/notifications'
import ExplicitBadge from '../ui/ExplicitBadge.vue'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Control of a player in the device panel. "Nothing moves" rule (see the wiki,
// 4_0_langage-visuel): the "now playing" block always has the SAME four lines — title, subtitle,
// bar, times — whether something is playing or not. Without a track, the title says "Nothing playing" and the
// subtitle the state; without a duration (live radio), the bar and the times are invisible but keep
// their place. Before, pausing made three lines disappear and moved the keys up by as much.
/** `relayFrom`: name of the player whose sound this device plays (a TV's soundbar) — see `lib/audioRouting.ts`. */
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'media_player'>; pending?: boolean; disabled?: boolean; relayFrom?: string }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t } = useI18n()
const volume = ref(props.state.volume)
watch(() => props.state.volume, (v) => { volume.value = v })
const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const fmt = formatClock

// The TITLE is already the panel's big value: the block repeats nothing of what we already see. It
// says, in order and without duplicates, the artist, the album (if it differs from the title — a single carries the
// name of the track) and the source (the app). Two lines always present; a line with no content
// keeps its height (non-breaking space). Without a title — metadata late by a second, or an app that
// will never publish one (`on` state of native Netflix, Prime Video on an Android TV) — the first
// line names the app.
const details = computed(() => {
  const n = props.state.nowPlaying
  // no playback of its own but another's sound: we say so ("Sound from TV Living room") rather than "Nothing playing"
  if (!n) return [props.relayFrom ? t('media.relaying', { name: props.relayFrom }) : t('media.nothing')]
  // Without a title, we name the app — and nothing more. A waiting "…" spun endlessly there whenever
  // the title was never going to come (native app of an Android TV: Prime Video, Netflix), and for
  // the real waiting case (track change, metadata late by a second) the app's name
  // is already what we would have shown next on that line.
  if (!n.title) return [n.source ?? '']
  const parts = [n.artist, n.album && n.album !== n.title ? n.album : undefined, n.source]
  return parts.filter((p, i, all): p is string => !!p && all.indexOf(p) === i)
})
const NBSP = '\u00a0'
const line1 = computed(() => details.value[0] || NBSP)
const line2 = computed(() => details.value[1] || NBSP)
// Position, duration and held slider: the same rules as the Music page bar
// (`useMediaPosition`, `useSeekHold`) — a duration is only a duration if positive, the position advances
// locally between two readings and freezes dead at pause, and after a move the slider stays
// on the target as long as an old poll contradicts it.
const { position, duration, hasPosition } = useMediaPosition(toRef(() => props.state))
const hasDuration = computed(() => duration.value !== undefined)
// Previous / play / next only make sense on a loaded session (playing or paused): at rest, or with an
// app on screen without a media channel (`on`, Netflix), the plugin would refuse — the keys are greyed out, as
// in the Media view. The volume, though, stays adjustable.
const loaded = computed(() => props.state.playback === 'playing' || props.state.playback === 'paused')
// A LIVE stream (radio, news channel) has no neighboring track and no start to go back to: previous and next
// are greyed out there. They used to be active, and "previous" cut the stream for good (the plugin sent a
// SEEK to 0 as on a track) — see 6_1_pieges-runtime. Play / pause and the volume do work.
const live = computed(() => props.state.nowPlaying?.live === true)
const skippable = computed(() => loaded.value && !live.value)

// The stream Kasbah serves to this player (started from the Music page): its quality, and its QUEUE, which
// drives previous / next and repeat — the speaker only has a "file" and would have nothing to
// skip. Same key row as the Music page bar: repeat, previous, −10 s, play,
// +10 s, next, stop; an unusable key (live stream, no queue) stays in place, greyed out.
const { session, station, step, setRepeat } = useMusicSession(
  toRef(() => props.descriptor.id), toRef(() => props.state), toRef(() => has('play_url')))
// the session outlives the track (server TTL): it no longer says anything true once the player is at rest
const ours = computed(() => (loaded.value ? session.value : null))
const queue = computed(() => ours.value?.queue ?? null)
const canPrevious = computed(() => (queue.value ? loaded.value : has('track_skip') && skippable.value))
const canNext = computed(() => (queue.value ? loaded.value && queue.value.index < queue.value.length - 1 : has('track_skip') && skippable.value))
const repeat = computed<MusicRepeat>(() => queue.value?.repeat ?? 'off')
const NEXT_REPEAT: Record<MusicRepeat, MusicRepeat> = { off: 'once', once: 'loop', loop: 'off' }
const repeatLabel = computed(() => t(repeat.value === 'once' ? 'music.repeatOnce' : repeat.value === 'loop' ? 'music.repeatLoop' : 'music.repeatOff'))
// our stream, or the radio the plugin started here (directory bitrate) — see lib/streamQuality
const quality = computed(() => streamQuality(t, ours.value?.quality, props.state, loaded.value ? station.value : null))
function failQueue(err: unknown) {
  useNotificationsStore().error(t('errors.UNKNOWN', { name: 'Kasbah', message: (err as Error).message }))
}
function skip(kind: 'next' | 'previous') {
  if (queue.value) step(kind).catch(failQueue)
  else emit('command', { type: kind === 'next' ? 'media_player.next' : 'media_player.previous' })
}

// Position slider: local value during the drag, then `media_player.seek` on release.
// The slider only acts on a track with a duration (a live stream has none) and if the device can seek.
const { seekDraft, beginSeek } = useSeekHold(toRef(() => props.state.nowPlaying?.positionS), toRef(() => props.descriptor.id))
const canSeek = computed(() => hasDuration.value && has('seek') && !live.value)
const shownPosition = computed(() => seekDraft.value ?? position.value ?? 0)
/** The slider ROUNDS to its step, the clock truncates: given the whole second, both move together. */
const sliderPosition = computed(() => Math.floor(shownPosition.value))
function seekEnd(v: number) {
  emit('command', { type: 'media_player.seek', positionS: beginSeek(v) })
}
/** Skip a few seconds from the DISPLAYED position: two quick presses add up. */
const SEEK_STEP_S = 10
function jump(deltaS: number) {
  const max = duration.value ?? Number.MAX_SAFE_INTEGER
  emit('command', { type: 'media_player.seek', positionS: beginSeek(Math.min(max, Math.max(0, shownPosition.value + deltaS))) })
}

/** The Music page, on THIS player: same key as its "Listening" panel. */
const router = useRouter()
const musicSession = useLocalStorage('kasbah.music.session', '')
function openInMusic() {
  musicSession.value = props.descriptor.id
  void router.push({ name: 'music' }).catch(() => { /* redundant navigation */ })
}

// Volume in steps of 5, from the DISPLAYED value (the slider may be ahead of the state)
const VOLUME_STEP = 5
function nudgeVolume(delta: number) {
  const v = Math.min(100, Math.max(0, Math.round(volume.value) + delta))
  volume.value = v
  emit('command', { type: 'media_player.set_volume', volume: v })
}
</script>

<template>
  <div>
    <div class="now mb-3">
      <!-- a title too long scrolls gently rather than being cut (MarqueeText) -->
      <div class="now__line1">
        <ExplicitBadge v-if="state.nowPlaying?.explicit" />
        <MarqueeText class="text-subtitle-1 font-weight-medium" :text="line1" />
      </div>
      <MarqueeText class="text-body-2 text-medium-emphasis" :text="line2" />
      <!-- position slider and times: invisible without a duration (live stream), but the space stays reserved -->
      <v-slider class="now__seek" :class="{ 'now--hidden': !hasDuration }"
                :model-value="sliderPosition" :min="0" :max="duration ?? 1" :step="1"
                :disabled="disabled || !canSeek" density="compact" hide-details color="primary" track-size="3" thumb-size="12"
                :aria-label="$t('media.seek')"
                @update:model-value="(v: number) => { seekDraft = v }" @end="seekEnd" />
      <!-- the times display as soon as a position is known, even without a duration (live stream, native app
           of a TV): the total stays empty, the location of the two numbers does not move -->
      <!-- in the middle of the times, the stream quality — ours or that of a radio (empty otherwise: the line does not move) -->
      <div class="now__times text-caption text-medium-emphasis">
        <span :class="{ 'now--hidden': !hasPosition && !hasDuration }">{{ fmt(shownPosition) || '0:00' }}</span>
        <span class="now__quality" :title="quality?.hint">{{ quality?.label ?? '' }}</span>
        <span class="now__end" :class="{ 'now--hidden': !hasPosition && !hasDuration }">{{ fmt(duration) }}</span>
      </div>
    </div>
    <!-- same row as the Music page bar; play dead center, repeat answers stop -->
    <div class="keys mb-3">
      <v-btn icon class="key--step" :class="{ 'key--on': repeat !== 'off' }" variant="text" size="small" :disabled="disabled || !queue"
             :title="repeatLabel" :aria-label="repeatLabel" :aria-pressed="repeat !== 'off'"
             @click="setRepeat(NEXT_REPEAT[repeat]).catch(failQueue)">
        <v-icon icon="repeat" /><span class="key__step" :class="{ 'now--hidden': repeat === 'off' }" aria-hidden="true">{{ repeat === 'loop' ? '∞' : '1' }}</span>
      </v-btn>
      <v-btn icon="skipPrev" variant="tonal" :disabled="disabled || !canPrevious" :aria-label="$t('media.previous')" @click="skip('previous')" />
      <v-btn icon class="key--step" variant="text" size="small" :disabled="disabled || !loaded || !canSeek"
             :title="$t('media.jumpBack', { seconds: SEEK_STEP_S })" :aria-label="$t('media.jumpBack', { seconds: SEEK_STEP_S })" @click="jump(-SEEK_STEP_S)">
        <v-icon icon="rotateLeft" /><span class="key__step" aria-hidden="true">{{ SEEK_STEP_S }}</span>
      </v-btn>
      <v-btn :icon="state.playback === 'playing' ? 'pause' : 'play'" color="primary" size="large" :disabled="disabled || !loaded"
             @click="emit('command', { type: state.playback === 'playing' ? 'media_player.pause' : 'media_player.play' })" />
      <v-btn icon class="key--step" variant="text" size="small" :disabled="disabled || !loaded || !canSeek"
             :title="$t('media.jumpForward', { seconds: SEEK_STEP_S })" :aria-label="$t('media.jumpForward', { seconds: SEEK_STEP_S })" @click="jump(SEEK_STEP_S)">
        <v-icon icon="rotateRight" /><span class="key__step" aria-hidden="true">{{ SEEK_STEP_S }}</span>
      </v-btn>
      <v-btn icon="skipNext" variant="tonal" :disabled="disabled || !canNext" :aria-label="$t('media.next')" @click="skip('next')" />
      <v-btn icon="stop" variant="text" size="small" :disabled="disabled || !loaded" :aria-label="$t('music.stop')" :title="$t('music.stop')"
             @click="emit('command', { type: 'media_player.stop' })" />
    </div>
    <!-- volume on ONE line that reads on its own: mute, −, slider, + — the − and + frame the
         slider they adjust, the value at the end — without a unit, like the track times (a bubble on
         the handle went over the transport keys). Small keys to
         leave the width to the slider. -->
    <div v-if="has('volume')" class="volume__row">
      <v-btn v-if="has('mute')" :icon="state.muted ? 'volumeOff' : 'volume'" variant="text" size="small" :disabled="disabled"
             :aria-label="state.muted ? $t('media.unmute') : $t('media.mute')"
             @click="emit('command', { type: 'media_player.set_mute', muted: !state.muted })" />
      <v-btn icon="minus" variant="text" size="x-small" :disabled="disabled || state.muted || volume <= 0" :aria-label="$t('media.volumeDown')" @click="nudgeVolume(-VOLUME_STEP)" />
      <v-slider v-model="volume" class="flex-grow-1" :min="0" :max="100" :step="1" :disabled="disabled || state.muted"
                hide-details :aria-label="$t('media.volume')"
                @end="(v: number) => emit('command', { type: 'media_player.set_volume', volume: Math.round(v) })" />
      <v-btn icon="plus" variant="text" size="x-small" :disabled="disabled || state.muted || volume >= 100" :aria-label="$t('media.volumeUp')" @click="nudgeVolume(VOLUME_STEP)" />
      <span class="text-caption volume-value">{{ Math.round(volume) }}</span>
    </div>
    <!-- to the Music page, on this player: same footer as the panel's "Settings" (label, pill) -->
    <div class="card card--soft to-music">
      <span class="muted">{{ $t('media.musicPageHint') }}</span>
      <button type="button" class="pill" @click="openInMusic">
        <StrokeIcon name="music" :size="16" /> {{ $t('media.openInMusic') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.now--hidden { visibility: hidden; }
/* position slider: thin, glued to the text; the handle stays small so as not to eat the times */
.now__line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.now__line1 > :last-child { min-width: 0; flex: 1 1 auto; }
.now__seek { margin-top: 2px; }
/* fixed-width digits: a scrolling value does not make its neighbors flinch */
.now__times { display: grid; grid-template-columns: 5.5ch minmax(0, 1fr) 5.5ch; align-items: center; font-variant-numeric: tabular-nums; }
.now__end { text-align: right; }
/* a piece of connoisseur info, not for reading: smaller and paler than the times that frame it */
.now__quality { text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 10px; opacity: .6; letter-spacing: .02em; }
/* seven keys in the panel's 285 px: sizes fixed here (Vuetify's overflowed by 32 px),
   spread from edge to edge — play stays in the center, the row being symmetric */
.keys { display: flex; align-items: center; justify-content: space-between; }
.keys > .v-btn { width: 36px; height: 36px; }
.keys > .v-btn--variant-tonal { width: 40px; height: 40px; }
.keys > .bg-primary { width: 50px; height: 50px; }
/* the step ("10", "1", "∞") lives IN THE CENTER of the arrow, as in the Music page bar */
.key--step :deep(.v-btn__content) { display: grid; }
.key--step :deep(.v-btn__content) > * { grid-area: 1 / 1; place-self: center; }
/* 26 px arrow for an 8 digit: the Music bar's proportions, the digit does not touch the stroke */
.key--step :deep(.v-icon) { font-size: 26px; width: 26px; height: 26px; }
.key__step { font-size: 8px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
.key--on { background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary)); }
.to-music { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; padding: 12px 14px; font-size: 13px; }
.to-music .muted { min-width: 0; }
.to-music .pill { flex: 0 0 auto; }
.volume__row { display: flex; align-items: center; gap: 4px; }
/* fixed width ("100") and constant-width digits: the value changes without making the slider move */
.volume-value { width: 3ch; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
