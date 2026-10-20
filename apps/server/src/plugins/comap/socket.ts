import type { Duplex } from 'node:stream'
import { createConnection } from 'node:net'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'

// Plain-text TCP transport of the Proteo 2 station: clear JSON, ONE line per message, request
// terminated by `\r\n`, no authentication. Neither HTTP nor Modbus — the project's only raw-socket
// precedent is TLS (`google_cast/channel.ts`), whose injectable factory pattern this file reuses to
// stay testable without a real station.
//
// The station accepts only ONE TCP connection at a time (verified 2026-09-16: a read made while the
// vendor's mobile app held the connection was accepted then left silent, with no answer or error).
// Hence the choice: one SHORT connection per read, opened then closed as soon as the response
// arrives — never a permanent connection, which would hog the station and break the owner's app.

export type SocketFactory = (host: string, port: number) => Promise<Duplex>

/** Real TCP socket, resolved once the connection is established. */
export const netSocketFactory: SocketFactory = (host, port) => new Promise((resolve, reject) => {
  const socket = createConnection({ host, port }, () => { socket.off('error', reject); resolve(socket) })
  socket.once('error', reject)
})

export interface ReadOnceOptions {
  host: string
  port: number
  /** Body of the `read` request, as written on the wire (see `mapping.ts`). */
  request: Record<string, unknown>
  connect: SocketFactory
  clock: Clock
  /** Aborted by `stop()`: a connection in progress is destroyed rather than left hanging. */
  signal: AbortSignal
  timeoutMs: number
}

/**
 * One read: opens the connection, writes the request, waits for THE FIRST response line, closes.
 * Bounded by `timeoutMs` AND by `signal` — the station ACCEPTS the connection even when it is
 * already busy elsewhere, and then never answers: without this double bound, the socket and the
 * poller would hang silently.
 */
export function readOnce(opts: ReadOnceOptions): Promise<unknown> {
  const { host, port, request, connect, clock, signal, timeoutMs } = opts
  return new Promise<unknown>((resolve, reject) => {
    let settled = false
    let socket: Duplex | null = null
    let buffer = ''

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clock.clearTimeout(timeoutHandle)
      signal.removeEventListener('abort', onAbort)
      socket?.destroy()
      fn()
    }
    const onAbort = () => finish(() => reject(new PluginError('DEVICE_UNAVAILABLE', 'connection aborted (plugin stopping)')))
    const timeoutHandle = clock.setTimeout(
      () => finish(() => reject(new PluginError('TIMEOUT', `no answer from ${host}:${port} after ${timeoutMs} ms`))),
      timeoutMs,
    )
    signal.addEventListener('abort', onAbort, { once: true })

    connect(host, port).then((s) => {
      if (settled) { s.destroy(); return }
      socket = s
      s.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        // The real station does NOT end its responses with a newline (observed 2026-09-16: `}}}}`
        // with nothing after, versus `}}\r\n` on the request side) — only the
        // `google_cast/channel.ts` pattern this file draws on expected one. A complete response is
        // therefore recognized by the valid JSON it forms, `\n` or not. The `\n` is still tried first
        // (free, guards against a firmware variant that would add one); without it, we retry the
        // whole buffer — once per chunk, never per byte — and a still-truncated JSON (chunk cut in
        // the middle) just waits for the rest instead of resolving on a partial.
        const nl = buffer.indexOf('\n')
        const candidate = nl === -1 ? buffer : buffer.slice(0, nl).replace(/\r$/, '')
        let parsed: unknown
        try { parsed = JSON.parse(candidate) } catch (err) {
          if (nl === -1) return // no newline: frame possibly still incomplete, we wait
          finish(() => reject(err as Error))
          return
        }
        finish(() => resolve(parsed))
      })
      s.on('error', (err: Error) => finish(() => reject(err)))
      s.on('close', () => finish(() => reject(new PluginError('DEVICE_UNAVAILABLE', 'connection closed before an answer'))))
      s.write(`${JSON.stringify(request)}\r\n`)
    }).catch((err: Error) => finish(() => reject(err)))
  })
}
