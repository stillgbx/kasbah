import { deviceClassOf, type CommandInput, type DeviceEntry, type House } from '@kasbah/shared'

// The assistant of the demo without a server (in-process transport): no transcription and no Claude,
// three sample requests instead. The microphone really listens, then the heard sentence is replaced by
// one of them, said as such; the request runs on the simulated house and the answer is played from a
// recording (`apps/web/demo/voice/`, copied beside the demo build). The requests name no room: their
// names differ from one demo house to the other.

export type DemoLang = 'en' | 'fr'
export type DemoRequestId = 'lights' | 'bedrooms' | 'movie'

export const DEMO_REQUESTS: Record<DemoRequestId, Record<DemoLang, { ask: string; answer: string }>> = {
  lights: {
    en: { ask: 'Turn on the lights, except in rooms with open shutters', answer: 'Done: the lights are on, except in rooms with open shutters.' },
    fr: { ask: 'Allume les lumières, sauf dans les pièces où les volets sont ouverts', answer: 'C\'est fait : les lumières sont allumées, sauf dans les pièces aux volets ouverts.' },
  },
  bedrooms: {
    en: { ask: 'Close the bedroom shutters and turn off their lights', answer: 'The bedroom shutters are closing, and their lights are off.' },
    fr: { ask: 'Ferme les volets des chambres et éteins leurs lumières', answer: 'Les volets des chambres se ferment, et leurs lumières sont éteintes.' },
  },
  movie: {
    en: { ask: 'Set a movie mood in the living room', answer: 'Movie mood is ready: lights dimmed, shutters closed.' },
    fr: { ask: 'Mets une ambiance cinéma dans le séjour', answer: 'L\'ambiance cinéma est prête : lumières tamisées, volets fermés.' },
  },
}

const REPLACED: Record<DemoLang, string> = { en: 'Demo mode, transcription replaced: ', fr: 'Mode démo, transcription remplacée : ' }

/** The answer to anything else than the three requests. */
export const DEMO_ONLY_MIC: Record<DemoLang, string> = {
  en: 'Demo mode: tap the microphone and say anything, the demo answers with one of its three sample requests.',
  fr: 'Mode démo : touchez le micro et dites n\'importe quoi, la démo répond par l\'une de ses trois demandes d\'exemple.',
}

/** The app's language, which the settings store writes on <html>. */
export const demoLang = (): DemoLang => (typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? 'en' : 'fr')

const IDS = Object.keys(DEMO_REQUESTS) as DemoRequestId[]
let lastPicked: DemoRequestId | null = null

/** The "transcription": one of the requests, never the same twice in a row, said to be a replacement. */
export function demoTranscript(lang: DemoLang, random: () => number = Math.random): string {
  const ids = IDS.filter((id) => id !== lastPicked)
  const id = ids[Math.floor(random() * ids.length)] ?? ids[0]!
  lastPicked = id
  return REPLACED[lang] + DEMO_REQUESTS[id][lang].ask
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/[.!?\s]+$/, '').replace(/\s+/g, ' ')

/** Which request a text is: the replaced transcription, or the request typed as is, in either language. */
export function demoRequestOf(text: string): { id: DemoRequestId; lang: DemoLang } | null {
  let t = text.trim()
  for (const prefix of Object.values(REPLACED)) if (t.startsWith(prefix)) t = t.slice(prefix.length)
  for (const id of IDS) for (const lang of ['en', 'fr'] as const) {
    if (normalize(t) === normalize(DEMO_REQUESTS[id][lang].ask)) return { id, lang }
  }
  return null
}

/** The request whose answer this is, to play its recording. */
export function demoClipOf(answer: string): { id: DemoRequestId; lang: DemoLang } | null {
  for (const id of IDS) for (const lang of ['en', 'fr'] as const) if (DEMO_REQUESTS[id][lang].answer === answer) return { id, lang }
  return null
}

/** What closes a window, for these requests: shutters, blinds and curtains (not gates, garages, awnings). */
const SHADES = ['shutter', 'blind', 'curtain']
const BEDROOM = /^(chambre|suite)|bedroom/i
const LIVING_ROOM = /séjour|salon|living/i

export interface DemoStep { deviceId: string; command: CommandInput }

/** The commands a request sends on this house, room by room. */
export function demoPlan(id: DemoRequestId, house: House, entries: DeviceEntry[]): DemoStep[] {
  const byId = new Map(entries.map((e) => [e.descriptor.id, e]))
  const rooms = house.rooms.map((room) => {
    const inRoom = house.devices.filter((d) => d.roomId === room.id && d.deviceId).map((d) => byId.get(d.deviceId!)).filter((e) => e !== undefined)
    return {
      name: room.name,
      lights: inRoom.filter((e) => e.descriptor.kind === 'light'),
      shades: inRoom.filter((e) => e.descriptor.kind === 'cover' && SHADES.includes(deviceClassOf(e.descriptor) ?? '')),
    }
  })
  const on = (e: DeviceEntry, brightness?: number): DemoStep =>
    ({ deviceId: e.descriptor.id, command: { type: 'light.set', on: true, ...(brightness === undefined ? {} : { brightness }) } })
  const off = (e: DeviceEntry): DemoStep => ({ deviceId: e.descriptor.id, command: { type: 'light.set', on: false } })
  const close = (e: DeviceEntry): DemoStep => ({ deviceId: e.descriptor.id, command: { type: 'cover.close' } })
  const isOpen = (e: DeviceEntry) => e.state.kind === 'cover' && (e.state.position ?? 0) > 0

  if (id === 'lights') return rooms.filter((r) => !r.shades.some(isOpen)).flatMap((r) => r.lights.map((e) => on(e)))
  if (id === 'bedrooms') return rooms.filter((r) => BEDROOM.test(r.name)).flatMap((r) => [...r.shades.map(close), ...r.lights.map(off)])
  return rooms.filter((r) => LIVING_ROOM.test(r.name)).flatMap((r) => [...r.lights.map((e) => on(e, 20)), ...r.shades.map(close)])
}
