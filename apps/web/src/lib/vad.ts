// The end of the sentence, guessed from the microphone's sound level (threshold voice activity detection): the
// person has spoken, then has been quiet for `SILENCE_MS` → listening stops by itself and the instruction goes out.
// Nobody speaks in the first `NO_SPEECH_MS` milliseconds → nothing heard.
//
// The threshold follows the room's noise: the floor drops at once to the lowest level heard and only
// rises slowly, during silences. A constant background music thus becomes the floor,
// and the voice stands out above it; speech from the very first instant does not stay there (the floor
// drops back at the first gap between two words). Values to be tuned in use, on a real microphone.

/** Silence after speech before sending: shorter cuts hesitations, longer makes people wait. */
export const SILENCE_MS = 1000
/** No speech up to there: nothing heard. */
export const NO_SPEECH_MS = 5000
/** Duration above the threshold to count as speech (a slam, a door are not enough). */
const SPEECH_MS = 250
/** The voice must exceed the noise floor by this factor (≈ +10 dB). */
const FACTOR = 3
/** Minimum threshold (RMS level, samples between -1 and 1): below it, it is silence. */
const MIN_LEVEL = 0.01
/** Floor rise per second of silence (share of the gap filled). */
const RISE_PER_S = 0.5

export type VadEvent = 'end' | 'nothing'

/** RMS level of a frame of samples. */
export function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!
  return frame.length ? Math.sqrt(sum / frame.length) : 0
}

/** One detector per listening: `push(level, ms since the start)` returns `end`, `nothing`, or nothing. */
export function createEndpointer() {
  let floor: number | null = null
  let last = 0
  let loudSince: number | null = null
  let quietSince: number | null = null
  let spoke = false
  let done = false

  return {
    push(level: number, at: number): VadEvent | null {
      if (done) return null
      const dt = Math.max(0, at - last) / 1000
      last = at
      const threshold = Math.max((floor ?? 0) * FACTOR, MIN_LEVEL)
      const loud = level > threshold
      // null frames (microphone opening) say nothing about the room's noise
      if (level > 0) {
        if (floor === null || level < floor) floor = level
        else if (!loud) floor += (level - floor) * Math.min(1, RISE_PER_S * dt)
      }
      if (loud) {
        quietSince = null
        loudSince ??= at
        if (at - loudSince >= SPEECH_MS) spoke = true
      } else {
        loudSince = null
        quietSince ??= at
      }
      if (spoke && quietSince !== null && at - quietSince >= SILENCE_MS) { done = true; return 'end' }
      if (!spoke && at >= NO_SPEECH_MS) { done = true; return 'nothing' }
      return null
    },
  }
}
