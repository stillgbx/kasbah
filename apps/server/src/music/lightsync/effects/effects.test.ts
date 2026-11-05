import { describe, expect, it } from 'vitest'
import type { ChannelColor, LightChannel } from '../../../core/lightStreamBridge'
import type { FeatureFrame } from '../analyze'
import { createEffect, type EffectParams, type Rgb } from './index'
import { PulseEffect } from './pulse'
import { WaveEffect } from './wave'

const RED: Rgb = [1, 0, 0]
const GREEN: Rgb = [0, 1, 0]
const BLUE: Rgb = [0, 0, 1]
const params = (over: Partial<EffectParams> = {}): EffectParams => ({ palette: [RED, GREEN, BLUE], energy: 0.5, brightness: 1, ...over })
const channels = (n: number): LightChannel[] => Array.from({ length: n }, (_, i) => ({ id: i, x: n === 1 ? 0 : -1 + (2 * i) / (n - 1), y: 0, z: 0 }))
const frame = (f: Partial<FeatureFrame> = {}): FeatureFrame => ({ low: 0, mid: 0, high: 0, onset: 0, ...f })
const peak = (c: ChannelColor) => Math.max(c.r, c.g, c.b)
const run = (n: number, fn: (i: number) => ChannelColor[]) => { let last: ChannelColor[] = []; for (let i = 0; i < n; i++) last = fn(i); return last }

describe('every effect', () => {
  for (const kind of ['pulse', 'wave', 'spectrum', 'strobe', 'breathe'] as const) {
    it(`${kind}: one colour per channel, within 0..brightness, settling when the music stops`, () => {
      const fx = createEffect(kind, channels(3), params({ brightness: 0.6 }))
      const loud = run(100, (i) => fx.next(frame({ low: 0.5, mid: 0.3, high: 0.2, onset: i % 25 === 0 ? 1 : 0 }), 0.02))
      expect(loud.map((c) => c.id).sort()).toEqual([0, 1, 2])
      for (const c of loud) for (const v of [c.r, c.g, c.b]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(0.6 + 1e-9) }
      const quiet = run(500, () => fx.next(undefined, 0.02))
      expect(Math.max(...quiet.map(peak))).toBeLessThanOrEqual(0.6 * 0.35)
    })
  }
})

describe('PulseEffect', () => {
  it('releases faster and contrasts more when energetic', () => {
    const settle = (energy: number) => {
      const fx = new PulseEffect(channels(1), params({ energy }))
      run(20, () => fx.next(frame({ low: 0.5 }), 0.02))
      return peak(run(10, () => fx.next(frame({ low: 0 }), 0.02))[0]!)
    }
    expect(settle(1)).toBeLessThan(settle(0))
  })

  it('passes the colours on at a strong attack, once per attack', () => {
    const fx = new PulseEffect(channels(2), params({ palette: [RED, BLUE], energy: 1 }))
    const steady = frame({ low: 0.5 })
    const before = run(50, () => fx.next(steady, 0.02))
    fx.next({ ...steady, onset: 1 }, 0.02)
    fx.next({ ...steady, onset: 1 }, 0.02)
    const after = run(50, () => fx.next(steady, 0.02))
    expect(after[0]!.b).toBeCloseTo(before[1]!.b, 2)
    expect(after[1]!.r).toBeCloseTo(before[0]!.r, 2)
  })

  it('takes new settings without starting over', () => {
    const fx = new PulseEffect(channels(1), params())
    run(30, () => fx.next(frame({ low: 0.5 }), 0.02))
    fx.configure(params({ brightness: 0.5 }))
    expect(peak(fx.next(frame({ low: 0.5 }), 0.02)[0]!)).toBeCloseTo(0.5, 1)   // still at full level, halved
  })
})

describe('WaveEffect', () => {
  it('rolls the palette further when energetic', () => {
    const drift = (energy: number) => {
      const fx = new WaveEffect(channels(1), params({ palette: [RED, BLUE], energy }))
      const a = fx.next(frame({ low: 0.5 }), 0.02)[0]!
      const b = run(50, () => fx.next(frame({ low: 0.5 }), 0.02))[0]!
      return Math.abs(b.b / peak(b) - a.b / peak(a))
    }
    expect(drift(1)).toBeGreaterThan(drift(0))
  })
})

describe('SpectrumEffect', () => {
  it('puts the bass on the leftmost light and the highs on the rightmost', () => {
    const fx = createEffect('spectrum', channels(3), params({ energy: 1 }))
    const bassOnly = run(30, () => fx.next(frame({ low: 0.5, mid: 0.001, high: 0.001 }), 0.02))
    const byId = (id: number) => bassOnly.find((c) => c.id === id)!
    expect(byId(0).r).toBeGreaterThan(0.9)          // left = bass = first colour (red), loud
    expect(peak(byId(2))).toBeLessThan(peak(byId(0)))
  })
})

describe('StrobeEffect', () => {
  it('stays dark between attacks and flashes on one', () => {
    const fx = createEffect('strobe', channels(2), params({ energy: 1 }))
    const dark = run(20, () => fx.next(frame({ low: 0.5 }), 0.02))
    expect(Math.max(...dark.map(peak))).toBe(0)
    const flash = fx.next(frame({ low: 0.5, onset: 1 }), 0.02)
    expect(Math.max(...flash.map(peak))).toBeGreaterThan(0.7)
    const after = run(15, () => fx.next(frame({ low: 0.5 }), 0.02))
    expect(Math.max(...after.map(peak))).toBeLessThan(0.1)
  })
})

describe('BreatheEffect', () => {
  it('never jumps: a sudden loud hit only nudges the brightness', () => {
    const fx = createEffect('breathe', channels(1), params())
    const before = peak(run(100, () => fx.next(frame({ low: 0.01 }), 0.02))[0]!)
    const hit = peak(fx.next(frame({ low: 1, mid: 1, high: 1, onset: 1 }), 0.02)[0]!)
    expect(hit - before).toBeLessThan(0.05)
  })
})
