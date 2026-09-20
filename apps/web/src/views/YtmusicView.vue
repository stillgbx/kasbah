<script setup lang="ts">
import { StorageSerializers, useLocalStorage } from '@vueuse/core'
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
const selectedMedia = useLocalStorage<YtmusicTrack | null>('kasbah.ytmusic.selectedMedia', null, {
  serializer: StorageSerializers.object,
})
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

const artistsView = computed(() =>
  sortedBy(searchArtists.value, sortArtists.value, (a) => a.name))
const albumsView = computed(() =>
  sortedBy(searchAlbums.value, sortAlbums.value, (a) => a.title, (a) => a.year))
const singlesView = computed(() =>
  sortedBy(searchSingles.value, sortSingles.value, (a) => a.title, (a) => a.year))
const compilationsView = computed(() =>
  sortedBy(searchCompilations.value, sortCompilations.value, (a) => a.title, (a) => a.year))
const tracksView = computed(() =>
  sortedBy(searchTracks.value, sortTracks.value, (a) => a.title, (a) => a.year))

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

/** Sous-titre : artiste · album · durée (pas de label discographique côté InnerTube). */
function trackMeta(tr: YtmusicTrack): string {
  const parts: string[] = []
  if (tr.artists.length) parts.push(tr.artists.join(', '))
  if (tr.album) parts.push(tr.album)
  if (tr.year) parts.push(tr.year)
  const dur = fmtDur(tr.durationS)
  if (dur) parts.push(dur)
  return parts.join(' · ')
}

function albumMeta(al: YtmusicAlbum): string {
  const parts: string[] = []
  if (al.artists.length) parts.push(al.artists.join(', '))
  if (al.year) parts.push(al.year)
  return parts.join(' · ')
}

function clearSearchResults() {
  searchArtists.value = []
  searchAlbums.value = []
  searchSingles.value = []
  searchCompilations.value = []
  searchTracks.value = []
}

async function runSearch() {
  const q = query.value.trim()
  if (!q) return
  busy.value = true
  browse.value = null
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
  selectedMedia.value = track
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
        </div>

        <form v-if="tab === 'search' && !browse" class="search" @submit.prevent="runSearch">
          <input v-model="query" type="search" class="search__input" :placeholder="$t('ytmusic.searchPlaceholder')" :disabled="busy" />
          <button type="submit" class="pill" data-on="1" :disabled="busy || !query.trim()">{{ $t('ytmusic.search') }}</button>
        </form>

        <div v-if="selectedMedia" class="selected muted small">
          <span class="selected__label">{{ $t('ytmusic.lastPlayed') }}</span>
          <span class="selected__title">{{ selectedMedia.title }}</span>
          <span v-if="trackMeta(selectedMedia)"> · {{ trackMeta(selectedMedia) }}</span>
        </div>

        <div v-if="tab === 'playlists' && !browse" class="list">
          <button v-for="pl in playlists" :key="pl.id" type="button" class="row" @click="openPlaylist(pl)">
            <ArtThumb :src="pl.artUrl" />
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
                <ArtThumb :src="ar.artUrl" round />
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
                <ArtThumb :src="al.artUrl" />
                <div class="min0">
                  <div class="title-row">
                    <span v-if="al.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
                    <div class="title">{{ al.title }}</div>
                  </div>
                  <div v-if="albumMeta(al)" class="muted small meta">{{ albumMeta(al) }}</div>
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
                <ArtThumb :src="al.artUrl" />
                <div class="min0">
                  <div class="title-row">
                    <span v-if="al.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
                    <div class="title">{{ al.title }}</div>
                  </div>
                  <div v-if="albumMeta(al)" class="muted small meta">{{ albumMeta(al) }}</div>
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
                <ArtThumb :src="al.artUrl" />
                <div class="min0">
                  <div class="title-row">
                    <span v-if="al.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
                    <div class="title">{{ al.title }}</div>
                  </div>
                  <div v-if="albumMeta(al)" class="muted small meta">{{ albumMeta(al) }}</div>
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
              <div v-for="tr in tracksView" :key="tr.videoId" class="row" :data-selected="selectedMedia?.videoId === tr.videoId ? '1' : '0'">
                <ArtThumb :src="tr.artUrl" />
                <div class="min0">
                  <div class="title-row">
                    <span v-if="tr.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
                    <div class="title">{{ tr.title }}</div>
                  </div>
                  <div class="muted small meta">{{ trackMeta(tr) }}</div>
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
          <div v-for="tr in tracks" :key="tr.videoId" class="row" :data-selected="selectedMedia?.videoId === tr.videoId ? '1' : '0'">
            <ArtThumb :src="tr.artUrl" />
            <div class="min0">
              <div class="title-row">
                <span v-if="tr.explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
                <div class="title">{{ tr.title }}</div>
              </div>
              <div class="muted small meta">{{ trackMeta(tr) }}</div>
            </div>
            <PlayButton
              :disabled="!deviceId"
              :busy="playingId === tr.videoId"
              :label="playingId === tr.videoId ? $t('ytmusic.starting') : $t('ytmusic.play')"
              @click="play(tr)"
            />
          </div>
          <p v-if="!busy && tracks.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
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
.player__select {
  padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px;
}
.search { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.search__input {
  flex: 1 1 200px; padding: 8px 12px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 14px;
}
.selected {
  margin: -4px 0 12px; padding: 0 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.selected__label { margin-right: 6px; }
.selected__title { color: var(--text); font-weight: 500; }
.search-grid {
  display: grid;
  gap: 18px;
  align-items: start;
  grid-template-columns: repeat(auto-fill, 280px);
  justify-content: start;
}
.section { margin-bottom: 0; width: 280px; min-width: 0; max-width: 280px; }
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
.meta {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.title-row {
  display: flex; align-items: center; gap: 6px; min-width: 0; width: 100%;
}
.title {
  flex: 1 1 0; min-width: 0;
  font-size: 14px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.explicit {
  flex: 0 0 auto;
  display: inline-grid; place-items: center;
  min-width: 16px; height: 16px; padding: 0 3px;
  border-radius: 3px; border: 1px solid var(--muted);
  font-size: 10px; font-weight: 700; line-height: 1; color: var(--muted);
}
.min0 { min-width: 0; flex: 1 1 0; }
.chev { color: var(--muted); flex: 0 0 auto; }
.back-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.back-row .title { min-width: 0; }
.empty { padding: 16px 4px; }
.small { font-size: 12px; }
.count { font-size: 13px; }
</style>
