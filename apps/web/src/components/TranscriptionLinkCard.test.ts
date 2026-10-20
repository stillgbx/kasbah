import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { setTransport } from '../api'
import type { Transport } from '../api/transport'
import TranscriptionLinkCard from './TranscriptionLinkCard.vue'

// The Transcription plugin sheet: choose the voice of the replies among the provider's, or return
// to the default voice (`TTS_VOICE`); when connected, to the house voice.

function fake(voice: string | null, voices = [{ id: '0a1b2c3d', name: 'ma-voix', language: 'Auto' }], who: { user: string | null; houseVoice: string | null } = { user: null, houseVoice: voice }) {
  const setTranscriptionVoice = vi.fn(async (v: string | null) => ({ ...who, voice: v, defaultVoice: 'default' }))
  setTransport({
    transcriptionSettings: async () => ({ ...who, voice, defaultVoice: 'default' }),
    transcriptionVoices: async () => ({ voices }),
    setTranscriptionVoice,
  } as unknown as Transport)
  return setTranscriptionVoice
}

describe('TranscriptionLinkCard', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  it('offers the default voice and the provider voices, and saves the choice', async () => {
    const set = fake(null)
    const w = mount(TranscriptionLinkCard)
    await flushPromises()
    expect(w.findAll('option').map((o) => o.text())).toEqual(['Voix par défaut (default)', 'ma-voix (Auto)'])
    await w.find('select').setValue('0a1b2c3d')
    await flushPromises()
    expect(set).toHaveBeenCalledWith('0a1b2c3d')
    await w.find('select').setValue('')
    await flushPromises()
    expect(set).toHaveBeenLastCalledWith(null)
  })

  it('connected: the first option is the house voice, and the choice only applies to the account', async () => {
    const set = fake(null, undefined, { user: 'alice', houseVoice: '0a1b2c3d' })
    const w = mount(TranscriptionLinkCard)
    await flushPromises()
    expect(w.findAll('option').map((o) => o.text())).toEqual(['Voix de la maison (ma-voix)', 'ma-voix (Auto)'])
    expect(w.find('.tl__hint').text()).toContain('pour alice seulement')
    await w.find('select').setValue('0a1b2c3d')
    await flushPromises()
    expect(set).toHaveBeenCalledWith('0a1b2c3d')
  })

  it('keeps visible a selected voice that the provider no longer offers', async () => {
    fake('disparue', [])
    const w = mount(TranscriptionLinkCard)
    await flushPromises()
    expect((w.find('select').element as HTMLSelectElement).value).toBe('disparue')
    expect(w.findAll('option').at(-1)!.text()).toBe('Voix disparue (introuvable chez le fournisseur)')
  })
})
