import { createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, createCipheriv, type KeyObject } from 'node:crypto'
import type { PushSubscriptionJson } from '@kasbah/shared'

// Web Push without a library: the payload encrypted for the browser (RFC 8291, `aes128gcm`) and the
// server identified to the push service by a signed token (VAPID, RFC 8292). Everything comes from
// `node:crypto`; sending is left to the caller, which goes through `publicFetch` (the endpoint is an
// address chosen by the browser).

/** The server's VAPID key pair; `publicKey` is what the browser passes to `pushManager.subscribe`. */
export interface VapidKeys {
  /** Uncompressed P-256 point (65 bytes), base64url. */
  publicKey: string
  /** Private scalar `d` of the JWK, base64url. */
  privateKey: string
}

const b64u = (b: Buffer | Uint8Array): string => Buffer.from(b).toString('base64url')
const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url')

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' })
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x!), fromB64u(jwk.y!)])), privateKey: jwk.d! }
}

function privateKeyObject(keys: VapidKeys): KeyObject {
  const pub = fromB64u(keys.publicKey)
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  })
}

/**
 * `Authorization` header for a push service (RFC 8292): an ES256 token for the ORIGIN of the
 * endpoint, valid 12 h (24 h at most). `subject` is how the push service reaches the sender
 * (`mailto:` or `https:`); Apple refuses a token without it.
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now: number): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })))
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: privateKeyObject(keys), dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`
}

/** Record size announced in the header: a whole payload fits in one record. */
const RECORD_SIZE = 4096

/**
 * The payload encrypted for one subscription (RFC 8291): a single `aes128gcm` record, the server's
 * ephemeral public key in the header. `salt` and `serverKeys` are only passed by the tests.
 */
export function encryptPayload(
  sub: PushSubscriptionJson, payload: Uint8Array,
  fixed: { salt?: Buffer; serverKeys?: ReturnType<typeof createECDH> } = {},
): Buffer {
  const uaPublic = fromB64u(sub.keys.p256dh)
  const authSecret = fromB64u(sub.keys.auth)
  const ecdh = fixed.serverKeys ?? createECDH('prime256v1')
  if (!fixed.serverKeys) ecdh.generateKeys()
  const asPublic = ecdh.getPublicKey()
  const ecdhSecret = ecdh.computeSecret(uaPublic)

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32))
  const salt = fixed.salt ?? randomBytes(16)
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))

  if (payload.length + 1 + 16 > RECORD_SIZE) throw new Error(`push payload too large (${payload.length} bytes)`)
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // 0x02: delimiter of the last (and only) record, no padding
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])

  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(RECORD_SIZE)
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body])
}
