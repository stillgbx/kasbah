import { describe, expect, it } from 'vitest'
import { createEndpointer, NO_SPEECH_MS, rms, SILENCE_MS } from './vad'

// End of sentence guessed from the sound level: invented levels, one frame every 50 ms.

const FRAME = 50

/** Plays a sequence of `[level, duration in ms]` and returns the first event, with its instant. */
function play(...parts: [level: number, ms: number][]) {
  const vad = createEndpointer()
  let at = 0
  for (const [level, ms] of parts) {
    for (let end = at + ms; at < end; at += FRAME) {
      const event = vad.push(level, at)
      if (event) return { event, at }
    }
  }
  return null
}

describe('createEndpointer', () => {
  it('speech then silence: sends after the wanted silence, not before', () => {
    const r = play([0.002, 300], [0.1, 1500], [0.002, 3000])
    expect(r?.event).toBe('end')
    expect(r!.at - 1800).toBe(SILENCE_MS)
  })

  it('a hesitation shorter than the wanted silence does not cut the sentence', () => {
    const r = play([0.002, 300], [0.1, 800], [0.002, SILENCE_MS - 200], [0.1, 800], [0.002, 3000])
    expect(r?.event).toBe('end')
    expect(r!.at).toBeGreaterThan(300 + 800 + SILENCE_MS - 200 + 800)
  })

  it('nobody speaks: nothing heard after the delay', () => {
    expect(play([0.002, 10_000])).toEqual({ event: 'nothing', at: NO_SPEECH_MS })
  })

  it('a brief noise (door, slam) does not count as speech', () => {
    expect(play([0.002, 300], [0.3, 100], [0.002, 10_000])?.event).toBe('nothing')
  })

  it('a constant background music becomes the floor: the voice stands out from it, the end is visible', () => {
    const r = play([0.03, 1000], [0.2, 1500], [0.03, 3000])
    expect(r?.event).toBe('end')
    expect(r!.at - 2500).toBe(SILENCE_MS)
  })

  it('speech from the very first instant is heard (the floor drops back at the first gap)', () => {
    const r = play([0.1, 600], [0.003, 100], [0.1, 800], [0.003, 3000])
    expect(r?.event).toBe('end')
  })

  it('the null frames of the microphone opening do not skew the floor', () => {
    const r = play([0, 200], [0.02, 500], [0.15, 1000], [0.02, 3000])
    expect(r?.event).toBe('end')
  })

  it('nothing after the first event', () => {
    const vad = createEndpointer()
    let at = 0
    for (; at <= NO_SPEECH_MS; at += FRAME) vad.push(0.002, at)
    expect(vad.push(0.5, at)).toBeNull()
  })
})

describe('rms', () => {
  it('RMS level of a frame', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5)
    expect(rms(new Float32Array(0))).toBe(0)
  })
})
