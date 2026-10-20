import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { setTransport } from '../api'
import type { Transport } from '../api/transport'
import { useLocalPlayerStore } from './localPlayer'

// The last listening on "This browser" survives the page reload: the queue and the position
// are kept here, the track comes back paused at its position, play restarts it from there.

const queue = {
  items: [
    { source: 'mixcloud', id: '/a/mix-1/', title: 'Mix 1', artist: 'A', durationS: 3600 },
    { source: 'mixcloud', id: '/a/mix-2/', title: 'Mix 2', artist: 'A', durationS: 3600 },
  ],
  index: 0,
  repeat: 'off' as const,
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  setTransport({ musicProgress: async () => {} } as unknown as Transport)
})
afterEach(() => setTransport(null))

describe('local player last listening', () => {
  it('keeps the queue and the position as they change', async () => {
    const local = useLocalPlayerStore()
    local.adopt({ streamUrl: 'data:,', session: { deviceId: local.id, source: 'mixcloud', id: '/a/mix-1/', sid: 's', durationS: 3600, title: 'Mix 1', artist: 'A', artUrl: null }, positionS: 0, queue })
      .catch(() => { /* no sound in the tests */ })
    await nextTick()
    local.seek(125)
    await nextTick()
    expect(JSON.parse(localStorage.getItem('kasbah.music.localQueue')!)).toMatchObject({ index: 0, items: [{ id: '/a/mix-1/' }, { id: '/a/mix-2/' }] })
    expect(localStorage.getItem('kasbah.music.localPosition')).toBe('125')
    local.stop()
    await nextTick()
    expect(localStorage.getItem('kasbah.music.localQueue')).toBeNull()
  })

  it('shows the saved track paused at its position after a reload, and resumes it from there', async () => {
    localStorage.setItem('kasbah.music.localQueue', JSON.stringify(queue))
    localStorage.setItem('kasbah.music.localPosition', '1834')
    const musicLocalPlay = vi.fn(async () => { throw new Error('stop here') })
    setTransport({ musicLocalPlay, musicProgress: async () => {} } as unknown as Transport)
    const local = useLocalPlayerStore()

    const st = local.entry.state
    expect(st).toMatchObject({ kind: 'media_player', playback: 'paused', nowPlaying: { title: 'Mix 1', positionS: 1834, durationS: 3600 } })
    expect(local.barSession).toMatchObject({ title: 'Mix 1', queue: { length: 2, index: 0 } })

    // nothing loaded: the slider only chooses where it will restart from
    local.seek(1900)
    expect(local.entry.state).toMatchObject({ nowPlaying: { positionS: 1900 } })
    expect(musicLocalPlay).not.toHaveBeenCalled()

    local.command({ type: 'media_player.play' })
    await vi.waitFor(() => expect(musicLocalPlay).toHaveBeenCalledWith(expect.objectContaining({ source: 'mixcloud', id: '/a/mix-1/' })))
  })
})
