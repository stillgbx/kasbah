import { X509Certificate } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { selfSignedCertificate, startTlsServer, type TestCertificate, type TestTlsServer } from '../../core/test-tls'
import { TlsPin } from '../../core/tls-pin'
import { connectRobot, extractReported, mergeShadow } from './mqtt'

// The robot speaks in DELTAS: these two functions are all that makes them usable, and they are
// pure. The rest of `mqtt.ts` is socket plumbing, tested here only for the certificate pin.

describe('mergeShadow', () => {
  it('merges a fragment into the shadow without losing the rest', () => {
    const base = { cleanMissionStatus: { cycle: 'clean', phase: 'run', error: 0 }, batPct: 84 }
    expect(mergeShadow(base, { cleanMissionStatus: { phase: 'hmMidMsn' } })).toEqual({
      cleanMissionStatus: { cycle: 'clean', phase: 'hmMidMsn', error: 0 },
      batPct: 84,
    })
  })

  it('replaces an array instead of extending it', () => {
    const base = { pmaps: [{ id: 'a' }, { id: 'b' }] }
    expect(mergeShadow(base, { pmaps: [{ id: 'c' }] })).toEqual({ pmaps: [{ id: 'c' }] })
  })

  it('leaves the shadow untouched when the fragment is not an object', () => {
    const base = { batPct: 84 }
    expect(mergeShadow(base, 'bruit')).toBe(base)
    expect(mergeShadow(base, null)).toBe(base)
    expect(mergeShadow(base, [1, 2])).toBe(base)
  })

  it('does not modify the previous shadow', () => {
    const base = { bin: { full: false, present: true } }
    const next = mergeShadow(base, { bin: { full: true } })
    expect(base.bin.full).toBe(false)
    expect(next).toEqual({ bin: { full: true, present: true } })
  })
})

describe('extractReported', () => {
  it('unwraps the AWS shadow shape', () => {
    expect(extractReported('{"state":{"reported":{"batPct":42}}}')).toEqual({ batPct: 42 })
  })

  it('accepts a state without `reported`', () => {
    expect(extractReported('{"state":{"batPct":42}}')).toEqual({ batPct: 42 })
  })

  it('accepts the bare object of the robot own topics', () => {
    expect(extractReported('{"batPct":42}')).toEqual({ batPct: 42 })
  })

  it('returns null on an unreadable topic rather than cutting the link', () => {
    expect(extractReported('pas du json')).toBeNull()
    expect(extractReported('"texte"')).toBeNull()
  })
})

describe('connectRobot certificate pin', () => {
  const fingerprint = (c: TestCertificate) => new X509Certificate(c.cert).fingerprint256
  let server: TestTlsServer | null = null
  afterEach(async () => { await server?.close(); server = null })

  const open = (pin: TlsPin) => connectRobot({ blid: 'BLID-TEST', password: 'local-password', ip: '127.0.0.1', port: server!.port, pin })

  it('sends the CONNECT, password included, to the pinned robot', async () => {
    const cert = selfSignedCertificate()
    server = await startTlsServer(cert)
    const link = open(new TlsPin(fingerprint(cert), vi.fn(), { device: 'test robot' }))
    await vi.waitFor(() => expect(server!.received()).toContain('local-password'))
    await link.close()
  })

  it('never sends it to a host with another certificate', async () => {
    server = await startTlsServer(selfSignedCertificate())
    const pin = new TlsPin(fingerprint(selfSignedCertificate()), vi.fn(), { device: 'test robot' })
    const link = open(pin)
    await vi.waitFor(() => expect(pin.changed).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(server.received()).toBe('')
    expect(link.connected).toBe(false)
    await link.close()
  })
})
