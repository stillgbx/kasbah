import { describe, expect, it } from 'vitest'
import { encodeWav, toBase64 } from './wav'

// L'en-tête doit dire ce que les moteurs attendent (PCM, une voie, 16 kHz, 16 bits), et les
// échantillons hors bornes être écrêtés plutôt que de déborder.

describe('encodeWav', () => {
  it('écrit un en-tête RIFF PCM 16 kHz mono 16 bits et les échantillons écrêtés', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5]))
    const view = new DataView(wav.buffer)
    const text = (at: number, n: number) => String.fromCharCode(...wav.subarray(at, at + n))
    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)          // PCM
    expect(view.getUint16(22, true)).toBe(1)          // une voie
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(12)         // 6 échantillons × 2 octets
    expect(wav.length).toBe(44 + 12)
    const samples = Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true))
    expect(samples).toEqual([0, 32767, -32768, 32767, -32768, 16383])
  })
})

describe('toBase64', () => {
  it('encode par tranches sans dépasser la pile', () => {
    const big = new Uint8Array(200_000).fill(65)
    expect(atob(toBase64(big))).toHaveLength(200_000)
    expect(toBase64(new Uint8Array([82, 73, 70, 70]))).toBe('UklGRg==')
  })
})
