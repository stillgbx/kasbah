<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { CommandInput, DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../api'
import type { YtmusicAlbum, YtmusicArtist, YtmusicPlaylist, YtmusicSession, YtmusicTrack } from '../api/transport'
import PageHeader from '../components/layout/PageHeader.vue'
import ChipRow from '../components/music/ChipRow.vue'
import ListeningSessions from '../components/music/ListeningSessions.vue'
import MusicItemRow from '../components/music/MusicItemRow.vue'
import MusicPlayerBar from '../components/music/MusicPlayerBar.vue'
import MusicTile from '../components/music/MusicTile.vue'
import Segmented from '../components/ui/Segmented.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { formatClock } from '../composables/useMediaPosition'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'

// Page Musique. Trois zones qui ne bougent jamais : la recherche en tête (simple : tuiles par
// section ; avancée : cinq colonnes artistes / albums / EP / compilations / titres avec tris), le
// panneau « Écoute » à droite (un lecteur = une session : là où partent les lectures et ce que pilote
// la barre), et le lecteur en bas. Sans recherche, la zone centrale sert à parcourir : récents, likes,
// playlists. Une seule source aujourd'hui (YouTube Music, non officiel) ; la rangée de sources est
// là pour les suivantes. La lecture reste un titre à la fois (`play_url`) — la file d'attente viendra.
//
// Le transfert (bureau → salon) passe par le serveur : il connaît le titre que joue la source et
// relance le flux sur la cible à la même position, puis arrête la source. Il n'est possible que pour
// une lecture lancée d'ici (`GET /sessions`) : une appli native sur le Chromecast n'est pas à nous.

defineOptions({ name: 'MusicView' })

type BrowseTab = 'recent' | 'liked' | 'playlists'
type Browse =
  | { kind: 'playlist'; id: string; title: string }
  | { kind: 'album'; id: string; title: string }
  | { kind: 'artist'; id: string; title: string }
/** Ordre API InnerTube = pertinence. */
type SectionSort = 'relevance' | 'alpha' | 'date'

const { t } = useI18n()
const router = useRouter()
const devices = useDevicesStore()
const house = useHouseStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()

// ---- recherche et catalogue -------------------------------------------------------------------
const query = useLocalStorage('kasbah.ytmusic.query', '')
const advanced = useLocalStorage('kasbah.music.advanced', false)
const browseTab = useLocalStorage<BrowseTab>('kasbah.music.browse', 'recent')
/** Derniers titres joués. */
const recentPlays = useLocalStorage<YtmusicTrack[]>('kasbah.ytmusic.recentPlays', [])
const recentQueries = useLocalStorage<string[]>('kasbah.ytmusic.recentQueries', [])
/** Vrai après une recherche : la zone centrale montre les résultats, pas le parcours. */
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
/** false tant que le statut cookie n'a pas été lu — éviter le faux « manquant ». */
const statusReady = ref(false)
const linked = ref(false)

const sortArtists = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.artists', 'relevance')
const sortAlbums = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.albums', 'relevance')
const sortSingles = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.singles', 'relevance')
const sortCompilations = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.compilations', 'relevance')
const sortTracks = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.tracks', 'relevance')
const hideExplicit = useLocalStorage('kasbah.ytmusic.hideExplicit', false)
const RECENT_MAX = 10
const RECENT_PLAYS_MAX = 20
/** Tuiles par rangée en recherche simple (le reste attend « Voir tout »). */
const SIMPLE_MAX = 12

/** Les sources de musique : une seule aujourd'hui, la rangée est prête pour les suivantes. */
const sources = computed(() => [{ id: 'ytmusic', label: 'YouTube Music', linked: linked.value }])

const browseOptions = computed(() => [
  { value: 'recent' as const, label: t('music.browseRecent') },
  { value: 'liked' as const, label: t('music.browseLiked') },
  { value: 'playlists' as const, label: t('music.browsePlaylists') },
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
  // date : année desc ; sans année → fin de liste (ordre relatif conservé)
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
/** Recherche simple : toutes les sorties dans une seule rangée, albums d'abord. */
const releasesSimple = computed(() => withoutExplicit([...searchAlbums.value, ...searchSingles.value, ...searchCompilations.value]).slice(0, SIMPLE_MAX))
const artistsSimple = computed(() => searchArtists.value.slice(0, SIMPLE_MAX))
const tracksSimple = computed(() => withoutExplicit(searchTracks.value).slice(0, SIMPLE_MAX))
const advancedSections = computed(() => [
  { key: 'artists', title: t('ytmusic.sectionArtists'), sort: sortArtists, options: sortOptionsName.value, items: artistsView.value.map((a) => ({ id: a.id, art: a.artUrl, title: a.name, meta: a.subscribers ?? '', open: () => openArtist(a) })), round: true, icon: 'person' as const },
  { key: 'albums', title: t('ytmusic.sectionAlbums'), sort: sortAlbums, options: sortOptionsDated.value, items: albumsView.value.map(releaseItem), round: false, icon: 'disc' as const },
  { key: 'singles', title: t('ytmusic.sectionEp'), sort: sortSingles, options: sortOptionsDated.value, items: singlesView.value.map(releaseItem), round: false, icon: 'disc' as const },
  { key: 'compilations', title: t('ytmusic.sectionCompil'), sort: sortCompilations, options: sortOptionsDated.value, items: compilationsView.value.map(releaseItem), round: false, icon: 'disc' as const },
].filter((s) => s.items.length))
function releaseItem(al: YtmusicAlbum) {
  return { id: al.id, art: al.artUrl, title: al.title, meta: albumMeta(al), year: al.year ?? null, explicit: !!al.explicit, open: () => openAlbum(al) }
}

const searchEmpty = computed(() =>
  searched.value && !browse.value && !busy.value
  && searchArtists.value.length === 0 && searchAlbums.value.length === 0 && searchSingles.value.length === 0
  && searchCompilations.value.length === 0 && searchTracks.value.length === 0)

// ---- sessions d'écoute ---------------------------------------------------------------------------
/** Tous les lecteurs de la maison : on voit ce qui joue partout, même là où on ne peut rien envoyer. */
const players = computed(() => devices.list.filter((e: DeviceEntry) => e.state.kind === 'media_player'))
const canReceive = (e: DeviceEntry) => e.state.available && e.descriptor.capabilities.includes('play_url')
const sessionId = useLocalStorage('kasbah.music.session', '')
/** Même clé que l'étoile du panneau Écoute : le lecteur par défaut est le premier favori. */
const favoriteSessions = useLocalStorage<string[]>('kasbah.music.favoriteSessions', [])
const selected = computed<DeviceEntry | null>(() => players.value.find((e) => e.descriptor.id === sessionId.value) ?? null)
const selectedName = computed(() => selected.value ? (house.houseDeviceFor(selected.value.descriptor.id)?.name ?? selected.value.descriptor.name) : '')
/** Les lecteurs qui jouent en ce moment un flux servi par Kasbah, par id plugin — transférables, déplaçables. */
const ourSessions = ref<Map<string, YtmusicSession>>(new Map())
const selectedSession = computed(() => (selected.value ? ourSessions.value.get(selected.value.descriptor.id) ?? null : null))
/** Titre en cours d'envoi : la barre le montre tout de suite, avec un sablier, le temps que l'enceinte suive. */
const pendingTrack = ref<YtmusicTrack | null>(null)
const transferMode = ref(false)
const transferBusyId = ref<string | null>(null)
const canTransfer = computed(() => {
  const s = selected.value
  if (!s || s.state.kind !== 'media_player') return false
  if (!ourSessions.value.has(s.descriptor.id)) return false
  if (s.state.playback !== 'playing' && s.state.playback !== 'paused') return false
  return players.value.some((e) => e.descriptor.id !== s.descriptor.id && canReceive(e))
})

watch(players, (list) => {
  // Ne pas écraser le choix persisté tant que l'inventaire n'est pas arrivé ; sinon le premier
  // FAVORI qui sait recevoir (ordre alphabétique, comme le panneau), puis le premier lecteur qui sait
  // recevoir, à défaut le premier tout court.
  if (!list.length) return
  if (!sessionId.value || !list.some((e) => e.descriptor.id === sessionId.value)) {
    const byName = [...list].sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name, undefined, { sensitivity: 'base' }))
    const fav = byName.find((e) => canReceive(e) && favoriteSessions.value.includes(e.descriptor.id))
    sessionId.value = (fav ?? byName.find(canReceive) ?? byName[0]!).descriptor.id
  }
}, { immediate: true })

async function refreshSessions(): Promise<void> {
  try {
    const r = await getTransport().ytmusicSessions()
    ourSessions.value = new Map(r.sessions.map((s) => [s.deviceId, s]))
  } catch { /* plugin absent ou serveur muet : rien à transférer */ }
}
let sessionsTicker: ReturnType<typeof setInterval> | undefined

function selectSession(id: string) {
  sessionId.value = id
}
/** Voir le lecteur dans la maison 3D. Naviguer d'abord, sélectionner ensuite (HomeView sous keep-alive, cf. 6_1). */
async function locate(id: string) {
  await router.push({ name: 'home' }).catch(() => { /* navigation redondante */ })
  house.selectDevice(house.houseDeviceFor(id)?.id ?? id)
}
function barCommand(cmd: CommandInput) {
  if (!selected.value) return
  void devices.sendCommand(selected.value.descriptor.id, cmd).then(() => {
    if (cmd.type === 'media_player.stop') void refreshSessions()
  })
}
// Pas de toast de succès ici ni au lancement d'un titre : la barre et le panneau montrent déjà le
// résultat, et le toast passait par-dessus le lecteur. Les erreurs, elles, restent des toasts.
async function transferTo(toId: string) {
  const from = selected.value
  if (!from) return
  transferBusyId.value = toId
  try {
    await getTransport().ytmusicTransfer({ fromDeviceId: from.descriptor.id, toDeviceId: toId })
    sessionId.value = toId
    transferMode.value = false
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally {
    transferBusyId.value = null
    void refreshSessions()
  }
}
/** Se placer dans le morceau : notre flux se relance à la position (le proxy n'est pas « seekable ») ; sinon la commande du lecteur. */
async function barSeek(positionS: number) {
  const s = selected.value
  if (!s) return
  if (selectedSession.value) {
    try { await getTransport().ytmusicSeek({ deviceId: s.descriptor.id, positionS }) }
    catch (err) { fail(err) }
    finally { void refreshSessions() }
  } else {
    void devices.sendCommand(s.descriptor.id, { type: 'media_player.seek', positionS: Math.round(positionS) })
  }
}

// ---- liaison et chargement ---------------------------------------------------------------------
async function refreshLink(): Promise<void> {
  // L'inventaire plugins n'est chargé que dans Réglages — le charger ici aussi.
  if (!plugins.loaded) await plugins.load()
  const plug = plugins.byId.ytmusic
  if (!plug?.enabled) {
    linked.value = false
    return
  }
  try {
    const s = await getTransport().ytmusicStatus()
    linked.value = s.linked && !s.cookieExpired
  } catch {
    // Fallback santé (peut être stale) si /status échoue.
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
onBeforeUnmount(() => clearInterval(sessionsTicker))

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
async function runSearch() {
  const q = query.value.trim()
  if (!q) return
  busy.value = true
  browse.value = null
  searched.value = true
  rememberQuery(q)
  try {
    const result = await getTransport().ytmusicSearch(q)
    searchArtists.value = result.artists
    searchAlbums.value = result.albums
    searchSingles.value = result.singles
    searchCompilations.value = result.compilations
    searchTracks.value = result.tracks
  } catch (err) { fail(err) }
  finally { busy.value = false }
}
/** Effacer la recherche : retour au parcours. */
async function clearSearch() {
  query.value = ''
  searched.value = false
  browse.value = null
  clearSearchResults()
  await loadBrowseTab()
}

async function loadBrowseTab(): Promise<void> {
  browse.value = null
  if (browseTab.value === 'liked') await loadLiked()
  else if (browseTab.value === 'playlists') await loadPlaylists()
  else tracks.value = []
}
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
async function openDetail(next: Browse, load: () => Promise<{ tracks: YtmusicTrack[] }>) {
  busy.value = true
  browse.value = next
  try { tracks.value = (await load()).tracks }
  catch (err) { fail(err) }
  finally { busy.value = false }
}
const openPlaylist = (pl: YtmusicPlaylist) => openDetail({ kind: 'playlist', id: pl.id, title: pl.title }, () => getTransport().ytmusicPlaylist(pl.id))
const openAlbum = (al: YtmusicAlbum) => openDetail({ kind: 'album', id: al.id, title: al.title }, () => getTransport().ytmusicAlbum(al.id))
const openArtist = (ar: YtmusicArtist) => openDetail({ kind: 'artist', id: ar.id, title: ar.name }, () => getTransport().ytmusicArtist(ar.id))
function backFromDetail() {
  browse.value = null
  tracks.value = []
  if (!searched.value) void loadBrowseTab()
}

async function play(track: YtmusicTrack) {
  const target = selected.value
  if (!target || !canReceive(target)) {
    notifications.error(t('ytmusic.noPlayer'))
    return
  }
  rememberPlay(track)
  playingId.value = track.videoId
  pendingTrack.value = track
  try {
    await getTransport().ytmusicPlay({
      videoId: track.videoId,
      deviceId: target.descriptor.id,
      title: track.title,
      ...(track.artists.length ? { artist: track.artists.join(', ') } : {}),
      ...(track.artUrl ? { artUrl: track.artUrl } : {}),
      ...(track.durationS ? { durationS: track.durationS } : {}),
    })
    void refreshSessions()
  } catch (err) { fail(err) }
  finally {
    playingId.value = null
    pendingTrack.value = null
  }
}

watch(browseTab, () => { if (linked.value && !searched.value) void loadBrowseTab() })
const playTarget = computed(() => !!selected.value && canReceive(selected.value))
</script>

<template>
  <div class="page">
    <PageHeader>
      <!-- sources : une pastille par service relié, prête pour les suivantes -->
      <div class="sources" :aria-label="$t('music.sources')">
        <span v-for="s in sources" :key="s.id" class="pill source" data-on="1" :title="s.linked ? $t('music.sourceLinked') : $t('music.sourceUnlinked')">
          <StrokeIcon name="music" :size="16" />
          <span>{{ s.label }}</span>
          <span class="source__dot" :data-linked="s.linked ? '1' : '0'" />
        </span>
      </div>
    </PageHeader>

    <div class="body">
      <section class="main">
        <form class="search" @submit.prevent="runSearch">
          <div class="search__field">
            <StrokeIcon name="search" :size="18" class="search__icon" />
            <input v-model="query" type="search" class="search__input" :placeholder="$t('music.searchPlaceholder')" :disabled="busy || !linked" :aria-label="$t('music.search')" />
            <button type="button" class="search__clear" :class="{ 'is-hidden': !query }" :aria-label="$t('music.clear')" :tabindex="query ? 0 : -1" @click="clearSearch">
              <StrokeIcon name="close" :size="14" />
            </button>
          </div>
          <button type="button" class="pill" :data-on="advanced ? '1' : '0'" :title="$t('music.advancedHint')" @click="advanced = !advanced">
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

        <div class="main__scroll">
          <div v-if="!statusReady" class="muted empty">{{ $t('common.loading') }}</div>
          <div v-else-if="!linked" class="card card--soft empty muted">{{ $t('ytmusic.needCookie') }}</div>
          <template v-else>
            <!-- détail : album, artiste, playlist -->
            <template v-if="browse">
              <div class="back-row">
                <button type="button" class="pill" @click="backFromDetail">
                  <StrokeIcon name="back" :size="16" />
                  <span>{{ $t('common.back') }}</span>
                </button>
                <span class="back-row__title">{{ browse.title }}</span>
              </div>
              <div class="list">
                <MusicItemRow v-for="tr in browseTracksView" :key="tr.videoId" action="play" :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                              :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null" :selected="recentPlays[0]?.videoId === tr.videoId"
                              :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')" @play="play(tr)" />
                <p v-if="!busy && browseTracksView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </div>
            </template>

            <!-- recherche simple : une rangée de tuiles par section -->
            <template v-else-if="searched && !advanced">
              <section v-if="artistsSimple.length" class="shelf">
                <div class="shelf__head"><h2 class="section-label">{{ $t('ytmusic.sectionArtists') }}</h2><button type="button" class="see-all" @click="advanced = true">{{ $t('music.seeAll') }}</button></div>
                <div class="shelf__row">
                  <MusicTile v-for="ar in artistsSimple" :key="ar.id" action="open" round icon="person" :art="ar.artUrl" :title="ar.name" :meta="ar.subscribers ?? ''" @open="openArtist(ar)" />
                </div>
              </section>
              <section v-if="releasesSimple.length" class="shelf">
                <div class="shelf__head"><h2 class="section-label">{{ $t('ytmusic.sectionAlbums') }}</h2><button type="button" class="see-all" @click="advanced = true">{{ $t('music.seeAll') }}</button></div>
                <div class="shelf__row">
                  <MusicTile v-for="al in releasesSimple" :key="al.id" action="open" icon="disc" :art="al.artUrl" :title="al.title" :meta="[albumMeta(al), al.year].filter(Boolean).join(' · ')" @open="openAlbum(al)" />
                </div>
              </section>
              <section v-if="tracksSimple.length" class="shelf">
                <div class="shelf__head"><h2 class="section-label">{{ $t('ytmusic.sectionTracks') }}</h2><button type="button" class="see-all" @click="advanced = true">{{ $t('music.seeAll') }}</button></div>
                <div class="shelf__row">
                  <MusicTile v-for="tr in tracksSimple" :key="tr.videoId" action="play" :art="tr.artUrl" :title="tr.title" :meta="trackMeta(tr)"
                             :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')" @play="play(tr)" />
                </div>
              </section>
              <p v-if="searchEmpty" class="muted empty">{{ $t('ytmusic.empty') }}</p>
            </template>

            <!-- recherche avancée : colonnes classées avec tris -->
            <div v-else-if="searched" class="search-grid">
              <section v-for="sec in advancedSections" :key="sec.key" class="section">
                <div class="section__head">
                  <h2 class="section-label">{{ sec.title }}</h2>
                  <Segmented v-model="sec.sort.value" dense fill :options="sec.options" :label="$t('ytmusic.sortLabel')" />
                </div>
                <div class="list">
                  <MusicItemRow v-for="it in sec.items" :key="it.id" action="open" :round="sec.round" :icon="sec.icon" :art="it.art" :title="it.title"
                                :explicit="'explicit' in it && it.explicit" :meta="it.meta" :year="'year' in it ? it.year : null" @open="it.open()" />
                </div>
              </section>
              <section v-if="tracksView.length" class="section">
                <div class="section__head">
                  <h2 class="section-label">{{ $t('ytmusic.sectionTracks') }}</h2>
                  <Segmented v-model="sortTracks" dense fill :options="sortOptionsDated" :label="$t('ytmusic.sortLabel')" />
                </div>
                <div class="list">
                  <MusicItemRow v-for="tr in tracksView" :key="tr.videoId" action="play" :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                                :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null" :selected="recentPlays[0]?.videoId === tr.videoId"
                                :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')" @play="play(tr)" />
                </div>
              </section>
              <p v-if="searchEmpty" class="muted empty">{{ $t('ytmusic.empty') }}</p>
            </div>

            <!-- parcourir : récents, likes, playlists -->
            <template v-else>
              <div class="browse-head">
                <Segmented v-model="browseTab" dense :options="browseOptions" :label="$t('music.browse')" />
              </div>
              <div v-if="browseTab === 'recent'" class="list">
                <MusicItemRow v-for="tr in recentPlays" :key="tr.videoId" action="play" :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                              :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null"
                              :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')" @play="play(tr)" />
                <p v-if="recentPlays.length === 0" class="muted empty">{{ $t('music.noRecent') }}</p>
              </div>
              <div v-else-if="browseTab === 'liked'" class="list">
                <MusicItemRow v-for="tr in browseTracksView" :key="tr.videoId" action="play" :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                              :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null"
                              :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')" @play="play(tr)" />
                <p v-if="!busy && browseTracksView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </div>
              <div v-else class="list">
                <MusicItemRow v-for="pl in playlists" :key="pl.id" action="open" icon="list" :art="pl.artUrl" :title="pl.title"
                              :meta="pl.trackCount != null ? $t('ytmusic.tracks', { n: pl.trackCount }, pl.trackCount) : ''" @open="openPlaylist(pl)" />
                <p v-if="!busy && playlists.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </div>
            </template>
          </template>
        </div>
      </section>

      <ListeningSessions :players="players" :selected-id="sessionId || null" :transfer-mode="transferMode" :transfer-busy-id="transferBusyId"
                         :pending-id="pendingTrack && selected ? selected.descriptor.id : null"
                         @select="selectSession" @transfer-to="transferTo" @locate="locate"
                         @command="(id, cmd) => devices.sendCommand(id, cmd)" />
    </div>

    <MusicPlayerBar :entry="selected" :name="selectedName" :session="selectedSession" :pending="pendingTrack"
                    :transfer-mode="transferMode" :can-transfer="canTransfer" :transfer-busy="!!transferBusyId"
                    @command="barCommand" @seek="barSeek" @transfer="transferMode = true" @cancel-transfer="transferMode = false" />
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.sources { display: flex; gap: 8px; align-items: center; }
.source { height: 36px; font-size: 13px; white-space: nowrap; }
.source__dot { width: 8px; height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--on-accent) 45%, transparent); }
.source__dot[data-linked='1'] { background: var(--on-accent); }

.body {
  flex: 1 1 auto; min-height: 0;
  display: grid; grid-template-columns: minmax(0, 1fr) var(--aside-w); gap: 16px;
  padding: 0 24px 16px;
}
.main { display: flex; flex-direction: column; min-height: 0; min-width: 0; gap: 10px; }
.main__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }

/* la recherche : le geste premier de la page, d'où sa taille */
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
.small { font-size: 12px; }

.browse-head { display: flex; align-items: center; gap: 12px; margin: 4px 0 10px; }
.back-row { display: flex; align-items: center; gap: 12px; margin: 4px 0 10px; }
.back-row__title { min-width: 0; font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* recherche simple : rangées défilantes de tuiles */
.shelf { margin: 4px 0 18px; }
.shelf__head { display: flex; align-items: baseline; justify-content: space-between; margin: 0 4px 8px; }
.see-all { border: 0; background: transparent; color: var(--accent); font: inherit; font-size: 13px; font-weight: 500; padding: 0; }
.shelf__row { display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x proximity; padding: 2px 4px 8px; }
.shelf__row::-webkit-scrollbar { height: 6px; }
.shelf__row::-webkit-scrollbar-thumb { background: var(--line); border-radius: 999px; }

/* recherche avancée : colonnes dès qu'il y a la place */
.search-grid { display: grid; gap: 18px; align-items: start; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.section { min-width: 0; }
.section__head { display: flex; flex-direction: column; align-items: stretch; gap: 6px; margin: 0 0 6px; }
.section-label { margin: 0 4px; }
.list { display: grid; gap: 2px; }
.empty { padding: 16px 4px; }
</style>
