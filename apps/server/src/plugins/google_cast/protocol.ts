// Cast v2 frame: a big-endian 32-bit integer (length) then a `CastMessage` protobuf message.
// The message has only seven fields and we only write six: encoding and decoding by hand fits in
// under a hundred lines, without depending on a protobuf compiler. Schema (cast_channel.proto):
//
//   1 protocol_version : enum   (CASTV2_1_0 = 0)
//   2 source_id        : string ('sender-0' on the Kasbah side)
//   3 destination_id   : string ('receiver-0' for the receiver, or an app's transportId)
//   4 namespace        : string (urn:x-cast:…)
//   5 payload_type     : enum   (STRING = 0, BINARY = 1)
//   6 payload_utf8     : string (JSON)
//   7 payload_binary   : bytes  (never sent, ignored when reading)

export const NS_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection'
export const NS_HEARTBEAT = 'urn:x-cast:com.google.cast.tp.heartbeat'
export const NS_RECEIVER = 'urn:x-cast:com.google.cast.receiver'
export const NS_MEDIA = 'urn:x-cast:com.google.cast.media'

export const SENDER_ID = 'sender-0'
export const RECEIVER_ID = 'receiver-0'

export interface CastMessage {
  sourceId: string
  destinationId: string
  namespace: string
  /** JSON payload already serialized (`payload_type = STRING`). */
  payload: string
}

/** A JSON message ready to go: `payload` is serialized here, once. */
export function jsonMessage(sourceId: string, destinationId: string, namespace: string, body: Record<string, unknown>): CastMessage {
  return { sourceId, destinationId, namespace, payload: JSON.stringify(body) }
}

// ---- minimal protobuf ------------------------------------------------------------------------

function varint(n: number): Buffer {
  const out: number[] = []
  while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n >>>= 7 }
  out.push(n)
  return Buffer.from(out)
}

function stringField(field: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([varint((field << 3) | 2), varint(bytes.length), bytes])
}

/** Encodes a message and its length: what we write as is on the TLS socket. */
export function encodeFrame(msg: CastMessage): Buffer {
  const body = Buffer.concat([
    Buffer.from([0x08, 0x00]),                 // 1 protocol_version = CASTV2_1_0
    stringField(2, msg.sourceId),
    stringField(3, msg.destinationId),
    stringField(4, msg.namespace),
    Buffer.from([0x28, 0x00]),                 // 5 payload_type = STRING
    stringField(6, msg.payload),
  ])
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length, 0)
  return Buffer.concat([header, body])
}

function readVarint(buf: Buffer, at: number): { value: number; next: number } {
  let value = 0, shift = 0, i = at
  for (;;) {
    const b = buf[i]
    if (b === undefined) throw new Error('truncated varint')
    i += 1
    value += (b & 0x7f) * 2 ** shift
    if ((b & 0x80) === 0) return { value, next: i }
    shift += 7
    if (shift > 35) throw new Error('varint too long')
  }
}

/** Decodes a message body (without its length prefix). Unknown fields ignored. */
export function decodeMessage(body: Buffer): CastMessage {
  const out: CastMessage = { sourceId: '', destinationId: '', namespace: '', payload: '' }
  let payloadType = 0
  let at = 0
  while (at < body.length) {
    const tag = readVarint(body, at)
    at = tag.next
    const field = tag.value >>> 3, wire = tag.value & 7
    if (wire === 0) {
      const v = readVarint(body, at)
      at = v.next
      if (field === 5) payloadType = v.value
    } else if (wire === 2) {
      const len = readVarint(body, at)
      const start = len.next, end = start + len.value
      if (end > body.length) throw new Error('truncated field')
      const text = () => body.subarray(start, end).toString('utf8')
      if (field === 2) out.sourceId = text()
      else if (field === 3) out.destinationId = text()
      else if (field === 4) out.namespace = text()
      else if (field === 6) out.payload = text()
      at = end
    } else if (wire === 1) at += 8
    else if (wire === 5) at += 4
    else throw new Error(`unsupported wire type ${wire}`)
  }
  if (payloadType !== 0) out.payload = ''             // binary payload: we do not read it
  return out
}

/**
 * Splits a byte stream into messages: TCP does not respect frame boundaries, a `data` event may
 * carry half a frame or three. To be called on each chunk received; returns the complete messages
 * and keeps the rest.
 */
export class FrameDecoder {
  private pending: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): CastMessage[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    const out: CastMessage[] = []
    while (this.pending.length >= 4) {
      const len = this.pending.readUInt32BE(0)
      if (this.pending.length < 4 + len) break
      out.push(decodeMessage(this.pending.subarray(4, 4 + len)))
      this.pending = this.pending.subarray(4 + len)
    }
    return out
  }
}
