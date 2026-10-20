import type { Logger } from 'pino'
import { createBackoff, type Backoff } from './backoff'
import { sleep, type Clock } from './clock'
import { PluginError } from './plugin'

export interface PollerOptions {
  name: string
  intervalMs: number
  fn: () => Promise<void>
  clock: Clock
  signal: AbortSignal
  logger?: Logger
  backoff?: Backoff
}

/**
 * Runs `fn` right away then every `intervalMs` on success; on error, logs once (then at debug level
 * until recovery) and waits for the next backoff delay.
 */
export function createPoller(opts: PollerOptions): { stop(): void; readonly running: boolean } {
  const backoff = opts.backoff ?? createBackoff({ initialMs: Math.min(opts.intervalMs, 2000), maxMs: 60_000 })
  let running = true, failing = false
  const ctrl = new AbortController()
  const signal = AbortSignal.any([opts.signal, ctrl.signal])
  void (async () => {
    while (running && !signal.aborted) {
      let delay = opts.intervalMs
      try {
        await opts.fn()
        if (failing) opts.logger?.info({ poller: opts.name }, 'recovered')
        failing = false
        backoff.reset()
      } catch (err) {
        delay = backoff.next()
        const log = failing ? opts.logger?.debug.bind(opts.logger) : opts.logger?.warn.bind(opts.logger)
        log?.({ poller: opts.name, err, retryInMs: delay }, 'poll failed')
        failing = true
      }
      await sleep(opts.clock, delay, signal)
    }
  })()
  return { stop() { running = false; ctrl.abort() }, get running() { return running } }
}

/** Rejects with PluginError('TIMEOUT') if the promise is not settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, clock: Clock, what = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const h = clock.setTimeout(() => reject(new PluginError('TIMEOUT', `${what} timed out after ${ms} ms`)), ms)
    p.then((v) => { clock.clearTimeout(h); resolve(v) }, (e) => { clock.clearTimeout(h); reject(e) })
  })
}
