import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '../../../../../house/demo-house.json'
import { setTransport } from '../../api'
import type { AssistantEvent, Transport } from '../../api/transport'
import type * as Wav from '../../lib/wav'
import { useHouseStore } from '../../stores/house'
import SearchBar from './SearchBar.vue'

// A dictated instruction goes out without passing through the field: it stays empty, the mic at the end, to
// chain another voice command; the instruction reads at the top of the answer. Separate file:
// the transcription plugin's status is only requested once per page load (per module).

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('../../lib/wav', async (orig) => ({ ...(await orig<typeof Wav>()), toMono16k: vi.fn(async () => new Float32Array(16_000)) }))

class FakeRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.() }
}

const asked: string[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  asked.length = 0
  setTransport({
    transcriptionStatus: async () => ({ ready: true, provider: 'voicestudio', speech: false, autoSend: false }),
    transcribe: async () => ({ text: 'Ouvre les volets', ms: 300 }),
    async assistantAsk(text: string, onEvent: (e: AssistantEvent) => void) {
      asked.push(text)
      onEvent({ type: 'text', text: 'Les volets sont ouverts.' })
      onEvent({ type: 'done', ms: 1 })
    },
  } as unknown as Transport)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } })
})
afterEach(() => { setTransport(null); vi.unstubAllGlobals() })

it('after a voice command, the field stays empty and the mic is ready for the next one', async () => {
  useHouseStore().house = parseHouse(demo)
  const w = mount(SearchBar)
  await flushPromises()
  await w.find('.search__mic').trigger('click'); await flushPromises()
  await w.find('.search__mic').trigger('click'); await flushPromises()
  expect(asked).toEqual(['Ouvre les volets'])
  expect(w.find('.reply__askedtext').text()).toBe('Ouvre les volets')
  expect(w.find('.reply__answer').text()).toBe('Les volets sont ouverts.')
  expect(w.find('input').element.value).toBe('')
  expect(w.find('.search__clear').exists()).toBe(false)
  // the mic chains: the previous answer clears, listening resumes
  await w.find('.search__mic').trigger('click'); await flushPromises()
  expect(w.find('.search__reply').exists()).toBe(false)
  expect(w.find('.search__mic').attributes('data-phase')).toBe('recording')
})
