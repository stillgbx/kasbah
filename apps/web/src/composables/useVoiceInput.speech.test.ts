import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { parseHouse } from '@kasbah/shared'
import demo from '../../../../house/demo-house.json'
import { setTransport } from '../api'
import type { Transport } from '../api/transport'
import type * as Wav from '../lib/wav'
import { useHouseStore } from '../stores/house'
import { useVoiceInput } from './useVoiceInput'

// Spoken replies on (`speech` sub-item): the reply returned by the caller is requested from the
// server and played HERE; a touch of the microphone during playback stops it. Separate file: the
// plugin's status is only requested once per page load (hence per module).

vi.mock('../lib/wav', async (orig) => ({ ...(await orig<typeof Wav>()), toMono16k: vi.fn(async () => new Float32Array(16_000)) }))

class FakeRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.() }
}

class FakeAudio {
  static last: FakeAudio | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playing = false
  constructor(readonly src: string) { FakeAudio.last = this }
  async play() { this.playing = true }
  pause() { this.playing = false }
}

const speak = vi.fn(async () => new Blob(['RIFF'], { type: 'audio/wav' }))

beforeEach(() => {
  setActivePinia(createPinia())
  speak.mockClear()
  setTransport({
    transcriptionStatus: async () => ({ ready: true, provider: 'voicestudio', speech: true }),
    transcribe: async () => ({ text: 'Allume la cuisine', ms: 300 }),
    speak,
  } as unknown as Transport)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:reponse', revokeObjectURL: () => {} }))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } })
})
afterEach(() => { setTransport(null); vi.unstubAllGlobals() })

function harness(answer: string | null) {
  let api!: ReturnType<typeof useVoiceInput>
  mount(defineComponent({ setup() { api = useVoiceInput(async () => answer); return () => h('div') } }))
  return () => api
}

it('says the reply aloud on this device, and a touch of the microphone stops it', async () => {
  const api = harness('Les spots de la cuisine sont allumés.')
  await flushPromises()
  api().toggle(); await flushPromises()
  api().toggle(); await flushPromises()
  expect(speak).toHaveBeenCalledWith('Les spots de la cuisine sont allumés.', {})
  expect(api().phase.value).toBe('speaking')
  expect(FakeAudio.last).toMatchObject({ src: 'blob:reponse', playing: true })
  api().toggle()
  expect(FakeAudio.last!.playing).toBe(false)
  expect(api().phase.value).toBe('idle')
})

it('returns to rest at the end of playback', async () => {
  const api = harness('Fait.')
  await flushPromises()
  api().toggle(); await flushPromises()
  api().toggle(); await flushPromises()
  FakeAudio.last!.onended!()
  expect(api().phase.value).toBe('idle')
})

it('replays a reply on demand, and the same button stops it', async () => {
  const api = harness(null)
  await flushPromises()
  expect(api().speech.value).toBe(true)
  api().replay('Il fait 19 degrés.'); await flushPromises()
  expect(speak).toHaveBeenCalledWith('Il fait 19 degrés.', {})
  expect(api().phase.value).toBe('speaking')
  api().replay('Il fait 19 degrés.')
  expect(FakeAudio.last!.playing).toBe(false)
  expect(api().phase.value).toBe('idle')
})

it('replays without redoing the synthesis, as long as the reply is not forgotten', async () => {
  const api = harness('Fait.')
  await flushPromises()
  api().toggle(); await flushPromises()
  api().toggle(); await flushPromises()
  FakeAudio.last!.onended!()
  api().replay('Fait.'); await flushPromises()
  expect(speak).toHaveBeenCalledTimes(1)
  expect(api().phase.value).toBe('speaking')
  FakeAudio.last!.onended!()
  api().replay('Autre chose.'); await flushPromises()
  expect(speak).toHaveBeenCalledTimes(2)
  FakeAudio.last!.onended!()
  api().forgetSpoken()
  api().replay('Autre chose.'); await flushPromises()
  expect(speak).toHaveBeenCalledTimes(3)
})

it('does not speak when the caller returns no reply (assistant error)', async () => {
  const api = harness(null)
  await flushPromises()
  api().toggle(); await flushPromises()
  api().toggle(); await flushPromises()
  expect(speak).not.toHaveBeenCalled()
})

it('sends the levels\' abbreviations with the reply, so that the synthesis says their name', async () => {
  useHouseStore().house = parseHouse(demo)
  const api = harness(null)
  await flushPromises()
  api().replay('Le RDC est éteint.'); await flushPromises()
  expect(speak).toHaveBeenCalledWith('Le RDC est éteint.', { RDC: 'Rez-de-chaussée' })
})
