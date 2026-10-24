import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { X509Certificate } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetch } from 'undici'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TlsPin, TlsPinError, createPinFile, pinnedAgent, pinnedTlsConnect } from './tls-pin'
import { selfSignedCertificate, startTlsServer, type TestCertificate, type TestTlsServer } from './test-tls'

const OK = 'HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok'
const fingerprint = (c: TestCertificate) => new X509Certificate(c.cert).fingerprint256

let server: TestTlsServer | null = null
afterEach(async () => { await server?.close(); server = null })

async function get(pin: TlsPin): Promise<string> {
  const agent = pinnedAgent(pin)
  try {
    const res = await fetch(`https://127.0.0.1:${server!.port}/`, { dispatcher: agent, headers: { authorization: 'Bearer secret' } })
    return await res.text()
  } finally { await agent.close() }
}

describe('TlsPin over undici', () => {
  it('pins the certificate met on the first connection, then accepts it again', async () => {
    const cert = selfSignedCertificate()
    server = await startTlsServer(cert, () => OK)
    const onChange = vi.fn()
    const pin = new TlsPin(undefined, onChange, { device: 'test device' })
    expect(await get(pin)).toBe('ok')
    expect(onChange).toHaveBeenCalledWith(fingerprint(cert))
    expect(await get(pin)).toBe('ok')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(pin.changed).toBe(false)
  })

  it('refuses another certificate before the request (and its secret) is written', async () => {
    server = await startTlsServer(selfSignedCertificate(), () => OK)
    const pin = new TlsPin(fingerprint(selfSignedCertificate()), vi.fn(), { device: 'test device' })
    const err = await get(pin).catch((e: Error) => e)
    expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(TlsPinError)
    expect(server.received()).toBe('')
    expect(pin.changed).toBe(true)
  })

  it('clearing the pin (pairing again) accepts the new certificate and pins it', async () => {
    const cert = selfSignedCertificate()
    server = await startTlsServer(cert, () => OK)
    const onChange = vi.fn()
    const pin = new TlsPin(fingerprint(selfSignedCertificate()), onChange, { device: 'test device' })
    await get(pin).catch(() => undefined)
    pin.clear()
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(pin.changed).toBe(false)
    expect(await get(pin)).toBe('ok')
    expect(onChange).toHaveBeenLastCalledWith(fingerprint(cert))
  })
})

describe('pinnedTlsConnect (mqtt.js writes before the handshake)', () => {
  it('holds what was written until the pin matched, then sends it', async () => {
    const cert = selfSignedCertificate()
    server = await startTlsServer(cert)
    const pin = new TlsPin(fingerprint(cert), vi.fn(), { device: 'test device' })
    const socket = pinnedTlsConnect({ host: '127.0.0.1', port: server.port }, pin)
    socket.write('CONNECT password')
    await once(socket, 'secureConnect')
    await vi.waitFor(() => expect(server!.received()).toBe('CONNECT password'))
    socket.destroy()
  })

  it('never sends it to a peer with another certificate', async () => {
    server = await startTlsServer(selfSignedCertificate())
    const pin = new TlsPin(fingerprint(selfSignedCertificate()), vi.fn(), { device: 'test device' })
    const socket = pinnedTlsConnect({ host: '127.0.0.1', port: server.port }, pin)
    socket.write('CONNECT password')
    const [err] = await once(socket, 'error') as [Error]
    expect(err).toBeInstanceOf(TlsPinError)
    await once(socket, 'close')
    expect(server.received()).toBe('')
    expect(pin.changed).toBe(true)
  })
})

describe('createPinFile', () => {
  it('keeps the fingerprint between two starts, and forgets it when cleared', async () => {
    const file = createPinFile(join(await mkdtemp(join(tmpdir(), 'kasbah-pin-')), 'pin.json'))
    expect(await file.load()).toBeUndefined()
    await file.save('AA:BB')
    expect(await file.load()).toBe('AA:BB')
    await file.save(undefined)
    expect(await file.load()).toBeUndefined()
  })
})
