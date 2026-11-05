import type { ChannelColor, LightChannel } from '../../core/lightStreamBridge'
import type { FeatureFrame } from './analyze'

// "Pulse": the brightness follows the bass (fast attack, slow release), the channels take colours
// from a warm palette and swap them on strong attacks. Each track has its own loudness: the bass is
// read against its own recent peak, not on an absolute scale.

type Rgb = readonly [number, number, number]

/** Amber, pink, violet, orange: saturated enough to read as colour at low brightness. */
const PALETTE: readonly Rgb[] = [[1, 0.35, 0.05], [1, 0.08, 0.4], [0.55, 0.12, 1], [1, 0.6, 0.02]]
/** Brightness never drops below this while the music plays: the room never goes dark. */
const FLOOR = 0.12
/** Time constant of the release (s). */
const RELEASE_S = 0.25
/** Half-life of the peak the bass is compared with (s): a quiet passage brightens up after a few seconds. */
const PEAK_HALF_LIFE_S = 4
/** An attack must be this strong to swap the colours, and not closer than this to the previous swap. */
const SWAP_ONSET = 0.3
const SWAP_GAP_S = 0.3
/** Colour cross-fade time constant (s). */
const FADE_S = 0.12

export class PulseEffect {
  private peak = 1e-4
  private env = 0
  private shift = 0
  private sinceSwap = Infinity
  private prevOnset = 0
  private colors = new Map<number, [number, number, number]>()

  constructor(private readonly channels: readonly LightChannel[]) {}

  /** Next frame; `frame` undefined = nothing to follow (paused, still decoding): the lights settle. */
  next(frame: FeatureFrame | undefined, dtS: number): ChannelColor[] {
    const low = frame?.low ?? 0
    this.peak = Math.max(low, this.peak * 0.5 ** (dtS / PEAK_HALF_LIFE_S), 1e-4)
    const level = Math.min(1, low / this.peak)
    this.env = Math.max(level, this.env * Math.exp(-dtS / RELEASE_S))
    const brightness = FLOOR + (1 - FLOOR) * this.env ** 1.5

    // rising edge only: an attack spans a frame or two
    const onset = frame?.onset ?? 0
    this.sinceSwap += dtS
    if (onset >= SWAP_ONSET && this.prevOnset < SWAP_ONSET && this.sinceSwap >= SWAP_GAP_S) {
      this.shift++
      this.sinceSwap = 0
    }
    this.prevOnset = onset

    const k = 1 - Math.exp(-dtS / FADE_S)
    // channels sorted left to right: neighbours get neighbouring colours
    const ordered = [...this.channels].sort((a, b) => a.x - b.x)
    return ordered.map((c, i) => {
      const target = PALETTE[(i + this.shift) % PALETTE.length]!
      const cur = this.colors.get(c.id) ?? [...target] as [number, number, number]
      for (let j = 0; j < 3; j++) cur[j] = cur[j]! + (target[j]! - cur[j]!) * k
      this.colors.set(c.id, cur)
      return { id: c.id, r: cur[0] * brightness, g: cur[1] * brightness, b: cur[2] * brightness }
    })
  }
}
