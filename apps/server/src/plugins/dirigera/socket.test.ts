import { createServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { selfSignedCertificate, startTlsServer } from '../../core/test-tls'
import { TlsPin } from '../../core/tls-pin'
import { DirigeraSocket } from './socket'

// The real `ws` package against a real TLS server with a self-signed certificate (as the hub has):
// what the injected factory of plugin.test.ts cannot prove — that the handshake goes through the
// pinned connection, carries the token, and writes nothing when the certificate changed.

const cleanups: Array<() => Promise<void> | void> = []
// in reverse: the client goes before the server, which would otherwise wait for it to close
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c() })

const until = (cond: () => boolean, ms = 3_000) => new Promise<void>((resolve, reject) => {
  const start = Date.now()
  const tick = () => (cond() ? resolve() : Date.now() - start > ms ? reject(new Error('timed out')) : setTimeout(tick, 10))
  tick()
})

function open(port: number, pin: TlsPin, events: unknown[], state: { opened: boolean }) {
  const controller = new AbortController()
  const socket = new DirigeraSocket({
    url: `wss://127.0.0.1:${port}/v1`, token: 'token-0', pin, clock: new ManualClock(0), signal: controller.signal,
    logger: pino({ level: 'silent' }), onEvent: (m) => events.push(m), onOpen: () => { state.opened = true }, onClose: () => {},
  })
  socket.start()
  cleanups.push(() => controller.abort())
  return socket
}

describe('DIRIGERA socket (real ws, real TLS)', () => {
  it('learns the certificate, sends the token on the handshake, and receives the events', async () => {
    const cert = selfSignedCertificate('dirigera-test')
    const server = createServer({ cert: cert.cert, key: cert.key })
    const wss = new WebSocketServer({ server })
    let auth: string | undefined
    wss.on('connection', (ws, req) => {
      auth = req.headers.authorization
      ws.send(JSON.stringify({ type: 'deviceStateChanged', data: { id: 'x', attributes: { isOn: true } } }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    cleanups.push(() => new Promise<void>((r) => { wss.close(); server.close(() => r()) }))

    let learned: string | undefined
    const pin = new TlsPin(undefined, (fp) => { learned = fp }, { device: 'DIRIGERA hub' })
    const events: unknown[] = []
    const state = { opened: false }
    open((server.address() as AddressInfo).port, pin, events, state)
    await until(() => state.opened && events.length > 0)
    expect(auth).toBe('Bearer token-0')
    expect(learned).toMatch(/^[0-9A-F:]+$/)
    expect(events[0]).toMatchObject({ type: 'deviceStateChanged' })
  })

  it('a changed certificate is refused before a single byte of the handshake is written', async () => {
    const server = await startTlsServer(selfSignedCertificate('another-hub'))
    cleanups.push(() => server.close())
    const pin = new TlsPin('AA:BB', () => {}, { device: 'DIRIGERA hub' })
    const state = { opened: false }
    open(server.port, pin, [], state)
    await until(() => pin.changed)
    await new Promise((r) => setTimeout(r, 100))
    expect(state.opened).toBe(false)
    expect(server.received()).toBe('')
  })
})
