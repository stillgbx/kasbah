import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { CommandInput, DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../api'
import type { MusicQueue, MusicTrack, MusicRepeat, MusicSession } from '../api/transport'
import { t } from '../i18n'

// Lecteur LOCAL : le son de l'appareil qui affiche la page (tablette, ordinateur, téléphone). Le
// serveur résout le titre et relaie le « fichier » (`POST /api/plugins/ytmusic/local`) ; un
// `<audio>` le lit. Session PRIVÉE : le serveur ne la connaît pas comme lecteur, les autres écrans
// ne la voient pas. La file vit donc ici, et suit les mêmes règles que celle du serveur (`queue.ts`) :
// la répétition porte sur le titre, la file ne boucle pas.
//
// Le store se présente à la page Musique comme un lecteur de plus (`entry`, un `media_player`
// synthétique) : le panneau Écoute et la barre du bas le montrent sans cas particulier ; seules les
// commandes changent de chemin (`command`, ici, au lieu de `devices.sendCommand`). Il vit hors de la
// vue : la musique continue quand on change de page.

export const LOCAL_PREFIX = 'local:'
export const isLocalPlayer = (id: string | null | undefined) => !!id && id.startsWith(LOCAL_PREFIX)

/** Au-delà de ce temps de lecture, « précédent » revient au début du titre (comme le serveur). */
const RESTART_AFTER_S = 3
/**
 * WAV vide : un premier `play()` DANS le geste de l'utilisateur déverrouille l'élément audio (Safari
 * refuse sinon un `play()` qui arrive après la réponse du serveur, hors du geste).
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
  /** Position publiée, à la seconde : la barre l'avance d'elle-même entre deux relevés. */
  const positionS = ref(0)
  const updatedAt = ref(Date.now())
  const session = ref<MusicSession | null>(null)
  const queue = ref<MusicQueue | null>(null)
  /** Un titre en cours de résolution côté serveur (sablier dans la barre). */
  const busy = ref(false)
  /** Chaque lancement a son numéro : un titre résolu trop tard ne remplace pas le suivant. */
  let generation = 0

  let audio: HTMLAudioElement | null = null
  let unlocked = false
  /** Un seul nouvel essai par titre quand le fichier ne se lit plus (session expirée côté serveur). */
  let retried = false

  const current = computed<MusicTrack | null>(() => (queue.value ? queue.value.items[queue.value.index] ?? null : null))

  function el(): HTMLAudioElement {
    if (audio) return audio
    const a = new Audio()
    a.preload = 'auto'
    a.volume = volume.value / 100
    // le son vide du déverrouillage ne dit rien de la lecture : ses événements sont ignorés
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
   * La position de la piste en cours, dite au serveur de temps en temps (et à la fin) : c'est ce qui
   * permet de reprendre un mix de plusieurs heures, que le serveur ne voit pas jouer ici.
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
    }).catch(() => { /* la reprise est un confort : un envoi perdu ne gêne pas l'écoute */ })
  }
  watch(volume, (v) => { if (audio) audio.volume = v / 100 })
  watch(muted, (m) => { if (audio) audio.muted = m })

  /** À appeler DANS le geste (clic) qui lance une lecture locale, avant tout `await`. */
  function prime() {
    if (unlocked) return
    unlocked = true
    const a = el()
    a.src = SILENT_WAV
    a.play().catch(() => { /* rien à entendre : seul le déverrouillage compte */ })
  }

  /** Lire le titre `index` de la file depuis `startS`. */
  async function go(index: number, repeat: MusicRepeat, startS = 0) {
    const q = queue.value
    const track = q?.items[index]
    if (!q || !track) return
    const gen = ++generation
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
      // se placer avant les métadonnées est ignoré par certains navigateurs : les attendre
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
      return
    }
    if (next.index === q!.index && audio) {
      // le même titre : son fichier est encore bon, pas d'aller au serveur
      queue.value = { ...q!, repeat: next.repeat }
      audio.currentTime = 0
      await audio.play()
      return
    }
    try { await go(next.index, next.repeat) }
    catch { playback.value = 'idle' }
  }

  /** Le fichier ne se lit plus (serveur redémarré, session expirée) : on redemande le titre, une fois, à la même position. */
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

  // ---- ce que la page appelle -------------------------------------------------------------------------
  /** Nouvelle file : `tracks[startIndex]` joue, la suite enchaîne. */
  async function playQueue(tracks: MusicTrack[], startIndex: number) {
    // la reprise d'un mix ne vaut qu'au premier lancement : la file garde la piste sans elle
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
    if (!q || !audio) return
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
  /** Ajouter sans interrompre ; rien ne joue ? Les titres partent tout de suite. */
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
    if (!audio) return
    audio.currentTime = Math.max(0, s)
    publish(audio.currentTime)
  }
  /** Tout arrêter et oublier le titre : rien ne joue plus ici. */
  function stop() {
    generation++
    busy.value = false
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

  /** Les commandes de la barre et du panneau, comme pour un lecteur du réseau. */
  function command(cmd: CommandInput) {
    const a = audio
    switch (cmd.type) {
      case 'media_player.play': void a?.play().catch(() => { /* fichier perdu : `error` s'en charge */ }); break
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

  /** Ce que le serveur reprend quand la lecture part d'ici vers une enceinte. */
  function snapshot() {
    const q = queue.value
    return {
      positionS: audio?.currentTime ?? positionS.value,
      ...(q ? { queue: { tracks: q.items, index: q.index, repeat: q.repeat } } : {}),
    }
  }
  /** Reprendre ici un titre transféré depuis une enceinte, à sa position, avec sa file. */
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

  // ---- écran verrouillé, casque, touches média du clavier ----------------------------------------------
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

  // ---- le lecteur tel que le voit la page ------------------------------------------------------------
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
  /** La session vue par la barre (titre, durée, qualité, file) — comme celles de `GET /sessions`. */
  const barSession = computed<MusicSession | null>(() => {
    const s = session.value, q = queue.value
    if (!s || playback.value === 'idle') return null
    const tr = current.value
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

/** Même règles que la file du serveur (`queue.ts`) : ce qui joue après la fin naturelle du titre. */
function afterEnd(q: MusicQueue): { index: number; repeat: MusicRepeat } | null {
  if (q.repeat === 'loop') return { index: q.index, repeat: 'loop' }
  if (q.repeat === 'once') return { index: q.index, repeat: 'off' }
  return q.index + 1 < q.items.length ? { index: q.index + 1, repeat: 'off' } : null
}
/** Sauter à un autre titre : un `once` en attente tombe avec le titre qu'il visait. */
const jumpRepeat = (r: MusicRepeat): MusicRepeat => (r === 'once' ? 'off' : r)
