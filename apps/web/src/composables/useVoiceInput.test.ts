import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { setTransport } from '../api'
import type { DeviceDescriptor, DeviceEntry } from '@kasbah/shared'
import type { Transport } from '../api/transport'
import type * as Wav from '../lib/wav'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { HEARD_NOTHING_MS, useVoiceInput } from './useVoiceInput'

// The search microphone: press, speak, press again → the WAV goes to the plugin with the house's
// names, and the heard text comes back to the caller. The browser's audio decoding is simulated:
// happy-dom has neither a microphone, nor `MediaRecorder`, nor `AudioContext`.

vi.mock('../lib/wav', async (orig) => ({ ...(await orig<typeof Wav>()), toMono16k: vi.fn(async () => new Float32Array(16_000)) }))

class FakeRecorder {
  static last: FakeRecorder | null = null
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor() { FakeRecorder.last = this }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.() }
}

const track = { stop: vi.fn() }
const transcribe = vi.fn(async () => ({ text: 'Allume la cuisine', ms: 300 }))
const speak = vi.fn(async () => new Blob(['RIFF'], { type: 'audio/wav' }))

/** `answer`: what the caller returns after the assistant (the reply to say, or nothing). */
function harness(answer: string | null = null) {
  const heard: string[] = []
  let api!: ReturnType<typeof useVoiceInput>
  const w = mount(defineComponent({ setup() { api = useVoiceInput(async (t) => { heard.push(t); return answer }); return () => h('div') } }))
  return { w, heard, api: () => api }
}

beforeEach(() => {
  setActivePinia(createPinia())
  transcribe.mockClear(); track.stop.mockClear(); speak.mockClear()
  setTransport({ transcriptionStatus: async () => ({ ready: true, provider: 'voicestudio', speech: false }), transcribe, speak } as unknown as Transport)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } })
})
afterEach(() => { setTransport(null); vi.unstubAllGlobals() })

describe('useVoiceInput', () => {
  it('knows whether the plugin is running, and transcribes what was said with the house\'s names', async () => {
    useDevicesStore().setEntries([{ descriptor: { id: 'mock:l', pluginId: 'mock', externalId: 'l', kind: 'light', name: 'Spots cuisine', capabilities: ['on_off'], meta: {} } as DeviceDescriptor, state: { kind: 'light', updatedAt: 0, available: true, on: false } as DeviceEntry['state'] }])
    const { heard, api } = harness()
    await flushPromises()
    expect(api().ready.value).toBe(true)
    api().toggle(); await flushPromises()
    expect(api().phase.value).toBe('recording')
    api().toggle(); await flushPromises()
    expect(heard).toEqual(['Allume la cuisine'])
    expect(api().phase.value).toBe('idle')
    expect(track.stop).toHaveBeenCalled()                       // the microphone is released
    const [audio, hints] = transcribe.mock.calls[0] as unknown as [string, string[]]
    expect(atob(audio).slice(0, 4)).toBe('RIFF')
    expect(atob(audio).length).toBe(44 + 16_000 * 2)            // 1 s at 16 kHz, 16 bits
    expect(hints).toContain('Spots cuisine')
  })

  it('stops by itself after 15 s', async () => {
    vi.useFakeTimers()
    try {
      const { heard, api } = harness()
      api().toggle(); await vi.advanceTimersByTimeAsync(0)
      expect(api().phase.value).toBe('recording')
      await vi.advanceTimersByTimeAsync(15_000)
      expect(FakeRecorder.last!.state).toBe('inactive')
      await vi.runAllTimersAsync()
      expect(heard).toEqual(['Allume la cuisine'])
    } finally { vi.useRealTimers() }
  })

  it('says why the microphone is missing on an http address, without asking the browser anything', async () => {
    vi.stubGlobal('isSecureContext', false)
    const { api } = harness()
    api().toggle(); await flushPromises()
    expect(api().phase.value).toBe('idle')
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    expect(useNotificationsStore().queue.at(-1)?.text).toContain('adresse http')
  })

  it('says "heard nothing" in the field, without a banner, for a few seconds', async () => {
    transcribe.mockResolvedValueOnce({ text: '', ms: 1 })
    const { heard, api } = harness()
    const queued = useNotificationsStore().queue.length
    vi.useFakeTimers()
    try {
      api().toggle(); await flushPromises()
      api().toggle(); await flushPromises()
      expect(heard).toEqual([])
      expect(api().heardNothing.value).toBe(true)
      expect(useNotificationsStore().queue.length).toBe(queued)
      vi.advanceTimersByTime(HEARD_NOTHING_MS)
      expect(api().heardNothing.value).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('speaking again clears "heard nothing"', async () => {
    transcribe.mockResolvedValueOnce({ text: '', ms: 1 })
    const { api } = harness()
    api().toggle(); await flushPromises()
    api().toggle(); await flushPromises()
    expect(api().heardNothing.value).toBe(true)
    api().toggle(); await flushPromises()
    expect(api().heardNothing.value).toBe(false)
  })

  it('says nothing when spoken replies are off', async () => {
    const { api } = harness('Les spots de la cuisine sont allumés.')
    api().toggle(); await flushPromises()
    api().toggle(); await flushPromises()
    expect(speak).not.toHaveBeenCalled()
    expect(api().phase.value).toBe('idle')
  })
})
