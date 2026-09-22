import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import type { StateFor } from '@kasbah/shared'
import { MEDIA_POSITION_SLACK_S, SEEK_HOLD_MAX_MS, SEEK_HOLD_MIN_MS, useMediaPosition, useSeekHold } from './useMediaPosition'

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
})

describe('useSeekHold', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const settle = () => vi.advanceTimersByTime(SEEK_HOLD_MIN_MS + 100)

  it('ignores the optimistic echo of its own command, then releases on the device confirmation', async () => {
    const published = ref<number | undefined>(40)
    const { seekDraft, beginSeek, holding } = useSeekHold(published)
    beginSeek(120)
    // le store répercute la commande tout de suite : la cible exacte, avant tout relevé
    published.value = 120
    await nextTick()
    expect(holding.value).toBe(true)
    expect(seekDraft.value).toBe(120)
    // relevé d'avant le geste : toujours tenu
    published.value = 41
    await nextTick()
    expect(holding.value).toBe(true)
    // le vrai relevé, après la tenue minimale : relâché
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
    // même valeur : le watch ne re-déclenche pas ; on force un tick voisin encore dans la marge
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
