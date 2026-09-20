<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../api'
import type { YtmusicAlbum, YtmusicArtist, YtmusicPlaylist, YtmusicTrack } from '../api/transport'
import PageHeader from '../components/layout/PageHeader.vue'
import ArtThumb from '../components/ui/ArtThumb.vue'
import PlayButton from '../components/ui/PlayButton.vue'
import Segmented from '../components/ui/Segmented.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'

// Vue YouTube Music (non officiel) : recherche + likes + playlists → play_url sur Cast/Sonos.
// Pas de redesign de Médias : le play_url manuel reste ailleurs.

defineOptions({ name: 'YtmusicView' })

type YtmTab = 'search' | 'liked' | 'playlists'
type Browse =
  | { kind: 'playlist'; id: string; title: string }
  | { kind: 'album'; id: string; title: string }
  | { kind: 'artist'; id: string; title: string }
/** Ordre API InnerTube = pertinence. */
type SectionSort = 'relevance' | 'alpha' | 'date'

const { t } = useI18n()
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()

const tab = useLocalStorage<YtmTab>('kasbah.ytmusic.tab', 'search')
const query = useLocalStorage('kasbah.ytmusic.query', '')
/** Derniers titres joués (pastilles). */
const recentPlays = useLocalStorage<YtmusicTrack[]>('kasbah.ytmusic.recentPlays', [])
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
const deviceId = useLocalStorage('kasbah.ytmusic.deviceId', '')
/** false tant que le statut cookie n'a pas été lu — éviter le faux « manquant ». */
const statusReady = ref(false)
const linked = ref(false)

const sortArtists = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.artists', 'relevance')
const sortAlbums = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.albums', 'relevance')
const sortSingles = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.singles', 'relevance')
const sortCompilations = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.compilations', 'relevance')
const sortTracks = useLocalStorage<SectionSort>('kasbah.ytmusic.sort.tracks', 'relevance')
/** Masquer albums / EP / titres marqués explicit. */
const hideExplicit = useLocalStorage('kasbah.ytmusic.hideExplicit', false)
/** Dernières requêtes (pastilles sous la barre). */
const recentQueries = useLocalStorage<string[]>('kasbah.ytmusic.recentQueries', [])
const RECENT_MAX = 10
const RECENT_PLAYS_MAX = 10

const selectedVideoId = computed(() => recentPlays.value[0]?.videoId ?? null)

const tabOptions = computed(() => [
  { value: 'search' as const, label: t('ytmusic.tabSearch') },
  { value: 'liked' as const, label: t('ytmusic.tabLiked') },
  { value: 'playlists' as const, label: t('ytmusic.tabPlaylists') },
])

const sortOptionsName = computed(() => [
  { value: 'relevance' as const, label: t('ytmusic.sortRelevance') },
  { value: 'alpha' as const, label: t('ytmusic.sortAlpha') },
])
const sortOptionsDated = computed(() => [
  ...sortOptionsName.value,
  { value: 'date' as const, label: t('ytmusic.sortDate') },
])

function sortedBy<T>(
  items: T[],
  mode: SectionSort,
  nameOf: (item: T) => string,
  dateOf?: (item: T) => string | null | undefined,
): T[] {
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
  if (!hideExplicit.value) return items
  return items.filter((i) => !i.explicit)
}

const artistsView = computed(() =>
  sortedBy(searchArtists.value, sortArtists.value, (a) => a.name))
const albumsView = computed(() =>
  sortedBy(withoutExplicit(searchAlbums.value), sortAlbums.value, (a) => a.title, (a) => a.year))
const singlesView = computed(() =>
  sortedBy(withoutExplicit(searchSingles.value), sortSingles.value, (a) => a.title, (a) => a.year))
const compilationsView = computed(() =>
  sortedBy(withoutExplicit(searchCompilations.value), sortCompilations.value, (a) => a.title, (a) => a.year))
const tracksView = computed(() =>
  sortedBy(withoutExplicit(searchTracks.value), sortTracks.value, (a) => a.title, (a) => a.year))
const browseTracksView = computed(() => withoutExplicit(tracks.value))

const players = computed(() => devices.list.filter((e: DeviceEntry) =>
  e.state.kind === 'media_player'
  && e.state.available
  && e.descriptor.capabilities.includes('play_url')))

const searchEmpty = computed(() =>
  tab.value === 'search'
  && !browse.value
  && !busy.value
  && !!query.value.trim()
  && searchArtists.value.length === 0
  && searchAlbums.value.length === 0
  && searchSingles.value.length === 0
  && searchCompilations.value.length === 0
  && searchTracks.value.length === 0)

watch(players, (list) => {
  // Ne pas écraser le choix persisté tant que l'inventaire n'est pas arrivé.
  if (!list.length) return
  if (!deviceId.value || !list.some((e) => e.descriptor.id === deviceId.value)) {
    deviceId.value = list[0]!.descriptor.id
  }
}, { immediate: true })

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

/** Charge le contenu de l'onglet courant (arrivée sur la page ou changement d'onglet). */
async function loadTabContent(): Promise<void> {
  if (tab.value === 'liked') await loadLiked()
  else if (tab.value === 'playlists') await loadPlaylists()
  else if (query.value.trim()) await runSearch()
}

onMounted(async () => {
  try { await refreshLink() }
  finally { statusReady.value = true }
  if (linked.value) await loadTabContent()
})

function fmtDur(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return ''
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/** Sous-titre : artiste · album (durée et année à droite, hors ellipsis). */
function trackMeta(tr: YtmusicTrack): string {
  const parts: string[] = []
  if (tr.artists.length) parts.push(tr.artists.join(', '))
  if (tr.album) parts.push(tr.album)
  return parts.join(' · ')
}

function albumMeta(al: YtmusicAlbum): string {
  return al.artists.length ? al.artists.join(', ') : ''
}

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
  // Déjà en tête : rien. Déjà présent : remonter sans dropper le 10ᵉ.
  if (idx === 0) return
  if (idx > 0) {
    const copy = [...cur]
    const [hit] = copy.splice(idx, 1)
    recentQueries.value = [hit!, ...copy]
    return
  }
  recentQueries.value = [trimmed, ...cur].slice(0, RECENT_MAX)
}

function removeRecent(q: string) {
  recentQueries.value = recentQueries.value.filter((x) => x !== q)
}

function rememberPlay(track: YtmusicTrack) {
  const cur = recentPlays.value
  const idx = cur.findIndex((t) => t.videoId === track.videoId)
  if (idx === 0) {
    recentPlays.value = [track, ...cur.slice(1)]
    return
  }
  if (idx > 0) {
    const copy = [...cur]
    copy.splice(idx, 1)
    recentPlays.value = [track, ...copy]
    return
  }
  recentPlays.value = [track, ...cur].slice(0, RECENT_PLAYS_MAX)
}

function removeRecentPlay(videoId: string) {
  recentPlays.value = recentPlays.value.filter((t) => t.videoId !== videoId)
}

async function runRecent(q: string) {
  tab.value = 'search'
  browse.value = null
  query.value = q
  await runSearch()
}

async function runSearch() {
  const q = query.value.trim()
  if (!q) return
  busy.value = true
  browse.value = null
  rememberQuery(q)
  try {
    const result = await getTransport().ytmusicSearch(q)
    searchArtists.value = result.artists
    searchAlbums.value = result.albums
    searchSingles.value = result.singles
    searchCompilations.value = result.compilations
    searchTracks.value = result.tracks
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function loadLiked() {
  busy.value = true
  browse.value = null
  clearSearchResults()
  try {
    tracks.value = (await getTransport().ytmusicLiked()).tracks
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function loadPlaylists() {
  busy.value = true
  browse.value = null
  clearSearchResults()
  tracks.value = []
  try {
    playlists.value = (await getTransport().ytmusicPlaylists()).playlists
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function openPlaylist(pl: YtmusicPlaylist) {
  busy.value = true
  browse.value = { kind: 'playlist', id: pl.id, title: pl.title }
  try {
    tracks.value = (await getTransport().ytmusicPlaylist(pl.id)).tracks
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function openAlbum(al: YtmusicAlbum) {
  busy.value = true
  browse.value = { kind: 'album', id: al.id, title: al.title }
  try {
    tracks.value = (await getTransport().ytmusicAlbum(al.id)).tracks
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function openArtist(ar: YtmusicArtist) {
  busy.value = true
  browse.value = { kind: 'artist', id: ar.id, title: ar.name }
  try {
    tracks.value = (await getTransport().ytmusicArtist(ar.id)).tracks
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

function backFromBrowse() {
  browse.value = null
  tracks.value = []
  if (tab.value === 'playlists') void loadPlaylists()
}

async function play(track: YtmusicTrack) {
  if (!deviceId.value) {
    notifications.error(t('ytmusic.noPlayer'))
    return
  }
  rememberPlay(track)
  playingId.value = track.videoId
  try {
    await getTransport().ytmusicPlay({
      videoId: track.videoId,
      deviceId: deviceId.value,
      title: track.title,
      ...(track.artists.length ? { artist: track.artists.join(', ') } : {}),
      ...(track.artUrl ? { artUrl: track.artUrl } : {}),
    })
    notifications.success(t('ytmusic.playing', { title: track.title }))
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { playingId.value = null }
}

watch(tab, (v) => {
  browse.value = null
  tracks.value = []
  if (v === 'liked') void loadLiked()
  else if (v === 'playlists') void loadPlaylists()
  else {
    playlists.value = []
    // Onglet recherche : relancer si le champ a du texte (ex. retour depuis Likes).
    if (query.value.trim()) void runSearch()
    else clearSearchResults()
  }
})
</script>

<template>
  <div class="page">
    <PageHeader>
      <div class="muted count">{{ $t('ytmusic.unofficial') }}</div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="!statusReady" class="muted empty">{{ $t('common.loading') }}</div>
      <div v-else-if="!linked" class="card card--soft empty muted">{{ $t('ytmusic.needCookie') }}</div>
      <template v-else>
        <div class="toolbar">
          <Segmented v-model="tab" dense :options="tabOptions" :label="$t('ytmusic.tabs')" />
          <label class="player">
            <span class="muted small">{{ $t('ytmusic.player') }}</span>
            <select v-model="deviceId" class="player__select">
              <option v-if="players.length === 0" value="" disabled>{{ $t('ytmusic.noPlayer') }}</option>
              <option v-for="p in players" :key="p.descriptor.id" :value="p.descriptor.id">{{ p.descriptor.name }}</option>
            </select>
          </label>
          <label class="hide-explicit">
            <v-switch v-model="hideExplicit" density="compact" hide-details color="primary" />
            <span class="muted small">{{ $t('ytmusic.hideExplicit') }}</span>
          </label>
        </div>

        <form v-if="tab === 'search' && !browse" class="search" @submit.prevent="runSearch">
          <input v-model="query" type="search" class="search__input" :placeholder="$t('ytmusic.searchPlaceholder')" :disabled="busy" />
          <button type="submit" class="pill" data-on="1" :disabled="busy || !query.trim()">{{ $t('ytmusic.search') }}</button>
        </form>

        <div class="recent-stack">
          <div class="recent">
            <span class="recent__label muted small">{{ $t('ytmusic.recent') }}</span>
            <div class="recent__chips">
              <div v-for="rq in recentQueries" :key="rq" class="recent-chip">
                <button type="button" class="recent-chip__go" :disabled="busy" @click="runRecent(rq)">{{ rq }}</button>
                <button
                  type="button"
                  class="recent-chip__x"
                  :aria-label="$t('ytmusic.recentRemove')"
                  :disabled="busy"
                  @click="removeRecent(rq)"
                >
                  <StrokeIcon name="close" :size="12" />
                </button>
              </div>
            </div>
          </div>
          <div class="recent">
            <span class="recent__label muted small">{{ $t('ytmusic.lastPlayed') }}</span>
            <div class="recent__chips">
              <div v-for="tr in recentPlays" :key="tr.videoId" class="recent-chip">
                <button type="button" class="recent-chip__go" :disabled="!!playingId" @click="play(tr)">{{ tr.title }}</button>
                <button
                  type="button"
                  class="recent-chip__x"
                  :aria-label="$t('ytmusic.lastPlayedRemove')"
                  :disabled="!!playingId"
                  @click="removeRecentPlay(tr.videoId)"
                >
                  <StrokeIcon name="close" :size="12" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="tab === 'playlists' && !browse" class="list">
          <button v-for="pl in playlists" :key="pl.id" type="button" class="row" @click="openPlaylist(pl)">
            <ArtThumb :src="pl.artUrl" icon="list" />
            <div class="min0">
              <div class="title">{{ pl.title }}</div>
              <div v-if="pl.trackCount != null" class="muted small">{{ $t('ytmusic.tracks', { n: pl.trackCount }, pl.trackCount) }}</div>
            </div>
            <StrokeIcon name="chevron" :size="16" class="chev" />
          </button>
          <p v-if="!busy && playlists.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
        </div>

        <div v-if="browse" class="back-row">
          <button type="button" class="pill" @click="backFromBrowse">{{
            browse.kind === 'playlist' ? $t('ytmusic.backPlaylists')
            : browse.kind === 'album' ? $t('ytmusic.backAlbums')
            : $t('ytmusic.backArtists')
          }}</button>
          <span class="title">{{ browse.title }}</span>
        </div>

        <!-- Recherche classée : colonnes dès qu'il y a la place -->
        <div v-if="tab === 'search' && !browse" class="search-grid">
          <section v-if="artistsView.length" class="section">
            <div class="section__head">
              <h2 class="section__title">{{ $t('ytmusic.sectionArtists') }}</h2>
              <Segmented v-model="sortArtists" dense fill :options="sortOptionsName" :label="$t('ytmusic.sortLabel')" />
            </div>
            <div class="list">
              <button v-for="ar in artistsView" :key="ar.id" type="button" class="row" @click="openArtist(ar)">
                <ArtThumb :src="ar.artUrl" round icon="person" />
                <div class="min0">
                  <div class="title">{{ ar.name }}</div>
                  <div v-if="ar.subscribers" class="muted small meta">{{ ar.subscribers }}</div>
                </div>
                <StrokeIcon name="chevron" :size="16" class="chev" />
              </button>
            </div>
          </section>

          <section v-if="albumsView.length" class="section">
            <div class="section__head">
              <h2 class="section__title">{{ $t('ytmusic.sectionAlbums') }}</h2>
              <Segmented v-model="sortAlbums" dense fill :options="sortOptionsDated" :label="$t('ytmusic.sortLabel')" />
            </div>
            <div class="list">
              <button v-for="al in albumsView" :key="al.id" type="button" class="row" @click="openAlbum(al)">
                <ArtThumb :src="al.artUrl" icon="disc" />
                <div class="min0">
                  <div class="line1">
                    <div class="title">{{ al.title }}</div>
                    <span v-if="al.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
                  </div>
                  <div class="line2">
                    <div v-if="albumMeta(al)" class="muted small meta">{{ albumMeta(al) }}</div>
                    <span v-else class="meta" />
                    <span class="year muted small">{{ al.year || '\u00a0' }}</span>
                  </div>
                </div>
                <StrokeIcon name="chevron" :size="16" class="chev" />
              </button>
            </div>
          </section>

          <section v-if="singlesView.length" class="section">
            <div class="section__head">
              <h2 class="section__title">{{ $t('ytmusic.sectionEp') }}</h2>
              <Segmented v-model="sortSingles" dense fill :options="sortOptionsDated" :label="$t('ytmusic.sortLabel')" />
            </div>
            <div class="list">
              <button v-for="al in singlesView" :key="al.id" type="button" class="row" @click="openAlbum(al)">
                <ArtThumb :src="al.artUrl" icon="disc" />
                <div class="min0">
                  <div class="line1">
                    <div class="title">{{ al.title }}</div>
                    <span v-if="al.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
                  </div>
                  <div class="line2">
                    <div v-if="albumMeta(al)" class="muted small meta">{{ albumMeta(al) }}</div>
                    <span v-else class="meta" />
                    <span class="year muted small">{{ al.year || '\u00a0' }}</span>
                  </div>
                </div>
                <StrokeIcon name="chevron" :size="16" class="chev" />
              </button>
            </div>
          </section>

          <section v-if="compilationsView.length" class="section">
            <div class="section__head">
              <h2 class="section__title">{{ $t('ytmusic.sectionCompil') }}</h2>
              <Segmented v-model="sortCompilations" dense fill :options="sortOptionsDated" :label="$t('ytmusic.sortLabel')" />
            </div>
            <div class="list">
              <button v-for="al in compilationsView" :key="al.id" type="button" class="row" @click="openAlbum(al)">
                <ArtThumb :src="al.artUrl" icon="disc" />
                <div class="min0">
                  <div class="line1">
                    <div class="title">{{ al.title }}</div>
                    <span v-if="al.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
                  </div>
                  <div class="line2">
                    <div v-if="albumMeta(al)" class="muted small meta">{{ albumMeta(al) }}</div>
                    <span v-else class="meta" />
                    <span class="year muted small">{{ al.year || '\u00a0' }}</span>
                  </div>
                </div>
                <StrokeIcon name="chevron" :size="16" class="chev" />
              </button>
            </div>
          </section>

          <section v-if="tracksView.length" class="section">
            <div class="section__head">
              <h2 class="section__title">{{ $t('ytmusic.sectionTracks') }}</h2>
              <Segmented v-model="sortTracks" dense fill :options="sortOptionsDated" :label="$t('ytmusic.sortLabel')" />
            </div>
            <div class="list">
              <div v-for="tr in tracksView" :key="tr.videoId" class="row" :data-selected="selectedVideoId === tr.videoId ? '1' : '0'">
                <ArtThumb :src="tr.artUrl" icon="music" />
                <div class="min0">
                  <div class="line1">
                    <div class="title">{{ tr.title }}</div>
                    <span v-if="tr.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
                  </div>
                  <div class="line2">
                    <div class="muted small meta">{{ trackMeta(tr) }}</div>
                    <span class="dur muted small">{{ fmtDur(tr.durationS) || '\u00a0' }}</span>
                    <span class="year muted small">{{ tr.year || '\u00a0' }}</span>
                  </div>
                </div>
                <PlayButton
                  :disabled="!deviceId"
                  :busy="playingId === tr.videoId"
                  :label="playingId === tr.videoId ? $t('ytmusic.starting') : $t('ytmusic.play')"
                  @click="play(tr)"
                />
              </div>
            </div>
          </section>

          <p v-if="searchEmpty" class="muted empty">{{ $t('ytmusic.empty') }}</p>
        </div>

        <!-- Likes / détail album·artiste·playlist -->
        <div v-if="tab === 'liked' || browse" class="list">
          <div v-for="tr in browseTracksView" :key="tr.videoId" class="row" :data-selected="selectedVideoId === tr.videoId ? '1' : '0'">
            <ArtThumb :src="tr.artUrl" icon="music" />
            <div class="min0">
              <div class="line1">
                <div class="title">{{ tr.title }}</div>
                <span v-if="tr.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
              </div>
              <div class="line2">
                <div class="muted small meta">{{ trackMeta(tr) }}</div>
                <span class="dur muted small">{{ fmtDur(tr.durationS) || '\u00a0' }}</span>
                <span class="year muted small">{{ tr.year || '\u00a0' }}</span>
              </div>
            </div>
            <PlayButton
              :disabled="!deviceId"
              :busy="playingId === tr.videoId"
              :label="playingId === tr.videoId ? $t('ytmusic.starting') : $t('ytmusic.play')"
              @click="play(tr)"
            />
          </div>
          <p v-if="!busy && browseTracksView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 14px; }
.player { display: grid; gap: 4px; min-width: 180px; }
.hide-explicit {
  display: flex; align-items: center; gap: 8px;
  margin-left: auto; padding-bottom: 2px; cursor: pointer;
}
.player__select {
  padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px;
}
.search { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.search__input {
  flex: 1 1 200px; padding: 8px 12px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 14px;
}
.recent-stack {
  display: grid;
  gap: 6px;
  margin: 0 0 12px;
}
.recent {
  display: flex; flex-wrap: nowrap; align-items: center; gap: 8px;
  min-height: 32px; padding: 0 2px;
}
.recent__label {
  flex: 0 0 11.5rem;
  width: 11.5rem;
  white-space: nowrap;
}
.recent__chips {
  display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; flex: 1 1 auto;
  min-height: 28px; align-items: center;
}
.recent-chip {
  display: inline-flex; align-items: center; max-width: 220px;
  border: 1px solid var(--line); border-radius: 999px;
  background: var(--surface); overflow: hidden;
}
.recent-chip__go {
  min-width: 0; flex: 1 1 auto;
  padding: 4px 8px 4px 10px; border: 0; background: transparent;
  color: var(--text); font: inherit; font-size: 12px; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left;
}
.recent-chip__go:hover:not(:disabled) { background: color-mix(in srgb, var(--muted) 12%, transparent); }
.recent-chip__x {
  flex: 0 0 auto; display: grid; place-items: center;
  width: 26px; height: 26px; padding: 0; border: 0; border-left: 1px solid var(--line);
  background: transparent; color: var(--muted); cursor: pointer;
}
.recent-chip__x:hover:not(:disabled) { color: var(--text); background: color-mix(in srgb, var(--muted) 12%, transparent); }
.recent-chip__go:disabled, .recent-chip__x:disabled { opacity: .45; cursor: default; }
.search-grid {
  display: grid;
  gap: 18px;
  align-items: start;
  /* 5 colonnes ≈ 1790 px (4×18 de gap) ; plus étroit → moins de colonnes qui s'étalent. */
  max-width: 1790px;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  justify-content: stretch;
}
.section { margin-bottom: 0; min-width: 0; }
.section__head {
  display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  margin: 0 0 6px;
}
.section__title {
  font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--muted); margin: 0 4px;
}
.list { display: grid; gap: 2px; }
.row {
  display: flex; align-items: center; gap: 12px; padding: 8px 4px;
  border-bottom: 1px solid var(--line); background: transparent; border-left: 0; border-right: 0; border-top: 0;
  color: inherit; text-align: left; width: 100%; cursor: default; font: inherit;
  min-width: 0;
}
.row[data-selected='1'] { background: color-mix(in srgb, var(--accent) 8%, transparent); }
button.row { cursor: pointer; }
.min0 { min-width: 0; flex: 1 1 0; display: grid; gap: 2px; }
.title {
  min-width: 0;
  font-size: 14px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  line-height: 1.25;
}
.meta {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.line1 {
  display: flex; align-items: center; gap: 6px; min-width: 0;
}
.line1 .title {
  flex: 1 1 auto; min-width: 0;
}
.line2 {
  display: flex; align-items: baseline; gap: 8px; min-width: 0;
}
.line2 .meta {
  flex: 1 1 auto; min-width: 0;
}
.explicit {
  flex: 0 0 auto;
  display: inline-grid; place-items: center;
  min-width: 16px; height: 16px; padding: 0 3px;
  border-radius: 3px; border: 1px solid var(--muted);
  font-size: 10px; font-weight: 700; line-height: 1; color: var(--muted);
}
.dur, .year {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  line-height: 1.1;
}
.year { min-width: 2.75rem; text-align: right; }
.dur { text-align: right; }
.chev { color: var(--muted); flex: 0 0 auto; }
.back-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.back-row .title { min-width: 0; }
.empty { padding: 16px 4px; }
.small { font-size: 12px; }
.count { font-size: 13px; }
</style>
