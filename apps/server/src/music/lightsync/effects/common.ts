import type { ChannelColor, LightChannel } from '../../../core/lightStreamBridge'
import type { FeatureFrame } from '../analyze'

// What every effect shares: its parameters, the reading of a band against its own recent peak
// (each track has its own loudness), colour cross-fades, and the "energy" mapping — 0 = calm,
// 1 = energetic, every derived setting moves monotonically between the two.

export type Rgb = readonly [number, number, number]

export interface EffectParams {
  /** At least one colour; effects cycle through it. */
  palette: readonly Rgb[]
  /** 0 = calm … 1 = energetic. */
  energy: number
  /** Maximum brightness, 0..1. */
  brightness: number
}

export interface Effect {
  /** Next frame; `frame` undefined = nothing to follow (paused, still decoding): the lights settle. */
  next(frame: FeatureFrame | undefined, dtS: number): ChannelColor[]
  /** New parameters, applied without resetting the effect's state: no jolt while the music plays. */
  configure(params: EffectParams): void
}

export const lerp = (calm: number, energetic: number, energy: number) => calm + (energetic - calm) * Math.min(1, Math.max(0, energy))

/** Channels left to right (then front to back): neighbouring lights get neighbouring colours. */
export function orderByX(channels: readonly LightChannel[]): LightChannel[] {
  return [...channels].sort((a, b) => a.x - b.x || a.y - b.y)
}

/** A band read against its own recent peak, which slowly forgets (a quiet passage brightens up). */
export class Normalizer {
  private peak = 1e-4
  constructor(private readonly halfLifeS = 4) {}
  get currentPeak(): number { return this.peak }
  /** `minPeak`: a reference the band is never read against less than (a nearly silent band stays dark). */
  level(value: number, dtS: number, minPeak = 0): number {
    this.peak = Math.max(value, this.peak * 0.5 ** (dtS / this.halfLifeS), 1e-4)
    return Math.min(1, value / Math.max(this.peak, minPeak))
  }
}

/** Instant attack, exponential release. */
export class Envelope {
  value = 0
  follow(level: number, dtS: number, releaseS: number): number {
    this.value = Math.max(level, this.value * Math.exp(-dtS / Math.max(0.01, releaseS)))
    return this.value
  }
}

/** Per-channel colour that glides towards its target (time constant in s). */
export class ColorFader {
  private readonly current = new Map<number, [number, number, number]>()
  toward(id: number, target: Rgb, dtS: number, tauS: number): Rgb {
    const cur = this.current.get(id) ?? [target[0], target[1], target[2]]
    const k = 1 - Math.exp(-dtS / Math.max(0.01, tauS))
    for (let j = 0; j < 3; j++) cur[j] = cur[j]! + (target[j]! - cur[j]!) * k
    this.current.set(id, cur)
    return cur
  }
}

/** Colour at a fractional position of the palette, interpolated, wrapping around. */
export function sample(palette: readonly Rgb[], position: number): Rgb {
  const n = palette.length
  const p = ((position % n) + n) % n
  const i = Math.floor(p)
  const f = p - i
  const a = palette[i]!
  const b = palette[(i + 1) % n]!
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

export function out(id: number, rgb: Rgb, brightness: number): ChannelColor {
  return { id, r: rgb[0] * brightness, g: rgb[1] * brightness, b: rgb[2] * brightness }
}

/** Rising edge of an attack, at most one per `gapS`. */
export class OnsetGate {
  private prev = 0
  private since = Infinity
  fire(onset: number, threshold: number, gapS: number, dtS: number): boolean {
    this.since += dtS
    const rising = onset >= threshold && this.prev < threshold
    this.prev = onset
    if (rising && this.since >= gapS) { this.since = 0; return true }
    return false
  }
}
