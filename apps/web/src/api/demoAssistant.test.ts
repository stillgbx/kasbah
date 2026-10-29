import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseHouse } from '@kasbah/shared'
import { createMockTransport } from './mockTransport'
import { DEMO_PROPERTIES } from './demoProperties'
import { DEMO_ONLY_MIC, DEMO_REQUESTS, demoClipOf, demoPlan, demoRequestOf, demoTranscript } from './demoAssistant'
import type { AssistantEvent as Event } from './transport'

// The demo's assistant: the heard sentence replaced by a sample request, the request run room by room
// on each demo house, and the answer matched to its recording.

const demo = (id: string, demoAssistant = true) => {
  const p = DEMO_PROPERTIES.find((x) => x.id === id)!
  return createMockTransport({ scenario: p.scenario, house: parseHouse(p.house), demoAssistant })
}

describe('demo assistant', () => {
  afterEach(() => vi.useRealTimers())

  it('replaces the transcription with a sample request, never the same twice in a row', () => {
    const heard = Array.from({ length: 20 }, (_, i) => demoTranscript('fr', () => (i * 0.37) % 1))
    expect(heard.every((t) => t.startsWith('Mode démo, transcription remplacée : '))).toBe(true)
    expect(heard.some((t, i) => i > 0 && t === heard[i - 1])).toBe(false)
    expect(demoTranscript('en').startsWith('Demo mode, transcription replaced: ')).toBe(true)
  })

  it('recognizes a request replaced or typed, in either language, and nothing else', () => {
    expect(demoRequestOf(`Mode démo, transcription remplacée : ${DEMO_REQUESTS.bedrooms.fr.ask}`)).toEqual({ id: 'bedrooms', lang: 'fr' })
    expect(demoRequestOf('set a movie mood in the living room.')).toEqual({ id: 'movie', lang: 'en' })
    expect(demoRequestOf('Allume la cuisine')).toBeNull()
    expect(demoClipOf(DEMO_REQUESTS.lights.en.answer)).toEqual({ id: 'lights', lang: 'en' })
    expect(demoClipOf('autre chose')).toBeNull()
  })

  it.each(DEMO_PROPERTIES.map((p) => p.id))('has something to do for each request in %s', async (id) => {
    const t = demo(id)
    const house = await t.getHouse()
    const entries = await t.getDevices()
    for (const request of ['lights', 'bedrooms', 'movie'] as const) expect(demoPlan(request, house, entries).length).toBeGreaterThan(0)
  })

  it('skips the rooms whose shutters are open, and only touches bedrooms or the living room', async () => {
    const t = demo('embruns')
    const house = await t.getHouse()
    const entries = await t.getDevices()
    const ids = (request: 'lights' | 'bedrooms' | 'movie') => demoPlan(request, house, entries).map((s) => s.deviceId)
    // Les Embruns: open sunshades in the living room and open shutters in bedrooms 2 and 3
    expect(ids('lights')).toEqual(expect.arrayContaining(['mock:em-light-cuisine', 'mock:em-light-entree', 'mock:em-light-sdb']))
    expect(ids('lights')).not.toContain('mock:em-light-sejour')
    expect(ids('lights')).not.toContain('mock:em-light-chambre2')
    expect(ids('bedrooms')).toEqual(expect.arrayContaining(['mock:em-cover-chambre2', 'mock:em-light-chambre3']))
    expect(ids('bedrooms')).not.toContain('mock:em-light-cuisine')
    expect(demoPlan('movie', house, entries)).toContainEqual({ deviceId: 'mock:em-light-sejour', command: { type: 'light.set', on: true, brightness: 20 } })
    expect(ids('movie')).not.toContain('mock:em-cover-portail')
  })

  it('runs a request with the tool lines of a real run, then answers', async () => {
    vi.useFakeTimers()
    const t = demo('belvedere')
    const events: Event[] = []
    const done = t.assistantAsk(DEMO_REQUESTS.bedrooms.fr.ask, (e: Event) => events.push(e))
    await vi.runAllTimersAsync()
    await done
    const tools = events.filter((e) => e.type === 'tool')
    expect(tools[0]).toMatchObject({ name: 'list_devices' })
    expect(tools.slice(1).every((e) => e.type === 'tool' && e.name === 'send_command')).toBe(true)
    expect(events.filter((e) => e.type === 'tool_result').every((e) => e.type === 'tool_result' && e.ok)).toBe(true)
    expect(events.at(-2)).toEqual({ type: 'text', text: DEMO_REQUESTS.bedrooms.fr.answer })
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('explains the microphone for anything else, and stays silent outside the demo', async () => {
    vi.useFakeTimers()
    const texts = async (t: ReturnType<typeof demo>) => {
      const events: Event[] = []
      const done = t.assistantAsk('Quelle heure est-il ?', (e: Event) => events.push(e))
      await vi.runAllTimersAsync()
      await done
      return events.filter((e) => e.type === 'text').map((e) => (e.type === 'text' ? e.text : ''))
    }
    expect(await texts(demo('tilleuls'))).toEqual([DEMO_ONLY_MIC.fr])
    expect(await texts(demo('tilleuls', false))).toEqual(["Mode démo : l'assistant a besoin du serveur Kasbah."])
    expect((await demo('tilleuls', false).transcriptionStatus()).ready).toBe(false)
    await expect(demo('tilleuls', false).transcribe('', [])).rejects.toMatchObject({ status: 501 })
  })
})
