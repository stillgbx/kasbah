<script lang="ts">
import type { YtmusicSearchResult } from '../api/transport'

// Last search served, kept AT MODULE LEVEL (so outside the component): going to look at the
// device in 3D then coming back remounts the view, and the same term then went back to the
// server, hence to InnerTube. The term serves as the key: as soon as it changes, we ask again.
// Module memory and not `localStorage` — the cache lasts as long as the tab, a page reload gives
// fresh results.
let lastSearch: { query: string; result: YtmusicSearchResult } | null = null
</script>

<script setup lang="ts">
import { useLocalStorage, useMediaQuery, useResizeObserver } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { CommandInput, DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../api'
import type { YtmusicAlbum, YtmusicArtist, YtmusicExplore, YtmusicExploreCategory, YtmusicExploreShelf, YtmusicPlaylist, MusicLastPlayed, MusicQueue, MusicTrack, MusicRepeat, MusicSession, RadioStation, YtmusicTrack } from '../api/transport'
import PageHeader from '../components/layout/PageHeader.vue'
import ChipRow from '../components/music/ChipRow.vue'
import ListeningSessions from '../components/music/ListeningSessions.vue'
import MixcloudBrowser from '../components/music/MixcloudBrowser.vue'
import MusicItemRow from '../components/music/MusicItemRow.vue'
import MusicPlayerBar from '../components/music/MusicPlayerBar.vue'
import QueueList from '../components/music/QueueList.vue'
import MusicShelves from '../components/music/MusicShelves.vue'
import MusicTile from '../components/music/MusicTile.vue'
import RadioBrowser from '../components/music/RadioBrowser.vue'
import ArtThumb from '../components/ui/ArtThumb.vue'
import ExplicitBadge from '../components/ui/ExplicitBadge.vue'
import Segmented from '../components/ui/Segmented.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { formatClock } from '../composables/useMediaPosition'
import { artAt } from '../lib/artUrl'
import type { IconName } from '../lib/strokeIcons'
import { splitCredit } from '../lib/wikiCredit'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { isLocalPlayer, useLocalPlayerStore } from '../stores/localPlayer'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'

// Music page. Three zones that never move: the search at the top (simple: tiles by section;
// advanced: five columns artists / albums / EPs / compilations / tracks with sorts), the
// "Listening" panel on the right (one player = one session: where playbacks go and what the bar
// drives), and the player at the bottom. Without a search, the central zone is for browsing:
// recents, likes, playlists. Sources: YouTube Music (unofficial) and, if the `radio` plugin is
// active, Radios — the pills at the top right choose the one that occupies the search and the
// central zone; the Listening panel and the bottom player stay shared. "Genres" and "Moods" open
// YouTube Music's "Moods & genres": a grid of pills, then the page of a category in rows of tiles
// (tracks, official playlists, albums), each row playable as a list.
//
// Queue: it lives on the SERVER, per player (the speaker only knows one "file" at a time).
// Playing a track from a list (album, playlist, likes, results) puts the whole list in it,
// starting from that track; "play next" and "add to the end" complete it without interrupting.
// The bar draws previous / next and the track repeat from it; the queue is displayed in place of
// the central zone (Queue button of the bar).
//
// The transfer (desktop → living room) goes through the server: it knows the track the source is
// playing, restarts it on the target, which positions itself at the same point, then stops the
// source. It is only possible for a playback started from here (`GET /sessions`): a native app
// on the Chromecast is not ours.

defineOptions({ name: 'MusicView' })

type BrowseTab = 'recent' | 'liked' | 'playlists' | 'new' | 'genres' | 'moods'
/** What the detail shows in its left column: the item as the list it comes from knew it. */
interface DetailHead { art: string | null; artists?: string[]; year?: string | null; explicit?: boolean; releaseType?: YtmusicAlbum['releaseType'] }
type Browse =
  | ({ kind: 'playlist'; id: string; title: string } & DetailHead)
  | ({ kind: 'album'; id: string; title: string } & DetailHead)
  | ({ kind: 'artist'; id: string; title: string } & DetailHead)
  | { kind: 'category'; params: string; title: string }
/** Ordre API InnerTube = pertinence. */
type SectionSort = 'relevance' | 'alpha' | 'date'

const { t, locale } = useI18n()
const router = useRouter()
const devices = useDevicesStore()
const house = useHouseStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const local = useLocalPlayerStore()

// ---- search and catalog -----------------------------------------------------------------------
const query = useLocalStorage('kasbah.ytmusic.query', '')
const advanced = useLocalStorage('kasbah.music.advanced', false)
const browseTab = useLocalStorage<BrowseTab>('kasbah.music.browse', 'recent')
/** Latest tracks played. */
const recentPlays = useLocalStorage<YtmusicTrack[]>('kasbah.ytmusic.recentPlays', [])
const recentQueries = useLocalStorage<string[]>('kasbah.ytmusic.recentQueries', [])
/** True after a search: the central zone shows the results, not the browsing. */
const searched = ref(false)
const tracks = ref<YtmusicTrack[]>([])
const searchArtists = ref<YtmusicArtist[]>([])
const searchAlbums = ref<YtmusicAlbum[]>([])
const searchSingles = ref<YtmusicAlbum[]>([])
const searchCompilations = ref<YtmusicAlbum[]>([])
const searchTracks = ref<YtmusicTrack[]>([])
const playlists = ref<YtmusicPlaylist[]>([])
const browse = ref<Browse | null>(null)
const busy = ref(false)
const playingId = ref<string | null>(null)
/** false until the cookie status has been read — avoids a false "missing". */
const statusReady = ref(false)
const linked = ref(false)
/** A linked account: likes and playlists. A signed-in user without a cookie searches anonymously. */
const personal = ref(true)

const sortArtists = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.artists', 'relevance')
const sortAlbums = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.albums', 'relevance')
const sortSingles = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.singles', 'relevance')
const sortCompilations = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.compilations', 'relevance')
const sortTracks = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.tracks', 'relevance')
const hideExplicit = useLocalStorage('kasbah.ytmusic.hideExplicit', false)
const RECENT_MAX = 10
const RECENT_PLAYS_MAX = 20
/** Tiles per row in simple search (the rest waits for "See all"). */
const SIMPLE_MAX = 12

/** The music sources: YouTube Music, then each active source plugin (the radios). */
type SourceId = 'ytmusic' | 'radio' | 'mixcloud'
const sources = computed(() => {
  const out: { id: SourceId; label: string; icon: IconName }[] = [{ id: 'ytmusic', label: 'YouTube Music', icon: 'sourceYtmusic' }]
  if (plugins.byId.mixcloud?.enabled) out.push({ id: 'mixcloud', label: 'Mixcloud', icon: 'sourceMixcloud' })
  if (plugins.byId.radio?.enabled) out.push({ id: 'radio', label: t('radio.source'), icon: 'sourceRadio' })
  return out
})
const sourceChoice = useLocalStorage<SourceId>('kasbah.music.source', 'ytmusic')
/** The displayed source: the remembered choice, if it is still active. */
const activeSource = computed<SourceId>(() => (sources.value.some((s) => s.id === sourceChoice.value) ? sourceChoice.value : 'ytmusic'))
/** Logos only: `Segmented` then gives the name as a tooltip and accessible label. */
const sourceOptions = computed(() => sources.value.map((s) => ({ value: s.id, label: s.label, icon: s.icon })))

const browseOptions = computed(() => [
  { value: 'recent' as const, label: t('music.browseRecent') },
  ...(personal.value ? [
    { value: 'liked' as const, label: t('music.browseLiked') },
    { value: 'playlists' as const, label: t('music.browsePlaylists') },
  ] : []),
  { value: 'new' as const, label: t('music.browseNew') },
  { value: 'genres' as const, label: t('music.browseGenres') },
  { value: 'moods' as const, label: t('music.browseMoods') },
])
const sortOptionsName = computed(() => [
  { value: 'relevance' as const, label: t('ytmusic.sortRelevance') },
  { value: 'alpha' as const, label: t('ytmusic.sortAlpha') },
])
const sortOptionsDated = computed(() => [
  ...sortOptionsName.value,
  { value: 'date' as const, label: t('ytmusic.sortDate') },
])

function sortedBy<T>(items: T[], mode: SectionSort, nameOf: (item: T) => string, dateOf?: (item: T) => string | null | undefined): T[] {
  if (mode === 'relevance' || items.length < 2) return items
  const copy = [...items]
  if (mode === 'alpha') {
    copy.sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }))
    return copy
  }
  // date: year desc; without a year → end of list (relative order kept)
  copy.sort((a, b) => {
    const ya = Number.parseInt(String(dateOf?.(a) ?? '').slice(0, 4), 10)
    const yb = Number.parseInt(String(dateOf?.(b) ?? '').slice(0, 4), 10)
    const ha = Number.isFinite(ya) ? ya : -1
    const hb = Number.isFinite(yb) ? yb : -1
    if (hb !== ha) return hb - ha
    return nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' })
  })
  return copy
}
function withoutExplicit<T extends { explicit?: boolean }>(items: T[]): T[] {
  return hideExplicit.value ? items.filter((i) => !i.explicit) : items
}

const artistsView = computed(() => sortedBy(searchArtists.value, sortArtists.value, (a) => a.name))
const albumsView = computed(() => sortedBy(withoutExplicit(searchAlbums.value), sortAlbums.value, (a) => a.title, (a) => a.year))
const singlesView = computed(() => sortedBy(withoutExplicit(searchSingles.value), sortSingles.value, (a) => a.title, (a) => a.year))
const compilationsView = computed(() => sortedBy(withoutExplicit(searchCompilations.value), sortCompilations.value, (a) => a.title, (a) => a.year))
const tracksView = computed(() => sortedBy(withoutExplicit(searchTracks.value), sortTracks.value, (a) => a.title, (a) => a.year))
const browseTracksView = computed(() => withoutExplicit(tracks.value))
/** Simple search: all releases in a single row, albums first. */
const releasesSimple = computed(() => withoutExplicit([...searchAlbums.value, ...searchSingles.value, ...searchCompilations.value]).slice(0, SIMPLE_MAX))
const artistsSimple = computed(() => searchArtists.value.slice(0, SIMPLE_MAX))
const tracksSimple = computed(() => withoutExplicit(searchTracks.value).slice(0, SIMPLE_MAX))
const advancedSections = computed(() => [
  { key: 'artists', title: t('ytmusic.sectionArtists'), sort: sortArtists, options: sortOptionsName.value, items: artistsView.value.map((a) => ({ id: a.id, art: a.artUrl, title: a.name, meta: a.subscribers ?? '', open: () => openArtist(a), play: () => playArtist(a) })), round: true, icon: 'person' as const },
  { key: 'albums', title: t('ytmusic.sectionAlbums'), sort: sortAlbums, options: sortOptionsDated.value, items: albumsView.value.map(releaseItem), round: false, icon: 'disc' as const },
  { key: 'singles', title: t('ytmusic.sectionEp'), sort: sortSingles, options: sortOptionsDated.value, items: singlesView.value.map(releaseItem), round: false, icon: 'disc' as const },
  { key: 'compilations', title: t('ytmusic.sectionCompil'), sort: sortCompilations, options: sortOptionsDated.value, items: compilationsView.value.map(releaseItem), round: false, icon: 'disc' as const },
].filter((s) => s.items.length))
function releaseItem(al: YtmusicAlbum) {
  return { id: al.id, art: al.artUrl, title: al.title, meta: albumMeta(al), year: al.year ?? null, explicit: !!al.explicit, open: () => openAlbum(al), play: () => playAlbum(al) }
}

const searchEmpty = computed(() =>
  searched.value && !browse.value && !busy.value
  && searchArtists.value.length === 0 && searchAlbums.value.length === 0 && searchSingles.value.length === 0
  && searchCompilations.value.length === 0 && searchTracks.value.length === 0)

// ---- listening sessions --------------------------------------------------------------------------
/**
 * All the house's players: you see what is playing everywhere, even where nothing can be sent.
 * Plus THIS browser (the sound of the tablet, the computer, the phone): a private player,
 * held by the `localPlayer` store, that only this screen sees.
 */
const players = computed(() => [local.entry, ...devices.list.filter((e: DeviceEntry) => e.state.kind === 'media_player')])
const localSelected = computed(() => isLocalPlayer(sessionId.value))
const canReceive = (e: DeviceEntry) => e.state.available && e.descriptor.capabilities.includes('play_url')
const sessionId = useLocalStorage('kasbah.music.session', '')
/** Same key as the star in the Listening panel: the default player is the first favorite. */
const favoriteSessions = useLocalStorage<string[]>('kasbah.music.favoriteSessions', [])
const selected = computed<DeviceEntry | null>(() => players.value.find((e) => e.descriptor.id === sessionId.value) ?? null)
const selectedName = computed(() => selected.value ? (house.houseDeviceFor(selected.value.descriptor.id)?.name ?? selected.value.descriptor.name) : '')
/** The players currently playing a stream served by Kasbah, by plugin id — transferable, movable. */
const ourSessions = ref<Map<string, MusicSession>>(new Map())
const selectedSession = computed(() => (localSelected.value ? local.barSession : selected.value ? ourSessions.value.get(selected.value.descriptor.id) ?? null : null))
/** The last radio launched on each player: the bar draws its quality from it (the speaker does not say it). */
const radioStations = ref<Map<string, RadioStation>>(new Map())
const selectedStation = computed(() => (selected.value ? radioStations.value.get(selected.value.descriptor.id) ?? null : null))
/**
 * The track the chosen player PLAYS (served by us), to flag it in the lists: highlighted,
 * and a dot that pulses while it plays (still when paused). Nothing if the player is idle.
 */
const nowPlayingTrack = computed<{ source: string; id: string } | null>(() => {
  const st = selected.value?.state
  if (st?.kind !== 'media_player' || (st.playback !== 'playing' && st.playback !== 'paused')) return null
  const s = selectedSession.value
  return s ? { source: s.source, id: s.id } : null
})
/** The YouTube Music lists of this page: an id only makes sense coming from it. */
const nowPlayingId = computed(() => (nowPlayingTrack.value?.source === 'ytmusic' ? nowPlayingTrack.value.id : null))
const nowPulsing = computed(() => selected.value?.state.kind === 'media_player' && selected.value.state.playback === 'playing')
/** Track being sent: the bar shows it right away, with an hourglass, while the speaker catches up. */
const pendingTrack = ref<YtmusicTrack | null>(null)
/**
 * The last listen of each player that no longer plays anything of ours (server restarted, stop):
 * the bar shows it paused at its position, and play restarts it from there.
 */
const lastPlayed = ref<Map<string, MusicLastPlayed>>(new Map())
/** Position chosen on the slider before restarting; otherwise the one kept by the server. */
const resumeAt = ref<number | null>(null)
const selectedLast = computed(() => {
  const s = selected.value
  if (!s || localSelected.value || selectedSession.value || s.state.kind !== 'media_player') return null
  const e = lastPlayed.value.get(s.descriptor.id)
  if (!e) return null
  // the player is playing something else (a radio launched elsewhere, an app): that is what the bar shows
  const st = s.state
  if (st.playback === 'playing') return null
  const shown = st.nowPlaying?.title?.trim().toLowerCase() ?? ''
  // paused, the speaker may still show OUR track (dead stream) or the name of the served file
  const dead = !shown || shown === e.track.title?.trim().toLowerCase() || /^[0-9a-f]{24}(\.[a-z0-9]{2,4})?$/.test(shown) || /^https?:\/\//.test(shown)
  if (st.playback === 'paused' && !dead) return null
  return e
})
const barResume = computed(() => {
  const e = selectedLast.value
  return e ? {
    title: e.track.title ?? null, artist: e.track.artist ?? null, artUrl: e.track.artUrl ?? null,
    durationS: e.durationS ?? e.track.durationS ?? null, positionS: resumeAt.value ?? e.positionS, explicit: e.track.explicit === true,
  } : null
})
watch(() => `${sessionId.value}|${selectedLast.value?.at ?? ''}`, () => { resumeAt.value = null })
async function resumeLast() {
  const e = selectedLast.value
  if (!e) return
  pendingTrack.value = fromQueueTrack(e.track)
  try {
    await getTransport().musicResume(e.deviceId, resumeAt.value ?? undefined)
    lastPlayed.value = new Map([...lastPlayed.value].filter(([id]) => id !== e.deviceId))
  } catch (err) { fail(err) }
  finally {
    pendingTrack.value = null
    void refreshSessions()
  }
}
const transferMode = ref(false)
const transferBusyId = ref<string | null>(null)
// Phone in portrait: no room for the "Listening" panel next to the content — it rises in a sheet,
// opened from the player's name in the bar (and by "Transfer", which needs the list of targets).
const phone = useMediaQuery('(max-width: 599px)')
const sessionsOpen = ref(false)
watch(phone, (p) => { if (!p) sessionsOpen.value = false })
function startTransfer() {
  transferMode.value = true
  if (phone.value) sessionsOpen.value = true
}
const canTransfer = computed(() => {
  const s = selected.value
  if (!s || s.state.kind !== 'media_player') return false
  if (!selectedSession.value) return false
  if (s.state.playback !== 'playing' && s.state.playback !== 'paused') return false
  return players.value.some((e) => e.descriptor.id !== s.descriptor.id && canReceive(e))
})

watch(players, (list) => {
  // Do not overwrite the persisted choice until the inventory has arrived; otherwise the first
  // FAVORITE that can receive (alphabetical order, like the panel), then the first player that can
  // receive, failing that the first one at all.
  // the local player is always there: wait for the inventory before judging a persisted choice
  if (!devices.list.length && sessionId.value) return
  if (!sessionId.value || !list.some((e) => e.descriptor.id === sessionId.value)) {
    const byName = [...list].sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name, undefined, { sensitivity: 'base' }))
    const fav = byName.find((e) => canReceive(e) && favoriteSessions.value.includes(e.descriptor.id))
    sessionId.value = (fav ?? byName.find(canReceive) ?? byName[0]!).descriptor.id
  }
}, { immediate: true })

async function refreshSessions(): Promise<void> {
  try {
    const [r, l] = await Promise.all([getTransport().musicSessions(), getTransport().musicLast()])
    ourSessions.value = new Map(r.sessions.map((s) => [s.deviceId, s]))
    lastPlayed.value = new Map(l.last.map((e) => [e.deviceId, e]))
  } catch { /* plugin absent or server silent: nothing to transfer */ }
  // the station only makes sense for a live stream: no point asking for it the rest of the time
  const st = selected.value?.state
  if (st?.kind !== 'media_player' || !st.nowPlaying?.live) return
  try {
    const r = await getTransport().radioPlaying()
    radioStations.value = new Map(r.playing.map((p) => [p.deviceId, p.station]))
  } catch { /* radio plugin absent: no quality to show */ }
}
let sessionsTicker: ReturnType<typeof setInterval> | undefined
// The server chains on its own: when the player changes track or state, re-read the sessions
// right away (track, queue) rather than at the next 20 s round. A little delay, to let the
// server finish launching the track it is chaining.
let sessionsSoon: ReturnType<typeof setTimeout> | undefined
watch(() => {
  const st = selected.value?.state
  return st?.kind === 'media_player' ? `${st.playback}|${st.nowPlaying?.title ?? ''}` : ''
}, () => {
  clearTimeout(sessionsSoon)
  sessionsSoon = setTimeout(() => { void refreshSessions() }, 800)
})

// ---- queue -----------------------------------------------------------------------------------------
/** A list with more tracks than the queue accepts: we send a window around the chosen track. */
const QUEUE_WINDOW = 1000
const queueOpen = ref(false)
const queue = ref<MusicQueue | null>(null)
const queueBusyIndex = ref<number | null>(null)
const queueWaiting = computed(() => (queue.value ? queue.value.items.length - queue.value.index - 1 : 0))
function toQueueTrack(tr: YtmusicTrack): MusicTrack {
  return {
    source: 'ytmusic',
    id: tr.videoId,
    title: tr.title,
    ...(tr.artists.length ? { artist: tr.artists.join(', ') } : {}),
    ...(tr.artUrl ? { artUrl: tr.artUrl } : {}),
    ...(tr.durationS ? { durationS: tr.durationS } : {}),
    ...(tr.explicit ? { explicit: true } : {}),
  }
}
/** A queue track seen as a catalog track (bar while sending, queue rows). */
function fromQueueTrack(qt: MusicTrack): YtmusicTrack {
  return {
    videoId: qt.id, title: qt.title ?? qt.id, artists: qt.artist ? [qt.artist] : [],
    artUrl: qt.artUrl ?? null, durationS: qt.durationS ?? null, ...(qt.explicit ? { explicit: true } : {}),
  }
}
async function loadQueue(): Promise<void> {
  const id = selected.value?.descriptor.id
  if (!id || !selectedSession.value?.queue) {
    queue.value = null
    return
  }
  if (localSelected.value) {
    queue.value = local.queue
    return
  }
  try { queue.value = await getTransport().musicQueue(id) }
  catch { queue.value = null }
}
// re-read the queue as soon as the session says it has moved (next track, add, remove, repeat)
watch(() => {
  const s = selectedSession.value
  return s?.queue ? `${s.deviceId}|${s.sid}|${s.queue.index}|${s.queue.length}|${s.queue.repeat}` : ''
}, () => { void loadQueue() }, { immediate: true })
// on opening, bring the playing track into view
watch(queueOpen, async (open) => {
  if (!open) return
  await loadQueue()
  await nextTick()
  document.querySelector('.queue-list [data-selected="1"]')?.scrollIntoView({ block: 'nearest' })
})
function patchSessionQueue(q: MusicQueue) {
  const s = selectedSession.value
  if (!s) return
  queue.value = q
  const next = new Map(ourSessions.value)
  next.set(s.deviceId, { ...s, queue: { length: q.items.length, index: q.index, repeat: q.repeat } })
  ourSessions.value = next
}
// the local queue changes without going to the server: show it as is
watch(() => local.queue, (q) => { if (localSelected.value) queue.value = q })
/** Next / previous / a chosen track: the server launches the track, the bar shows it right away. */
async function queueGo(step: 'next' | 'previous' | number) {
  const id = selected.value?.descriptor.id
  if (!id) return
  const target = typeof step === 'number' ? step : step === 'next' && queue.value ? queue.value.index + 1 : null
  const track = target !== null ? queue.value?.items[target] : undefined
  if (track) pendingTrack.value = fromQueueTrack(track)
  if (typeof step === 'number') queueBusyIndex.value = step
  try {
    if (localSelected.value) {
      await (step === 'next' ? local.next() : step === 'previous' ? local.previous() : local.jump(step))
      return
    }
    const api = getTransport()
    const q = step === 'next' ? await api.musicQueueNext(id) : step === 'previous' ? await api.musicQueuePrevious(id) : await api.musicQueueJump(id, step)
    patchSessionQueue(q)
  } catch (err) { fail(err) }
  finally {
    pendingTrack.value = null
    queueBusyIndex.value = null
    void refreshSessions()
  }
}
async function setRepeat(mode: MusicRepeat) {
  const id = selected.value?.descriptor.id
  if (!id) return
  if (localSelected.value) return local.setRepeat(mode)
  try { patchSessionQueue(await getTransport().musicQueueRepeat(id, mode)) }
  catch (err) { fail(err) }
}
async function removeFromQueue(index: number) {
  const id = selected.value?.descriptor.id
  if (!id) return
  if (localSelected.value) return local.remove(index)
  try { patchSessionQueue(await getTransport().musicQueueRemove(id, index)) }
  catch (err) { fail(err) }
}
async function clearQueue() {
  const id = selected.value?.descriptor.id
  if (!id) return
  if (localSelected.value) return local.clear()
  try { patchSessionQueue(await getTransport().musicQueueClear(id)) }
  catch (err) { fail(err) }
}
/** Play next / add to the end, without interrupting. Nothing playing here? The server launches the track. */
async function addToQueue(track: YtmusicTrack, where: 'next' | 'end') {
  const target = selected.value
  if (!target || !canReceive(target)) {
    notifications.error(t('ytmusic.noPlayer'))
    return
  }
  if (localSelected.value) {
    local.prime()
    try { if (await local.add([toQueueTrack(track)], where)) rememberPlay(track) }
    catch (err) { failLocal(err) }
    return
  }
  try {
    const r = await getTransport().musicQueueAdd({ deviceId: target.descriptor.id, tracks: [toQueueTrack(track)], where })
    if (r.started) rememberPlay(track)
    patchSessionQueue(r.queue)
  } catch (err) { fail(err) }
  finally { void refreshSessions() }
}

function selectSession(id: string) {
  sessionId.value = id
}
/** See the player in the 3D house. Navigate first, select afterwards (HomeView under keep-alive, see 6_1). */
async function locate(id: string) {
  await router.push({ name: 'home' }).catch(() => { /* navigation redondante */ })
  house.selectDevice(house.houseDeviceFor(id)?.id ?? id)
}
function barCommand(cmd: CommandInput) {
  if (!selected.value) return
  // the last listen: play restarts it, queue and position included
  if (cmd.type === 'media_player.play' && selectedLast.value) {
    void resumeLast()
    return
  }
  // a queue: it is the one that skips, the speaker only has a single track
  if ((cmd.type === 'media_player.next' || cmd.type === 'media_player.previous') && selectedSession.value?.queue) {
    void queueGo(cmd.type === 'media_player.next' ? 'next' : 'previous')
    return
  }
  if (localSelected.value) {
    local.command(cmd)
    return
  }
  void devices.sendCommand(selected.value.descriptor.id, cmd).then(() => {
    if (cmd.type === 'media_player.stop') void refreshSessions()
  })
}
// No success toast here nor when launching a track: the bar and the panel already show the
// result, and the toast went over the player. Errors, for their part, stay toasts.
/** Play / pause from a panel row: the local player is not a server device. */
function panelCommand(id: string, cmd: CommandInput) {
  if (isLocalPlayer(id)) local.command(cmd)
  else void devices.sendCommand(id, cmd)
}
/**
 * Transfer, both ways with this browser: to a speaker, the server takes over the position
 * and the queue that the browser gives it, then the browser goes quiet; from a speaker, the server
 * stops it and gives the browser what it needs to resume (file, position, queue).
 */
async function transferTo(toId: string) {
  const from = selected.value
  if (!from) return
  const fromId = from.descriptor.id
  if (isLocalPlayer(toId)) local.prime()
  transferBusyId.value = toId
  try {
    const api = getTransport()
    if (isLocalPlayer(fromId)) {
      await api.musicTransfer({ fromDeviceId: fromId, toDeviceId: toId, ...local.snapshot() })
      local.stop()
    } else {
      const r = await api.musicTransfer({ fromDeviceId: fromId, toDeviceId: toId })
      if (isLocalPlayer(toId) && r.session) await local.adopt({ ...r, session: r.session })
    }
    sessionId.value = toId
    transferMode.value = false
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally {
    transferBusyId.value = null
    void refreshSessions()
  }
}
/** Seek within the track: the player's command is enough, our stream is a "file" for it. */
function barSeek(positionS: number) {
  const s = selected.value
  if (selectedLast.value) {
    resumeAt.value = Math.round(positionS)
    return
  }
  if (localSelected.value) local.seek(positionS)
  else if (s) void devices.sendCommand(s.descriptor.id, { type: 'media_player.seek', positionS: Math.round(positionS) })
}

// ---- linking and loading -----------------------------------------------------------------------
async function refreshLink(): Promise<void> {
  // The plugin inventory is only loaded in Settings — load it here too.
  if (!plugins.loaded) await plugins.load()
  const plug = plugins.byId.ytmusic
  if (!plug?.enabled) {
    linked.value = false
    return
  }
  try {
    const s = await getTransport().ytmusicStatus()
    linked.value = (s.linked && !s.cookieExpired) || s.anonymous
    personal.value = !s.anonymous
    if (s.anonymous && (browseTab.value === 'liked' || browseTab.value === 'playlists')) browseTab.value = 'recent'
  } catch {
    // Health fallback (may be stale) if /status fails.
    linked.value = plug.health.status !== 'needs_pairing'
  }
}

onMounted(async () => {
  void refreshSessions()
  sessionsTicker = setInterval(() => { void refreshSessions() }, 20_000)
  try { await refreshLink() }
  finally { statusReady.value = true }
  if (!linked.value) return
  if (query.value.trim()) await runSearch()
  else await loadBrowseTab()
})
onBeforeUnmount(() => { clearInterval(sessionsTicker); clearTimeout(sessionsSoon) })

function trackMeta(tr: YtmusicTrack): string {
  const parts: string[] = []
  if (tr.artists.length) parts.push(tr.artists.join(', '))
  if (tr.album) parts.push(tr.album)
  return parts.join(' · ')
}
function albumMeta(al: YtmusicAlbum): string {
  return al.artists.length ? al.artists.join(', ') : ''
}
const fail = (err: unknown) => notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
/** The browser refuses to play (autoplay blocked, format): it is not a server error. */
const failLocal = (err: unknown) => (err instanceof DOMException ? notifications.error(t('music.localFailed')) : fail(err))

function clearSearchResults() {
  searchArtists.value = []
  searchAlbums.value = []
  searchSingles.value = []
  searchCompilations.value = []
  searchTracks.value = []
}
function rememberQuery(q: string) {
  const trimmed = q.trim()
  if (!trimmed) return
  const key = trimmed.toLowerCase()
  const cur = recentQueries.value
  const idx = cur.findIndex((x) => x.toLowerCase() === key)
  if (idx === 0) return
  if (idx > 0) {
    const copy = [...cur]
    const [hit] = copy.splice(idx, 1)
    recentQueries.value = [hit!, ...copy]
    return
  }
  recentQueries.value = [trimmed, ...cur].slice(0, RECENT_MAX)
}
function removeRecent(q: string) { recentQueries.value = recentQueries.value.filter((x) => x !== q) }
function rememberPlay(track: YtmusicTrack) {
  const rest = recentPlays.value.filter((t) => t.videoId !== track.videoId)
  recentPlays.value = [track, ...rest].slice(0, RECENT_PLAYS_MAX)
}

async function runRecent(q: string) {
  query.value = q
  await runSearch()
}
function applySearch(result: YtmusicSearchResult) {
  searchArtists.value = result.artists
  searchAlbums.value = result.albums
  searchSingles.value = result.singles
  searchCompilations.value = result.compilations
  searchTracks.value = result.tracks
}
async function runSearch() {
  const q = query.value.trim()
  if (!q) return
  browse.value = null
  backStack.value = []
  queueOpen.value = false
  searched.value = true
  rememberQuery(q)
  // Same term as on the last pass: we redisplay, we do not ask again.
  if (lastSearch?.query === q) {
    applySearch(lastSearch.result)
    return
  }
  // Clear BEFORE waiting: keeping the previous request's results while the new one runs (several
  // seconds) made it look like the click had not registered, or worse, that they were the answer.
  clearSearchResults()
  tracks.value = []
  busy.value = true
  try {
    const result = await getTransport().ytmusicSearch(q)
    lastSearch = { query: q, result }
    applySearch(result)
  } catch (err) { fail(err) }
  finally { busy.value = false }
}
/** Clear the search: back to browsing. */
async function clearSearch() {
  lastSearch = null
  query.value = ''
  searched.value = false
  browse.value = null
  clearSearchResults()
  await loadBrowseTab()
}

async function loadBrowseTab(): Promise<void> {
  browse.value = null
  backStack.value = []
  if (browseTab.value === 'liked') await loadLiked()
  else if (browseTab.value === 'playlists') await loadPlaylists()
  else if (browseTab.value === 'genres' || browseTab.value === 'moods') await loadExplore()
  else if (browseTab.value === 'new') await loadNew()
  else tracks.value = []
}

// ---- moods and genres ----------------------------------------------------------------------------
/** The categories, in the app's language (YouTube names them); re-read only if the language changes. */
const explore = ref<YtmusicExplore | null>(null)
let exploreLang = ''
const categoryShelves = ref<YtmusicExploreShelf[]>([])
/** What was opened FROM a category (a playlist, an album) returns to it through "Back". */
const backStack = ref<Browse[]>([])
async function loadExplore() {
  if (explore.value && exploreLang === locale.value) return
  busy.value = true
  tracks.value = []
  try {
    explore.value = await getTransport().ytmusicExplore(locale.value)
    exploreLang = locale.value
    void loadCovers(locale.value)
  } catch (err) { fail(err) }
  finally { busy.value = false }
}
/**
 * Card cover art: YouTube's page has none, the server takes them from each category
 * (slow the first time, ~10 s, then kept 6 h). The cards do not wait: the cover art fades in
 * as it arrives, in an already reserved slot. A failure simply leaves them bare.
 */
const covers = ref<Record<string, string[]>>({})
async function loadCovers(lang: string) {
  try { covers.value = (await getTransport().ytmusicExploreCovers(lang)).covers }
  catch { /* cards without cover art */ }
}
/** Cover art only appears once loaded: never an empty square nor an image drawn in bands. */
const coverLoaded = ref<Set<string>>(new Set())
function markCover(url: string) { coverLoaded.value = new Set(coverLoaded.value).add(url) }
/** Genres: "For you" first (if any), then the genres; Moods: the moods and moments. */
const exploreGroups = computed(() => {
  const e = explore.value
  if (!e) return []
  const groups = browseTab.value === 'moods'
    ? [{ key: 'moods', ...e.moods }]
    : [{ key: 'forYou', ...e.forYou }, { key: 'genres', ...e.genres }]
  return groups.filter((g) => g.categories.length > 0)
})
async function openCategory(c: YtmusicExploreCategory) {
  backStack.value = []
  queueOpen.value = false
  browse.value = { kind: 'category', params: c.params, title: c.title }
  categoryShelves.value = []
  busy.value = true
  try { categoryShelves.value = (await getTransport().ytmusicExploreCategory(c.params, locale.value)).shelves }
  catch (err) { fail(err) }
  finally { busy.value = false }
}
/** "Hide explicit" applies here too; a row emptied by the filter disappears. */
function visibleShelves(shelves: YtmusicExploreShelf[]): YtmusicExploreShelf[] {
  return shelves
    .map((sh) => ({ ...sh, tracks: withoutExplicit(sh.tracks), albums: withoutExplicit(sh.albums) }))
    .filter((sh) => sh.tracks.length + sh.playlists.length + sh.albums.length > 0)
}
const categoryView = computed(() => visibleShelves(categoryShelves.value))

/** The new releases: kept for the session, re-read if the language changes (the server keeps them 10 min). */
const newShelves = ref<YtmusicExploreShelf[]>([])
let newLang = ''
async function loadNew() {
  if (newShelves.value.length && newLang === locale.value) return
  busy.value = true
  tracks.value = []
  try {
    newShelves.value = (await getTransport().ytmusicExploreNew(locale.value)).shelves
    newLang = locale.value
  } catch (err) { fail(err) }
  finally { busy.value = false }
}
const newView = computed(() => visibleShelves(newShelves.value))
const categoryLoading = computed(() => busy.value && browse.value?.kind === 'category')
async function loadLiked() {
  busy.value = true
  try { tracks.value = (await getTransport().ytmusicLiked()).tracks }
  catch (err) { fail(err) }
  finally { busy.value = false }
}
async function loadPlaylists() {
  busy.value = true
  tracks.value = []
  try { playlists.value = (await getTransport().ytmusicPlaylists()).playlists }
  catch (err) { fail(err) }
  finally { busy.value = false }
}
/** The introduction text of the opened album or artist (YouTube Music, often taken from Wikipedia), if there is one. */
const detailDescription = ref<string | null>(null)
const descOpen = ref(false)
/**
 * The detail's left column stays FIXED while the tracks scroll, as long as it fits entirely in
 * the visible zone (under "Back"). Otherwise — screen too short, introduction expanded — it
 * scrolls with the list, so that its play button never leaves the view. We MEASURE (and re-measure
 * on every size change of either) rather than guess with screen thresholds.
 */
const scrollEl = ref<HTMLElement | null>(null)
/** Queue, category or detail open: the "Back" row is displayed above the scrolling zone. */
const hasBackRow = computed(() => statusReady.value && linked.value && (queueOpen.value || !!browse.value))
const sideEl = ref<HTMLElement | null>(null)
const sideFits = ref(false)
function measureSide() {
  const sc = scrollEl.value, side = sideEl.value
  if (!sc || !side) { sideFits.value = false; return }
  sideFits.value = side.offsetHeight <= sc.clientHeight
}
// `useResizeObserver` follows the template refs when they appear or change (the column only
// exists once a detail is open); the introduction that arrives, or that is expanded, resizes it
useResizeObserver(scrollEl, measureSide)
useResizeObserver(sideEl, measureSide)
/** The text, and its source and license mention (Wikipedia), written separately in small print. */
const detailParts = computed(() => splitCredit(detailDescription.value))
const detailText = computed(() => detailParts.value.text)
const detailCredit = computed(() => detailParts.value.credit)
async function openDetail(next: Browse, load: () => Promise<{ tracks: YtmusicTrack[]; description?: string | null }>) {
  if (browse.value?.kind === 'category') backStack.value = [...backStack.value, browse.value]
  busy.value = true
  browse.value = next
  queueOpen.value = false
  detailDescription.value = null
  descOpen.value = false
  try {
    const r = await load()
    tracks.value = r.tracks
    detailDescription.value = r.description ?? null
  }
  catch (err) { fail(err) }
  finally { busy.value = false }
}
const openPlaylist = (pl: YtmusicPlaylist) => openDetail({ kind: 'playlist', id: pl.id, title: pl.title, art: pl.artUrl }, () => getTransport().ytmusicPlaylist(pl.id))
const openAlbum = (al: YtmusicAlbum) => openDetail({
  kind: 'album', id: al.id, title: al.title, art: al.artUrl, artists: al.artists, year: al.year ?? null, explicit: !!al.explicit, releaseType: al.releaseType ?? null,
}, () => getTransport().ytmusicAlbum(al.id, locale.value))
const openArtist = (ar: YtmusicArtist) => openDetail({ kind: 'artist', id: ar.id, title: ar.name, art: ar.artUrl }, () => getTransport().ytmusicArtist(ar.id, locale.value))

// ---- left column of the detail (album, playlist, artist), YouTube Music style -----------------------
/** A lone cover art, large: an album's track list need not repeat it on every row. */
const detail = computed(() => (browse.value && browse.value.kind !== 'category' ? browse.value : null))
const detailArtless = computed(() => detail.value?.kind === 'album')
/** "Album · 2012": the release type (or playlist / artist) and the year. */
const detailKind = computed(() => {
  const d = detail.value
  if (!d) return ''
  const kind = d.kind === 'playlist' ? t('music.kindPlaylist')
    : d.kind === 'artist' ? t('music.kindArtist')
    : ({ single: t('music.kindSingle'), ep: t('music.kindEp'), compilation: t('music.kindCompilation') } as Record<string, string>)[d.releaseType ?? ''] ?? t('music.kindAlbum')
  return [kind, d.year].filter(Boolean).join(' · ')
})
/** "8 tracks · 33 min" — nothing while loading (the row keeps its place). */
const detailStats = computed(() => {
  const list = browseTracksView.value
  if (!list.length) return ''
  const total = Math.round(list.reduce((sum, tr) => sum + (tr.durationS ?? 0), 0) / 60)
  const h = Math.floor(total / 60)
  const dur = total <= 0 ? '' : h ? t('music.durHourMin', { h, m: total % 60 }) : t('music.durMin', { m: total })
  return [t('music.detailTracks', { n: list.length }, list.length), dur].filter(Boolean).join(' · ')
})
function backFromDetail() {
  tracks.value = []
  const prev = backStack.value.at(-1)
  if (prev) {
    // the category we came from: its rows are still in memory
    backStack.value = backStack.value.slice(0, -1)
    browse.value = prev
    return
  }
  browse.value = null
  if (!searched.value) void loadBrowseTab()
}

/** Play `track`; the list it comes from (album, playlist, likes, results) becomes the queue, starting from it. */
async function play(track: YtmusicTrack, list: YtmusicTrack[] = [track]) {
  const target = selected.value
  if (!target || !canReceive(target)) {
    notifications.error(t('ytmusic.noPlayer'))
    return
  }
  rememberPlay(track)
  await playTracks(list.map(toQueueTrack), Math.max(0, list.findIndex((x) => x.videoId === track.videoId)))
}

/**
 * Play `all[at]`, wherever the tracks come from (YouTube Music, Mixcloud): the list becomes the
 * chosen player's queue — speaker (server-side queue) or this browser —, by windows of
 * `QUEUE_WINDOW`.
 */
async function playTracks(all: MusicTrack[], at: number) {
  const target = selected.value
  if (!target || !canReceive(target)) {
    notifications.error(t('ytmusic.noPlayer'))
    return
  }
  const track = all[at]
  if (!track) return
  if (localSelected.value) local.prime()
  playingId.value = track.id
  pendingTrack.value = fromQueueTrack(track)
  const from = Math.max(0, Math.min(at - 100, all.length - QUEUE_WINDOW))
  const tracksWindow = all.slice(from, from + QUEUE_WINDOW)
  if (localSelected.value) {
    try { await local.playQueue(tracksWindow, at - from) }
    catch (err) { failLocal(err) }
    finally {
      playingId.value = null
      pendingTrack.value = null
    }
    return
  }
  try {
    const r = await getTransport().musicQueuePlay({ deviceId: target.descriptor.id, tracks: tracksWindow, startIndex: at - from })
    patchSessionQueue(r.queue)
    void refreshSessions()
  } catch (err) { fail(err) }
  finally {
    playingId.value = null
    pendingTrack.value = null
  }
}

/** Album or artist played with one gesture (its tile, its row): its tracks become the queue, from the first. */
const playingCollection = ref<string | null>(null)
async function playCollection(id: string, load: () => Promise<{ tracks: YtmusicTrack[] }>) {
  // the sound unlock must happen within the gesture, before the list loads
  if (localSelected.value) local.prime()
  playingCollection.value = id
  try {
    const list = withoutExplicit((await load()).tracks)
    if (list.length) await play(list[0]!, list)
    else notifications.error(t('ytmusic.empty'))
  } catch (err) { fail(err) }
  finally { playingCollection.value = null }
}
const playAlbum = (al: YtmusicAlbum) => playCollection(al.id, () => getTransport().ytmusicAlbum(al.id))
const playArtist = (ar: YtmusicArtist) => playCollection(ar.id, () => getTransport().ytmusicArtist(ar.id))
const playPlaylist = (pl: YtmusicPlaylist) => playCollection(pl.id, () => getTransport().ytmusicPlaylist(pl.id))

watch(browseTab, () => { queueOpen.value = false; if (linked.value && !searched.value) void loadBrowseTab() })
const playTarget = computed(() => !!selected.value && canReceive(selected.value))
/** A search has gone out and its answer is not there: the results zone shows skeletons. */
const searching = computed(() => busy.value && searched.value && !browse.value)
</script>

<template>
  <div class="page">
    <PageHeader>
      <!-- sources: YouTube Music and each active source plugin; the chosen one occupies the search and the central zone -->
      <Segmented v-model="sourceChoice" class="sources" :options="sourceOptions" :label="$t('music.sources')" />
    </PageHeader>

    <div class="body">
      <section class="main">
        <!-- the queue, opened from the bar while a source other than YouTube Music is displayed: it
             takes the central zone; the source stays mounted (hidden), we find it as it was on return -->
        <div v-if="queueOpen && activeSource !== 'ytmusic'" class="main__body">
          <div class="back-row">
            <button type="button" class="pill" @click="queueOpen = false">
              <StrokeIcon name="back" :size="16" />
              <span>{{ $t('common.back') }}</span>
            </button>
            <span class="back-row__title">{{ $t('music.queue') }}</span>
            <button type="button" class="pill back-row__end" :disabled="queueWaiting <= 0 && !(queue && queue.index > 0)" @click="clearQueue">
              <StrokeIcon name="trash" :size="16" />
              <span>{{ $t('music.queueClear') }}</span>
            </button>
          </div>
          <div class="main__scroll main__scroll--under">
            <QueueList :queue="queue" :waiting="queueWaiting" :pulsing="nowPulsing" :can-play="playTarget" :busy-index="queueBusyIndex"
                       @play="queueGo" @remove="removeFromQueue" />
          </div>
        </div>
        <RadioBrowser v-if="activeSource === 'radio'" v-show="!queueOpen" :target="playTarget ? selected : null" :local-selected="localSelected" />
        <MixcloudBrowser v-else-if="activeSource === 'mixcloud'" v-show="!queueOpen" :now-playing="nowPlayingTrack" :pulsing="nowPulsing" :playing-id="playingId"
                         :can-play="playTarget" @play="playTracks" />
        <template v-else>
        <form class="search" @submit.prevent="runSearch">
          <div class="search__field">
            <StrokeIcon name="search" :size="18" class="search__icon" />
            <input v-model="query" type="search" class="search__input" :placeholder="$t('music.searchPlaceholder')" :disabled="busy || !linked" :aria-label="$t('music.search')" />
            <button type="button" class="search__clear" :class="{ 'is-hidden': !query }" :aria-label="$t('music.clear')" :tabindex="query ? 0 : -1" @click="clearSearch">
              <StrokeIcon name="close" :size="14" />
            </button>
            <!-- phone: "Advanced" and the explicit filter wait in a menu at the end of the field -->
            <v-menu v-if="phone" location="bottom end" :close-on-content-click="false">
              <template #activator="{ props: menu }">
                <button v-bind="menu" type="button" class="search__options" :data-on="(advanced && searched) || hideExplicit ? '1' : '0'"
                        :title="$t('music.searchOptions')" :aria-label="$t('music.searchOptions')">
                  <StrokeIcon name="gear" :size="16" />
                </button>
              </template>
              <div class="search-menu card">
                <button type="button" class="pill" :data-on="advanced && searched ? '1' : '0'" :disabled="!searched" @click="advanced = !advanced">
                  <StrokeIcon name="layers" :size="16" />
                  <span>{{ $t('music.advanced') }}</span>
                </button>
                <label class="hide-explicit">
                  <v-switch v-model="hideExplicit" density="compact" hide-details color="primary" />
                  <span class="small">{{ $t('ytmusic.hideExplicit') }}</span>
                </label>
              </div>
            </v-menu>
          </div>
          <!-- the presentation of the RESULTS: with no search displayed, nothing to present — greyed out, the choice stays remembered -->
          <button type="button" class="pill" :data-on="advanced && searched ? '1' : '0'" :disabled="!searched" :title="$t('music.advancedHint')" @click="advanced = !advanced">
            <StrokeIcon name="layers" :size="16" />
            <span>{{ $t('music.advanced') }}</span>
          </button>
          <label class="hide-explicit" :title="$t('ytmusic.hideExplicit')">
            <v-switch v-model="hideExplicit" density="compact" hide-details color="primary" />
            <span class="muted small">{{ $t('ytmusic.hideExplicit') }}</span>
          </label>
        </form>
        <ChipRow :label="$t('ytmusic.recent')" :items="recentQueries.map((q) => ({ key: q, label: q }))" :disabled="busy || !linked"
                 :remove-label="$t('ytmusic.recentRemove')" @pick="runRecent" @remove="removeRecent" />

        <div class="main__body">
        <!-- the veil of a detail's cover art (album, playlist, artist), blurred, behind "Back" and the
             zone that scrolls — never under the search —, faded on its four edges: no demarcation,
             and fixed, since it is not in the scrolling zone -->
        <div v-if="detail?.art && !queueOpen" class="veil" aria-hidden="true">
          <img :key="detail.art" :src="detail.art" alt="" referrerpolicy="no-referrer">
        </div>
        <!-- "Back" (queue, category, detail) OUTSIDE the scrolling zone: nothing passes under it
             anymore, and no background band to separate it from the veil — the top of the zone
             fades, rows disappear into it softly -->
        <div v-if="hasBackRow" class="back-row">
          <button type="button" class="pill" @click="queueOpen ? (queueOpen = false) : backFromDetail()">
            <StrokeIcon name="back" :size="16" />
            <span>{{ $t('common.back') }}</span>
          </button>
          <span class="back-row__title">{{ queueOpen ? $t('music.queue') : browse?.kind === 'category' ? browse.title : '' }}</span>
          <button v-if="queueOpen" type="button" class="pill back-row__end" :disabled="queueWaiting <= 0 && !(queue && queue.index > 0)" @click="clearQueue">
            <StrokeIcon name="trash" :size="16" />
            <span>{{ $t('music.queueClear') }}</span>
          </button>
        </div>
        <div ref="scrollEl" class="main__scroll" :class="{ 'main__scroll--under': hasBackRow }">
          <div v-if="!statusReady" class="muted empty">{{ $t('common.loading') }}</div>
          <div v-else-if="!linked" class="card card--soft empty muted">{{ $t('ytmusic.needCookie') }}</div>
          <template v-else>
            <!-- queue of the chosen player: what is playing, what follows -->
            <template v-if="queueOpen">
              <QueueList :queue="queue" :waiting="queueWaiting" :pulsing="nowPulsing" :can-play="playTarget" :busy-index="queueBusyIndex"
                         @play="queueGo" @remove="removeFromQueue" />
            </template>

            <!-- a category (genre, mood): its rows of tiles -->
            <template v-else-if="browse?.kind === 'category'">
              <template v-if="categoryLoading">
                <section v-for="n in 3" :key="n" class="shelf" aria-hidden="true">
                  <div class="shelf__head"><span class="skel skel--label" /></div>
                  <div class="shelf__row">
                    <span v-for="i in 7" :key="i" class="skel-tile">
                      <span class="skel skel--art" />
                      <span class="skel skel--line" />
                      <span class="skel skel--line skel--short" />
                    </span>
                  </div>
                </section>
              </template>
              <template v-else>
                <MusicShelves :shelves="categoryView" :play-target="playTarget" :playing-id="playingId" :playing-collection="playingCollection"
                              @play-track="play" @open-playlist="openPlaylist" @play-playlist="playPlaylist" @open-album="openAlbum" @play-album="playAlbum" />
                <p v-if="categoryView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </template>
            </template>

            <!-- detail: album, artist, playlist — a fixed column on the left (cover art, title, play), the tracks on the right -->
            <template v-else-if="detail">
              <div class="detail">
                <aside ref="sideEl" class="detail__side" :class="{ 'is-fixed': sideFits }">
                  <!-- in 600 px: the cover art displays up to 300 px, on high-density screens -->
                  <ArtThumb :key="detail.art ?? 'none'" :src="artAt(detail.art, 600)" :size="176" :round="detail.kind === 'artist'"
                            :icon="detail.kind === 'artist' ? 'person' : detail.kind === 'album' ? 'disc' : 'list'" class="detail__art" />
                  <h2 class="detail__title" :title="detail.title">{{ detail.title }}</h2>
                  <div class="detail__artist">{{ detail.artists?.length ? detail.artists.join(', ') : '\u00a0' }}</div>
                  <!-- type, year, tracks and duration on ONE line: the column gains a line of height -->
                  <div class="detail__meta muted">
                    <ExplicitBadge v-if="detail.explicit" />
                    <span>{{ [detailKind, detailStats].filter(Boolean).join(' · ') || '\u00a0' }}</span>
                  </div>
                  <!-- the album's or artist's introduction, collapsed to two lines: a click expands it -->
                  <p v-if="detailText" class="detail__desc muted" :class="{ 'is-open': descOpen }" :title="descOpen ? undefined : detailText"
                     role="button" tabindex="0" :aria-expanded="descOpen" @click="descOpen = !descOpen" @keydown.enter="descOpen = !descOpen">{{ detailText }}</p>
                  <p v-if="detailCredit" class="detail__credit muted">{{ detailCredit }}</p>
                  <button type="button" class="detail__play" :disabled="!playTarget || browseTracksView.length === 0"
                          :title="$t('music.playAll')" :aria-label="$t('music.playAll')" @click="play(browseTracksView[0]!, browseTracksView)">
                    <StrokeIcon name="play" :size="22" :stroke-width="2" />
                  </button>
                </aside>
                <div class="list detail__list">
                  <MusicItemRow v-for="(tr, i) in browseTracksView" :key="tr.videoId" action="play" queueable :artless="detailArtless" :position="i + 1" :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                                :meta="detailArtless ? tr.artists.join(', ') : trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="detailArtless ? null : tr.year ?? null"
                                :selected="nowPlayingId === tr.videoId" :playing="nowPlayingId === tr.videoId && nowPulsing"
                                :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')"
                                @play="play(tr, browseTracksView)" @play-next="addToQueue(tr, 'next')" @add-end="addToQueue(tr, 'end')" />
                  <p v-if="!busy && browseTracksView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
                </div>
              </div>
            </template>

            <!-- waiting: same shape as the coming results, so that nothing jumps when they arrive -->
            <template v-else-if="searching">
              <section v-for="n in 3" :key="n" class="shelf" aria-hidden="true">
                <div class="shelf__head"><span class="skel skel--label" /></div>
                <div class="shelf__row">
                  <span v-for="i in 7" :key="i" class="skel-tile">
                    <span class="skel skel--art" />
                    <span class="skel skel--line" />
                    <span class="skel skel--line skel--short" />
                  </span>
                </div>
              </section>
              <p class="muted empty" role="status">{{ $t('ytmusic.searching') }}</p>
            </template>

            <!-- simple search: a row of tiles per section -->
            <template v-else-if="searched && !advanced">
              <section v-if="artistsSimple.length" class="shelf">
                <div class="shelf__head"><h2 class="section-label">{{ $t('ytmusic.sectionArtists') }}</h2><button type="button" class="see-all" @click="advanced = true">{{ $t('music.seeAll') }}</button></div>
                <div class="shelf__row">
                  <MusicTile v-for="ar in artistsSimple" :key="ar.id" action="open" playable round icon="person" :art="ar.artUrl" :title="ar.name" :meta="ar.subscribers ?? ''"
                             :disabled="!playTarget" :busy="playingCollection === ar.id" :play-label="$t('music.playAll')" @open="openArtist(ar)" @play="playArtist(ar)" />
                </div>
              </section>
              <section v-if="releasesSimple.length" class="shelf">
                <div class="shelf__head"><h2 class="section-label">{{ $t('ytmusic.sectionAlbums') }}</h2><button type="button" class="see-all" @click="advanced = true">{{ $t('music.seeAll') }}</button></div>
                <div class="shelf__row">
                  <MusicTile v-for="al in releasesSimple" :key="al.id" action="open" playable icon="disc" :art="al.artUrl" :title="al.title" :explicit="!!al.explicit" :meta="[albumMeta(al), al.year].filter(Boolean).join(' · ')"
                             :disabled="!playTarget" :busy="playingCollection === al.id" :play-label="$t('music.playAll')" @open="openAlbum(al)" @play="playAlbum(al)" />
                </div>
              </section>
              <section v-if="tracksSimple.length" class="shelf">
                <div class="shelf__head"><h2 class="section-label">{{ $t('ytmusic.sectionTracks') }}</h2><button type="button" class="see-all" @click="advanced = true">{{ $t('music.seeAll') }}</button></div>
                <div class="shelf__row">
                  <MusicTile v-for="tr in tracksSimple" :key="tr.videoId" action="play" :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit" :meta="trackMeta(tr)"
                             :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')" @play="play(tr, tracksSimple)" />
                </div>
              </section>
              <p v-if="searchEmpty" class="muted empty">{{ $t('ytmusic.empty') }}</p>
            </template>

            <!-- advanced search: ranked columns with sorts -->
            <div v-else-if="searched" class="search-grid">
              <section v-for="sec in advancedSections" :key="sec.key" class="section">
                <div class="section__head">
                  <h2 class="section-label">{{ sec.title }}</h2>
                  <Segmented v-model="sec.sort.value" dense fill :options="sec.options" :label="$t('ytmusic.sortLabel')" />
                </div>
                <div class="list">
                  <MusicItemRow v-for="it in sec.items" :key="it.id" action="open" playable :round="sec.round" :icon="sec.icon" :art="it.art" :title="it.title"
                                :explicit="'explicit' in it && it.explicit" :meta="it.meta" :year="'year' in it ? it.year : null"
                                :disabled="!playTarget" :busy="playingCollection === it.id" :play-label="$t('music.playAll')" @open="it.open()" @play="it.play()" />
                </div>
              </section>
              <section v-if="tracksView.length" class="section">
                <div class="section__head">
                  <h2 class="section-label">{{ $t('ytmusic.sectionTracks') }}</h2>
                  <Segmented v-model="sortTracks" dense fill :options="sortOptionsDated" :label="$t('ytmusic.sortLabel')" />
                </div>
                <div class="list">
                  <MusicItemRow v-for="tr in tracksView" :key="tr.videoId" action="play" queueable :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                                :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null" :selected="nowPlayingId === tr.videoId" :playing="nowPlayingId === tr.videoId && nowPulsing"
                                :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')"
                                @play="play(tr, tracksView)" @play-next="addToQueue(tr, 'next')" @add-end="addToQueue(tr, 'end')" />
                </div>
              </section>
              <p v-if="searchEmpty" class="muted empty">{{ $t('ytmusic.empty') }}</p>
            </div>

            <!-- browse: recents, likes, playlists, genres, moods -->
            <template v-else>
              <div class="browse-head">
                <Segmented v-model="browseTab" dense :options="browseOptions" :label="$t('music.browse')" />
              </div>
              <div v-if="browseTab === 'recent'" class="list">
                <MusicItemRow v-for="tr in recentPlays" :key="tr.videoId" action="play" queueable :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                              :selected="nowPlayingId === tr.videoId" :playing="nowPlayingId === tr.videoId && nowPulsing"
                              :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null"
                              :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')"
                              @play="play(tr, [...recentPlays])" @play-next="addToQueue(tr, 'next')" @add-end="addToQueue(tr, 'end')" />
                <p v-if="recentPlays.length === 0" class="muted empty">{{ $t('music.noRecent') }}</p>
              </div>
              <div v-else-if="browseTab === 'liked'" class="list">
                <MusicItemRow v-for="(tr, i) in browseTracksView" :key="tr.videoId" action="play" queueable :position="i + 1" :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                              :selected="nowPlayingId === tr.videoId" :playing="nowPlayingId === tr.videoId && nowPulsing"
                              :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null"
                              :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')"
                              @play="play(tr, browseTracksView)" @play-next="addToQueue(tr, 'next')" @add-end="addToQueue(tr, 'end')" />
                <p v-if="!busy && browseTracksView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </div>
              <!-- new releases: the rows of the YouTube Music page -->
              <div v-else-if="browseTab === 'new'">
                <template v-if="busy && !newShelves.length">
                  <section v-for="n in 2" :key="n" class="shelf" aria-hidden="true">
                    <div class="shelf__head"><span class="skel skel--label" /></div>
                    <div class="shelf__row">
                      <span v-for="i in 7" :key="i" class="skel-tile">
                        <span class="skel skel--art" />
                        <span class="skel skel--line" />
                        <span class="skel skel--line skel--short" />
                      </span>
                    </div>
                  </section>
                </template>
                <template v-else>
                  <MusicShelves :shelves="newView" grid :play-target="playTarget" :playing-id="playingId" :playing-collection="playingCollection"
                                @play-track="play" @open-playlist="openPlaylist" @play-playlist="playPlaylist" @open-album="openAlbum" @play-album="playAlbum" />
                  <p v-if="!busy && newView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
                </template>
              </div>
              <!-- genres / moods: fixed-size cards, gradient of the YouTube Music color, two tilted covers -->
              <div v-else-if="browseTab === 'genres' || browseTab === 'moods'">
                <div v-if="busy && !exploreGroups.length" class="cat-grid" aria-hidden="true">
                  <span v-for="i in 12" :key="i" class="skel cat-skel" />
                </div>
                <template v-for="grp in exploreGroups" :key="grp.key">
                  <h2 v-if="grp.title" class="section-label cat-head">{{ grp.title }}</h2>
                  <div class="cat-grid">
                    <button v-for="c in grp.categories" :key="c.params" type="button" class="cat" :style="{ '--cat': c.color ?? '#606060' }"
                            :title="c.title" @click="openCategory(c)">
                      <span class="cat__title">{{ c.title }}</span>
                      <span class="cat__art" aria-hidden="true">
                        <img v-for="(u, ci) in (covers[c.params] ?? []).slice(0, 2).reverse()" :key="u" :src="u" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"
                             class="cat__cover" :class="[`cat__cover--${(covers[c.params] ?? []).slice(0, 2).length - ci}`, { 'is-in': coverLoaded.has(u) }]"
                             @load="markCover(u)">
                      </span>
                    </button>
                  </div>
                </template>
                <p v-if="!busy && exploreGroups.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </div>
              <div v-else class="list">
                <MusicItemRow v-for="pl in playlists" :key="pl.id" action="open" playable icon="list" :art="pl.artUrl" :title="pl.title"
                              :meta="pl.trackCount != null ? $t('ytmusic.tracks', { n: pl.trackCount }, pl.trackCount) : ''"
                              :disabled="!playTarget" :busy="playingCollection === pl.id" :play-label="$t('music.playAll')" @open="openPlaylist(pl)" @play="playPlaylist(pl)" />
                <p v-if="!busy && playlists.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </div>
            </template>
          </template>
        </div>
        </div>
        </template>
      </section>

      <!-- the column on the right; on a phone, a sheet over the page (scrim, handle), closed by default -->
      <div class="sessions-sheet" :data-open="sessionsOpen ? '1' : '0'">
        <div class="sessions-sheet__scrim" @click="sessionsOpen = false" />
        <div class="sessions-sheet__panel">
          <button type="button" class="sessions-sheet__grip" :aria-label="$t('common.close')" @click="sessionsOpen = false"><span /></button>
          <ListeningSessions :players="players" :selected-id="sessionId || null" :transfer-mode="transferMode" :transfer-busy-id="transferBusyId"
                             :pending-id="pendingTrack && selected ? selected.descriptor.id : null"
                             @select="selectSession" @transfer-to="transferTo" @locate="locate"
                             @command="panelCommand" />
        </div>
      </div>
    </div>

    <MusicPlayerBar :entry="selected" :name="selectedName" :session="selectedSession" :station="selectedStation" :pending="pendingTrack" :resume="barResume"
                    :transfer-mode="transferMode" :can-transfer="canTransfer" :transfer-busy="!!transferBusyId" :queue-open="queueOpen"
                    @command="barCommand" @seek="barSeek" @transfer="startTransfer" @cancel-transfer="transferMode = false"
                    @repeat="setRepeat" @toggle-queue="queueOpen = !queueOpen" @sessions="sessionsOpen = true" />
  </div>
</template>

<style scoped>
/* relative: the expanded player and the "Listening" sheet of a phone cover the page */
.page { position: relative; height: 100%; display: flex; flex-direction: column; min-height: 0; }

.body {
  flex: 1 1 auto; min-height: 0;
  display: grid; grid-template-columns: minmax(0, 1fr) var(--aside-w); gap: 16px;
  padding: 0 var(--page-x) 16px;
}
/* outside a phone, the sheet does not exist: the panel is the grid's right column */
.sessions-sheet, .sessions-sheet__panel { display: contents; }
.sessions-sheet__scrim, .sessions-sheet__grip { display: none; }
/* Phone in portrait: the central zone takes all the height; "Listening" rises in a sheet from the
   bottom, above the player (expanded or not), and the scrim closes it. */
@media (max-width: 599px) {
  .body { grid-template-columns: minmax(0, 1fr); gap: 10px; padding-bottom: 10px; }
  /* overflow: the closed panel, pushed down out of the frame, would otherwise lengthen the shell's
     scroll and the whole page could slide up under it */
  .sessions-sheet { display: block; position: absolute; inset: 0; z-index: 30; pointer-events: none; overflow: hidden; }
  .sessions-sheet__scrim {
    display: block; position: absolute; inset: 0; background: rgba(0, 0, 0, .25);
    opacity: 0; transition: opacity .2s;
  }
  .sessions-sheet__panel {
    display: flex; flex-direction: column; position: absolute; left: 0; right: 0; bottom: 0; height: 64%;
    border-top: 1px solid var(--line); border-radius: 20px 20px 0 0; overflow: hidden;
    background: var(--surface); box-shadow: var(--shadow);
    transform: translateY(100%); visibility: hidden;
  }
  .sessions-sheet[data-open='1'] { pointer-events: auto; }
  .sessions-sheet[data-open='1'] .sessions-sheet__scrim { opacity: 1; }
  .sessions-sheet[data-open='1'] .sessions-sheet__panel { transform: none; visibility: visible; }
  /* hidden after its slide, not before: `visibility` waits for the end of the transition */
  .sessions-sheet__panel { transition: transform .22s ease, visibility 0s linear .22s; }
  .sessions-sheet[data-open='1'] .sessions-sheet__panel { transition: transform .22s ease, visibility 0s; }
  .sessions-sheet__grip {
    display: grid; place-items: center; flex: 0 0 auto; height: 24px; width: 100%;
    border: 0; background: transparent; padding: 0;
  }
  .sessions-sheet__grip > span { width: 40px; height: 4px; border-radius: 999px; background: color-mix(in srgb, var(--text) 28%, transparent); }
  /* the sheet is the card: the panel loses its own */
  .sessions-sheet__panel > :deep(.sessions) { flex: 1 1 auto; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
}
@media (max-width: 599px) and (prefers-reduced-motion: reduce) {
  .sessions-sheet__scrim, .sessions-sheet__panel, .sessions-sheet[data-open='1'] .sessions-sheet__panel { transition: none; }
}
.main { display: flex; flex-direction: column; min-height: 0; min-width: 0; gap: 10px; }
/* under the search: "Back", the scrolling zone, and the veil behind them */
.main__body { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.main__body > :not(.veil) { position: relative; z-index: 1; }
/* veil: faded on its FOUR edges (two crossed masks) — no sharp line —, kept in the column
   and clipped in its box: the enlarged blurred image does not overflow */
.veil {
  position: absolute; z-index: 0; inset: 0 0 auto; height: 540px; overflow: hidden; pointer-events: none;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14%, #000 38%, transparent 100%), linear-gradient(to right, transparent 0, #000 12%, #000 88%, transparent 100%);
  -webkit-mask-composite: source-in;
  mask-image: linear-gradient(to bottom, transparent 0, #000 14%, #000 38%, transparent 100%), linear-gradient(to right, transparent 0, #000 12%, #000 88%, transparent 100%);
  mask-composite: intersect;
}
.veil img { width: 100%; height: 100%; object-fit: cover; display: block; filter: blur(70px) saturate(1.35); opacity: .3; transform: scale(1.15); }
.main__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }

/* the search: the page's first gesture, hence its size */
.search { display: flex; align-items: center; gap: 12px; flex: 0 0 auto; }
.search__field {
  flex: 1 1 auto; min-width: 0; height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 16px;
  border-radius: 999px; border: 1px solid var(--line); background: var(--surface);
}
.search__field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search__icon { color: var(--muted); flex: 0 0 auto; }
.search__input { flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; }
.search__input::-webkit-search-cancel-button { display: none; }
.search__clear { display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 999px; background: var(--surface2); color: var(--muted); flex: 0 0 auto; }
.search__clear:hover { color: var(--text); }
.is-hidden { visibility: hidden; }
.hide-explicit { display: flex; align-items: center; gap: 6px; cursor: pointer; flex: 0 0 auto; }
.search__options {
  display: grid; place-items: center; width: 34px; height: 34px; border: 0; border-radius: 999px;
  background: var(--surface2); color: var(--muted); flex: 0 0 auto;
}
.search__options[data-on='1'] { background: var(--accent-soft); color: var(--accent); }
.search-menu { display: grid; gap: 10px; padding: 12px; justify-items: start; }
/* Phone in portrait: the field alone on its row, its options in the menu at its end. The source
   selector stays on the title's line (three icons): one row less above the content. */
@media (max-width: 599px) {
  .search__field { padding-right: 6px; }
  .search > .pill, .search > .hide-explicit { display: none; }
  .page :deep(.page-header__titles) { flex-basis: 0; }
  .sources { order: -1; }   /* before the assistant's button, which PageHeader also moves to -1 */
}
.small { font-size: 12px; }

.browse-head { display: flex; align-items: center; gap: 12px; margin: 4px 0 10px; }
/* "Back": above the scrolling zone, without background (the veil passes underneath with no demarcation) */
.back-row { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; min-height: 36px; }
/* under "Back", the top of the scrolling zone fades over a few pixels: a row that goes up
   disappears into it instead of being cut off sharply */
.main__scroll--under {
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14px); mask-image: linear-gradient(to bottom, transparent 0, #000 14px);
}
.back-row__title { min-width: 0; flex: 1 1 auto; font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.back-row__end { flex: 0 0 auto; white-space: nowrap; }

/* waiting for a search: blocks the size of the tiles, breathing gently */
.skel { display: block; border-radius: 8px; background: var(--surface2); animation: skel 1.4s ease-in-out infinite; }
.skel-tile { width: 128px; flex: 0 0 auto; display: grid; gap: 6px; }
.skel--art { width: 128px; height: 128px; border-radius: 10px; }
.skel--line { height: 10px; }
.skel--short { width: 60%; }
.skel--label { width: 120px; height: 13px; }
@keyframes skel { 0%, 100% { opacity: .45; } 50% { opacity: .9; } }
@media (prefers-reduced-motion: reduce) { .skel { animation: none; opacity: .6; } }

/* simple search: scrolling rows of tiles */
.shelf { margin: 4px 0 18px; }
.shelf__head { display: flex; align-items: baseline; justify-content: space-between; margin: 0 4px 8px; }
.see-all { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 13px; font-weight: 500; padding: 0; }
.shelf__row { display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x proximity; padding: 2px 4px 8px; }
.shelf__row::-webkit-scrollbar { height: 6px; }
.shelf__row::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }

/* advanced search: columns as soon as there is room */
.search-grid { display: grid; gap: 18px; align-items: start; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.section { min-width: 0; }
.section__head { display: flex; flex-direction: column; align-items: stretch; gap: 6px; margin: 0 0 6px; }
.section-label { margin: 0 4px; }
.list { display: grid; gap: 2px; }

/* detail: column on the left (cover art, title, play), the tracks on the right. `overflow-x: clip`
   (not `hidden`): the blurred veil does not create a horizontal bar, and the column can stay
   sticky. */
.detail {
  /* the cover art grows with the screen; the column follows (cover art + margins) */
  --cover: 208px;
  position: relative; display: grid; grid-template-columns: calc(var(--cover) + 40px) minmax(0, 1fr); gap: 36px; align-items: start; overflow-x: clip;
}
@media (min-width: 1500px) { .detail { --cover: 260px; gap: 48px; } }
@media (min-width: 1800px) { .detail { --cover: 300px; gap: 56px; } }
.detail__side { position: relative; z-index: 1; display: grid; justify-items: center; gap: 5px; padding: 14px 20px 10px; text-align: center; }
/* fixed when it fits entirely under "Back" (measured: `sideFits`), hooked EXACTLY at its
   starting place — otherwise it slid a few pixels before sticking */
.detail__side.is-fixed { position: sticky; top: 0; }
/* `--art` is set inline by ArtThumb: only !important overrides it */
.detail__art { --art: var(--cover) !important; box-shadow: 0 14px 36px rgb(0 0 0 / .38); border-radius: 10px; margin-bottom: 10px; }
.detail__art.art-wrap--round { border-radius: 999px; }
.detail__art:not(.art-wrap--round) :deep(.art) { border-radius: 10px; }
.detail__title {
  margin: 0; font-size: 22px; font-weight: 700; line-height: 1.2; max-width: 100%;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.detail__artist { font-size: 15px; font-weight: 500; margin-bottom: 4px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.detail__meta { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; min-height: 18px; max-width: 100%; white-space: nowrap; }
.detail__meta > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.detail__desc {
  margin: 8px 0 0; max-width: 100%; font-size: 13px; line-height: 1.45; cursor: pointer;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.detail__desc.is-open { display: block; }
.detail__credit { margin: 2px 0 0; max-width: 100%; font-size: 10.5px; line-height: 1.35; opacity: .75; }
.detail__desc:hover { color: var(--text); }
.detail__play {
  margin-top: 8px; display: grid; place-items: center; width: 54px; height: 54px; border-radius: 999px; border: 0;
  background: var(--accent); color: var(--on-accent); cursor: pointer; box-shadow: 0 6px 18px rgb(0 0 0 / .3); transition: transform .15s, filter .15s;
}
.detail__play svg { margin-left: 3px; }
.detail__play:hover:not(:disabled) { filter: brightness(1.08); transform: scale(1.04); }
.detail__play:disabled { opacity: .45; cursor: default; }
.detail__list { position: relative; z-index: 1; min-width: 0; }

/* genres / moods: FIXED-size cards (the cover art arrives afterwards, in a slot already made).
   Background: the YouTube Music color darkened into a gradient — these colors are pastel
   (#a4ffa4, #cccccc…), as a flat fill the white text would be unreadable there. Same card in
   both themes: it is a thumbnail, like a cover art. */
.cat-head { margin: 4px 4px 8px; }
.cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(208px, 1fr)); gap: 12px; margin: 0 0 20px; }
.cat {
  position: relative; overflow: hidden; height: 108px; min-width: 0; display: block; padding: 14px 16px;
  border: 0; border-radius: 12px; text-align: left; cursor: pointer; font: inherit; color: #fff;
  background:
    radial-gradient(120% 90% at 100% 100%, color-mix(in srgb, var(--cat) 55%, transparent) 0%, transparent 60%),
    linear-gradient(135deg, color-mix(in srgb, var(--cat) 58%, #0b0d12) 0%, color-mix(in srgb, var(--cat) 24%, #0b0d12) 100%);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / .06);
  transition: filter .2s, transform .2s;
}
.cat:hover { filter: brightness(1.1); }
.cat:active { transform: scale(.985); }
.cat:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* two lines at most, on the left: the cover art occupies the opposite corner */
.cat__title {
  position: relative; z-index: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  max-width: 62%; font-size: 17px; font-weight: 700; line-height: 1.2; letter-spacing: -.01em; text-shadow: 0 1px 8px rgb(0 0 0 / .35);
}
.cat__art { position: absolute; right: 0; bottom: 0; width: 132px; height: 100%; pointer-events: none; }
.cat__cover {
  position: absolute; width: 76px; height: 76px; border-radius: 6px; object-fit: cover;
  box-shadow: 0 6px 18px rgb(0 0 0 / .45); opacity: 0; transition: opacity .35s ease, transform .3s ease;
}
/* the first cover art in front, tilted to the right; the second behind, set back */
.cat__cover--1 { right: -10px; bottom: -12px; transform: rotate(22deg); }
.cat__cover--2 { right: 44px; bottom: -22px; width: 64px; height: 64px; transform: rotate(-10deg); filter: brightness(.85); }
.cat__cover.is-in { opacity: 1; }
.cat:hover .cat__cover--1 { transform: rotate(16deg) translateY(-3px); }
.cat:hover .cat__cover--2 { transform: rotate(-14deg) translateY(-2px); }
@media (prefers-reduced-motion: reduce) { .cat, .cat__cover { transition: none; } }
.cat-skel { height: 108px; border-radius: 12px; }
.empty { padding: 16px 4px; }
</style>
