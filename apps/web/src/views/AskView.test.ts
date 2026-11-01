import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { setTransport } from '../api'
import type { AssistantEvent, Transport } from '../api/transport'
import AskView from './AskView.vue'

// The page of the app's "Ask Kasbah" shortcut, transcription on: it listens at once when the
// microphone permission is already given, waits for a touch otherwise (never a prompt without one),
// and a typed instruction goes to the assistant, its answer in place.

class FakeRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive' }
}

let permission: PermissionState = 'granted'
const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop() {} }] }))
const assistantAsk = vi.fn(async (_text: string, onEvent: (e: AssistantEvent) => void) => {
  onEvent({ type: 'text', text: 'La lampe est allumée.' })
  onEvent({ type: 'done', ms: 1200 })
})

const mountView = () => mount(AskView)

beforeEach(() => {
  setActivePinia(createPinia())
  getUserMedia.mockClear(); assistantAsk.mockClear()
  setTransport({
    transcriptionStatus: async () => ({ ready: true, provider: 'voicestudio', speech: false, autoSend: false }),
    assistantAsk,
  } as unknown as Transport)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') }))
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: permission }) } })
})
afterEach(() => { setTransport(null); vi.unstubAllGlobals() })

describe('AskView', () => {
  it('permission given: listens on arrival', async () => {
    permission = 'granted'
    const w = mountView()
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(w.find('.ask__mic').attributes('data-phase')).toBe('recording')
    expect(w.find('.ask__status').text()).toBe('J’écoute…')
    w.unmount()
  })

  it('permission not given yet: no prompt without a touch, the microphone waits', async () => {
    permission = 'prompt'
    const w = mountView()
    await flushPromises()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(w.find('.ask__mic').attributes('data-phase')).toBe('idle')
    expect(w.find('.ask__mic').attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('a typed instruction goes to the assistant, leaves the field, and its answer shows', async () => {
    permission = 'prompt'
    const w = mountView()
    await flushPromises()
    expect(w.find('.reply').exists()).toBe(false)
    await w.find('.ask__input').setValue('Allume la lampe')
    await w.find('.ask__input').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(assistantAsk).toHaveBeenCalledWith('Allume la lampe', expect.any(Function), expect.anything())
    expect((w.find('.ask__input').element as HTMLInputElement).value).toBe('')
    expect(w.find('.reply__answer').text()).toBe('La lampe est allumée.')
    w.unmount()
  })
})
