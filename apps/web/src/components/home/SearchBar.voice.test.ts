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

// Une instruction dictée part sans passer par le champ : il reste vide, le micro au bout, pour
// enchaîner une autre commande vocale ; l'instruction se lit en tête de la réponse. Fichier à part :
// le statut du plugin de transcription n'est demandé qu'une fois par chargement de page (de module).

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

it('après une commande vocale, le champ reste vide et le micro prêt pour la suivante', async () => {
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
  // le micro enchaîne : la réponse précédente s'efface, l'écoute reprend
  await w.find('.search__mic').trigger('click'); await flushPromises()
  expect(w.find('.search__reply').exists()).toBe(false)
  expect(w.find('.search__mic').attributes('data-phase')).toBe('recording')
})
