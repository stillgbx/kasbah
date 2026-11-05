import type { ChannelColor, LightChannel } from '../../../core/lightStreamBridge'
import type { FeatureFrame } from '../analyze'
import { ColorFader, Envelope, lerp, Normalizer, OnsetGate, orderByX, out, type Effect, type EffectParams } from './common'

// "Pulse": brightness follows the bass (instant attack, release shorter when energetic), the
// channels take the palette's colours left to right and pass them on at each strong attack.

export class PulseEffect implements Effect {
  private readonly ordered: LightChannel[]
  private readonly bass = new Normalizer()
  private readonly env = new Envelope()
  private readonly gate = new OnsetGate()
  private readonly fader = new ColorFader()
  private shift = 0

  constructor(channels: readonly LightChannel[], private params: EffectParams) {
    this.ordered = orderByX(channels)
  }

  configure(params: EffectParams): void { this.params = params }

  next(frame: FeatureFrame | undefined, dtS: number): ChannelColor[] {
    const { palette, energy, brightness } = this.params
    const level = this.bass.level(frame?.low ?? 0, dtS)
    const env = this.env.follow(level, dtS, lerp(0.6, 0.12, energy))
    const floor = lerp(0.25, 0.05, energy)
    const b = (floor + (1 - floor) * env ** lerp(1, 2, energy)) * brightness
    if (this.gate.fire(frame?.onset ?? 0, lerp(0.6, 0.2, energy), lerp(1.2, 0.2, energy), dtS)) this.shift++
    return this.ordered.map((c, i) => out(c.id, this.fader.toward(c.id, palette[(i + this.shift) % palette.length]!, dtS, lerp(0.4, 0.08, energy)), b))
  }
}
