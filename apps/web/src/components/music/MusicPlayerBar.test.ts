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

/**
 * Sauter de 10 s passe par le MÊME chemin qu'un déplacement au curseur (`seek` vers le parent), et
 * part de la position AFFICHÉE : deux appuis rapides s'additionnent au lieu de retomber sur un
 * relevé qui n'a pas encore bougé.
 */
describe('MusicPlayerBar — reculer / avancer de 10 s', () => {
  const at = (positionS: number, over: Record<string, unknown> = {}) => {
    const e = entry('playing')
    return {
      ...props(),
      entry: { descriptor: e.descriptor, state: { ...e.state, nowPlaying: { title: 'x', positionS, durationS: 248 }, ...over } } as DeviceEntry,
    }
  }
  const keys = (w: ReturnType<typeof mount>) => w.findAll('.key--jump')

  it("avance et recule de 10 s, et deux appuis rapides s'additionnent", async () => {
    const w = mount(MusicPlayerBar, { props: at(100) })
    expect(keys(w)).toHaveLength(2)
    // deux appuis avant que le lecteur ait bougé : 100 → 110 → 120, et non deux fois 110
    await keys(w)[1]!.trigger('click')
    await keys(w)[1]!.trigger('click')
    await keys(w)[0]!.trigger('click')
    expect(w.emitted('seek')).toEqual([[110], [120], [110]])
  })

  it('ne sort jamais du morceau : ni avant le début, ni après la fin', async () => {
    const debut = mount(MusicPlayerBar, { props: at(4) })
    await keys(debut)[0]!.trigger('click')
    expect(debut.emitted('seek')).toEqual([[0]])

    const fin = mount(MusicPlayerBar, { props: at(245) })
    await keys(fin)[1]!.trigger('click')
    expect(fin.emitted('seek')).toEqual([[248]])
  })

  it('grise les deux touches sur un direct, qui n\'a ni début ni fin', () => {
    const w = mount(MusicPlayerBar, { props: at(100, { nowPlaying: { title: 'radio', positionS: 100, live: true } }) })
    expect(keys(w).map((k) => k.attributes('disabled'))).toEqual(['', ''])
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
