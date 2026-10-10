import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { setTransport } from '../api'
import type { Transport } from '../api/transport'
import type * as Wav from '../lib/wav'
import { useVoiceInput } from './useVoiceInput'

// Réponses parlées allumées (sous-item `speech`) : la réponse rendue par l'appelant est demandée au
// serveur et jouée ICI ; un toucher du micro pendant la lecture l'arrête. Fichier à part : le statut
// du plugin n'est demandé qu'une fois par chargement de page (donc de module).

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

it('dit la réponse à voix haute sur cet appareil, et un toucher du micro l’arrête', async () => {
  const api = harness('Les spots de la cuisine sont allumés.')
  await flushPromises()
  api().toggle(); await flushPromises()
  api().toggle(); await flushPromises()
  expect(speak).toHaveBeenCalledWith('Les spots de la cuisine sont allumés.')
  expect(api().phase.value).toBe('speaking')
  expect(FakeAudio.last).toMatchObject({ src: 'blob:reponse', playing: true })
  api().toggle()
  expect(FakeAudio.last!.playing).toBe(false)
  expect(api().phase.value).toBe('idle')
})

it('revient au repos à la fin de la lecture', async () => {
  const api = harness('Fait.')
  await flushPromises()
  api().toggle(); await flushPromises()
  api().toggle(); await flushPromises()
  FakeAudio.last!.onended!()
  expect(api().phase.value).toBe('idle')
})

it('réécoute une réponse à la demande, et le même bouton l’arrête', async () => {
  const api = harness(null)
  await flushPromises()
  expect(api().speech.value).toBe(true)
  api().replay('Il fait 19 degrés.'); await flushPromises()
  expect(speak).toHaveBeenCalledWith('Il fait 19 degrés.')
  expect(api().phase.value).toBe('speaking')
  api().replay('Il fait 19 degrés.')
  expect(FakeAudio.last!.playing).toBe(false)
  expect(api().phase.value).toBe('idle')
})

it('réécoute sans refaire la synthèse, tant que la réponse n’est pas oubliée', async () => {
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

it('ne parle pas quand l’appelant ne rend pas de réponse (erreur de l’assistant)', async () => {
  const api = harness(null)
  await flushPromises()
  api().toggle(); await flushPromises()
  api().toggle(); await flushPromises()
  expect(speak).not.toHaveBeenCalled()
})
