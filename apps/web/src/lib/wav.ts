// Un enregistrement du micro (WebM/Opus sous Chrome, MP4 sous Safari) devient un WAV 16 kHz mono
// 16 bits : le format que tous les moteurs de transcription lisent sans ffmpeg (vLLM lit mal le
// WebM), et assez petit pour une instruction (32 Ko par seconde).

export const STT_RATE = 16_000

/** Décode l'enregistrement et le ramène à une voie à 16 kHz (le navigateur rééchantillonne). */
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

/** PCM 16 bits petit-boutiste, une voie, avec son en-tête RIFF de 44 octets. */
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

/** Base64 d'octets, par tranches (un `apply` sur 500 Ko dépasserait la pile). */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
