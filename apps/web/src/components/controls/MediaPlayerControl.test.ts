import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { setTransport } from '../../api'
import type { Transport } from '../../api/transport'
import { SEEK_HOLD_MIN_MS } from '../../composables/useMediaPosition'
import MediaPlayerControl from './MediaPlayerControl.vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(() => Promise.resolve()) }) }))

// What a player displays when it says almost nothing: native app of an Android TV (Prime Video),
// live stream without a duration, or late metadata. Cases observed on the real thing, see the wiki 3_6_google-cast.

const descriptor: DeviceDescriptor = {
  id: 'google_cast:tv', pluginId: 'google_cast', externalId: 'tv', kind: 'media_player', name: 'TV Salon',
  capabilities: ['playback', 'now_playing', 'track_skip', 'seek', 'volume', 'mute'],
  meta: { mediaPlayer: { deviceClass: 'tv' } },
}
const base: StateFor<'media_player'> = { kind: 'media_player', updatedAt: 0, available: true, playback: 'playing', volume: 20, muted: false }

const times = (w: ReturnType<typeof mount>) => w.find('.now__times')
const hidden = (w: ReturnType<typeof mount>, sel: string) => w.find(sel).classes().includes('now--hidden')
// transport row: repeat, previous, −10 s, play, +10 s, next, stop
const KEY = { repeat: 0, previous: 1, back: 2, play: 3, forward: 4, next: 5, stop: 6 } as const

describe('MediaPlayerControl', () => {
  it('names the app when there is no title, without an endless waiting marker', () => {
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, nowPlaying: { title: '', source: 'Prime Video', positionS: 141.89 } } } })
    expect(w.text()).toContain('Prime Video')
    expect(w.text()).not.toContain('…')
  })

  it('shows the position alone when the duration is unknown, and never a negative time', () => {
    // Prime Video announces `duration: -0.001`: the plugin removes it, but the UI must not
    // make a time out of it either if it arrives anyway (other plugin, simulation)
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, nowPlaying: { title: '', source: 'Prime Video', positionS: 141.89, durationS: -0.001 } } } })
    expect(times(w).text()).toBe('2:21')                    // position only, no total
    expect(times(w).text()).not.toContain('-')
    expect(w.findAll('.now__times > .now--hidden')).toHaveLength(0) // the times are visible
    expect(hidden(w, '.now__seek')).toBe(true)              // the slider is not: nothing to scrub
  })

  it('shows both times and an active slider on a real duration', () => {
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, nowPlaying: { title: 'Terracotta', source: 'Spotify', positionS: 42.5, durationS: 187.2 } } } })
    expect(times(w).text()).toBe('0:423:07')
    expect(hidden(w, '.now__seek')).toBe(false)
  })

  it('greys out previous / next / jumps / repeat / seek on a live stream, but not play-pause nor stop', () => {
    // the franceinfo live stream: "previous" cut the stream there (SEEK to 0 on the plugin side)
    const live = { descriptor, state: { ...base, nowPlaying: { title: 'franceinfo', source: 'Radio France', positionS: 38.2, live: true } } }
    const keys = mount(MediaPlayerControl, { props: live }).findAll('.v-btn')
    for (const k of ['repeat', 'previous', 'back', 'forward', 'next'] as const) expect(keys[KEY[k]]!.attributes('disabled'), k).toBeDefined()
    expect(keys[KEY.play]!.attributes('disabled')).toBeUndefined()    // play / pause
    expect(keys[KEY.stop]!.attributes('disabled')).toBeUndefined()    // stop
    // a live stream with a duration (rare) is no more scrubbable
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...live.state, nowPlaying: { ...live.state.nowPlaying, durationS: 3600 } } } })
    expect(w.find('.now__seek input').attributes('disabled')).toBeDefined()
  })

  it('keeps previous, next and the 10 s jumps active on an ordinary track', () => {
    const keys = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, nowPlaying: { title: 'Terracotta', positionS: 42.5, durationS: 187.2 } } } }).findAll('.v-btn')
    for (const k of ['previous', 'back', 'play', 'forward', 'next', 'stop'] as const) expect(keys[KEY[k]]!.attributes('disabled'), k).toBeUndefined()
    // without a Kasbah stream, no queue: nothing to repeat
    expect(keys[KEY.repeat]!.attributes('disabled')).toBeDefined()
  })

  it('jumps 10 s from the shown position, clamped to the track', async () => {
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, playback: 'paused', nowPlaying: { title: 'Terracotta', positionS: 180, durationS: 187.2 } } } })
    const keys = w.findAll('.v-btn')
    await keys[KEY.back]!.trigger('click')
    expect(w.emitted('command')?.[0]).toEqual([{ type: 'media_player.seek', positionS: 170 }])
    await keys[KEY.forward]!.trigger('click')
    await keys[KEY.forward]!.trigger('click')
    expect(w.emitted('command')?.[2]).toEqual([{ type: 'media_player.seek', positionS: 187 }])
  })

  it('keeps the four lines of the block when nothing plays (nothing must move)', () => {
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, playback: 'idle' } } })
    expect(times(w).exists()).toBe(true)
    expect(w.findAll('.now__times > .now--hidden')).toHaveLength(2)  // the two times
    expect(hidden(w, '.now__seek')).toBe(true)
  })

  it('keeps the seek draft until the published position nears the target', async () => {
    vi.useFakeTimers()
    try {
      const state = { ...base, playback: 'paused' as const, nowPlaying: { title: 'Terracotta', positionS: 40, durationS: 200 } }
      const w = mount(MediaPlayerControl, { props: { descriptor, state } })
      const sliders = w.findAllComponents({ name: 'VSlider' })
      // first VSlider = position; the second is the volume
      await sliders[0]!.vm.$emit('end', 120)
      expect(w.emitted('command')?.[0]).toEqual([{ type: 'media_player.seek', positionS: 120 }])
      expect(times(w).text().startsWith('2:00')).toBe(true)

      // optimistic echo then a reading from before the gesture: the target stays displayed
      await w.setProps({ state: { ...state, nowPlaying: { ...state.nowPlaying, positionS: 120 } } })
      await w.setProps({ state: { ...state, nowPlaying: { ...state.nowPlaying, positionS: 42 } } })
      expect(times(w).text().startsWith('2:00')).toBe(true)

      // the real reading, after the minimum hold
      vi.advanceTimersByTime(SEEK_HOLD_MIN_MS + 100)
      await w.setProps({ state: { ...state, nowPlaying: { ...state.nowPlaying, positionS: 119 } } })
      expect(times(w).text().startsWith('1:59')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the quality of a Kasbah stream and lets its queue drive next and repeat', async () => {
    vi.useFakeTimers()
    const queue = { items: [], index: 0, repeat: 'once' as const }
    const musicQueueNext = vi.fn(async () => queue)
    const musicQueueRepeat = vi.fn(async () => queue)
    setTransport({
      musicSessions: async () => ({ sessions: [{
        deviceId: 'google_cast:tv', source: 'ytmusic', id: 'abc', sid: 's1', durationS: 187,
        quality: { mime: 'audio/mpeg', bitrateKbps: 192 }, queue: { length: 3, index: 0, repeat: 'off' },
      }] }),
      musicQueueNext, musicQueuePrevious: vi.fn(async () => queue), musicQueueRepeat,
    } as unknown as Transport)
    try {
      const castable = { ...descriptor, capabilities: [...descriptor.capabilities, 'play_url' as const] }
      const w = mount(MediaPlayerControl, { props: { descriptor: castable, state: { ...base, nowPlaying: { title: 'Terracotta', positionS: 42.5, durationS: 187.2 } } } })
      await vi.waitFor(() => expect(w.find('.now__quality').text()).toBe('MP3 192 kb/s'))
      const keys = w.findAll('.v-btn')
      expect(keys[KEY.repeat]!.attributes('disabled')).toBeUndefined()
      await keys[KEY.next]!.trigger('click')
      expect(musicQueueNext).toHaveBeenCalledWith('google_cast:tv')
      expect(w.emitted('command')).toBeUndefined()   // the queue jumps, not the speaker
      await keys[KEY.repeat]!.trigger('click')
      expect(musicQueueRepeat).toHaveBeenCalledWith('google_cast:tv', 'once')
    } finally {
      setTransport(null)
      vi.useRealTimers()
    }
  })

  it("shows a radio's quality from the directory while the player plays that station live", async () => {
    const station = { id: 'fi', name: 'France Info', url: 'http://x/fi.mp3', tags: [], codec: 'MP3', bitrateKbps: 128 }
    setTransport({
      musicSessions: async () => ({ sessions: [] }),
      radioPlaying: async () => ({ playing: [{ deviceId: 'google_cast:tv', station }] }),
    } as unknown as Transport)
    try {
      const castable = { ...descriptor, capabilities: [...descriptor.capabilities, 'play_url' as const] }
      const live = { ...base, nowPlaying: { title: 'France Info', artist: 'France', positionS: 30, live: true } }
      const w = mount(MediaPlayerControl, { props: { descriptor: castable, state: live } })
      await vi.waitFor(() => expect(w.find('.now__quality').text()).toBe('MP3 128 kb/s'))
      // moved on to something else: the station no longer says anything about what it plays
      await w.setProps({ state: { ...live, nowPlaying: { ...live.nowPlaying, title: 'FIP' } } })
      expect(w.find('.now__quality').text()).toBe('')
    } finally {
      setTransport(null)
    }
  })
})
