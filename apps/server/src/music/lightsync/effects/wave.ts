import type { ChannelColor, LightChannel } from '../../../core/lightStreamBridge'
import type { FeatureFrame } from '../analyze'
import { Envelope, lerp, Normalizer, orderByX, out, sample, type Effect, type EffectParams } from './common'

// "Wave": the palette rolls from one light to the next, left to right. It moves faster when the
// music is loud and when energetic; brightness breathes with the overall level.

export class WaveEffect implements Effect {
  private readonly ordered: LightChannel[]
  private readonly loud = new Normalizer()
  private readonly env = new Envelope()
  /** Position in the palette, in colours. */
  private phase = 0

  constructor(channels: readonly LightChannel[], private params: EffectParams) {
    this.ordered = orderByX(channels)
  }

  configure(params: EffectParams): void { this.params = params }

  next(frame: FeatureFrame | undefined, dtS: number): ChannelColor[] {
    const { palette, energy, brightness } = this.params
    const level = this.loud.level(frame ? frame.low + 0.5 * frame.mid : 0, dtS)
    const env = this.env.follow(level, dtS, lerp(1.2, 0.3, energy))
    // colours per second: a slow drift when calm, a run when energetic, both pushed by the music
    this.phase += dtS * lerp(0.08, 0.6, energy) * (0.4 + 1.2 * env)
    const floor = lerp(0.35, 0.1, energy)
    const b = (floor + (1 - floor) * env) * brightness
    const n = this.ordered.length
    // the whole room spans one colour step of the palette: neighbours differ, the wave stays readable
    return this.ordered.map((c, i) => out(c.id, sample(palette, this.phase + (n > 1 ? i / n : 0)), b))
  }
}
