import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { setTransport } from '../../api'
import type { Transport } from '../../api/transport'
import SearchPalette from './SearchPalette.vue'

// The app's "Ask Kasbah" shortcut with transcription on: the palette listens at once when the
// microphone permission is already given, and falls back to the focused field otherwise. Separate
// file: the plugin's status is only requested once per page load (hence per module).

const route = { name: 'home' as string, query: {} as Record<string, string | null> }
const replace = vi.fn(async (to: { query: Record<string, string | null> }) => { route.query = to.query })
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace }), useRoute: () => route }))

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
const focus = vi.spyOn(HTMLInputElement.prototype, 'focus')

beforeEach(() => {
  setActivePinia(createPinia())
  route.query = { ask: null, source: 'shortcut' }
  getUserMedia.mockClear(); focus.mockClear()
  setTransport({ transcriptionStatus: async () => ({ ready: true, provider: 'voicestudio', speech: false, autoSend: false }) } as unknown as Transport)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') }))
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: permission }) } })
})
afterEach(() => { setTransport(null); vi.unstubAllGlobals() })

describe('SearchPalette, app shortcut', () => {
  it('permission given: opens listening, the keyboard down', async () => {
    permission = 'granted'
    const w = mount(SearchPalette, { global: { stubs: { teleport: true } } })
    await flushPromises()
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(w.find('.palette__mic').attributes('data-phase')).toBe('recording')
    expect(focus).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith({ query: {} })
    w.unmount()
  })

  it('permission not given yet: no prompt without a touch, the field focused and the microphone at hand', async () => {
    permission = 'prompt'
    const w = mount(SearchPalette, { global: { stubs: { teleport: true } } })
    await flushPromises()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(w.find('.palette__mic').attributes('data-phase')).toBe('idle')
    expect(focus).toHaveBeenCalled()
    w.unmount()
  })
})
