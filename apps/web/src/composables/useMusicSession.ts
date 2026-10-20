import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { StateFor } from '@kasbah/shared'
import { getTransport } from '../api'
import type { MusicRepeat, MusicSession, RadioStation } from '../api/transport'

// The stream Kasbah serves to ONE player (`GET /api/music/sessions`): quality and queue, for
// the device panel — and, for a live stream, the station the radio plugin started there (its quality).
// The Music page keeps its own card of all the sessions; here we only follow that of a
// single player, re-read when it changes track or state, and every 20 s.
// `enabled`: false for a player that cannot receive our streams — no call to the server.
export function useMusicSession(deviceId: Ref<string>, state: Ref<StateFor<'media_player'>>, enabled: Ref<boolean>) {
  const session = ref<MusicSession | null>(null)
  const station = ref<RadioStation | null>(null)

  async function refresh(): Promise<void> {
    if (!enabled.value) { session.value = null; station.value = null; return }
    const id = deviceId.value
    const api = getTransport()
    // the station is only requested for a live stream: the rest of the time it would be of no use
    const [sessions, radios] = await Promise.allSettled([
      api.musicSessions(),
      state.value.nowPlaying?.live ? api.radioPlaying() : Promise.resolve({ playing: [] }),
    ])
    if (id !== deviceId.value) return
    // plugin absent or server mute: no session, no station
    session.value = sessions.status === 'fulfilled' ? sessions.value.sessions.find((s) => s.deviceId === id) ?? null : null
    station.value = radios.status === 'fulfilled' ? radios.value.playing.find((p) => p.deviceId === id)?.station ?? null : null
  }

  /** The queue skips (the speaker only has a "file"); the session is re-read for the next track. */
  async function step(kind: 'next' | 'previous'): Promise<void> {
    const api = getTransport()
    try { await (kind === 'next' ? api.musicQueueNext(deviceId.value) : api.musicQueuePrevious(deviceId.value)) }
    finally { void refresh() }
  }
  async function setRepeat(mode: MusicRepeat): Promise<void> {
    const q = await getTransport().musicQueueRepeat(deviceId.value, mode)
    if (session.value?.queue) session.value = { ...session.value, queue: { length: q.items.length, index: q.index, repeat: q.repeat } }
  }

  // same delay as the Music page: let the server finish starting the track it chains
  let soon: ReturnType<typeof setTimeout> | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  // another player in the same panel: do not lend it the previous one's session
  watch(deviceId, () => { session.value = null; station.value = null })
  watch(() => `${deviceId.value}|${enabled.value}|${state.value.playback}|${state.value.nowPlaying?.title ?? ''}`, () => {
    clearTimeout(soon)
    soon = setTimeout(() => { void refresh() }, 800)
  })
  onMounted(() => {
    void refresh()
    ticker = setInterval(() => { void refresh() }, 20_000)
  })
  onBeforeUnmount(() => { clearTimeout(soon); clearInterval(ticker) })

  return { session, station, step, setRepeat }
}
