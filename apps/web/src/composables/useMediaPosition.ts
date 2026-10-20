import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { StateFor } from '@kasbah/shared'

// Position read from a player, advanced locally between two readings. The device does not push its
// position: the plugin re-reads it every two to ten seconds. While it plays, we advance it
// HERE every half second from the last reading received (local reference set when the position or the
// track changes — not `updatedAt`, which a simple volume change would move). The next
// reading realigns without a visible jolt. Same rule as the device panel (`MediaPlayerControl`).
//
// A duration is only a duration if POSITIVE: a player may announce an absurd one to mean
// "unknown" (Prime Video: `-0.001`).

/**
 * Margin (s) when paused: a reading that deviates by less than this from the frozen position is polling
 * noise (the last one dates from before the gesture, up to 2 s), not a move — we let it pass
 * without making the counter go back. Beyond that, it is a real jump (transfer, seek) and we follow it.
 */
export const MEDIA_POSITION_SLACK_S = 2.5

export function useMediaPosition(state: Ref<StateFor<'media_player'> | undefined>) {
  const anchor = ref({ pos: 0, at: 0 })
  const now = ref(Date.now())
  const playing = () => state.value?.playback === 'playing'
  /** Current position from the local reference: advances while it plays, frozen otherwise. */
  const local = () => anchor.value.pos + (playing() ? (Date.now() - anchor.value.at) / 1000 : 0)

  // A fresh reading realigns the reference — except when paused, where a close reading is polling noise:
  // adopting that old figure made the counter go back, which then repositioned itself.
  watch(() => [state.value?.nowPlaying?.positionS, state.value?.nowPlaying?.title] as const, ([pos, title], old) => {
    const raw = pos ?? 0
    const sameTrack = !!old && old[1] === title
    if (sameTrack && !playing() && Math.abs(raw - anchor.value.pos) < MEDIA_POSITION_SLACK_S) return
    anchor.value = { pos: raw, at: Date.now() }
  }, { immediate: true })
  // Play → pause: the counter stops DEAD where it was, it does not jump to the last reading.
  // Pause → play: it restarts from where it froze.
  watch(() => state.value?.playback, (pb, prev) => {
    if (prev === 'playing' && pb !== 'playing') anchor.value = { pos: local(), at: Date.now() }
    else if (pb === 'playing' && prev !== 'playing') anchor.value = { pos: anchor.value.pos, at: Date.now() }
  })
  let ticker: ReturnType<typeof setInterval> | undefined
  onMounted(() => { ticker = setInterval(() => { if (playing()) now.value = Date.now() }, 500) })
  onBeforeUnmount(() => clearInterval(ticker))

  const duration = computed<number | undefined>(() => {
    const d = state.value?.nowPlaying?.durationS
    return d !== undefined && d > 0 ? d : undefined
  })
  const hasPosition = computed(() => state.value?.nowPlaying?.positionS !== undefined)
  const position = computed<number | undefined>(() => {
    const s = state.value
    if (!s?.nowPlaying) return undefined
    const p = s.playback === 'playing' ? anchor.value.pos + (now.value - anchor.value.at) / 1000 : anchor.value.pos
    return duration.value ? Math.min(p, duration.value) : p
  })
  return { position, duration, hasPosition }
}

/** Minimum hold (ms): the store's optimistic echo arrives immediately with the exact value of the target. */
export const SEEK_HOLD_MIN_MS = 2_000
/** Maximum hold (ms): a player that never confirms must not freeze the slider. */
export const SEEK_HOLD_MAX_MS = 8_000

/**
 * Position slider held after a move. A single gesture produces THREE successive positions
 * in the store: the optimistic echo of our command (the exact target, right away), a still-old
 * poll (the starting point, up to 2 s), then the device's real reading. The requested
 * value therefore stays displayed at least `SEEK_HOLD_MIN_MS` — the echo does not count — and until the
 * player publishes a position CLOSER to the target than to the starting point (compare to the
 * start rather than to a fixed distance: a one-second move must also hold against a
 * stagnant reading), at most `SEEK_HOLD_MAX_MS`. `deviceId`: changing player releases everything.
 */
export function useSeekHold(published: Ref<number | undefined>, deviceId?: Ref<string | undefined>) {
  const seekDraft = ref<number | null>(null)
  const holding = ref(false)
  let target = 0
  let origin = 0
  let beganAt = 0

  /** Sets the target (rounded to the second) and returns the value to send to the player. */
  function beginSeek(v: number): number {
    target = Math.round(v)
    origin = published.value ?? target
    beganAt = Date.now()
    seekDraft.value = target
    holding.value = true
    return target
  }
  function release() {
    holding.value = false
    seekDraft.value = null
  }

  watch(published, (pos) => {
    if (!holding.value || pos === undefined) return
    const heldMs = Date.now() - beganAt
    if (heldMs >= SEEK_HOLD_MAX_MS) return release()
    if (heldMs >= SEEK_HOLD_MIN_MS && Math.abs(pos - target) < Math.abs(pos - origin)) release()
  })
  if (deviceId) watch(deviceId, release)

  return { seekDraft, beginSeek, holding }
}

/** `m:ss`, `h:mm:ss` from one hour; empty without a value. */
export function formatClock(s: number | undefined | null): string {
  if (s === undefined || s === null || !Number.isFinite(s)) return ''
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(Math.floor(s % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
