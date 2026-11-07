import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import type { HueClient } from './client'
import { encodeFrame, MAX_CHANNELS, openStream, pickArea, restoreBody, toLightArea, type DtlsSocket } from './entertainment'
import { hueEntertainmentConfigurationSchema } from './types'

const AREA = '1a8d99cc-967b-44f2-9202-43f976c0fa6b'

describe('restoreBody', () => {
  const dynamics = { duration: 1000 }
  it('brings back a colour light in its colour, a white one in its temperature', () => {
    expect(restoreBody({ id: 'a', on: { on: true }, dimming: { brightness: 40 }, color_temperature: { mirek: null, mirek_valid: false }, color: { xy: { x: 0.2, y: 0.3 } } }))
      .toEqual({ on: { on: true }, dimming: { brightness: 40 }, color: { xy: { x: 0.2, y: 0.3 } }, dynamics })
    expect(restoreBody({ id: 'b', on: { on: true }, dimming: { brightness: 80 }, color_temperature: { mirek: 300, mirek_valid: true }, color: { xy: { x: 0.45, y: 0.41 } } }))
      .toEqual({ on: { on: true }, dimming: { brightness: 80 }, color_temperature: { mirek: 300 }, dynamics })
  })
  it('only switches off a light that was off', () => {
    expect(restoreBody({ id: 'c', on: { on: false }, dimming: { brightness: 80 }, color: { xy: { x: 0.2, y: 0.3 } } })).toEqual({ on: { on: false }, dynamics })
  })
})

describe('encodeFrame', () => {
  it('writes the HueStream v2 header, the area id and 7 bytes per channel', () => {
    const buf = encodeFrame(AREA, 0x1ff, [{ id: 0, r: 1, g: 0, b: 0.5 }, { id: 3, r: 0, g: 1, b: 0 }])
    expect(buf.length).toBe(16 + 36 + 2 * 7)
    expect(buf.subarray(0, 9).toString('ascii')).toBe('HueStream')
    expect([...buf.subarray(9, 16)]).toEqual([0x02, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00])   // version 2.0, sequence wraps at 8 bits, RGB
    expect(buf.subarray(16, 52).toString('ascii')).toBe(AREA)
    expect([...buf.subarray(52, 59)]).toEqual([0, 0xff, 0xff, 0x00, 0x00, 0x80, 0x00])
    expect([...buf.subarray(59, 66)]).toEqual([3, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00])
  })

  it('clamps colours to 0..1 and drops channels beyond what the bridge reads', () => {
    const many = Array.from({ length: MAX_CHANNELS + 5 }, (_, id) => ({ id, r: 2, g: -1, b: Number.NaN }))
    const buf = encodeFrame(AREA, 0, many)
    expect(buf.length).toBe(16 + 36 + MAX_CHANNELS * 7)
    expect([...buf.subarray(52, 59)]).toEqual([0, 0xff, 0xff, 0, 0, 0, 0])
  })

  it('refuses an id that is not a UUID (the bridge would ignore the frame silently)', () => {
    expect(() => encodeFrame('abc', 0, [])).toThrow(/UUID/)
  })
})

const area = (id: string, lights: string[], channels = lights.length) => hueEntertainmentConfigurationSchema.parse({
  id,
  metadata: { name: `area ${id}` },
  channels: Array.from({ length: channels }, (_, i) => ({ channel_id: i, position: { x: i, y: 0, z: 0 }, members: [] })),
  light_services: lights.map((rid) => ({ rid, rtype: 'light' })),
})

describe('pickArea', () => {
  const room = new Set(['l1', 'l2', 'l3'])

  it('takes an area with a lamp next door when at least half of it is in the room', () => {
    expect(pickArea([area('open-space', ['l1', 'next-door'])], room)?.id).toBe('open-space')
  })

  it('never picks an area mostly outside the room', () => {
    expect(pickArea([area('a', ['l1', 'next-door', 'other-room'])], room)).toBeUndefined()
  })

  it('prefers an area all in the room to one spilling over, even with fewer lights', () => {
    expect(pickArea([area('spill', ['l1', 'l2', 'next-door']), area('clean', ['l1'])], room)?.id).toBe('clean')
  })

  it('among areas spilling over, prefers the most room lights, then the fewest outside', () => {
    const picked = pickArea([area('one', ['l1', 'x']), area('two-many-out', ['l1', 'l2', 'x', 'y']), area('two', ['l1', 'l2', 'x'])], room)
    expect(picked?.id).toBe('two')
  })

  it('prefers the area covering the most lights of the room, then the most channels', () => {
    const picked = pickArea([area('small', ['l1']), area('big', ['l1', 'l2']), area('big-more-channels', ['l2', 'l3'], 4)], room)
    expect(picked?.id).toBe('big-more-channels')
  })

  it('ignores an empty area', () => {
    expect(pickArea([area('empty', [])], room)).toBeUndefined()
  })
})

class FakeSocket extends EventEmitter implements DtlsSocket {
  sent: Buffer[] = []
  closed = false
  send(data: Buffer) { this.sent.push(data) }
  close() { this.closed = true }
}

describe('openStream', () => {
  const AREA_ID = '1a8d99cc-967b-44f2-9202-43f976c0fa6b'
  function setup() {
    const clock = new ManualClock(0)
    const socket = new FakeSocket()
    const entertainmentAction = vi.fn(async () => {})
    const connect = vi.fn((_opts: { port: number; identity: string; psk: Buffer }) => { setTimeout(() => socket.emit('connected'), 0); return socket })
    const opening = openStream({
      client: { entertainmentAction } as unknown as HueClient,
      area: toLightArea(area(AREA_ID, ['l1'])),
      host: '192.168.1.20', appKey: 'app-key', clientKey: '00112233445566778899aabbccddeeff',
      connect, clock, logger: pino({ level: 'silent' }),
    })
    return { clock, socket, entertainmentAction, connect, opening }
  }

  it('starts the area, then authenticates with the app key and the client key as PSK', async () => {
    const { connect, entertainmentAction, opening } = setup()
    await opening
    expect(entertainmentAction).toHaveBeenCalledWith(AREA_ID, 'start')
    const call = connect.mock.calls[0]![0]
    expect(call.port).toBe(2100)
    expect(call.identity).toBe('app-key')
    expect(call.psk.toString('hex')).toBe('00112233445566778899aabbccddeeff')
  })

  it('sends frames, repeats the last one when the caller goes quiet, and stops the area on close', async () => {
    const { clock, socket, entertainmentAction, opening } = setup()
    const stream = await opening
    stream.send([{ id: 0, r: 1, g: 0, b: 0 }])
    expect(socket.sent).toHaveLength(1)
    clock.advance(2500)
    expect(socket.sent.length).toBeGreaterThanOrEqual(2)   // keep-alive: the bridge drops a silent stream after 10 s
    expect(socket.sent.at(-1)!.subarray(52)).toEqual(socket.sent[0]!.subarray(52))
    await stream.close()
    expect(socket.closed).toBe(true)
    expect(entertainmentAction).toHaveBeenLastCalledWith(AREA_ID, 'stop')
    const count = socket.sent.length
    stream.send([{ id: 0, r: 0, g: 1, b: 0 }])
    expect(socket.sent).toHaveLength(count)
  })

  it('tells the caller when the bridge ends the stream', async () => {
    const { socket, entertainmentAction, opening } = setup()
    const stream = await opening
    const ended = vi.fn()
    stream.onEnded(ended)
    socket.emit('close')
    await new Promise((r) => setTimeout(r, 0))
    expect(ended).toHaveBeenCalledWith('stream closed by the bridge')
    expect(entertainmentAction).toHaveBeenLastCalledWith(AREA_ID, 'stop')
  })

  it('stops the area again if the handshake fails', async () => {
    const clock = new ManualClock(0)
    const socket = new FakeSocket()
    const entertainmentAction = vi.fn(async () => {})
    const connect = vi.fn(() => { setTimeout(() => socket.emit('error', new Error('handshake refused')), 0); return socket })
    const opening = openStream({
      client: { entertainmentAction } as unknown as HueClient,
      area: toLightArea(area(AREA_ID, ['l1'])),
      host: 'h', appKey: 'k', clientKey: '00'.repeat(16),
      connect,
      clock, logger: pino({ level: 'silent' }),
    })
    await expect(opening).rejects.toThrow('handshake refused')
    expect(entertainmentAction).toHaveBeenLastCalledWith(AREA_ID, 'stop')
    expect(connect).toHaveBeenCalledTimes(1)      // an answer, not silence: not worth another try
  })

  it('tries the handshake again on silence (the library never resends a lost packet), and says why it gave up', async () => {
    const manual = new ManualClock(0)
    // a process that was blocked: its clock jumps ahead of the timers that were due
    let skew = 0
    const clock = {
      now: () => manual.now() + skew,
      setTimeout: (fn: () => void, ms: number) => manual.setTimeout(fn, ms),
      clearTimeout: (h: unknown) => manual.clearTimeout(h),
      setInterval: (fn: () => void, ms: number) => manual.setInterval(fn, ms),
      clearInterval: (h: unknown) => manual.clearInterval(h),
    }
    const sockets: (FakeSocket & { udp: EventEmitter })[] = []
    const entertainmentAction = vi.fn(async (_id: string, _action: string) => {})
    const opening = openStream({
      client: { entertainmentAction } as unknown as HueClient,
      area: toLightArea(area(AREA_ID, ['l1'])),
      host: 'h', appKey: 'k', clientKey: '00'.repeat(16),
      connect: () => { const sk = Object.assign(new FakeSocket(), { udp: new EventEmitter() }); sockets.push(sk); return sk },
      clock, logger: pino({ level: 'silent' }),
    })
    const failure = expect(opening).rejects.toThrow('DTLS handshake timed out (3 attempt(s), 1 packet(s) from the bridge, timers up to 1200 ms late)')
    await new Promise((r) => setTimeout(r, 0))
    sockets[0]!.udp.emit('message', Buffer.alloc(1))     // the bridge answered once, then silence
    skew = 1200
    manual.advance(100)          // the 100 ms sampler runs, 1200 ms late
    skew = 0
    for (let t = 0; t < 7000; t += 100) { manual.advance(100); await new Promise((r) => setTimeout(r, 0)) }
    await failure
    expect(sockets).toHaveLength(3)
    expect(sockets.every((sk) => sk.closed)).toBe(true)
    // between two tries, the area is stopped and started again (a half-done handshake keeps the bridge deaf)
    expect(entertainmentAction.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['start', 'stop', 'start', 'stop', 'start', 'stop'])
  })

  it('keeps the area on and connects on a second try', async () => {
    const clock = new ManualClock(0)
    const sockets: FakeSocket[] = []
    const entertainmentAction = vi.fn(async () => {})
    const opening = openStream({
      client: { entertainmentAction } as unknown as HueClient,
      area: toLightArea(area(AREA_ID, ['l1'])),
      host: 'h', appKey: 'k', clientKey: '00'.repeat(16),
      connect: () => {
        const sk = new FakeSocket()
        sockets.push(sk)
        if (sockets.length === 2) setTimeout(() => sk.emit('connected'), 0)
        return sk
      },
      clock, logger: pino({ level: 'silent' }),
    })
    for (let t = 0; t < 2500; t += 100) { clock.advance(100); await new Promise((r) => setTimeout(r, 0)) }
    const stream = await opening
    expect(sockets).toHaveLength(2)
    expect(sockets[0]!.closed).toBe(true)
    expect(entertainmentAction.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['start', 'stop', 'start'])
    await stream.close()
  })
})

describe('openStream on a socket the library closed by itself', () => {
  it('ends the stream instead of throwing out of the caller', async () => {
    const clock = new ManualClock(0)
    const socket = new FakeSocket()
    const entertainmentAction = vi.fn(async () => {})
    const stream = await openStream({
      client: { entertainmentAction } as unknown as HueClient,
      area: toLightArea(area('1a8d99cc-967b-44f2-9202-43f976c0fa6b', ['l1'])),
      host: 'h', appKey: 'k', clientKey: '00'.repeat(16),
      connect: () => { setTimeout(() => socket.emit('connected'), 0); return socket },
      clock, logger: pino({ level: 'silent' }),
    })
    const ended = vi.fn()
    stream.onEnded(ended)
    socket.send = () => { throw new Error('The socket is closed. Cannot send data.') }
    expect(() => stream.send([{ id: 0, r: 1, g: 0, b: 0 }])).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(ended).toHaveBeenCalledWith(expect.stringContaining('sending failed'))
    expect(entertainmentAction).toHaveBeenLastCalledWith('1a8d99cc-967b-44f2-9202-43f976c0fa6b', 'stop')
  })
})
