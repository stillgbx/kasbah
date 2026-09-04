import type { Logger } from 'pino'
import { createBackoff } from './backoff'
import { sleep, type Clock } from './clock'

// Client Server-Sent Events minimal sur fetch (compatible dispatcher undici → certificat auto-signé Hue).
// Le paquet `eventsource` ne sait pas prendre un dispatcher, d'où cette implémentation.

export interface SseEvent { id?: string; event?: string; data: string }

/** Découpe un flux texte SSE en événements (gère les `data:` répartis sur plusieurs chunks). */
export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let cur: { id?: string; event?: string; data: string[] } = { data: [] }
  const flush = (): SseEvent | null => {
    if (cur.data.length === 0) { cur = { data: [] }; return null }
    const ev: SseEvent = { data: cur.data.join('\n') }
    if (cur.id !== undefined) ev.id = cur.id
    if (cur.event !== undefined) ev.event = cur.event
    cur = { data: [] }
    return ev
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') { const ev = flush(); if (ev) yield ev; continue }
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        let value2 = colon < 0 ? '' : line.slice(colon + 1)
        if (value2.startsWith(' ')) value2 = value2.slice(1)
        if (field === 'data') cur.data.push(value2)
        else if (field === 'id') cur.id = value2
        else if (field === 'event') cur.event = value2
      }
    }
    const ev = flush()
    if (ev) yield ev
  } finally {
    reader.releaseLock()
  }
}

/** Sous-ensemble de Response suffisant ici : permet d'injecter un faux fetch (tests) ou undici. */
export interface MinimalResponse {
  ok: boolean
  status: number
  body: ReadableStream<Uint8Array> | null
  json(): Promise<unknown>
  text(): Promise<string>
}
export type FetchLike = (input: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<MinimalResponse>

export interface ConnectSseOptions {
  url: string
  headers?: Record<string, string>
  fetchImpl: FetchLike
  dispatcher?: unknown
  signal: AbortSignal
  clock: Clock
  logger?: Logger
  onEvent: (ev: SseEvent) => void
  /** Appelé à chaque (re)connexion réussie ; `isReconnect` permet de resynchroniser l'état manqué. */
  onOpen?: (isReconnect: boolean) => void | Promise<void>
  onDown?: (attempts: number) => void
  /** Durée de connexion au-delà de laquelle le backoff est remis à zéro. */
  stableAfterMs?: number
}

/** Boucle de connexion SSE avec reconnexion exponentielle ; se termine quand `signal` est annulé. */
export async function connectSse(opts: ConnectSseOptions): Promise<void> {
  const backoff = createBackoff({ initialMs: 1000, maxMs: 30_000 })
  let connections = 0
  while (!opts.signal.aborted) {
    const startedAt = opts.clock.now()
    try {
      const res = await opts.fetchImpl(opts.url, {
        headers: { Accept: 'text/event-stream', ...(opts.headers ?? {}) },
        signal: opts.signal,
        ...(opts.dispatcher ? { dispatcher: opts.dispatcher } : {}),
      })
      if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`)
      await opts.onOpen?.(connections > 0)
      connections++
      for await (const ev of parseSse(res.body)) {
        if (opts.signal.aborted) break
        opts.onEvent(ev)
      }
      if (opts.signal.aborted) break
      opts.logger?.warn({ url: opts.url }, 'SSE stream ended, reconnecting')
    } catch (err) {
      if (opts.signal.aborted) break
      opts.logger?.warn({ url: opts.url, err: (err as Error).message }, 'SSE connection failed')
    }
    if (opts.clock.now() - startedAt > (opts.stableAfterMs ?? 30_000)) backoff.reset()
    const delay = backoff.next()
    opts.onDown?.(backoff.attempts)
    await sleep(opts.clock, delay, opts.signal)
  }
}
