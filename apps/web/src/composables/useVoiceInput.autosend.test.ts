import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { setTransport } from '../api'
import type { Transport } from '../api/transport'
import type * as Wav from '../lib/wav'
import { NO_SPEECH_MS, SILENCE_MS } from '../lib/vad'
import { useVoiceInput } from './useVoiceInput'

// Send at the end of the sentence on (`autoSend` sub-item): the microphone level, read by a simulated
// `AnalyserNode`, stops listening on its own after speech; without speech, nothing goes out. Separate
// file: the plugin's status is only requested once per page load (hence per module).

vi.mock('../lib/wav', async (orig) => ({ ...(await orig<typeof Wav>()), toMono16k: vi.fn(async () => new Float32Array(16_000)) }))

class FakeRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.() }
}

/** The level the microphone is hearing right now (amplitude of a square signal). */
let level = 0
const closed = vi.fn()
class FakeAudioContext {
  resume = async () => {}
  close = async () => { closed() }
  createMediaStreamSource() { return { connect() {} } }
  createAnalyser() {
    return { fftSize: 0, getFloatTimeDomainData: (frame: Float32Array) => { for (let i = 0; i < frame.length; i++) frame[i] = i % 2 ? level : -level } }
  }
}

const transcribe = vi.fn(async () => ({ text: 'Allume la cuisine', ms: 300 }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  setActivePinia(createPinia())
  level = 0.002
  transcribe.mockClear(); closed.mockClear()
  setTransport({ transcriptionStatus: async () => ({ ready: true, provider: 'voicestudio', speech: false, autoSend: true }), transcribe } as unknown as Transport)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } })
})
afterEach(() => { setTransport(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

function harness() {
  const heard: string[] = []
  let api!: ReturnType<typeof useVoiceInput>
  mount(defineComponent({ setup() { api = useVoiceInput(async (t) => { heard.push(t); return null }); return () => h('div') } }))
  return { heard, api: () => api }
}

it('speak then fall silent: listening stops by itself and the text goes out, without touching the button', async () => {
  const { heard, api } = harness()
  await vi.advanceTimersByTimeAsync(0)
  api().toggle(); await vi.advanceTimersByTimeAsync(300)
  expect(api().phase.value).toBe('recording')
  level = 0.1; await vi.advanceTimersByTimeAsync(1500)
  level = 0.002; await vi.advanceTimersByTimeAsync(SILENCE_MS - 100)
  expect(api().phase.value).toBe('recording')
  await vi.advanceTimersByTimeAsync(200)
  expect(heard).toEqual(['Allume la cuisine'])
  expect(api().phase.value).toBe('idle')
  expect(closed).toHaveBeenCalled()
})

it('nobody speaks: nothing heard, and nothing is sent to the transcription', async () => {
  const { heard, api } = harness()
  await vi.advanceTimersByTimeAsync(0)
  api().toggle(); await vi.advanceTimersByTimeAsync(NO_SPEECH_MS + 100)
  expect(api().phase.value).toBe('idle')
  expect(api().heardNothing.value).toBe(true)
  expect(transcribe).not.toHaveBeenCalled()
  expect(heard).toEqual([])
})

it('the button stays: a touch during speech sends right away', async () => {
  const { heard, api } = harness()
  await vi.advanceTimersByTimeAsync(0)
  api().toggle(); await vi.advanceTimersByTimeAsync(300)
  level = 0.1; await vi.advanceTimersByTimeAsync(800)
  api().toggle(); await vi.advanceTimersByTimeAsync(0)
  expect(heard).toEqual(['Allume la cuisine'])
})
