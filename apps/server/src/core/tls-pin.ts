import { readFile } from 'node:fs/promises'
import tls, { type ConnectionOptions, type TLSSocket } from 'node:tls'
import type { Logger } from 'pino'
import { Agent, buildConnector } from 'undici'
import { writeFileAtomic } from './atomic-file'

// Certificate pinning on first use, for the LAN devices whose certificate cannot be verified
// (self-signed, or signed by a vendor authority we do not have). The first TLS connection records
// the SHA-256 fingerprint of the device certificate; a later one presenting another certificate is
// cut BEFORE the request carrying the secret (application key, token, MQTT password) is written.
// Pairing again clears the pin, and the next connection learns the certificate it meets.
//
// Node never calls `checkServerIdentity` when the chain fails to verify (self-signed peer) and
// `rejectUnauthorized` is false: the check happens on the established socket instead, before it is
// handed to the client.

/** What the pin refuses. `code` is what mqtt.js needs to report a stream error. */
export class TlsPinError extends Error {
  readonly code = 'TLS_PIN_MISMATCH'
}

export class TlsPin {
  /** The device presented another certificate: what the plugin health reports. */
  changed = false

  constructor(
    private fingerprint: string | undefined,
    /** Persists the pin: the fingerprint learned, or `undefined` once cleared. */
    private readonly onChange: (fingerprint: string | undefined) => void,
    private readonly opts: { device: string; logger?: Logger | undefined },
  ) {}

  /** Pairing again: the next connection learns the certificate it meets. */
  clear(): void {
    this.fingerprint = undefined
    this.changed = false
    this.onChange(undefined)
  }

  /** Checks a socket whose handshake completed. `null` when accepted, the error to fail it with otherwise. */
  check(socket: TLSSocket): TlsPinError | null {
    // empty on a resumed session: hence no session cache below, and a missing certificate is refused
    const seen = socket.getPeerCertificate().fingerprint256 as string | undefined
    if (seen && !this.fingerprint) {
      this.fingerprint = seen
      this.onChange(seen)
      this.opts.logger?.info({ device: this.opts.device, fingerprint: seen }, 'device certificate pinned')
    }
    if (seen && seen === this.fingerprint) {
      this.changed = false
      return null
    }
    // logged once per change, not on every retry
    if (!this.changed) {
      this.opts.logger?.warn({ device: this.opts.device, expected: this.fingerprint, seen },
        'device certificate changed: connection refused before any credential, pair again to accept it')
    }
    this.changed = true
    return new TlsPinError(`${this.opts.device} certificate changed`)
  }
}

/** undici dispatcher for a device: certificate not verified, but pinned. */
export function pinnedAgent(pin: TlsPin): Agent {
  const connect = buildConnector({ rejectUnauthorized: false, maxCachedSessions: 0 })
  return new Agent({
    // undici writes the request only once this callback hands it the socket
    connect: (options, callback) => connect(options, (err, socket) => {
      if (err) return callback(err, null)
      const refused = pin.check(socket as TLSSocket)
      if (refused) {
        socket!.destroy()
        return callback(refused, null)
      }
      callback(null, socket!)
    }),
  })
}

/**
 * `tls.connect` whose writes wait for the pin. mqtt.js writes its CONNECT (password included) as
 * soon as it has the stream, before the handshake: the socket stays corked until the pin matched.
 */
export function pinnedTlsConnect(options: ConnectionOptions, pin: TlsPin): TLSSocket {
  const socket = tls.connect({ ...options, rejectUnauthorized: false })
  socket.cork()
  socket.once('secureConnect', () => {
    const refused = pin.check(socket)
    if (refused) socket.destroy(refused)
    else socket.uncork()
  })
  return socket
}

/** Pin kept in its own file at 0600, for a plugin whose credential has no file to hold it. */
export interface PinFile {
  load(): Promise<string | undefined>
  save(fingerprint: string | undefined): Promise<void>
}

export function createPinFile(path: string, logger?: Logger): PinFile {
  return {
    async load() {
      try { return (JSON.parse(await readFile(path, 'utf8')) as { fingerprint?: string }).fingerprint }
      catch { return undefined }
    },
    async save(fingerprint) {
      try { await writeFileAtomic(path, `${JSON.stringify(fingerprint ? { fingerprint } : {}, null, 2)}\n`, { mode: 0o600 }) }
      catch (err) { logger?.warn({ err, path }, 'could not write the certificate pin') }
    },
  }
}
