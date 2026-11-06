import type { ChannelColor, LightChannel } from '../../../core/lightStreamBridge'
import type { FeatureFrame } from '../analyze'
import { lerp, OnsetGate, out, type Effect, type EffectParams } from './common'

// "Strobe": dark between beats, a flash of the next palette colour on each strong attack. Calm
// keeps a dim glow and only reacts to the biggest hits; energetic goes black and flashes often.

/** Flash decay (s): short enough to read as a flash, long enough for the bridge's 25 Hz to show it. */
const FLASH_S = 0.08

export class StrobeEffect implements Effect {
  private readonly gate = new OnsetGate()
  private flash = 0
  private index = 0

  constructor(private readonly channels: readonly LightChannel[], private params: EffectParams) {}

  configure(params: EffectParams): void { this.params = params }

  next(frame: FeatureFrame | undefined, dtS: number): ChannelColor[] {
    const { palette, energy, brightness } = this.params
    this.flash *= Math.exp(-dtS / FLASH_S)
    // at most about three flashes a second, even energetic (faster is hard to bear, and the usual
    // photosensitivity limit)
    if (this.gate.fire(frame?.onset ?? 0, lerp(0.75, 0.4, energy), lerp(1, 0.35, energy), dtS)) {
      this.flash = 1
      this.index = (this.index + 1) % palette.length
    }
    const glow = lerp(0.15, 0, energy)
    const color = palette[this.index % palette.length]!
    return this.channels.map((c) => out(c.id, color, Math.max(glow, this.flash) * brightness))
  }
}
