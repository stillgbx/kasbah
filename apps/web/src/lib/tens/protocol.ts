// Bluetooth protocol of the actiTENS mini (Sublimed, `acTENSv2_…`), recorded by capture on 2026-09-25:
// see `_generated-ai-doc/tens/protocole.md`. Pure — neither Bluetooth nor Vue — to be tested without the device.
//
// A frame: `1b 40 <command> <length> <data…> <crc>` from Kasbah to the TENS, and
// `1b c0 <command & 0x7f> <length> <data…> <crc>` in response (`1b e0 …`: spontaneous event).
// The checksum is a CRC-8/MAXIM over the whole frame, verified on the 74 captured frames.

export const TENS_SERVICE = '59994ce0-ba92-4fe6-be82-84b98195945b'
export const TENS_COMMAND_CHAR = '59994ce1-ba92-4fe6-be82-84b98195945b'
export const TENS_REPLY_CHAR = '59994ce2-ba92-4fe6-be82-84b98195945b'
export const TENS_STATUS_SERVICE = '9c7786c0-fbcb-11e5-a837-0800200c9a66'
export const TENS_BATTERY_CHAR = '9c7786c2-fbcb-11e5-a837-0800200c9a66'
export const TENS_SESSION_CHAR = '9c7786c4-fbcb-11e5-a837-0800200c9a66'

export const CMD = {
  hello: 0x85,
  program: 0xa0,
  start: 0xa1,
  intensity: 0xa2,
  stop: 0xa3,
  pause: 0xa4,
  resume: 0xa5,
  check: 0xa6,
  register: 0x93,
} as const

/**
 * The 4-byte token that the app attaches to each command. No TENS reply contains it:
 * it is perhaps a session identifier chosen by the app, perhaps a value tied to the account.
 * We replay the one from the capture; the first live trial will tell whether another value passes.
 */
export const TENS_TOKEN = Uint8Array.of(0x2a, 0x11, 0x5b, 0x4a)

/** CRC-8/MAXIM (Dallas 1-Wire): reflected polynomial 0x31 (0x8c), init 0, no final xor. */
export function crc8Maxim(bytes: Uint8Array): number {
  let crc = 0
  for (const b of bytes) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0x8c : crc >>> 1
  }
  return crc
}

export function encodeFrame(cmd: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const out = new Uint8Array(payload.length + 5)
  out.set([0x1b, 0x40, cmd, payload.length])
  out.set(payload, 4)
  out[out.length - 1] = crc8Maxim(out.subarray(0, -1))
  return out
}

export interface TensReply { kind: 'reply' | 'event'; cmd: number; payload: Uint8Array }

/** A frame received on the reply channel, or `null` if it is truncated or corrupted. */
export function parseFrame(bytes: Uint8Array): TensReply | null {
  if (bytes.length < 5 || bytes[0] !== 0x1b) return null
  const kind = bytes[1] === 0xc0 ? 'reply' : bytes[1] === 0xe0 ? 'event' : null
  if (!kind) return null
  const len = bytes[3]!
  if (bytes.length !== len + 5) return null
  if (crc8Maxim(bytes.subarray(0, -1)) !== bytes[bytes.length - 1]) return null
  return { kind, cmd: bytes[2]!, payload: bytes.slice(4, 4 + len) }
}

/** The expected reply to a command: same number, high bit removed (a2 → 22). */
export const replyCmd = (cmd: number) => cmd & 0x7f

/** REFUSAL reply: `1b c0 7f 02 <refused command> <code>` (code 5 for a malformed program). */
export const REFUSED = 0x7f

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff]

/** Channels 1, 2 or both — the mask carried by the electrode check. */
export type TensChannels = 1 | 2 | 3

/**
 * Automatic electrode check (the TENS passes 0.5 mA through them), first step of each
 * launch. The tail `64 00 00 00 10 27 00 00` is replayed as is: identical in all
 * the captures, meaning unknown.
 */
export const checkFrame = (channels: TensChannels) =>
  encodeFrame(CMD.check, Uint8Array.of(channels, ...TENS_TOKEN, 0x64, 0, 0, 0, 0x10, 0x27, 0, 0))

/**
 * A program segment: `<session identifier> <number of segments> <captured body>`. The
 * number of segments is read in all the captures (01 for P1-P4 and P12, 02 for P5-P8, P10,
 * P11, 04 for P9); a wrong number is refused (`1b c0 7f 02 a0 05`, observed live).
 */
export const programFrame = (sessionTag: number, segmentCount: number, segment: Uint8Array) =>
  encodeFrame(CMD.program, Uint8Array.of(sessionTag & 0xff, segmentCount, ...segment))

export const startFrame = (durationS: number) => encodeFrame(CMD.start, Uint8Array.of(...u16(durationS), ...TENS_TOKEN))

/** ABSOLUTE intensity of a channel, in tenths of a milliampere (50 = 5.0 mA). */
export const intensityFrame = (channel: 1 | 2, tenths: number) =>
  encodeFrame(CMD.intensity, Uint8Array.of(channel, ...u16(tenths), ...TENS_TOKEN))

export const pauseFrame = () => encodeFrame(CMD.pause, TENS_TOKEN)
export const resumeFrame = () => encodeFrame(CMD.resume, TENS_TOKEN)
export const stopFrame = () => encodeFrame(CMD.stop, TENS_TOKEN)
export const helloFrame = () => encodeFrame(CMD.hello)
/** Register 0x3c: the app arms it (`ff`) right after startup and puts it back to 0 after the stop. */
export const sessionFlagFrame = (on: boolean) => encodeFrame(CMD.register, Uint8Array.of(0x3c, on ? 0xff : 0))

export interface TensBattery {
  charging: boolean
  millivolts: number
  /** Deduced from the voltage by the device: a false 100 % as soon as it is on the cable. */
  percent: number
}

/** Battery characteristic (`c2`): `[charging][?][mV LE16][%]`. */
export function decodeBattery(bytes: Uint8Array): TensBattery | null {
  if (bytes.length < 5) return null
  return { charging: bytes[0] === 1, millivolts: bytes[2]! | (bytes[3]! << 8), percent: bytes[4]! }
}

export type TensSessionState = 'idle' | 'ready' | 'running' | 'paused'
const SESSION_STATES: Record<number, TensSessionState> = { 0: 'idle', 1: 'ready', 2: 'running', 3: 'paused' }

export interface TensSession {
  state: TensSessionState
  /** Byte 1: `02` after a requested stop — presumed end reason, kept raw. */
  reason: number
  /** Low byte of the session identifier sent with the program. */
  sessionTag: number
  remainingS: number
  /** Intensities in tenths of mA. */
  ch1: number
  ch2: number
}

/** Session characteristic (`c4`): `[state][reason][session][s remaining LE16][c1 LE16][c2 LE16]`. */
export function decodeSession(bytes: Uint8Array): TensSession | null {
  if (bytes.length < 9) return null
  return {
    state: SESSION_STATES[bytes[0]!] ?? 'idle',
    reason: bytes[1]!,
    sessionTag: bytes[2]!,
    remainingS: bytes[3]! | (bytes[4]! << 8),
    ch1: bytes[5]! | (bytes[6]! << 8),
    ch2: bytes[7]! | (bytes[8]! << 8),
  }
}

/** Step of the app's + / − buttons, and of its progressive ramp-up: 0.5 mA. */
export const INTENSITY_STEP = 5

/**
 * The steps to go from one intensity to another, as the app does: never a jump, a
 * step of 0.5 mA at a time on the way up. The way down, for its part, is immediate — lowering the current
 * must never wait.
 */
export function rampSteps(from: number, to: number, step = INTENSITY_STEP): number[] {
  if (to <= from) return to === from ? [] : [to]
  const out: number[] = []
  let v = from
  while (v < to) {
    v = Math.min(to, (Math.floor(v / step) + 1) * step)
    out.push(v)
  }
  return out
}
