import type { Clock } from './clock'

/** Token bucket: `capacity` tokens, refilled at `refillPerSecond`. */
export class TokenBucket {
  private tokens: number
  private last: number
  constructor(private readonly capacity: number, private readonly refillPerSecond: number, private readonly clock: Clock) {
    this.tokens = capacity
    this.last = clock.now()
  }
  private refill() {
    const now = this.clock.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSecond)
    this.last = now
  }
  tryTake(n = 1): boolean {
    this.refill()
    if (this.tokens >= n) { this.tokens -= n; return true }
    return false
  }
  /** Delay (ms) before a token is available. */
  waitMs(n = 1): number {
    this.refill()
    return this.tokens >= n ? 0 : Math.ceil(((n - this.tokens) / this.refillPerSecond) * 1000)
  }
}
