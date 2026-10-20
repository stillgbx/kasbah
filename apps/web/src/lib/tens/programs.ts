// The actiTENS mini's programs. The device does not know a "P3": the app sends it the
// SHAPE of the current, segment by segment (frequency, pulse width, envelope, duration). We
// replay here the segments captured on 2026-09-25, byte for byte, without the two bytes that
// `programFrame` adds in front (session identifier, number of segments).
//
// Body of a segment: `<segment no.> <duration ms LE32> <mode> <freq c1> <freq c2> <width c1>
// <width c2> <envelope> <width c1> <width c2> <envelope>` — width in tens of µs,
// envelope 0 flat / 1 rise / 2 fall, mode 1 = frequency sweep.

import type { TensChannels } from './protocol'

export interface TensProgram {
  id: string
  /** Number displayed by the app (P1…P12). */
  number: number
  segments: Uint8Array[]
}

const hex = (s: string) => Uint8Array.from(s.split(' ').map((b) => parseInt(b, 16)))

export const TENS_PROGRAMS: TensProgram[] = [
  { id: 'p1', number: 1, segments: [hex('01 00 00 00 00 00 64 64 14 14 00 14 14 00')] },
  { id: 'p2', number: 2, segments: [hex('01 00 00 00 00 00 50 50 0f 0f 00 0f 0f 00')] },
  { id: 'p3', number: 3, segments: [hex('01 00 00 00 00 00 02 02 19 19 00 19 19 00')] },
  { id: 'p4', number: 4, segments: [hex('01 00 00 00 00 00 64 02 14 14 00 14 14 00')] },
  { id: 'p5', number: 5, segments: [
    hex('81 36 42 0f 00 00 64 64 0f 0f 00 0f 0f 00'),
    hex('02 c0 c6 2d 00 00 02 02 14 14 00 14 14 00'),
  ] },
  { id: 'p6', number: 6, segments: [
    hex('01 b8 0b 00 00 00 64 64 0f 0f 00 0f 0f 00'),
    hex('02 b8 0b 00 00 00 02 02 14 14 00 14 14 00'),
  ] },
  { id: 'p7', number: 7, segments: [
    hex('01 fa 00 00 00 00 64 64 0f 0f 00 0f 0f 00'),
    hex('02 fa 00 00 00 00 00 00 00 00 00 00 00 00'),
  ] },
  { id: 'p8', number: 8, segments: [
    hex('01 4c 1d 00 00 01 02 50 14 0a 00 14 0a 00'),
    hex('02 4c 1d 00 00 01 50 02 0a 14 00 0a 14 00'),
  ] },
  // P9 "Muscle relaxation": the cycle rest 5 s / rise 2 s / contraction 10 s / fall 1 s.
  // The app precedes it with a continuous phase to choose the maximum intensity; here we start the
  // cycle directly, the intensity is adjusted while it runs.
  { id: 'p9', number: 9, segments: [
    hex('01 88 13 00 00 00 00 00 00 00 00 00 00 00'),
    hex('02 d0 07 00 00 00 32 32 23 23 01 23 23 01'),
    hex('03 10 27 00 00 00 32 32 23 23 00 23 23 00'),
    hex('04 e8 03 00 00 00 32 32 23 23 02 23 23 02'),
  ] },
  { id: 'p10', number: 10, segments: [
    hex('01 e8 03 00 00 00 50 50 0f 0f 01 0f 0f 02'),
    hex('02 e8 03 00 00 00 50 50 0f 0f 02 0f 0f 01'),
  ] },
  { id: 'p11', number: 11, segments: [
    hex('01 c8 00 00 00 00 50 50 0f 0f 01 0f 0f 02'),
    hex('02 c8 00 00 00 00 50 50 0f 0f 02 0f 0f 01'),
  ] },
  { id: 'p12', number: 12, segments: [hex('01 00 00 00 00 00 50 50 06 06 00 06 06 00')] },
]

export const tensProgram = (id: string) => TENS_PROGRAMS.find((p) => p.id === id)

/**
 * A favorite recalls the whole launch: program, duration, channels and the intensity to reach per
 * channel (tenths of mA, 0 = nothing automatic, we raise it by hand). Favorites saved before
 * channels and intensities have neither: 1 + 2 and 0.
 */
export interface TensFavorite { program: string; minutes: number; channels?: TensChannels; ch1?: number; ch2?: number }

/**
 * What distinguishes one favorite from another: the whole launch. The same program can therefore come back
 * several times, at different durations, channels or intensities.
 */
export const favoriteKey = (f: TensFavorite) => [f.program, f.minutes, f.channels ?? 3, f.ch1 ?? 0, f.ch2 ?? 0].join(':')

/** The starting favorites (one click, duration included, as in the app); editable afterwards, per machine. */
export const TENS_FAVORITES: TensFavorite[] = [
  { program: 'p6', minutes: 60 },
  { program: 'p3', minutes: 60 },
]

export const DURATION_MIN = 5
export const DURATION_MAX = 120
export const DURATION_STEP = 5
export const DURATION_DEFAULT = 30

/**
 * Intensity ceiling on the Kasbah side, per channel, in tenths of mA (30 mA, chosen by the user).
 * Nothing allows exceeding it from the page: we send current into a body.
 */
export const INTENSITY_MAX = 300
