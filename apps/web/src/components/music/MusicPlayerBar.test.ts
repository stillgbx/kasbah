import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceEntry } from '@kasbah/shared'
import MusicPlayerBar from './MusicPlayerBar.vue'

// The bar says what OUR server serves to the speaker: a constant-bitrate MP3, and in the tooltip
// what YouTube gave to produce it. The row keeps its place when nothing is playing ("nothing
// moves").

const entry = (playback: 'playing' | 'idle'): DeviceEntry => ({
  descriptor: {
    id: 'sonos:RINCON', pluginId: 'sonos', externalId: 'RINCON', kind: 'media_player', name: 'Bureau',
    capabilities: ['playback', 'now_playing', 'volume', 'mute', 'seek'],
    meta: { mediaPlayer: { deviceClass: 'speaker' } },
  },
  state: { kind: 'media_player', updatedAt: 0, available: true, playback, volume: 25, muted: false },
} as DeviceEntry)

const quality = {
  mime: 'audio/mpeg', bitrateKbps: 192, sampleRateHz: 48_000, channels: 2, lengthBytes: 5_961_600,
  source: { ext: 'm4a', formatId: '140', abrKbps: 129 },
}
const session = { durationS: 248, title: 'see through (remix)', artist: 'Samara Cyn', artUrl: null, quality }

const props = (over: Record<string, unknown> = {}) => ({
  entry: entry('playing'), name: 'Bureau', session, pending: null,
  transferMode: false, canTransfer: false, transferBusy: false, queueOpen: false, ...over,
})

/**
 * Between the click and the first byte served, a few seconds pass (yt-dlp resolution): the bar
 * already shows the title and cover art from the CATALOG. The badge must follow the same source,
 * otherwise it arrives late on an explicit track and stays on the next one, which is not.
 */
describe("MusicPlayerBar — badge explicit pendant l'envoi", () => {
  const playing = (over: Record<string, unknown> = {}) => ({
    ...props({ session: null }),
    entry: {
      descriptor: entry('playing').descriptor,
      state: { ...entry('playing').state, nowPlaying: { title: 'Ancien titre', explicit: true } },
    } as DeviceEntry,
    ...over,
  })

  it("immediately flags an explicit track being sent", () => {
    const w = mount(MusicPlayerBar, { props: playing({
      entry: entry('idle'),
      pending: { title: 'Nouveau', artists: ['A'], artUrl: null, explicit: true },
    }) })
    expect(w.find('.explicit').exists()).toBe(true)
  })

  it("clears it as of the next track, without waiting for the stream to start", () => {
    // the player is STILL playing the previous explicit track: the track being sent is what counts
    const w = mount(MusicPlayerBar, { props: playing({
      pending: { title: 'Sans marquage', artists: ['A'], artUrl: null },
    }) })
    expect(w.find('.bar__title').text()).toBe('Sans marquage')
    expect(w.find('.explicit').exists()).toBe(false)
  })

  it("takes the player's flag back once the send is over", () => {
    const w = mount(MusicPlayerBar, { props: playing() })
    expect(w.find('.explicit').exists()).toBe(true)
  })
})

/**
 * Playback of a paused track (the last listen, after a reload or a server restart): the restart
 * answers before the speaker publishes "playing". The button spins from the click until then,
 * without falling back in the meantime to a greyed-out "play".
 */
describe('MusicPlayerBar — waiting for playback', () => {
  const resume = { title: 'Mix', artist: 'DJ', artUrl: null, durationS: 3600, positionS: 1200, explicit: false }
  const main = (w: ReturnType<typeof mount>) => w.find('.key--main')
  const spinning = (w: ReturnType<typeof mount>) => main(w).find('.v-progress-circular').exists()

  it("spins from the click until the speaker plays, even after the send is over", async () => {
    const w = mount(MusicPlayerBar, { props: props({ entry: entry('idle'), session: null, resume }) })
    expect(spinning(w)).toBe(false)
    await main(w).trigger('click')
    expect(w.emitted('command')).toEqual([[{ type: 'media_player.play' }]])
    expect(spinning(w)).toBe(true)
    // the restart answered: the last listen is forgotten, the speaker has not said anything yet
    await w.setProps({ resume: null })
    expect(spinning(w)).toBe(true)
    await w.setProps({ entry: entry('playing') })
    expect(spinning(w)).toBe(false)
  })

  it("gives the button back if the speaker never follows", async () => {
    vi.useFakeTimers()
    try {
      const w = mount(MusicPlayerBar, { props: props({ entry: entry('idle'), session: null, resume }) })
      await main(w).trigger('click')
      expect(spinning(w)).toBe(true)
      vi.advanceTimersByTime(15_000)
      await w.vm.$nextTick()
      expect(spinning(w)).toBe(false)
    } finally { vi.useRealTimers() }
  })
})

/**
 * Skipping 10 s goes through the SAME path as a cursor drag (`seek` to the parent), and starts
 * from the DISPLAYED position: two quick presses add up instead of falling back onto a reading
 * that has not moved yet.
 */
describe('MusicPlayerBar — back / forward 10 s', () => {
  const at = (positionS: number, over: Record<string, unknown> = {}) => {
    const e = entry('playing')
    return {
      ...props(),
      entry: { descriptor: e.descriptor, state: { ...e.state, nowPlaying: { title: 'x', positionS, durationS: 248 }, ...over } } as DeviceEntry,
    }
  }
  const keys = (w: ReturnType<typeof mount>) => w.findAll('.key--jump')

  it("moves forward and back 10 s, and two quick presses add up", async () => {
    const w = mount(MusicPlayerBar, { props: at(100) })
    expect(keys(w)).toHaveLength(2)
    // two presses before the player has moved: 100 → 110 → 120, not 110 twice
    await keys(w)[1]!.trigger('click')
    await keys(w)[1]!.trigger('click')
    await keys(w)[0]!.trigger('click')
    expect(w.emitted('seek')).toEqual([[110], [120], [110]])
  })

  it('never leaves the track: neither before the start, nor after the end', async () => {
    const debut = mount(MusicPlayerBar, { props: at(4) })
    await keys(debut)[0]!.trigger('click')
    expect(debut.emitted('seek')).toEqual([[0]])

    const fin = mount(MusicPlayerBar, { props: at(245) })
    await keys(fin)[1]!.trigger('click')
    expect(fin.emitted('seek')).toEqual([[248]])
  })

  it('greys out both buttons on a live stream, which has neither a start nor an end', () => {
    const w = mount(MusicPlayerBar, { props: at(100, { nowPlaying: { title: 'radio', positionS: 100, live: true } }) })
    expect(keys(w).map((k) => k.attributes('disabled'))).toEqual(['', ''])
  })
})

describe('MusicPlayerBar — stream quality', () => {
  it('states the served format and bitrate, and details the source in a tooltip', () => {
    const w = mount(MusicPlayerBar, { props: props() })
    const q = w.find('.bar__quality')
    expect(q.text().replace(/\u00a0/g, ' ')).toBe('MP3 192 kb/s')
    const hint = q.attributes('title')?.replace(/\u00a0/g, ' ') ?? ''
    expect(hint).toContain('48 kHz')
    expect(hint).toContain('stéréo')
    expect(hint).toContain('6.0 Mo')
    expect(hint).toContain('source M4A 129 kb/s')
  })

  it('keeps the row in place when the player plays nothing from us', () => {
    const w = mount(MusicPlayerBar, { props: props({ entry: entry('idle'), session: null }) })
    const q = w.find('.bar__quality')
    expect(q.exists()).toBe(true)
    expect(q.text().trim()).toBe('')
  })
})

/**
 * The queue lives on the server: it is the queue, not the speaker (which only has a "file"), that
 * makes previous / next possible. Repeat takes the place that answers to stop.
 */
describe('MusicPlayerBar — queue and repeat', () => {
  const keys = (w: ReturnType<typeof mount>) => w.findAll('.bar__keys .key')
  const withQueue = (index: number, length: number, repeat = 'off') => props({ session: { ...session, queue: { length, index, repeat } } })

  it('enables next while the queue has a continuation, previous always', () => {
    const middle = mount(MusicPlayerBar, { props: withQueue(0, 3) })
    const [, prev, , , , next] = keys(middle)
    expect(prev!.attributes('disabled')).toBeUndefined()
    expect(next!.attributes('disabled')).toBeUndefined()
    const last = mount(MusicPlayerBar, { props: withQueue(2, 3) })
    expect(keys(last)[5]!.attributes('disabled')).toBeDefined()
    expect(keys(last)[1]!.attributes('disabled')).toBeUndefined()
  })

  it('cycles repeat: once, loop, stop', async () => {
    const w = mount(MusicPlayerBar, { props: withQueue(0, 1, 'once') })
    const repeat = keys(w)[0]!
    expect(repeat.attributes('data-on')).toBe('1')
    expect(repeat.find('.key__step').text()).toBe('1')
    await repeat.trigger('click')
    expect(w.emitted('repeat')).toEqual([['loop']])
    const off = mount(MusicPlayerBar, { props: withQueue(0, 1) })
    expect(keys(off)[0]!.find('.key__step').classes()).toContain('bar--hidden')
  })

  it('counts the pending tracks on the Queue button, without moving anything', () => {
    const w = mount(MusicPlayerBar, { props: withQueue(1, 5) })
    expect(w.find('.key__badge').text()).toBe('3')
    const none = mount(MusicPlayerBar, { props: withQueue(0, 1) })
    expect(none.find('.key__badge').classes()).toContain('bar--hidden')
  })

  it("with no queue or skip declared by the speaker, previous and next stay greyed out", () => {
    const w = mount(MusicPlayerBar, { props: props() })
    expect(keys(w)[1]!.attributes('disabled')).toBeDefined()
    expect(keys(w)[5]!.attributes('disabled')).toBeDefined()
    expect(keys(w)[0]!.attributes('disabled')).toBeDefined()
  })
})
