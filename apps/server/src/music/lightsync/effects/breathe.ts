import type { ChannelColor, LightChannel } from '../../../core/lightStreamBridge'
import type { FeatureFrame } from '../analyze'
import { lerp, Normalizer, orderByX, out, sample, type Effect, type EffectParams } from './common'

// "Breathe": slow and soft. Brightness follows the overall energy over a few seconds (no beat),
// the colours drift through the palette, each light a little behind its left neighbour.

export class BreatheEffect implements Effect {
  private readonly ordered: LightChannel[]
  private readonly loud = new Normalizer(8)
  private level = 0
  private phase = 0

  constructor(channels: readonly LightChannel[], private params: EffectParams) {
    this.ordered = orderByX(channels)
  }

  configure(params: EffectParams): void { this.params = params }

  next(frame: FeatureFrame | undefined, dtS: number): ChannelColor[] {
    const { palette, energy, brightness } = this.params
    const target = this.loud.level(frame ? frame.low + frame.mid + frame.high : 0, dtS)
    // symmetric smoothing, no instant attack: it rises and falls like a breath
    const tau = lerp(4, 1.5, energy)
    this.level += (target - this.level) * (1 - Math.exp(-dtS / tau))
    this.phase += dtS * palette.length / lerp(30, 8, energy)
    const floor = lerp(0.3, 0.15, energy)
    const b = (floor + (1 - floor) * this.level) * brightness
    return this.ordered.map((c, i) => out(c.id, sample(palette, this.phase - i * 0.15), b))
  }
}
