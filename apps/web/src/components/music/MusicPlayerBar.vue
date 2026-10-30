<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import type { MusicRepeat, MusicStreamQuality, RadioStation } from '../../api/transport'
import { formatClock, useMediaPosition, useSeekHold } from '../../composables/useMediaPosition'
import { deviceIcon } from '../../lib/deviceIcons'
import { streamQuality } from '../../lib/streamQuality'
import { isLocalPlayer } from '../../stores/localPlayer'
import ArtThumb from '../ui/ArtThumb.vue'
import ExplicitBadge from '../ui/ExplicitBadge.vue'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Player at the bottom of the Music page: what the chosen SESSION plays (a Cast / Sonos player),
// and its buttons. Three columns: the track on the left, the transport and position at the CENTER
// of the screen, the volume and the player on the right. "Nothing moves" rule: same zones and same
// height whether something is playing or not; without a duration, slider and time are invisible
// but keep their place; a button without the capability stays in place, greyed out.
//
// `session`: the stream WE serve to this player — a "file" of known size for it, so the position
// is its own. Title, artist, cover art and duration come from the session when there is one: the
// speaker, for its part, sometimes publishes the stream URL or the app name while the metadata
// arrives, and not always the duration. `pending`: title being sent (yt-dlp resolution: a few
// seconds) — it shows right away, the central button spins, the speaker catches up afterwards.
//
// `resume`: the last listen of this player, when it no longer plays anything of ours (the server
// restarted, playback was stopped). It shows PAUSED at its position; play restarts it from
// there, and the slider chooses where it will resume.
//
// The player's QUEUE (`session.queue`) drives previous / next — the speaker only has a "file" and
// would have nothing to skip — and the track repeat, in the slot that answers to stop.
const props = defineProps<{
  entry: DeviceEntry | null
  name: string
  session: {
    durationS: number | null
    title?: string | null
    artist?: string | null
    artUrl?: string | null
    quality?: MusicStreamQuality | null
    queue?: { length: number; index: number; repeat: MusicRepeat } | null
  } | null
  /** The last radio launched on this player (radio plugin): its quality, as long as it plays the live stream. */
  station?: RadioStation | null
  pending: { title: string; artists: string[]; artUrl: string | null; explicit?: boolean } | null
  resume?: { title: string | null; artist: string | null; artUrl: string | null; durationS: number | null; positionS: number; explicit: boolean } | null
  transferMode: boolean
  canTransfer: boolean
  transferBusy: boolean
  /** The queue is displayed in the central area of the page. */
  queueOpen: boolean
}>()
const emit = defineEmits<{
  command: [cmd: CommandInput]; seek: [positionS: number]; transfer: []; cancelTransfer: []
  repeat: [mode: MusicRepeat]; toggleQueue: []
}>()
const { t } = useI18n()

const state = computed<StateFor<'media_player'> | undefined>(() =>
  props.entry?.state.kind === 'media_player' ? props.entry.state : undefined)
const has = (c: string) => !!props.entry?.descriptor.capabilities.includes(c as never)
const available = computed(() => !!state.value?.available)
const loaded = computed(() => state.value?.playback === 'playing' || state.value?.playback === 'paused')
const live = computed(() => state.value?.nowPlaying?.live === true)
const skippable = computed(() => loaded.value && !live.value)
// The proxy session outlives the track (server TTL): after a stop or a page reload, it no longer
// says anything true as long as the player has nothing loaded — otherwise the bar showed a cover
// art and a duration for "Nothing playing".
const ours = computed(() => (loaded.value ? props.session : null))

// ---- queue and repeat ------------------------------------------------------------------------------
const queue = computed(() => ours.value?.queue ?? null)
// Previous remains possible on the first track: it takes you back to the start of the track.
// the last listen has not been restarted yet: nothing to skip or stop (the speaker may still be
// "paused" on our dead stream, and `loaded` would say otherwise)
const canPrevious = computed(() => available.value && !resume.value && (queue.value ? loaded.value : has('track_skip') && skippable.value))
const canNext = computed(() => available.value && !resume.value && (queue.value ? loaded.value && queue.value.index < queue.value.length - 1 : has('track_skip') && skippable.value))
/** Tracks waiting after the current one: pill on the Queue button (the "add" feedback without a toast). */
const waiting = computed(() => (queue.value ? Math.max(0, queue.value.length - queue.value.index - 1) : 0))
const repeat = computed<MusicRepeat>(() => queue.value?.repeat ?? 'off')
const NEXT_REPEAT: Record<MusicRepeat, MusicRepeat> = { off: 'once', once: 'loop', loop: 'off' }
const repeatLabel = computed(() => t(repeat.value === 'once' ? 'music.repeatOnce' : repeat.value === 'loop' ? 'music.repeatLoop' : 'music.repeatOff'))

const NBSP = '\u00a0'
/**
 * A URL is not a title, nor is the hexadecimal id of a proxy session: the speaker displays them
 * while the metadata arrives — or for good when the server has restarted and no longer knows
 * what it is playing.
 */
const looksLikeUrl = (v: string | undefined) => !!v && (/^(https?:\/\/|[a-z0-9.-]+\/api\/)/i.test(v) || /^[0-9a-f]{24}(\.[a-z0-9]{2,4})?$/i.test(v.trim()))
const resume = computed(() => (props.pending ? null : props.resume ?? null))
const art = computed(() => {
  if (props.pending) return props.pending.artUrl
  if (resume.value) return resume.value.artUrl
  const n = state.value?.nowPlaying
  return n ? n.artUrl ?? ours.value?.artUrl ?? null : null
})
const title = computed(() => {
  if (props.pending) return props.pending.title
  if (resume.value) return resume.value.title || t('media.paused')
  const n = state.value?.nowPlaying
  if (!props.entry) return t('music.noSession')
  if (!n) return t('music.nothing')
  if (ours.value?.title) return ours.value.title
  return (looksLikeUrl(n.title) ? undefined : n.title) || n.source || t('media.playing')
})
const subtitle = computed(() => {
  if (props.pending) return props.pending.artists.join(', ') || t('ytmusic.starting')
  if (resume.value) return resume.value.artist || NBSP
  const s = state.value
  const n = s?.nowPlaying
  if (!s) return NBSP
  if (!n) return s.available ? t(`media.${s.playback}`) : t('common.unavailable')
  // our stream: the catalog's artist, without the name of the receiving app
  if (ours.value?.title) return ours.value.artist || NBSP
  const parts = [n.artist, n.album && n.album !== n.title ? n.album : undefined, n.source]
  return parts.filter((p, i, all): p is string => !!p && !looksLikeUrl(p) && all.indexOf(p) === i).join(' · ') || NBSP
})

// ---- stream quality -----------------------------------------------------------------------------
// What the speaker receives from US (always constant-bitrate MP3: that is what gives the stream a
// size, hence a duration and seeking), and in the tooltip what YouTube gave us to produce it. One
// line, under the player name: we want to be able to judge the chain at a glance, not open the
// server log.
// A radio, for its part, goes from the station to the speaker: its quality is the one the
// directory announces.
const quality = computed(() => streamQuality(t, ours.value?.quality, state.value, loaded.value ? props.station : null))
const qualityLine = computed(() => quality.value?.label ?? NBSP)
const qualityHint = computed(() => quality.value?.hint)

// ---- position ------------------------------------------------------------------------------------
const { position: rawPosition, duration: deviceDuration, hasPosition } = useMediaPosition(toRef(() => state.value))
const duration = computed(() => (resume.value ? resume.value.durationS ?? undefined : deviceDuration.value ?? ours.value?.durationS ?? undefined))
const hasDuration = computed(() => duration.value !== undefined && duration.value !== null)
const position = computed<number | undefined>(() => {
  if (resume.value) return resume.value.positionS
  if (rawPosition.value === undefined) return undefined
  return duration.value ? Math.min(rawPosition.value, duration.value) : rawPosition.value
})
// Slider: local value during the drag, then held until a reading close to the target — otherwise
// an old poll made the thumb bounce (click → old position → target).
const { seekDraft, beginSeek } = useSeekHold(
  toRef(() => state.value?.nowPlaying?.positionS),
  toRef(() => props.entry?.descriptor.id),
)
// the last listen: the slider only chooses where it will resume
const canSeek = computed(() => hasDuration.value && (resume.value ? true : !live.value && loaded.value && has('seek')))
const shownPosition = computed(() => seekDraft.value ?? position.value ?? 0)
/** The slider ROUNDS to its step, the clock truncates: given the whole second, both move together. */
const sliderPosition = computed(() => Math.floor(shownPosition.value))
function seekEnd(v: number) {
  emit('seek', beginSeek(v))
}
/**
 * Skip a few seconds: same path as a cursor drag (the thumb is "held" on the target as long as
 * an old reading contradicts it), starting from the DISPLAYED position — two quick presses must
 * add up, not repeat on a reading that has not moved yet.
 */
const SEEK_STEP_S = 10
function jump(deltaS: number) {
  const max = duration.value ?? Number.MAX_SAFE_INTEGER
  emit('seek', beginSeek(Math.min(max, Math.max(0, shownPosition.value + deltaS))))
}

// ---- volume: mute, −, slider, +, value — like the device panel's card -------------------------------
const VOLUME_STEP = 5
// The setting goes to the speaker WHILE dragging: you hear what you adjust without releasing.
// Not at every pixel though — at most one send every VOLUME_THROTTLE_MS, then the final value on
// release. The device reading is ignored while the thumb is held, otherwise a late poll would make
// the slider jump under the finger.
const VOLUME_THROTTLE_MS = 200
const volume = ref(state.value?.volume ?? 0)
const sliding = ref(false)
let volumeSentAt = 0
let volumeTimer: ReturnType<typeof setTimeout> | undefined
watch(() => state.value?.volume, (v) => { if (!sliding.value) volume.value = v ?? 0 })
function sendVolume(v: number) {
  volumeSentAt = Date.now()
  emit('command', { type: 'media_player.set_volume', volume: v })
}
function setVolume(v: number) {
  const next = Math.min(100, Math.max(0, Math.round(v)))
  volume.value = next
  clearTimeout(volumeTimer)
  volumeTimer = undefined
  sendVolume(next)
}
function slideVolume(v: number) {
  sliding.value = true
  volume.value = Math.min(100, Math.max(0, Math.round(v)))
  if (volumeTimer) return // a send is already scheduled: it will take the latest value
  const wait = VOLUME_THROTTLE_MS - (Date.now() - volumeSentAt)
  if (wait <= 0) { sendVolume(volume.value); return }
  volumeTimer = setTimeout(() => { volumeTimer = undefined; sendVolume(volume.value) }, wait)
}
function endVolume(v: number) {
  sliding.value = false
  setVolume(v)
}
onBeforeUnmount(() => clearTimeout(volumeTimer))
const volumeOk = computed(() => available.value && has('volume') && !state.value?.muted)

/**
 * Flagged by the service that launched the track (the speaker never says it). It follows the SAME
 * source as the title and cover art: during the send the catalog speaks, otherwise the player's
 * state. Without that, the badge arrived late on an explicit track, and STAYED on the next one
 * until the stream really started — while title and cover art had already changed.
 */
/**
 * Playback on a paused track (arriving on the page, last listen restarted): the speaker stays
 * "paused" while it fills its buffer, and the button did not move. It spins from the click
 * until the player plays — at most STARTING_MAX_MS, if the speaker never follows.
 */
const STARTING_MAX_MS = 15_000
const starting = ref(false)
let startingTimer: ReturnType<typeof setTimeout> | undefined
function stopStarting() {
  starting.value = false
  clearTimeout(startingTimer)
}
watch(() => state.value?.playback, (p) => { if (p === 'playing') stopStarting() })
watch(() => props.entry?.descriptor.id, stopStarting)
onBeforeUnmount(() => clearTimeout(startingTimer))
const busy = computed(() => !!props.pending || starting.value)
function playPause() {
  if (state.value?.playback === 'playing') {
    emit('command', { type: 'media_player.pause' })
    return
  }
  starting.value = true
  clearTimeout(startingTimer)
  startingTimer = setTimeout(stopStarting, STARTING_MAX_MS)
  emit('command', { type: 'media_player.play' })
}

const explicit = computed(() => (props.pending
  ? props.pending.explicit === true
  : resume.value ? resume.value.explicit : state.value?.nowPlaying?.explicit === true))
</script>

<template>
  <div class="bar" :data-empty="entry ? '0' : '1'">
    <!-- the track -->
    <div class="bar__track">
      <ArtThumb :key="art ?? 'none'" :src="art" :size="56" icon="music" class="bar__art" />
      <div class="bar__titles">
        <div class="bar__line1">
          <ExplicitBadge v-if="explicit" />
          <MarqueeText class="bar__title" :text="title" />
        </div>
        <MarqueeText class="bar__sub muted" :text="subtitle" />
      </div>
      <!-- at the end of the track, not on the right: volume, player and transfer already fill that column at 1280 px -->
      <button type="button" class="key key--small key--queue" :data-on="queueOpen ? '1' : '0'" :disabled="!entry"
              :title="queueOpen ? $t('music.queueHide') : $t('music.queueShow')" :aria-label="queueOpen ? $t('music.queueHide') : $t('music.queueShow')"
              :aria-pressed="queueOpen" @click="emit('toggleQueue')">
        <StrokeIcon name="list" :size="16" />
        <!-- set on the corner: it widens nothing when it appears -->
        <span class="key__badge" :class="{ 'bar--hidden': !waiting }" :title="$t('music.queueWaiting', { n: waiting }, waiting)">{{ waiting > 99 ? '99+' : waiting }}</span>
      </button>
    </div>

    <!-- transport + position, at the center of the screen -->
    <div class="bar__center">
      <div class="bar__keys">
        <!-- repeat answers to the stop button: the row is symmetric, play is dead center.
             The step ("1" once, "∞" looping) lives at the center of the arrows, like the 10 s skips. -->
        <button type="button" class="key key--repeat" :data-on="repeat !== 'off' ? '1' : '0'" :disabled="!available || !queue"
                :title="repeatLabel" :aria-label="repeatLabel" :aria-pressed="repeat !== 'off'"
                @click="emit('repeat', NEXT_REPEAT[repeat])">
          <StrokeIcon name="repeat" :size="24" />
          <span class="key__step" :class="{ 'bar--hidden': repeat === 'off' }" aria-hidden="true">{{ repeat === 'loop' ? '∞' : '1' }}</span>
        </button>
        <button type="button" class="key" :disabled="!canPrevious"
                :title="$t('media.previous')" :aria-label="$t('media.previous')"
                @click="emit('command', { type: 'media_player.previous' })">
          <StrokeIcon name="skipPrev" :size="18" />
        </button>
        <button type="button" class="key key--jump" :disabled="!available || !canSeek"
                :title="$t('media.jumpBack', { seconds: SEEK_STEP_S })" :aria-label="$t('media.jumpBack', { seconds: SEEK_STEP_S })"
                @click="jump(-SEEK_STEP_S)">
          <StrokeIcon name="rotateLeft" :size="24" />
          <span class="key__step" aria-hidden="true">{{ SEEK_STEP_S }}</span>
        </button>
        <button type="button" class="key key--main" :disabled="busy || !available || (!loaded && !resume)" :aria-busy="busy ? 'true' : undefined"
                :title="busy ? $t('ytmusic.starting') : state?.playback === 'playing' ? $t('common.pause') : $t('media.play')"
                :aria-label="busy ? $t('ytmusic.starting') : state?.playback === 'playing' ? $t('common.pause') : $t('media.play')"
                @click="playPause">
          <v-progress-circular v-if="busy" indeterminate :size="22" :width="2" color="currentColor" />
          <StrokeIcon v-else :name="state?.playback === 'playing' ? 'pause' : 'play'" :size="20" />
        </button>
        <button type="button" class="key key--jump" :disabled="!available || !canSeek"
                :title="$t('media.jumpForward', { seconds: SEEK_STEP_S })" :aria-label="$t('media.jumpForward', { seconds: SEEK_STEP_S })"
                @click="jump(SEEK_STEP_S)">
          <StrokeIcon name="rotateRight" :size="24" />
          <span class="key__step" aria-hidden="true">{{ SEEK_STEP_S }}</span>
        </button>
        <button type="button" class="key" :disabled="!canNext"
                :title="$t('media.next')" :aria-label="$t('media.next')"
                @click="emit('command', { type: 'media_player.next' })">
          <StrokeIcon name="skipNext" :size="18" />
        </button>
        <button type="button" class="key" :disabled="!available || !loaded || !!resume"
                :title="$t('music.stop')" :aria-label="$t('music.stop')"
                @click="emit('command', { type: 'media_player.stop' })">
          <StrokeIcon name="stop" :size="16" />
        </button>
      </div>
      <!-- invisible without duration or position (nothing playing), but the space stays -->
      <div class="bar__seek" :class="{ 'bar--hidden': !hasDuration && !hasPosition && !resume }">
        <span class="time">{{ formatClock(shownPosition) || '0:00' }}</span>
        <v-slider :class="{ 'bar--hidden': !hasDuration }" :model-value="sliderPosition" :min="0" :max="duration ?? 1" :step="1"
                  :disabled="!available || !canSeek" density="compact" hide-details color="primary" track-size="4" thumb-size="16"
                  :aria-label="$t('media.seek')"
                  @update:model-value="(v: number) => { seekDraft = v }" @end="seekEnd" />
        <span class="time time--end">{{ formatClock(duration ?? undefined) }}</span>
      </div>
    </div>

    <!-- volume + lecteur -->
    <div class="bar__right">
      <div class="bar__volume">
        <button type="button" class="key key--small" :disabled="!available || !has('mute')"
                :data-on="state?.muted ? '1' : '0'"
                :title="state?.muted ? $t('media.unmute') : $t('media.mute')" :aria-label="state?.muted ? $t('media.unmute') : $t('media.mute')"
                @click="emit('command', { type: 'media_player.set_mute', muted: !state?.muted })">
          <StrokeIcon :name="state?.muted ? 'volumeOff' : 'volume'" :size="16" />
        </button>
        <button type="button" class="key key--tiny" :disabled="!volumeOk || volume <= 0" :aria-label="$t('media.volumeDown')" :title="$t('media.volumeDown')" @click="setVolume(volume - VOLUME_STEP)">
          <StrokeIcon name="minus" :size="14" />
        </button>
        <v-slider :model-value="volume" class="bar__volume-slider" :min="0" :max="100" :step="1" :disabled="!volumeOk"
                  density="compact" hide-details color="primary" track-size="4" thumb-size="14" :aria-label="$t('media.volume')"
                  @update:model-value="slideVolume" @end="endVolume" />
        <button type="button" class="key key--tiny" :disabled="!volumeOk || volume >= 100" :aria-label="$t('media.volumeUp')" :title="$t('media.volumeUp')" @click="setVolume(volume + VOLUME_STEP)">
          <StrokeIcon name="plus" :size="14" />
        </button>
        <span class="pct muted">{{ has('volume') ? Math.round(volume) : '' }}</span>
      </div>
      <div class="bar__device">
        <span class="icon-square" :data-on="loaded ? '1' : '0'">
          <!-- this browser: a screen, not a speaker -->
          <StrokeIcon :name="!entry ? 'speaker' : isLocalPlayer(entry.descriptor.id) ? 'tablet' : deviceIcon(entry.descriptor, entry.state)" :size="18" />
        </span>
        <div class="bar__device-text">
          <MarqueeText class="bar__device-name" :text="name || NBSP" />
          <!-- slot kept even without a stream of ours: the column does not move when playback starts -->
          <span class="bar__quality muted" :title="qualityHint">{{ qualityLine }}</span>
        </div>
      </div>
      <!-- Transfer becomes Cancel while choosing the target: a single button, a single place -->
      <button v-if="transferMode" type="button" class="pill pill--transfer" data-on="1" :disabled="transferBusy" @click="emit('cancelTransfer')">
        <StrokeIcon name="close" :size="16" />
        <span>{{ transferBusy ? $t('music.transferring') : $t('common.cancel') }}</span>
      </button>
      <button v-else type="button" class="pill pill--transfer" :disabled="!canTransfer"
              :title="canTransfer ? $t('music.transferTo') : $t('music.transferUnavailable')"
              @click="emit('transfer')">
        <StrokeIcon name="move" :size="16" />
        <span>{{ $t('music.transfer') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.bar {
  flex: 0 0 auto;
  height: 92px;
  display: grid;
  /* The central column is at the middle of the SCREEN, not of the bar: the bar starts after the
     rail, so the left wing is shorter than the right by half a rail width. A "1fr 1fr" would have
     centered on the page and the play button would have looked shifted to the right. */
  /* The central column widens with the screen (time slider easier and more precise): at
     1280 px it is 340, which the right wing still tolerates; at 1920 px, 640. */
  --center-w: clamp(320px, calc(100vw - 940px), 640px);
  --bar-gap: 18px;
  grid-template-columns: calc(50% - var(--rail-w) / 2 - var(--center-w) / 2 - var(--bar-gap)) var(--center-w) minmax(0, 1fr);
  align-items: center;
  gap: var(--bar-gap);
  padding: 0 24px calc(var(--safe-bottom) + 0px);
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.bar__track { display: flex; align-items: center; gap: 14px; min-width: 0; }
.bar__art { border-radius: 8px; overflow: hidden; }
.bar__titles { min-width: 0; flex: 1 1 auto; display: grid; gap: 2px; }
.bar__line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* the title scrolls (MarqueeText, `contain: inline-size`): it NEEDS the remaining space —
   leaving it only "its" space shrinks it to zero. The "E" therefore goes in front of it, stuck
   to it, not pushed to the end. */
.bar__title { min-width: 0; flex: 1 1 auto; font-size: 15px; font-weight: 600; line-height: 1.25; }
.bar__sub { font-size: 12.5px; line-height: 1.25; }

.bar__center { display: grid; gap: 2px; justify-items: center; min-width: 0; width: var(--center-w); }
/* The transport buttons GROW with the screen: at 1280 the row already grazes the volume zone,
   at 1920 it has room. Capped by the bar height (92 px): button + position slider must fit in it.
   Double (76 px) fits in neither. */
.bar__keys {
  /* Width = that of the central column, buttons CENTERED inside it: when the row overflows
     (narrow screen), it overflows on BOTH sides equally and the play button stays at the exact
     center of the screen. Without this the row started from the left edge of the column and play
     slid to the right. */
  display: flex; align-items: center; justify-content: center; gap: 8px; width: var(--center-w);
  /* The bar HEIGHT (92 px) bounds the button height: the central column stacks the row and the
     position slider, and 42 px (play 50) is what fits in 88. So we act on the WIDTH — oblong
     buttons, easier to hit with a finger without growing the bar. This width follows the screen,
     because the free space between the track (left) and the volume (right) is what bounds it:
     ~376 px at 1280, ~682 px at 1920. */
  --key: 42px;
  --key-w: clamp(42px, calc(5.2vw - 24px), 84px);
  --key-main: calc(var(--key) * 1.1);
}
.key {
  display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
/* size driven by the row, icon included: a single setting to change */
.bar__keys .key { flex: 0 0 auto; width: var(--key-w); height: var(--key); border-radius: calc(var(--key) * .3); }
/* the icon is set on the HEIGHT: as a percentage on both sides, it would stretch with the button */
.bar__keys .key svg { height: 46%; width: auto; }
.bar__keys .key--jump svg, .bar__keys .key--repeat svg { height: 62%; }
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .35; cursor: default; }
.key--main { width: 46px; height: 46px; border-radius: 999px; border-color: transparent; background: var(--accent); color: var(--on-accent); }
.bar__keys .key--main { width: var(--key-main); height: var(--key-main); border-radius: 999px; }
.bar__keys .key--main svg { height: 44%; }
.key--main:hover:not(:disabled) { background: var(--accent); color: var(--on-accent); filter: brightness(1.06); }
.key--main:disabled[aria-busy='true'] { opacity: .85; }
.key--queue { position: relative; flex: 0 0 auto; }
.key__badge {
  position: absolute; top: -4px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
  background: var(--accent); color: var(--on-accent); font-size: 10px; font-weight: 700; line-height: 16px; text-align: center;
  font-variant-numeric: tabular-nums; pointer-events: none;
}
.key--queue[data-on='1'] .key__badge { background: var(--on-accent); color: var(--accent); }
/* the step lives AT THE CENTER of the arrow (same grid cell), like on podcast players */
.key--jump > *, .key--repeat > * { grid-area: 1 / 1; }
.key__step {
  /* small enough NOT to touch the arrow: at 10 px on a 22 px arrow the two digits
     filled the circle edge to edge and the whole thing became a blob */
  font-size: calc(var(--key) * .2); font-weight: 600; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums;
}
.key--small { width: 32px; height: 32px; border-radius: 10px; border-color: transparent; }
.key--tiny { width: 28px; height: 28px; border-radius: 8px; border-color: transparent; }
.key[data-on='1'] { background: var(--accent); color: var(--on-accent); }
.bar__seek { width: var(--center-w); display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; min-width: 0; }
/* fixed width in the time font: 5.5ch fits h:mm:ss (narrow colons) */
.time { min-width: 5.5ch; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.time--end { text-align: right; }
.bar--hidden { visibility: hidden; }

.bar__right { display: flex; align-items: center; gap: 14px; min-width: 0; width: 100%; justify-content: flex-end; }
.bar__volume { display: flex; align-items: center; gap: 2px; flex: 1 1 auto; min-width: 180px; max-width: 300px; }
.bar__volume-slider { flex: 1 1 auto; min-width: 90px; }
.pct { width: 3ch; font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
.bar__device { display: flex; align-items: center; gap: 8px; min-width: 0; }
.bar__device-text { display: grid; gap: 1px; min-width: 0; }
.bar__device-name { min-width: 0; width: 96px; font-size: 13px; font-weight: 500; }
/* discreet: what the proxy serves, under the name, on a line that never overflows */
.bar__quality { width: 96px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
/* FIXED width: "Transfer", "Cancel" and "Transferring…" take turns in the same button without
   shifting the volume or the player; a label that is too long is cut */
.pill--transfer { height: 36px; width: 124px; padding: 0 12px; font-size: 13px; flex: 0 0 auto; justify-content: center; }
.pill--transfer span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar[data-empty='1'] .bar__title { color: var(--muted); }
/* Phone in portrait: the three columns stack — the track, the buttons, the position, then the
   volume with the player and "Transfer". Fixed heights: nothing moves from one track to the
   next. */
@media (max-width: 599px) {
  .bar {
    --center-w: 100%; --bar-gap: 6px;
    height: auto; grid-template-columns: minmax(0, 1fr); padding: 8px var(--page-x) calc(var(--safe-bottom) + 8px);
  }
  .bar__track { gap: 10px; }
  .bar__keys { --key: 40px; --key-w: 40px; gap: 6px; }
  .bar__right { justify-content: space-between; gap: 8px; }
  .bar__volume { min-width: 0; max-width: none; }
  .bar__volume-slider { min-width: 0; }
  .bar__device-name, .bar__quality { width: 72px; }
  /* "Transfer" as an icon only; the label is still read by screen readers */
  .pill--transfer { width: 44px; padding: 0; }
  .pill--transfer span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
}
</style>
