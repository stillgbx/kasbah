import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { CommandInput, DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../api'
import type { MusicQueue, MusicTrack, MusicRepeat, MusicSession } from '../api/transport'
import { t } from '../i18n'

// LOCAL player: the sound of the device that displays the page (tablet, computer, phone). The
// server resolves the track and relays the "file" (`POST /api/plugins/ytmusic/local`); an
// `<audio>` plays it. PRIVATE session: the server does not know it as a player, the other screens
// do not see it. The queue therefore lives here, and follows the same rules as the server's (`queue.ts`):
// repeat applies to the track, the queue does not loop.
//
// The store presents itself to the Music page as one more player (`entry`, a synthetic
// `media_player`): the Listening panel and the bottom bar show it without special cases; only the
// commands change path (`command`, here, instead of `devices.sendCommand`). It lives outside the
// view: the music keeps going when changing page.
//
// The last listening survives a page reload: the queue and the position are kept in this
// browser (on each action: play, pause, seek, next track). On return, the track is
// there, paused at its position (`restored`: nothing loaded in the `<audio>`); play restarts it from there.

export const LOCAL_PREFIX = 'local:'
export const isLocalPlayer = (id: string | null | undefined) => !!id && id.startsWith(LOCAL_PREFIX)

/** Beyond this playing time, "previous" goes back to the start of the track (like the server). */
const RESTART_AFTER_S = 3
/**
 * Empty WAV: a first `play()` INSIDE the user's gesture unlocks the audio element (Safari
 * otherwise refuses a `play()` that arrives after the server's response, outside the gesture).
 */
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

function randomId(): string {
  const a = new Uint8Array(8)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const useLocalPlayerStore = defineStore('localPlayer', () => {
  const clientId = useLocalStorage('kasbah.music.localClientId', randomId())
  const id = computed(() => `${LOCAL_PREFIX}${clientId.value}`)
  const volume = useLocalStorage('kasbah.music.localVolume', 80)
  const muted = ref(false)

  const playback = ref<'idle' | 'playing' | 'paused'>('idle')
  /** Published position, to the second: the bar advances it by itself between two readings. */
  const positionS = ref(0)
  const updatedAt = ref(Date.now())
  const session = ref<MusicSession | null>(null)
  const queue = ref<MusicQueue | null>(null)
  /** A track being resolved on the server side (hourglass in the bar). */
  const busy = ref(false)
  /** Each launch has its number: a track resolved too late does not replace the next one. */
  let generation = 0

  let audio: HTMLAudioElement | null = null
  let unlocked = false
  /** A single new attempt per track when the file no longer plays (session expired on the server side). */
  let retried = false

  // ---- last listening, kept in this browser ---------------------------------------------------------
  // Two keys: the queue (up to 1,000 tracks) is only written when it changes, the position on each reading.
  const savedQueue = useLocalStorage<MusicQueue | null>('kasbah.music.localQueue', null, { serializer: { read: (v) => (v ? JSON.parse(v) as MusicQueue : null), write: (v) => JSON.stringify(v) } })
  const savedPosition = useLocalStorage('kasbah.music.localPosition', 0)
  if (savedQueue.value?.items[savedQueue.value.index]) {
    queue.value = savedQueue.value
    positionS.value = savedPosition.value
    playback.value = 'paused'
  }
  /** The displayed track comes from the save: the `<audio>` has not loaded anything yet. */
  const restored = ref(playback.value === 'paused')
  watch(queue, (q) => { savedQueue.value = q })
  watch(positionS, (p) => { savedPosition.value = p })

  const current = computed<MusicTrack | null>(() => (queue.value ? queue.value.items[queue.value.index] ?? null : null))

  function el(): HTMLAudioElement {
    if (audio) return audio
    const a = new Audio()
    a.preload = 'auto'
    a.volume = volume.value / 100
    // the silent unlock sound says nothing about playback: its events are ignored
    const silent = () => a.src.startsWith('data:')
    a.addEventListener('playing', () => { if (!silent()) { playback.value = 'playing'; publish(a.currentTime) } })
    a.addEventListener('pause', () => { if (!silent() && playback.value === 'playing') { playback.value = 'paused'; publish(a.currentTime) } })
    a.addEventListener('timeupdate', () => { if (!silent() && Math.floor(a.currentTime) !== positionS.value) publish(a.currentTime) })
    a.addEventListener('seeked', () => { if (!silent()) publish(a.currentTime) })
    a.addEventListener('ended', () => { if (!silent()) void onEnded() })
    a.addEventListener('error', () => { if (!silent()) void onError() })
    audio = a
    return a
  }
  function publish(pos: number) {
    positionS.value = Math.floor(pos)
    updatedAt.value = Date.now()
    reportProgress(false)
  }
  /**
   * The position of the current track, told to the server from time to time (and at the end): it is what
   * allows resuming a multi-hour mix, which the server does not see playing here.
   */
  let reportedAt = 0
  const REPORT_EVERY_MS = 15_000
  function reportProgress(ended: boolean) {
    const tr = current.value
    if (!tr || (!ended && Date.now() - reportedAt < REPORT_EVERY_MS)) return
    reportedAt = Date.now()
    const durationS = session.value?.durationS ?? tr.durationS
    void getTransport().musicProgress({
      source: tr.source, id: tr.id, positionS: ended && durationS ? durationS : positionS.value,
      ...(durationS ? { durationS } : {}), ...(ended ? { ended: true } : {}),
    }).catch(() => { /* resuming is a comfort: a lost send does not hinder listening */ })
  }
  watch(volume, (v) => { if (audio) audio.volume = v / 100 })
  watch(muted, (m) => { if (audio) audio.muted = m })

  /** To be called INSIDE the gesture (click) that starts a local playback, before any `await`. */
  function prime() {
    if (unlocked) return
    unlocked = true
    const a = el()
    a.src = SILENT_WAV
    a.play().catch(() => { /* nothing to hear: only the unlocking counts */ })
  }

  /** Play the track `index` of the queue from `startS`. */
  async function go(index: number, repeat: MusicRepeat, startS = 0) {
    const q = queue.value
    const track = q?.items[index]
    if (!q || !track) return
    const gen = ++generation
    restored.value = false
    queue.value = { ...q, index, repeat }
    busy.value = true
    retried = false
    const a = el()
    a.pause()
    try {
      const next = afterEnd({ ...q, index, repeat })
      const nextTrack = next && next.index !== index ? q.items[next.index] : undefined
      const r = await getTransport().musicLocalPlay({ ...track, clientId: clientId.value, ...(nextTrack ? { next: { source: nextTrack.source, id: nextTrack.id } } : {}) })
      if (gen !== generation) return
      await load(r.streamUrl, r.session, startS)
    } finally {
      if (gen === generation) busy.value = false
    }
  }

  async function load(streamUrl: string, s: MusicSession, startS: number) {
    const a = el()
    session.value = s
    a.src = streamUrl
    if (startS > 0) {
      // setting the position before the metadata is ignored by some browsers: wait for them
      await new Promise<void>((resolve) => {
        const done = () => { a.removeEventListener('loadedmetadata', done); a.removeEventListener('error', done); resolve() }
        a.addEventListener('loadedmetadata', done)
        a.addEventListener('error', done)
      })
      a.currentTime = startS
    }
    publish(startS)
    playback.value = 'paused'
    await a.play()
    updateMediaSession()
  }

  async function onEnded() {
    reportProgress(true)
    const q = queue.value
    const next = q ? afterEnd(q) : null
    if (!next) {
      playback.value = 'idle'
      // the queue has run to the end: nothing left to resume
      queue.value = null
      return
    }
    if (next.index === q!.index && audio) {
      // the same track: its file is still good, no need to go to the server
      queue.value = { ...q!, repeat: next.repeat }
      audio.currentTime = 0
      await audio.play()
      return
    }
    try { await go(next.index, next.repeat) }
    catch { playback.value = 'idle' }
  }

  /** The file no longer plays (server restarted, session expired): we ask for the track again, once, at the same position. */
  async function onError() {
    if (!audio || !queue.value || busy.value) return
    if (retried) {
      playback.value = 'idle'
      return
    }
    const at = audio.currentTime
    const q = queue.value
    await go(q.index, q.repeat, at).catch(() => { playback.value = 'idle' })
    retried = true
  }

  // ---- what the page calls ----------------------------------------------------------------------------
  /** New queue: `tracks[startIndex]` plays, the rest follows. */
  async function playQueue(tracks: MusicTrack[], startIndex: number) {
    // resuming a mix only applies at the first launch: the queue keeps the track without it
    const startS = tracks[startIndex]?.startS ?? 0
    queue.value = { items: tracks.map(({ startS: _s, ...t }) => t), index: startIndex, repeat: 'off' }
    await go(startIndex, 'off', startS)
  }
  async function next() {
    const q = queue.value
    if (q && q.index + 1 < q.items.length) await go(q.index + 1, jumpRepeat(q.repeat))
  }
  async function previous() {
    const q = queue.value
    if (!q) return
    if (restored.value) {
      if (q.index === 0 || positionS.value > RESTART_AFTER_S) seek(0)
      else await go(q.index - 1, jumpRepeat(q.repeat))
      return
    }
    if (!audio) return
    if (audio.currentTime > RESTART_AFTER_S || q.index === 0) {
      audio.currentTime = 0
      return
    }
    await go(q.index - 1, jumpRepeat(q.repeat))
  }
  async function jump(index: number) {
    const q = queue.value
    if (q && index >= 0 && index < q.items.length) await go(index, jumpRepeat(q.repeat))
  }
  function setRepeat(mode: MusicRepeat) {
    if (queue.value) queue.value = { ...queue.value, repeat: mode }
  }
  /** Add without interrupting; nothing playing? The tracks start right away. */
  async function add(tracks: MusicTrack[], where: 'next' | 'end'): Promise<boolean> {
    const q = queue.value
    if (!q || playback.value === 'idle') {
      await playQueue(tracks, 0)
      return true
    }
    const items = [...q.items]
    if (where === 'next') items.splice(q.index + 1, 0, ...tracks)
    else items.push(...tracks)
    queue.value = { ...q, items }
    return false
  }
  function remove(index: number) {
    const q = queue.value
    if (!q || index < 0 || index >= q.items.length || index === q.index) return
    queue.value = { ...q, items: q.items.filter((_, i) => i !== index), index: index < q.index ? q.index - 1 : q.index }
  }
  function clear() {
    const q = queue.value
    if (q) queue.value = { ...q, items: [q.items[q.index]!], index: 0 }
  }
  function seek(s: number) {
    // nothing loaded: we only choose where playback will restart from
    if (restored.value) {
      publish(Math.max(0, s))
      return
    }
    if (!audio) return
    audio.currentTime = Math.max(0, s)
    publish(audio.currentTime)
  }
  /** Stop everything and forget the track: nothing plays here anymore. */
  function stop() {
    generation++
    busy.value = false
    restored.value = false
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    playback.value = 'idle'
    session.value = null
    queue.value = null
    publish(0)
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null
  }

  /** The commands of the bar and the panel, as for a network player. */
  function command(cmd: CommandInput) {
    const a = audio
    switch (cmd.type) {
      case 'media_player.play':
        if (restored.value && queue.value) {
          prime()
          void go(queue.value.index, queue.value.repeat, positionS.value).catch(() => { playback.value = 'paused' })
          break
        }
        void a?.play().catch(() => { /* file lost: `error` takes care of it */ }); break
      case 'media_player.pause': a?.pause(); break
      case 'media_player.stop': stop(); break
      case 'media_player.next': void next(); break
      case 'media_player.previous': void previous(); break
      case 'media_player.seek': seek(cmd.positionS); break
      case 'media_player.set_volume': volume.value = cmd.volume; break
      case 'media_player.set_mute': muted.value = cmd.muted; break
      default: break
    }
  }

  /** What the server takes over when playback goes from here to a speaker. */
  function snapshot() {
    const q = queue.value
    return {
      positionS: audio?.currentTime ?? positionS.value,
      ...(q ? { queue: { tracks: q.items, index: q.index, repeat: q.repeat } } : {}),
    }
  }
  /** Resume here a track transferred from a speaker, at its position, with its queue. */
  async function adopt(r: { streamUrl: string; session: MusicSession; positionS: number; queue?: MusicQueue | null }) {
    generation++
    const s = r.session
    queue.value = r.queue ?? {
      items: [{ source: s.source, id: s.id, ...(s.title ? { title: s.title } : {}), ...(s.artist ? { artist: s.artist } : {}), ...(s.artUrl ? { artUrl: s.artUrl } : {}), ...(s.durationS ? { durationS: s.durationS } : {}) }],
      index: 0, repeat: 'off',
    }
    retried = false
    await load(r.streamUrl, s, r.positionS)
  }

  // ---- locked screen, headset, keyboard media keys ----------------------------------------------------
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return
    const tr = current.value
    navigator.mediaSession.metadata = tr
      ? new MediaMetadata({ title: tr.title ?? '', artist: tr.artist ?? '', ...(tr.artUrl ? { artwork: [{ src: tr.artUrl }] } : {}) })
      : null
  }
  if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => command({ type: 'media_player.play' }))
    ms.setActionHandler('pause', () => command({ type: 'media_player.pause' }))
    ms.setActionHandler('nexttrack', () => { void next() })
    ms.setActionHandler('previoustrack', () => { void previous() })
    ms.setActionHandler('seekto', (d) => { if (d.seekTime !== undefined) seek(d.seekTime) })
  }

  // ---- the player as the page sees it ------------------------------------------------------------
  const entry = computed<DeviceEntry>(() => {
    const tr = current.value
    const loaded = playback.value !== 'idle' && !!tr
    return {
      descriptor: {
        id: id.value, pluginId: 'local', externalId: clientId.value, kind: 'media_player', name: t('music.localPlayer'),
        capabilities: ['playback', 'volume', 'mute', 'now_playing', 'track_skip', 'seek', 'play_url'],
        meta: { mediaPlayer: { deviceClass: 'speaker' } },
      },
      state: {
        kind: 'media_player', available: true, updatedAt: updatedAt.value,
        playback: loaded ? playback.value : 'idle', volume: volume.value, muted: muted.value,
        ...(loaded ? {
          nowPlaying: {
            title: tr.title ?? tr.id,
            ...(tr.artist ? { artist: tr.artist } : {}),
            ...(tr.artUrl ? { artUrl: tr.artUrl } : {}),
            ...((session.value?.durationS ?? tr.durationS) ? { durationS: session.value?.durationS ?? tr.durationS } : {}),
            positionS: positionS.value,
            ...(tr.explicit ? { explicit: true } : {}),
          },
        } : {}),
      },
    } as DeviceEntry
  })
  /** The session seen by the bar (title, duration, quality, queue) — like those of `GET /sessions`. */
  const barSession = computed<MusicSession | null>(() => {
    const q = queue.value
    const tr = current.value
    // restored: no server session yet, the kept track stands in for it (title, duration, queue)
    const s = session.value ?? (restored.value && tr ? {
      deviceId: id.value, source: tr.source, id: tr.id, sid: '', durationS: tr.durationS ?? null,
      title: tr.title ?? null, artist: tr.artist ?? null, artUrl: tr.artUrl ?? null,
    } : null)
    if (!s || playback.value === 'idle') return null
    return {
      ...s,
      ...(tr ? { source: tr.source, id: tr.id, title: tr.title ?? s.title, artist: tr.artist ?? s.artist, artUrl: tr.artUrl ?? s.artUrl } : {}),
      queue: q ? { length: q.items.length, index: q.index, repeat: q.repeat } : null,
    }
  })

  return {
    id, entry, barSession, queue, busy, playback,
    prime, playQueue, next, previous, jump, setRepeat, add, remove, clear, seek, stop, command, snapshot, adopt,
  }
})

/** Same rules as the server's queue (`queue.ts`): what plays after the natural end of the track. */
function afterEnd(q: MusicQueue): { index: number; repeat: MusicRepeat } | null {
  if (q.repeat === 'loop') return { index: q.index, repeat: 'loop' }
  if (q.repeat === 'once') return { index: q.index, repeat: 'off' }
  return q.index + 1 < q.items.length ? { index: q.index + 1, repeat: 'off' } : null
}
/** Jump to another track: a pending `once` falls with the track it was aiming at. */
const jumpRepeat = (r: MusicRepeat): MusicRepeat => (r === 'once' ? 'off' : r)
