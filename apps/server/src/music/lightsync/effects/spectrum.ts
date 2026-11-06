import type { ChannelColor, LightChannel } from '../../../core/lightStreamBridge'
import type { FeatureFrame } from '../analyze'
import { ColorFader, Envelope, lerp, Normalizer, orderByX, out, type Effect, type EffectParams, type Rgb } from './common'

// "Spectrum": the lights share out the bands, left to right — bass, mids, highs — each with its
// colour of the palette and its own level. A single light shows the three mixed, weighted by level.

const BANDS = ['low', 'mid', 'high'] as const
const MIN_SHARE = 0.15

export class SpectrumEffect implements Effect {
  private readonly ordered: LightChannel[]
  private readonly norms = BANDS.map(() => new Normalizer())
  private readonly envs = BANDS.map(() => new Envelope())
  private readonly fader = new ColorFader()

  constructor(channels: readonly LightChannel[], private params: EffectParams) {
    this.ordered = orderByX(channels)
  }

  configure(params: EffectParams): void { this.params = params }

  next(frame: FeatureFrame | undefined, dtS: number): ChannelColor[] {
    const { palette, energy, brightness } = this.params
    const release = lerp(0.7, 0.2, energy)
    const attack = lerp(0.15, 0.04, energy)
    // each band against its own peak (highs are quieter than bass by nature), but never against
    // less than a share of the loudest band: a band with almost nothing in it stays dark
    const loudest = Math.max(...this.norms.map((n) => n.currentPeak))
    const levels = BANDS.map((band, k) => this.envs[k]!.follow(this.norms[k]!.level(frame?.[band] ?? 0, dtS, MIN_SHARE * loudest), dtS, release, attack))
    const floor = lerp(0.3, 0.12, energy)
    const gamma = lerp(1, 1.5, energy)
    const colorOf = (k: number): Rgb => palette[k % palette.length]!
    const n = this.ordered.length
    if (n === 1) {
      const total = levels.reduce((s, v) => s + v, 0) || 1
      const mix: [number, number, number] = [0, 0, 0]
      levels.forEach((v, k) => { const c = colorOf(k); for (let j = 0; j < 3; j++) mix[j] = mix[j]! + c[j]! * (v / total) })
      const top = Math.max(...levels)
      const c = this.ordered[0]!
      return [out(c.id, this.fader.toward(c.id, mix, dtS, 0.1), (floor + (1 - floor) * top ** gamma) * brightness)]
    }
    return this.ordered.map((c, i) => {
      const k = Math.min(2, Math.floor((i * BANDS.length) / n))
      return out(c.id, colorOf(k), (floor + (1 - floor) * levels[k]! ** gamma) * brightness)
    })
  }
}
