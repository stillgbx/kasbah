// Injectable clock: the engine never touches `Date.now`/`setInterval` directly,
// which allows deterministic tests (ManualClock) and an acceleration of the simulated time.

export interface Clock {
  now(): number
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** Manual clock for tests: `advance(ms)` fires the due timers in order. */
export class ManualClock implements Clock {
  private t: number
  private seq = 0
  private timers = new Map<number, { at: number; fn: () => void; every?: number }>()
  constructor(start = 0) { this.t = start }
  now() { return this.t }
  setInterval(fn: () => void, ms: number) {
    const id = ++this.seq
    this.timers.set(id, { at: this.t + ms, fn, every: ms })
    return id
  }
  clearInterval(h: unknown) { this.timers.delete(h as number) }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq
    this.timers.set(id, { at: this.t + ms, fn })
    return id
  }
  clearTimeout(h: unknown) { this.timers.delete(h as number) }
  advance(ms: number) {
    const target = this.t + ms
    for (;;) {
      let nextId: number | null = null, nextAt = Infinity
      for (const [id, tm] of this.timers) if (tm.at <= target && tm.at < nextAt) { nextAt = tm.at; nextId = id }
      if (nextId === null) break
      const tm = this.timers.get(nextId)!
      this.t = tm.at
      if (tm.every) tm.at += tm.every
      else this.timers.delete(nextId)
      tm.fn()
    }
    this.t = target
  }
}
