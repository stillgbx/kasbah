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
 * Exécute `fn` tout de suite puis toutes les `intervalMs` en cas de succès ; en cas d'erreur,
 * journalise une fois (puis en debug jusqu'au rétablissement) et attend le prochain délai de backoff.
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

/** Rejette en PluginError('TIMEOUT') si la promesse n'est pas résolue dans `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, clock: Clock, what = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const h = clock.setTimeout(() => reject(new PluginError('TIMEOUT', `${what} timed out after ${ms} ms`)), ms)
    p.then((v) => { clock.clearTimeout(h); resolve(v) }, (e) => { clock.clearTimeout(h); reject(e) })
  })
}
