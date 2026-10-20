import { describe, expect, it } from 'vitest'
import { FrameDecoder, NS_RECEIVER, RECEIVER_ID, SENDER_ID, decodeMessage, encodeFrame, jsonMessage } from './protocol'

describe('cast protocol framing', () => {
  const msg = jsonMessage(SENDER_ID, RECEIVER_ID, NS_RECEIVER, { type: 'GET_STATUS', requestId: 1 })

  it('encodes a length-prefixed protobuf frame that decodes back to the same message', () => {
    const frame = encodeFrame(msg)
    expect(frame.readUInt32BE(0)).toBe(frame.length - 4)
    expect(decodeMessage(frame.subarray(4))).toEqual(msg)
  })

  it('reassembles frames split or glued by TCP', () => {
    const a = encodeFrame(msg), b = encodeFrame(jsonMessage(RECEIVER_ID, SENDER_ID, NS_RECEIVER, { type: 'RECEIVER_STATUS', requestId: 1, status: {} }))
    const stream = Buffer.concat([a, b])
    const decoder = new FrameDecoder()
    const cut = a.length + 3                                  // two bytes into the length of the 2nd frame
    expect(decoder.push(stream.subarray(0, 2))).toEqual([])   // not even a whole length
    expect(decoder.push(stream.subarray(2, cut))).toEqual([msg])
    const rest = decoder.push(stream.subarray(cut))
    expect(rest).toHaveLength(1)
    expect(JSON.parse(rest[0]!.payload)).toMatchObject({ type: 'RECEIVER_STATUS' })
  })

  it('skips fields it does not know (a binary payload, an added field)', () => {
    const body = encodeFrame(msg).subarray(4)
    const extra = Buffer.concat([body, Buffer.from([0x3a, 0x02, 0xaa, 0xbb]), Buffer.from([0x40, 0x01])]) // 7 bytes, 8 varint
    expect(decodeMessage(extra)).toEqual(msg)
  })

  it('does not hand a binary payload over as text', () => {
    const body = Buffer.concat([encodeFrame(msg).subarray(4, encodeFrame(msg).length - 0)])
    // replaces payload_type STRING (0x28 0x00) with BINARY (0x28 0x01)
    const idx = body.indexOf(Buffer.from([0x28, 0x00]))
    body[idx + 1] = 1
    expect(decodeMessage(body).payload).toBe('')
  })

  it('handles multi-byte varint lengths (payloads over 127 bytes)', () => {
    const big = jsonMessage(SENDER_ID, RECEIVER_ID, NS_RECEIVER, { type: 'X', text: 'y'.repeat(500) })
    const frame = encodeFrame(big)
    expect(new FrameDecoder().push(frame)).toEqual([big])
  })
})
