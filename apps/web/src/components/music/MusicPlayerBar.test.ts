import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceEntry } from '@kasbah/shared'
import MusicPlayerBar from './MusicPlayerBar.vue'

// La barre dit ce que NOTRE serveur sert à l'enceinte : un MP3 à débit constant, et en info-bulle ce
// que YouTube a donné pour le produire. La ligne garde sa place quand rien ne joue (« rien ne bouge »).

const entry = (playback: 'playing' | 'idle'): DeviceEntry => ({
  descriptor: {
    id: 'sonos:RINCON', pluginId: 'sonos', externalId: 'RINCON', kind: 'media_player', name: 'Bureau',
    capabilities: ['playback', 'now_playing', 'volume', 'mute', 'seek'],
    meta: { mediaPlayer: { deviceClass: 'speaker' } },
  },
  state: { kind: 'media_player', updatedAt: 0, available: true, playback, volume: 25, muted: false },
} as DeviceEntry)

const quality = {
  mime: 'audio/mpeg', bitrateKbps: 192, sampleRateHz: 48_000, channels: 2, lengthBytes: 5_961_600,
  source: { ext: 'm4a', formatId: '140', abrKbps: 129 },
}
const session = { durationS: 248, title: 'see through (remix)', artist: 'Samara Cyn', artUrl: null, quality }

const props = (over: Record<string, unknown> = {}) => ({
  entry: entry('playing'), name: 'Bureau', session, pending: null,
  transferMode: false, canTransfer: false, transferBusy: false, ...over,
})

/**
 * Entre le clic et le premier octet servi, il se passe quelques secondes (résolution yt-dlp) : la
 * barre montre déjà le titre et la pochette du CATALOGUE. Le badge doit suivre la même source, sinon
 * il arrive en retard sur un titre explicit et reste sur le suivant, qui ne l'est pas.
 */
describe("MusicPlayerBar — badge explicit pendant l'envoi", () => {
  const playing = (over: Record<string, unknown> = {}) => ({
    ...props({ session: null }),
    entry: {
      descriptor: entry('playing').descriptor,
      state: { ...entry('playing').state, nowPlaying: { title: 'Ancien titre', explicit: true } },
    } as DeviceEntry,
    ...over,
  })

  it("marque tout de suite un titre explicit en cours d'envoi", () => {
    const w = mount(MusicPlayerBar, { props: playing({
      entry: entry('idle'),
      pending: { title: 'Nouveau', artists: ['A'], artUrl: null, explicit: true },
    }) })
    expect(w.find('.explicit').exists()).toBe(true)
  })

  it("l'efface dès le titre suivant, sans attendre que le flux démarre", () => {
    // le lecteur joue ENCORE le morceau explicit d'avant : c'est le titre envoyé qui fait foi
    const w = mount(MusicPlayerBar, { props: playing({
      pending: { title: 'Sans marquage', artists: ['A'], artUrl: null },
    }) })
    expect(w.find('.bar__title').text()).toBe('Sans marquage')
    expect(w.find('.explicit').exists()).toBe(false)
  })

  it("reprend le marquage du lecteur une fois l'envoi terminé", () => {
    const w = mount(MusicPlayerBar, { props: playing() })
    expect(w.find('.explicit').exists()).toBe(true)
  })
})

describe('MusicPlayerBar — qualité du flux', () => {
  it('dit le format et le débit servis, et détaille la source en info-bulle', () => {
    const w = mount(MusicPlayerBar, { props: props() })
    const q = w.find('.bar__quality')
    expect(q.text().replace(/\u00a0/g, ' ')).toBe('MP3 192 kb/s')
    const hint = q.attributes('title')?.replace(/\u00a0/g, ' ') ?? ''
    expect(hint).toContain('48 kHz')
    expect(hint).toContain('stéréo')
    expect(hint).toContain('6.0 Mo')
    expect(hint).toContain('source M4A 129 kb/s')
  })

  it('garde la place de la ligne quand le lecteur ne joue rien de nous', () => {
    const w = mount(MusicPlayerBar, { props: props({ entry: entry('idle'), session: null }) })
    const q = w.find('.bar__quality')
    expect(q.exists()).toBe(true)
    expect(q.text().trim()).toBe('')
  })
})
