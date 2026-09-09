// Trame Cast v2 : un entier 32 bits big-endian (longueur) puis un message protobuf `CastMessage`.
// Le message n'a que sept champs et on n'en écrit que six : encoder et décoder à la main tient en
// moins de cent lignes, sans dépendre d'un compilateur protobuf. Schéma (cast_channel.proto) :
//
//   1 protocol_version : enum   (CASTV2_1_0 = 0)
//   2 source_id        : string ('sender-0' côté Kasbah)
//   3 destination_id   : string ('receiver-0' pour le récepteur, ou le transportId d'une appli)
//   4 namespace        : string (urn:x-cast:…)
//   5 payload_type     : enum   (STRING = 0, BINARY = 1)
//   6 payload_utf8     : string (JSON)
//   7 payload_binary   : bytes  (jamais émis, ignoré en lecture)

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
  /** Charge utile JSON déjà sérialisée (`payload_type = STRING`). */
  payload: string
}

/** Un message JSON prêt à partir : `payload` est sérialisé ici, une seule fois. */
export function jsonMessage(sourceId: string, destinationId: string, namespace: string, body: Record<string, unknown>): CastMessage {
  return { sourceId, destinationId, namespace, payload: JSON.stringify(body) }
}

// ---- protobuf minimal ------------------------------------------------------------------------

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

/** Encode un message et sa longueur : ce qu'on écrit tel quel sur la socket TLS. */
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

/** Décode le corps d'un message (sans son préfixe de longueur). Champs inconnus ignorés. */
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
  if (payloadType !== 0) out.payload = ''             // charge binaire : on ne la lit pas
  return out
}

/**
 * Découpe un flux d'octets en messages : TCP ne respecte pas les frontières de trame, un `data`
 * peut porter une demi-trame ou trois. À appeler sur chaque morceau reçu ; rend les messages
 * complets et garde le reste.
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
