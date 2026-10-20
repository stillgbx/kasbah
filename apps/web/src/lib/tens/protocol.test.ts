import { describe, expect, it } from 'vitest'
import {
  checkFrame, crc8Maxim, decodeBattery, decodeSession, encodeFrame, helloFrame, intensityFrame, parseFrame, pauseFrame,
  programFrame, rampSteps, replyCmd, resumeFrame, sessionFlagFrame, startFrame, stopFrame,
} from './protocol'
import { TENS_PROGRAMS, tensProgram } from './programs'

// All the frames expected here are COPIED from the 2026-09-25 capture (actiTENS app →
// TENS): if the encoding deviates by a byte from what the app sends, the test fails.
const hex = (s: string) => Uint8Array.from(s.trim().split(/\s+/).map((b) => parseInt(b, 16)))
const h = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')

describe('crc8Maxim', () => {
  it('matches the check byte of captured frames', () => {
    for (const f of ['1b 40 85 00 4d', '1b 40 a4 04 2a 11 5b 4a 05', '1b c0 22 00 af', '1b c0 13 01 3c 42']) {
      const b = hex(f)
      expect(crc8Maxim(b.subarray(0, -1))).toBe(b[b.length - 1])
    }
  })
})

describe('frames sent by Kasbah', () => {
  it('encode the commands exactly as the phone app does', () => {
    expect(h(helloFrame())).toBe('1b 40 85 00 4d')
    expect(h(checkFrame(3))).toBe('1b 40 a6 0d 03 2a 11 5b 4a 64 00 00 00 10 27 00 00 91')
    expect(h(checkFrame(1))).toBe('1b 40 a6 0d 01 2a 11 5b 4a 64 00 00 00 10 27 00 00 c6')
    expect(h(checkFrame(2))).toBe('1b 40 a6 0d 02 2a 11 5b 4a 64 00 00 00 10 27 00 00 36')
    expect(h(startFrame(600))).toBe('1b 40 a1 06 58 02 2a 11 5b 4a e6')
    expect(h(startFrame(7200))).toBe('1b 40 a1 06 20 1c 2a 11 5b 4a 01')
    expect(h(intensityFrame(1, 5))).toBe('1b 40 a2 07 01 05 00 2a 11 5b 4a 25')
    expect(h(intensityFrame(1, 50))).toBe('1b 40 a2 07 01 32 00 2a 11 5b 4a 4d')
    expect(h(intensityFrame(2, 0))).toBe('1b 40 a2 07 02 00 00 2a 11 5b 4a 89')
    expect(h(pauseFrame())).toBe('1b 40 a4 04 2a 11 5b 4a 05')
    expect(h(resumeFrame())).toBe('1b 40 a5 04 2a 11 5b 4a 32')
    expect(h(stopFrame())).toBe('1b 40 a3 04 2a 11 5b 4a 80')
    expect(h(sessionFlagFrame(true))).toBe('1b 40 93 02 3c ff 39')
    expect(h(sessionFlagFrame(false))).toBe('1b 40 93 02 3c 00 0c')
  })

  it('rebuild the captured program frames from the program table and the session id', () => {
    const p3 = tensProgram('p3')!
    expect(h(programFrame(0xd0, 1, p3.segments[0]!))).toBe('1b 40 a0 10 d0 01 01 00 00 00 00 00 02 02 19 19 00 19 19 00 97')
    const p6 = tensProgram('p6')!
    expect(p6.segments.map((s) => h(programFrame(0x23, 2, s)))).toEqual([
      '1b 40 a0 10 23 02 01 b8 0b 00 00 00 64 64 0f 0f 00 0f 0f 00 de',
      '1b 40 a0 10 23 02 02 b8 0b 00 00 00 02 02 14 14 00 14 14 00 95',
    ])
    const p9 = tensProgram('p9')!
    expect(h(programFrame(0xa3, 4, p9.segments[3]!))).toBe('1b 40 a0 10 a3 04 04 e8 03 00 00 00 32 32 23 23 02 23 23 02 e4')
  })

  it('declares twelve programs with 14-byte segments', () => {
    expect(TENS_PROGRAMS.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    for (const p of TENS_PROGRAMS) for (const s of p.segments) expect(s.length).toBe(14)
  })
})

describe('parseFrame', () => {
  it('reads replies and events and rejects corrupted frames', () => {
    expect(parseFrame(hex('1b c0 22 00 af'))).toEqual({ kind: 'reply', cmd: 0x22, payload: new Uint8Array() })
    expect(parseFrame(hex('1b c0 13 01 3c 42'))).toEqual({ kind: 'reply', cmd: 0x13, payload: Uint8Array.of(0x3c) })
    expect(parseFrame(hex('1b e0 14 05 3c 00 00 00 00 20'))?.kind).toBe('event')
    expect(parseFrame(hex('1b c0 22 00 00'))).toBeNull() // bad checksum
    expect(parseFrame(hex('1b c0 22 01 af'))).toBeNull() // inconsistent length
  })

  it('maps a command to its reply number', () => {
    expect(replyCmd(0xa2)).toBe(0x22)
    expect(replyCmd(0x85)).toBe(0x05)
  })

  it('round-trips what encodeFrame writes', () => {
    const f = encodeFrame(0xa2, Uint8Array.of(1, 2, 3))
    f[1] = 0xc0
    f[f.length - 1] = crc8Maxim(f.subarray(0, -1))
    expect(parseFrame(f)?.payload).toEqual(Uint8Array.of(1, 2, 3))
  })
})

describe('decoders', () => {
  it('decode the battery characteristic, on and off the charger', () => {
    expect(decodeBattery(hex('00 00 a0 0f 59'))).toEqual({ charging: false, millivolts: 4000, percent: 89 })
    expect(decodeBattery(hex('01 00 1b 11 64'))).toEqual({ charging: true, millivolts: 4379, percent: 100 })
    expect(decodeBattery(hex('00 00'))).toBeNull()
  })

  it('decode the session characteristic', () => {
    expect(decodeSession(hex('02 00 35 9e 0d 46 00 41 00'))).toEqual({ state: 'running', reason: 0, sessionTag: 0x35, remainingS: 3486, ch1: 70, ch2: 65 })
    expect(decodeSession(hex('03 00 d0 25 02 00 00 00 00'))?.state).toBe('paused')
    expect(decodeSession(hex('00 02 00 00 00 00 00 00 00'))).toMatchObject({ state: 'idle', reason: 2 })
    expect(decodeSession(hex('01 00 00 00 00 05 00 05 00'))?.state).toBe('ready')
  })
})

describe('rampSteps', () => {
  it('climbs 0.5 mA at a time, like the app', () => {
    expect(rampSteps(0, 50)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50])
    expect(rampSteps(3, 12)).toEqual([5, 10, 12])
  })

  it('drops straight down and does nothing when already there', () => {
    expect(rampSteps(50, 10)).toEqual([10])
    expect(rampSteps(20, 20)).toEqual([])
  })
})
