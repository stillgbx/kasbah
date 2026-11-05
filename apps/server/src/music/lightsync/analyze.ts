// Audio features for the light sync, computed from mono PCM as it arrives: one frame every 20 ms
// with the energy of three bands and the strength of an attack. Nothing of the PCM is kept beyond
// one window, so a mix several hours long costs a few MB of features, not hundreds of MB of samples.

/** Rate ffmpeg decodes to: 240 samples = exactly one 20 ms hop. */
export const SAMPLE_RATE = 12_000
export const HOP = 240
export const HOP_S = HOP / SAMPLE_RATE
const WINDOW = 512
const BIN_HZ = SAMPLE_RATE / WINDOW

/** Band edges (Hz): kick and bass, voice and most instruments, cymbals and hi-hats. */
const BANDS = { low: [30, 150], mid: [150, 2000], high: [2000, 6000] } as const
const binRange = ([lo, hi]: readonly [number, number]) => [Math.max(1, Math.round(lo / BIN_HZ)), Math.min(WINDOW / 2 - 1, Math.round(hi / BIN_HZ))] as const

/** Attack: spectral flux above `ONSET_RATIO` × its mean over the last second. */
const FLUX_HISTORY = 50
const ONSET_RATIO = 1.5
/** Floor of that mean: after a silence, the first note is an attack, the hiss of a quiet passage is not. */
const FLUX_FLOOR = 1

export interface FeatureFrame {
  /** RMS-like energy of each band (raw scale: the effect normalises it). */
  low: number
  mid: number
  high: number
  /** 0 = no attack, up to 1 = attack well above the recent level. */
  onset: number
}

/** What the sync reads: features by position in the track, over the span analysed so far. */
export interface FeatureSource {
  readonly startS: number
  readonly endS: number
  at(positionS: number): FeatureFrame | undefined
}

/** In-place radix-2 FFT (size = power of two). */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k
        const b = a + half
        const wr = Math.cos(step * k)
        const wi = Math.sin(step * k)
        const xr = re[b]! * wr - im[b]! * wi
        const xi = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - xr; im[b] = im[a]! - xi
        re[a] = re[a]! + xr; im[a] = im[a]! + xi
      }
    }
  }
}

/**
 * Turns PCM pushed in any chunk size into feature frames. Frame `i` describes the audio that ENDS
 * at `startS + (i + 1) × HOP_S` (the window looks back), so a lookup by playback position never
 * lights up before the sound.
 */
export class FeatureExtractor implements FeatureSource {
  private readonly ring = new Float32Array(WINDOW)
  /** Next write slot of the ring: also where its oldest sample is. */
  private head = 0
  private filled = 0
  private sinceHop = 0
  private readonly hann = Float32Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)))
  private readonly re = new Float32Array(WINDOW)
  private readonly im = new Float32Array(WINDOW)
  private prevLog = new Float32Array(WINDOW / 2)
  private readonly fluxes: number[] = []
  private readonly ranges = { low: binRange(BANDS.low), mid: binRange(BANDS.mid), high: binRange(BANDS.high) }
  private data = new Float32Array(4 * 4096)
  private count = 0

  /** @param startS position in the track of the first sample pushed. */
  constructor(readonly startS = 0) {}

  get frames(): number { return this.count }
  /** Position in the track up to which features exist. */
  get endS(): number { return this.startS + this.count * HOP_S }

  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.head] = samples[i]!
      this.head = (this.head + 1) % WINDOW
      if (this.filled < WINDOW) this.filled++
      if (++this.sinceHop === HOP) {
        this.sinceHop = 0
        this.analyse()
      }
    }
  }

  /** Frame covering this position in the track, or undefined outside what has been analysed. */
  at(positionS: number): FeatureFrame | undefined {
    const i = Math.floor((positionS - this.startS) / HOP_S)
    if (i < 0 || i >= this.count) return undefined
    const d = this.data
    return { low: d[i * 4]!, mid: d[i * 4 + 1]!, high: d[i * 4 + 2]!, onset: d[i * 4 + 3]! }
  }

  private analyse(): void {
    for (let i = 0; i < WINDOW; i++) { this.re[i] = this.ring[(this.head + i) % WINDOW]! * this.hann[i]!; this.im[i] = 0 }
    fft(this.re, this.im)
    const band = ([a, b]: readonly [number, number]) => {
      let sum = 0
      for (let k = a; k <= b; k++) sum += this.re[k]! ** 2 + this.im[k]! ** 2
      return Math.sqrt(sum / (b - a + 1)) / WINDOW
    }
    let flux = 0
    const log = new Float32Array(WINDOW / 2)
    for (let k = 1; k < WINDOW / 2; k++) {
      log[k] = Math.log1p(100 * Math.hypot(this.re[k]!, this.im[k]!) / WINDOW)
      const d = log[k]! - this.prevLog[k]!
      if (d > 0) flux += d
    }
    this.prevLog = log
    // the first full window has no predecessor: its "flux" is the whole spectrum, not an attack
    const warm = this.filled === WINDOW && this.count > 0
    const mean = Math.max(FLUX_FLOOR, this.fluxes.length ? this.fluxes.reduce((s, f) => s + f, 0) / this.fluxes.length : 0)
    const onset = warm && flux > ONSET_RATIO * mean ? Math.min(1, (flux / mean - ONSET_RATIO) / ONSET_RATIO) : 0
    if (warm) {
      this.fluxes.push(flux)
      if (this.fluxes.length > FLUX_HISTORY) this.fluxes.shift()
    }
    this.store(band(this.ranges.low), band(this.ranges.mid), band(this.ranges.high), onset)
  }

  private store(low: number, mid: number, high: number, onset: number): void {
    if ((this.count + 1) * 4 > this.data.length) {
      const bigger = new Float32Array(this.data.length * 2)
      bigger.set(this.data)
      this.data = bigger
    }
    const o = this.count * 4
    this.data[o] = low; this.data[o + 1] = mid; this.data[o + 2] = high; this.data[o + 3] = onset
    this.count++
  }
}
