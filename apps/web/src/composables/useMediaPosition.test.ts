import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import type { StateFor } from '@kasbah/shared'
import { formatClock, MEDIA_POSITION_SLACK_S, SEEK_HOLD_MAX_MS, SEEK_HOLD_MIN_MS, useMediaPosition, useSeekHold } from './useMediaPosition'

function media(partial: Partial<StateFor<'media_player'>> & { nowPlaying?: StateFor<'media_player'>['nowPlaying'] }): StateFor<'media_player'> {
  return {
    kind: 'media_player',
    updatedAt: 0,
    available: true,
    playback: 'paused',
    volume: 20,
    muted: false,
    ...partial,
  }
}

describe('useMediaPosition', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ignores a stale poll while paused when it is within the slack', async () => {
    const state = ref(media({
      playback: 'paused',
      nowPlaying: { title: 'Terracotta', positionS: 100, durationS: 200 },
    }))
    const { position } = useMediaPosition(state)
    expect(position.value).toBe(100)

    state.value = media({
      playback: 'paused',
      nowPlaying: { title: 'Terracotta', positionS: 100 - (MEDIA_POSITION_SLACK_S - 0.5), durationS: 200 },
    })
    await nextTick()
    expect(position.value).toBe(100)
  })

  it('accepts a real jump while paused beyond the slack', async () => {
    const state = ref(media({
      playback: 'paused',
      nowPlaying: { title: 'Terracotta', positionS: 100, durationS: 200 },
    }))
    const { position } = useMediaPosition(state)

    state.value = media({
      playback: 'paused',
      nowPlaying: { title: 'Terracotta', positionS: 100 + MEDIA_POSITION_SLACK_S + 1, durationS: 200 },
    })
    await nextTick()
    expect(position.value).toBe(100 + MEDIA_POSITION_SLACK_S + 1)
  })

  it('never goes below the reading just received, between two ticks of its clock', async () => {
    // seen on 2026-10-30 at a track change: the clock showed "-1:-1:-1"
    const state = ref(media({
      playback: 'playing',
      nowPlaying: { title: 'Break On Through', positionS: 236, durationS: 283 },
    }))
    const { position } = useMediaPosition(state)
    // the local clock only ticks every 500 ms: a reading lands in between
    vi.advanceTimersByTime(300)
    state.value = media({ playback: 'playing', nowPlaying: { title: 'Introduction', positionS: 0, durationS: 28 } })
    await nextTick()
    expect(position.value).toBe(0)
  })
})

describe('useSeekHold', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const settle = () => vi.advanceTimersByTime(SEEK_HOLD_MIN_MS + 100)

  it('ignores the optimistic echo of its own command, then releases on the device confirmation', async () => {
    const published = ref<number | undefined>(40)
    const { seekDraft, beginSeek, holding } = useSeekHold(published)
    beginSeek(120)
    // the store reflects the command right away: the exact target, before any reading
    published.value = 120
    await nextTick()
    expect(holding.value).toBe(true)
    expect(seekDraft.value).toBe(120)
    // reading from before the gesture: still held
    published.value = 41
    await nextTick()
    expect(holding.value).toBe(true)
    // the real reading, after the minimum hold: released
    settle()
    published.value = 121
    await nextTick()
    expect(holding.value).toBe(false)
    expect(seekDraft.value).toBeNull()
  })

  it('gives up after the maximum hold even without confirmation', async () => {
    const published = ref<number | undefined>(40)
    const { beginSeek, holding } = useSeekHold(published)
    beginSeek(120)
    vi.advanceTimersByTime(SEEK_HOLD_MAX_MS + 100)
    published.value = 45
    await nextTick()
    expect(holding.value).toBe(false)
  })

  it('keeps the draft when a stale poll arrives far from the target', async () => {
    const published = ref<number | undefined>(40)
    const { seekDraft, beginSeek, holding } = useSeekHold(published)
    expect(beginSeek(120)).toBe(120)
    expect(seekDraft.value).toBe(120)
    expect(holding.value).toBe(true)

    published.value = 42
    await nextTick()
    expect(seekDraft.value).toBe(120)
    expect(holding.value).toBe(true)
  })

  it('releases only once a published position is near the target after a far poll', async () => {
    const published = ref<number | undefined>(40)
    const { seekDraft, beginSeek, holding } = useSeekHold(published)
    beginSeek(120)

    published.value = 41
    await nextTick()
    expect(holding.value).toBe(true)

    settle()
    published.value = 119
    await nextTick()
    expect(holding.value).toBe(false)
    expect(seekDraft.value).toBeNull()
  })

  it('does not release a short seek on the still-stale start position', async () => {
    const published = ref<number | undefined>(100)
    const { seekDraft, beginSeek, holding } = useSeekHold(published)
    beginSeek(101)

    published.value = 100
    await nextTick()
    // same value: the watch does not re-trigger; we force a neighboring tick still within the margin
    published.value = 100.2
    await nextTick()
    expect(holding.value).toBe(true)
    expect(seekDraft.value).toBe(101)

    settle()
    published.value = 101
    await nextTick()
    expect(holding.value).toBe(false)
    expect(seekDraft.value).toBeNull()
  })

  // seen on 2026-10-30 on a Cast, read every 10 s: once released, the thumb stayed frozen on the target
  // until the next reading
  it('releases on the optimistic echo once the minimum hold is over, without waiting for another reading', async () => {
    const published = ref<number | undefined>(40)
    const { seekDraft, beginSeek, holding } = useSeekHold(published)
    beginSeek(120)
    published.value = 120
    await nextTick()
    vi.advanceTimersByTime(SEEK_HOLD_MIN_MS + 600)
    expect(holding.value).toBe(false)
    expect(seekDraft.value).toBeNull()
  })

  it('gives up after the maximum hold even when no reading comes at all', () => {
    const published = ref<number | undefined>(40)
    const { beginSeek, holding } = useSeekHold(published)
    beginSeek(120)
    vi.advanceTimersByTime(SEEK_HOLD_MAX_MS + 600)
    expect(holding.value).toBe(false)
  })

  it('moves the held position on with the music while it plays, not while paused', async () => {
    const published = ref<number | undefined>(40)
    const playing = ref(true)
    const { seekDraft, beginSeek } = useSeekHold(published, undefined, () => playing.value)
    beginSeek(120)
    // a reading from before the gesture keeps the hold
    published.value = 41
    await nextTick()
    vi.advanceTimersByTime(1500)
    expect(seekDraft.value).toBe(121.5)
    playing.value = false
    vi.advanceTimersByTime(1000)
    expect(seekDraft.value).toBe(121.5)
  })

  it('clears when the device id changes', async () => {
    const published = ref<number | undefined>(40)
    const deviceId = ref('a')
    const { seekDraft, beginSeek, holding } = useSeekHold(published, deviceId)
    beginSeek(120)
    deviceId.value = 'b'
    await nextTick()
    expect(holding.value).toBe(false)
    expect(seekDraft.value).toBeNull()
  })
})

describe('formatClock', () => {
  it('writes m:ss under an hour, h:mm:ss beyond, nothing without a value', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(59.9)).toBe('0:59')
    expect(formatClock(3599)).toBe('59:59')
    expect(formatClock(3600)).toBe('1:00:00')
    expect(formatClock(14233)).toBe('3:57:13')
    expect(formatClock(undefined)).toBe('')
    expect(formatClock(NaN)).toBe('')
  })
})
