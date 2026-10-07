import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { setTransport } from '../api'
import type { Transport } from '../api/transport'
import TranscriptionLinkCard from './TranscriptionLinkCard.vue'

// La fiche du plugin Transcription : choisir la voix des réponses parmi celles du fournisseur, ou
// revenir à la voix par défaut (`TTS_VOICE`).

function fake(voice: string | null, voices = [{ id: '0a1b2c3d', name: 'ma-voix', language: 'Auto' }]) {
  const setTranscriptionVoice = vi.fn(async (v: string | null) => ({ voice: v, defaultVoice: 'default' }))
  setTransport({
    transcriptionSettings: async () => ({ voice, defaultVoice: 'default' }),
    transcriptionVoices: async () => ({ voices }),
    setTranscriptionVoice,
  } as unknown as Transport)
  return setTranscriptionVoice
}

describe('TranscriptionLinkCard', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  it('propose la voix par défaut et les voix du fournisseur, et enregistre le choix', async () => {
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

  it('garde visible une voix retenue que le fournisseur ne propose plus', async () => {
    fake('disparue', [])
    const w = mount(TranscriptionLinkCard)
    await flushPromises()
    expect((w.find('select').element as HTMLSelectElement).value).toBe('disparue')
    expect(w.findAll('option').at(-1)!.text()).toBe('Voix disparue (introuvable chez le fournisseur)')
  })
})
