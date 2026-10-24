import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import tls from 'node:tls'

// Tests only: self-signed certificates and a local TLS server, to exercise the certificate pin
// (`tls-pin.ts`) without a dependency. Node can sign but not build a certificate, so the few DER
// fields of an X.509 v3 are written here (EC P-256, ECDSA-SHA256, no extension).

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const n = body.length
  const len = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]
  return Buffer.concat([Buffer.from([tag, ...len]), body])
}
const seq = (...parts: Buffer[]) => der(0x30, ...parts)
const ECDSA_SHA256 = seq(der(0x06, Buffer.from('2a8648ce3d040302', 'hex')))

export interface TestCertificate { cert: string; key: string }

/** A fresh self-signed certificate: two calls never give the same fingerprint. */
export function selfSignedCertificate(name = 'kasbah-test'): TestCertificate {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const cn = seq(der(0x31, seq(der(0x06, Buffer.from('550403', 'hex')), der(0x0c, Buffer.from(name)))))
  const serial = randomBytes(8)
  serial[0] = (serial[0]! & 0x7f) | 0x01
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    ECDSA_SHA256,
    cn,
    seq(der(0x17, Buffer.from('250101000000Z')), der(0x17, Buffer.from('491231235959Z'))),
    cn,
    publicKey.export({ type: 'spki', format: 'der' }),
  )
  const signature = sign('sha256', tbs, privateKey)
  const cert = seq(tbs, ECDSA_SHA256, der(0x03, Buffer.concat([Buffer.from([0]), signature])))
  const b64 = cert.toString('base64').match(/.{1,64}/g)!.join('\n')
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  }
}

export interface TestTlsServer {
  port: number
  /** Everything the clients sent, decrypted: what a pin must keep empty. */
  received(): string
  close(): Promise<void>
}

/** TLS server on 127.0.0.1 that records what it receives and answers each chunk with `respond`. */
export async function startTlsServer(cert: TestCertificate, respond?: (chunk: string) => string | undefined): Promise<TestTlsServer> {
  let received = ''
  const sockets = new Set<tls.TLSSocket>()
  const server = tls.createServer({ cert: cert.cert, key: cert.key }, (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => { /* the client cut the link: expected when the pin refuses */ })
    socket.on('data', (chunk) => {
      received += chunk.toString()
      const answer = respond?.(chunk.toString())
      if (answer !== undefined) socket.write(answer)
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    port: (server.address() as AddressInfo).port,
    received: () => received,
    close: async () => {
      for (const s of sockets) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
