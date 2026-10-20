import type { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { ManualClock } from '@kasbah/mock-sim'
import { describe, expect, it, vi } from 'vitest'
import { RtspRelay, redactStreamUrl, type RelayMessage } from './rtsp-relay'

const box = (type: string, payload: Buffer | Buffer[] = Buffer.alloc(0)): Buffer => {
  const body = Array.isArray(payload) ? Buffer.concat(payload) : payload
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length + 8, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}
const avcC = box('avcC', Buffer.from([1, 0x4d, 0x00, 0x20, 0xff, 0xe1, 0, 0]))
const FTYP = box('ftyp', Buffer.from('isom'))
const MOOV = box('moov', box('trak', box('stsd', box('avc1', [Buffer.alloc(78), avcC]))))
const fragment = (n: number) => Buffer.concat([box('moof', Buffer.alloc(16, n)), box('mdat', Buffer.alloc(64, n))])

/** Fake ffmpeg: a process whose stdout and exit we drive. */
function fakeFfmpeg() {
  const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, kill: vi.fn() })
  proc.kill.mockImplementation(() => { proc.exitCode = 0; proc.emit('exit', null, 'SIGTERM'); return true })
  const spawnImpl = vi.fn(() => proc)
  return { proc, spawnImpl: spawnImpl as unknown as typeof spawn }
}

function relayWith(clock: ManualClock, onIdle = vi.fn()) {
  const ff = fakeFfmpeg()
  const relay = new RtspRelay({ ffmpegPath: 'ffmpeg', url: 'rtsps://cam/x?auth=t', clock, onIdle, idleGraceMs: 5000, spawnImpl: ff.spawnImpl })
  return { relay, ...ff, onIdle }
}

const collect = () => { const got: RelayMessage[] = []; return { got, fn: (m: RelayMessage) => got.push(m) } }

describe('RtspRelay', () => {
  it('spawns ffmpeg copying the stream to fragmented MP4, announces codecs, fans fragments out', () => {
    const clock = new ManualClock(0)
    const { relay, proc, spawnImpl } = relayWith(clock)
    const a = collect()
    relay.subscribe(a.fn)
    relay.start()
    const args = (spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string[]
    expect(args).toEqual(expect.arrayContaining(['-rtsp_transport', 'tcp', '-c', 'copy', '-f', 'mp4', 'pipe:1']))
    expect(args[0]).toBe('-y')                          // the thumbnail is rewritten in place
    expect(args[args.indexOf('-movflags') + 1]).toContain('frag_keyframe')
    // the header arrives in arbitrary chunks
    const head = Buffer.concat([FTYP, MOOV, fragment(1)])
    proc.stdout.write(head.subarray(0, 20))
    proc.stdout.write(head.subarray(20))
    expect(a.got.map((m) => m.kind)).toEqual(['init', 'fragment'])
    expect((a.got[0] as { mime: string }).mime).toBe('video/mp4; codecs="avc1.4D0020"')
    expect((a.got[0] as { data: Buffer }).data.equals(Buffer.concat([FTYP, MOOV]))).toBe(true)
    expect((a.got[1] as { data: Buffer }).data.equals(fragment(1))).toBe(true)
    // a subscriber arriving midway first receives the header, then the following fragments
    const b = collect()
    relay.subscribe(b.fn)
    proc.stdout.write(fragment(2))
    expect(b.got.map((m) => m.kind)).toEqual(['init', 'fragment'])
    expect(a.got).toHaveLength(3)
    expect(relay.subscriberCount).toBe(2)
  })

  it('stops ffmpeg and frees the source once the last viewer has been gone for the grace period', () => {
    const clock = new ManualClock(0)
    const { relay, proc, onIdle } = relayWith(clock)
    const a = collect(), b = collect()
    relay.start()
    relay.subscribe(a.fn)
    relay.subscribe(b.fn)
    relay.unsubscribe(a.fn)
    clock.advance(10_000)
    expect(onIdle).not.toHaveBeenCalled()             // one subscriber is left
    relay.unsubscribe(b.fn)
    clock.advance(4000)
    expect(onIdle).not.toHaveBeenCalled()             // grace period: a screen may come back
    relay.subscribe(a.fn)                             // … and it does come back: the delay is cancelled
    clock.advance(10_000)
    expect(onIdle).not.toHaveBeenCalled()
    relay.unsubscribe(a.fn)
    clock.advance(5000)
    expect(onIdle).toHaveBeenCalledTimes(1)
    relay.stop('no viewer left')
    expect(proc.kill).toHaveBeenCalled()
    expect(relay.hasEnded).toBe(true)
    // a late subscriber is told right away
    const late = collect()
    relay.subscribe(late.fn)
    expect(late.got).toEqual([{ kind: 'ended', reason: 'no viewer left' }])
  })

  it('adds a periodic JPEG snapshot output when asked, without touching the MP4 relay', () => {
    const ff = fakeFfmpeg()
    const relay = new RtspRelay({
      ffmpegPath: 'ffmpeg', url: 'rtsps://cam/x', clock: new ManualClock(0), onIdle: vi.fn(), spawnImpl: ff.spawnImpl,
      snapshot: { path: '/tmp/cam.jpg', intervalMs: 10_000, width: 480 },
    })
    relay.start()
    const args = (ff.spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string[]
    const mp4 = args.indexOf('pipe:1')
    expect(args.slice(mp4 + 1)).toEqual(['-map', '0:v:0', '-vf', 'fps=1/10,scale=480:-2', '-q:v', '4', '-update', '1', '-atomic_writing', '1', '-f', 'image2', '/tmp/cam.jpg'])
    expect(args.slice(0, mp4)).toEqual(expect.arrayContaining(['-c', 'copy']))
  })

  it('a relay that never gets a viewer reports itself idle after the grace period', () => {
    const clock = new ManualClock(0)
    const { relay, onIdle } = relayWith(clock)
    relay.start()
    clock.advance(4999)
    expect(onIdle).not.toHaveBeenCalled()
    clock.advance(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
    // …but not if a subscriber arrived in the meantime
    const clock2 = new ManualClock(0)
    const other = relayWith(clock2)
    other.relay.start()
    clock2.advance(3000)
    other.relay.subscribe(collect().fn)
    clock2.advance(10_000)
    expect(other.onIdle).not.toHaveBeenCalled()
  })

  it('an ffmpeg exit ends the relay for every viewer, with the last stderr line as the reason', () => {
    const clock = new ManualClock(0)
    const { relay, proc } = relayWith(clock)
    const a = collect()
    relay.start()
    relay.subscribe(a.fn)
    proc.stderr.write('rtsps://stream.example:443/sdm/abc?auth=g.0.SECRET: 401 Unauthorized\n')
    proc.exitCode = 1
    proc.emit('exit', 1, null)
    // the session token must never end up in a log
    expect(a.got).toEqual([{ kind: 'ended', reason: 'ffmpeg exited (1): rtsps://stream.example:443/… 401 Unauthorized' }])
    expect(redactStreamUrl('x rtsps://h/p?auth=t y rtsp://h2/q z')).toBe('x rtsps://h/… y rtsp://h2/… z')
    expect(relay.subscriberCount).toBe(0)
  })

  it('refuses a stream whose codecs it cannot describe', () => {
    const clock = new ManualClock(0)
    const { relay, proc } = relayWith(clock)
    const a = collect()
    relay.start()
    relay.subscribe(a.fn)
    proc.stdout.write(Buffer.concat([FTYP, box('moov', box('trak', box('stsd', box('hvc1', Buffer.alloc(80)))))]))
    expect(a.got).toEqual([{ kind: 'ended', reason: 'unsupported codecs (no avcC in moov)' }])
    expect(proc.kill).toHaveBeenCalled()
  })
})

describe('RtspRelay.rotateSource', () => {
  it('starts a replacement ffmpeg, switches once it delivers an init and a fragment, kills the old one', () => {
    const clock = new ManualClock(0)
    const spawned: ReturnType<typeof fakeFfmpeg>['proc'][] = []
    const spawnImpl = vi.fn(() => { const f = fakeFfmpeg(); spawned.push(f.proc); return f.proc })
    const relay = new RtspRelay({ ffmpegPath: 'ffmpeg', url: 'rtsps://cam/x?auth=t1', clock, onIdle: vi.fn(), spawnImpl: spawnImpl as unknown as typeof spawn })
    const a = collect()
    relay.start()
    relay.subscribe(a.fn)
    spawned[0]!.stdout.write(Buffer.concat([FTYP, MOOV, fragment(1)]))
    expect(a.got.map((m) => m.kind)).toEqual(['init', 'fragment'])

    relay.rotateSource('rtsps://cam/x?auth=t2')
    expect((spawnImpl.mock.calls[1] as unknown as [string, string[]])[1]).toContain('rtsps://cam/x?auth=t2')
    // as long as the replacement has not delivered a picture, the old source keeps feeding the subscribers
    spawned[0]!.stdout.write(fragment(2))
    spawned[1]!.stdout.write(Buffer.concat([FTYP, MOOV]))
    expect(a.got.map((m) => m.kind)).toEqual(['init', 'fragment', 'fragment'])
    expect(spawned[0]!.kill).not.toHaveBeenCalled()
    // first fragment of the replacement: new header, this fragment, and the old ffmpeg is stopped
    spawned[1]!.stdout.write(fragment(3))
    expect(a.got.map((m) => m.kind)).toEqual(['init', 'fragment', 'fragment', 'init', 'fragment'])
    expect((a.got[4] as { data: Buffer }).data.equals(fragment(3))).toBe(true)
    expect(spawned[0]!.kill).toHaveBeenCalledTimes(1)
    // the old source's tail is ignored, the new one feeds alone
    spawned[0]!.stdout.write(fragment(9))
    spawned[1]!.stdout.write(fragment(4))
    expect(a.got).toHaveLength(6)
    expect((a.got[5] as { data: Buffer }).data.equals(fragment(4))).toBe(true)
    expect(relay.hasEnded).toBe(false)
  })

  it('a replacement that dies before delivering leaves the current source alone', () => {
    const clock = new ManualClock(0)
    const spawned: ReturnType<typeof fakeFfmpeg>['proc'][] = []
    const spawnImpl = vi.fn(() => { const f = fakeFfmpeg(); spawned.push(f.proc); return f.proc })
    const relay = new RtspRelay({ ffmpegPath: 'ffmpeg', url: 'rtsps://cam/x?auth=t1', clock, onIdle: vi.fn(), spawnImpl: spawnImpl as unknown as typeof spawn })
    const a = collect()
    relay.start()
    relay.subscribe(a.fn)
    spawned[0]!.stdout.write(Buffer.concat([FTYP, MOOV, fragment(1)]))
    relay.rotateSource('rtsps://cam/x?auth=t2')
    spawned[1]!.exitCode = 1
    spawned[1]!.emit('exit', 1, null)
    spawned[0]!.stdout.write(fragment(2))
    expect(a.got.map((m) => m.kind)).toEqual(['init', 'fragment', 'fragment'])
    expect(relay.hasEnded).toBe(false)
  })
})
