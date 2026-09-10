import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import MediaPlayerControl from './MediaPlayerControl.vue'

// Ce qu'un lecteur affiche quand il ne dit presque rien : appli native d'une TV Android (Prime Video),
// direct sans durée, ou métadonnées en retard. Cas relevés en réel, voir le wiki 3_6_google-cast.

const descriptor: DeviceDescriptor = {
  id: 'google_cast:tv', pluginId: 'google_cast', externalId: 'tv', kind: 'media_player', name: 'TV Salon',
  capabilities: ['playback', 'now_playing', 'track_skip', 'seek', 'volume', 'mute'],
  meta: { mediaPlayer: { deviceClass: 'tv' } },
}
const base: StateFor<'media_player'> = { kind: 'media_player', updatedAt: 0, available: true, playback: 'playing', volume: 20, muted: false }

const times = (w: ReturnType<typeof mount>) => w.find('.now__times')
const hidden = (w: ReturnType<typeof mount>, sel: string) => w.find(sel).classes().includes('now--hidden')

describe('MediaPlayerControl', () => {
  it('names the app when there is no title, without an endless waiting marker', () => {
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, nowPlaying: { title: '', source: 'Prime Video', positionS: 141.89 } } } })
    expect(w.text()).toContain('Prime Video')
    expect(w.text()).not.toContain('…')
  })

  it('shows the position alone when the duration is unknown, and never a negative time', () => {
    // Prime Video annonce `duration: -0.001` : le plugin la retire, mais l'UI ne doit pas non plus
    // en faire un temps si elle arrive quand même (autre plugin, simulation)
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, nowPlaying: { title: '', source: 'Prime Video', positionS: 141.89, durationS: -0.001 } } } })
    expect(times(w).text()).toBe('2:21')                    // position seule, pas de total
    expect(times(w).text()).not.toContain('-')
    expect(hidden(w, '.now__times')).toBe(false)            // les temps sont visibles
    expect(hidden(w, '.now__seek')).toBe(true)              // le curseur, non : rien à parcourir
  })

  it('shows both times and an active slider on a real duration', () => {
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, nowPlaying: { title: 'Terracotta', source: 'Spotify', positionS: 42.5, durationS: 187.2 } } } })
    expect(times(w).text()).toBe('0:423:07')
    expect(hidden(w, '.now__seek')).toBe(false)
  })

  it('greys out previous / next / seek on a live stream, but not play-pause', () => {
    // le direct de franceinfo : « précédent » y coupait le flux (SEEK à 0 côté plugin)
    const live = { descriptor, state: { ...base, nowPlaying: { title: 'franceinfo', source: 'Radio France', positionS: 38.2, live: true } } }
    const keys = mount(MediaPlayerControl, { props: live }).findAll('.v-btn')
    expect(keys[0]!.attributes('disabled')).toBeDefined()             // précédent
    expect(keys[1]!.attributes('disabled')).toBeUndefined()           // lecture / pause
    expect(keys[2]!.attributes('disabled')).toBeDefined()             // suivant
    // un direct à durée (rare) ne se parcourt pas davantage
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...live.state, nowPlaying: { ...live.state.nowPlaying, durationS: 3600 } } } })
    expect(w.find('.now__seek input').attributes('disabled')).toBeDefined()
  })

  it('keeps previous and next active on an ordinary track', () => {
    const keys = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, nowPlaying: { title: 'Terracotta', positionS: 42.5, durationS: 187.2 } } } }).findAll('.v-btn')
    for (const k of keys.slice(0, 3)) expect(k.attributes('disabled')).toBeUndefined()
  })

  it('keeps the four lines of the block when nothing plays (rien ne doit bouger)', () => {
    const w = mount(MediaPlayerControl, { props: { descriptor, state: { ...base, playback: 'idle' } } })
    expect(times(w).exists()).toBe(true)
    expect(hidden(w, '.now__times')).toBe(true)
    expect(hidden(w, '.now__seek')).toBe(true)
  })
})
