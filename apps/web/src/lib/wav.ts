// A microphone recording (WebM/Opus on Chrome, MP4 on Safari) becomes a 16 kHz mono 16-bit
// WAV: the format that all transcription engines read without ffmpeg (vLLM reads WebM
// poorly), and small enough for an instruction (32 KB per second).

export const STT_RATE = 16_000

/** Decodes the recording and brings it down to one channel at 16 kHz (the browser resamples). */
export async function toMono16k(recording: Blob): Promise<Float32Array> {
  const bytes = await recording.arrayBuffer()
  const decoder = new AudioContext()
  try {
    const decoded = await decoder.decodeAudioData(bytes)
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * STT_RATE)), STT_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    return (await offline.startRendering()).getChannelData(0)
  } finally {
    void decoder.close()
  }
}

/** Little-endian 16-bit PCM, one channel, with its 44-byte RIFF header. */
export function encodeWav(samples: Float32Array, rate = STT_RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(out.buffer)
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return out
}

/** Base64 of bytes, in chunks (an `apply` on 500 KB would exceed the stack). */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
