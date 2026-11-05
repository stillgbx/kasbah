import { describe, expect, it } from 'vitest'
import { FeatureExtractor, fft, HOP_S, SAMPLE_RATE } from './analyze'

/** Silence with sine bursts: `[startS, durationS, hz]`. */
function signal(lengthS: number, bursts: [number, number, number][]): Float32Array {
  const pcm = new Float32Array(Math.round(lengthS * SAMPLE_RATE))
  for (const [start, dur, hz] of bursts) {
    const a = Math.round(start * SAMPLE_RATE)
    const b = Math.min(pcm.length, Math.round((start + dur) * SAMPLE_RATE))
    for (let i = a; i < b; i++) pcm[i] = 0.8 * Math.sin((2 * Math.PI * hz * (i - a)) / SAMPLE_RATE)
  }
  return pcm
}

function run(pcm: Float32Array, chunk = 1000, startS = 0): FeatureExtractor {
  const fx = new FeatureExtractor(startS)
  for (let i = 0; i < pcm.length; i += chunk) fx.push(pcm.subarray(i, i + chunk))
  return fx
}

/** Times (s) of the frames whose onset is set. */
function onsetTimes(fx: FeatureExtractor): number[] {
  const out: number[] = []
  for (let i = 0; i < fx.frames; i++) if (fx.at(fx.startS + (i + 0.5) * HOP_S)!.onset > 0) out.push(fx.startS + (i + 1) * HOP_S)
  return out
}

describe('fft', () => {
  it('puts a pure tone in its bin', () => {
    const n = 64
    const re = Float32Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 8 * i) / n))
    const im = new Float32Array(n)
    fft(re, im)
    const mags = Array.from(re, (r, k) => Math.hypot(r, im[k]!))
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(8)
    expect(mags[8]).toBeCloseTo(n / 2, 3)
  })
})

describe('FeatureExtractor', () => {
  it('produces one frame per 20 ms and maps a position to its frame', () => {
    const fx = run(signal(2, []))
    expect(fx.frames).toBe(100)
    expect(fx.endS).toBeCloseTo(2, 6)
    expect(fx.at(-0.01)).toBeUndefined()
    expect(fx.at(2.5)).toBeUndefined()
    expect(fx.at(1)).toEqual({ low: 0, mid: 0, high: 0, onset: 0 })
  })

  it('flags an attack at each burst, never in the silence between them', () => {
    const fx = run(signal(3, [[0.5, 0.15, 80], [1.2, 0.15, 80], [2.1, 0.15, 3000]]))
    const times = onsetTimes(fx)
    for (const burst of [0.5, 1.2, 2.1]) {
      // the window looks back 43 ms: the attack shows within a few frames after the sound starts
      expect(times.some((t) => t >= burst && t <= burst + 0.08)).toBe(true)
    }
    expect(times.every((t) => [0.5, 1.2, 2.1].some((b) => t >= b && t <= b + 0.2))).toBe(true)
  })

  it('puts a bass note in the low band and a cymbal-like tone in the high band', () => {
    const fx = run(signal(2, [[0.2, 0.5, 80], [1.2, 0.5, 4000]]))
    const bass = fx.at(0.5)!
    const hiss = fx.at(1.5)!
    expect(bass.low).toBeGreaterThan(10 * bass.high)
    expect(bass.low).toBeGreaterThan(bass.mid)
    expect(hiss.high).toBeGreaterThan(10 * hiss.low)
  })

  it('gives the same frames whatever the chunk size ffmpeg delivers', () => {
    const pcm = signal(1.5, [[0.3, 0.2, 200], [0.9, 0.1, 2500]])
    const a = run(pcm, 7)
    const b = run(pcm, 4096)
    expect(a.frames).toBe(b.frames)
    for (let t = 0.01; t < 1.5; t += 0.1) expect(a.at(t)).toEqual(b.at(t))
  })

  it('indexes frames from the position the decoding started at', () => {
    const fx = run(signal(1, [[0.4, 0.2, 80]]), 1000, 120)
    expect(fx.at(119.9)).toBeUndefined()
    expect(fx.endS).toBeCloseTo(121, 6)
    expect(fx.at(120.5)!.low).toBeGreaterThan(0)
  })
})
