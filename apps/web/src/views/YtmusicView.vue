<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../api'
import type { YtmusicPlaylist, YtmusicTrack } from '../api/transport'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'

// Vue YouTube Music (non officiel) : recherche + likes + playlists → play_url sur Cast/Sonos.
// Pas de redesign de Médias : le play_url manuel reste ailleurs.

defineOptions({ name: 'YtmusicView' })

const { t } = useI18n()
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()

const tab = ref<'search' | 'liked' | 'playlists'>('search')
const query = ref('')
const tracks = ref<YtmusicTrack[]>([])
const playlists = ref<YtmusicPlaylist[]>([])
const playlistId = ref<string | null>(null)
const playlistTitle = ref('')
const busy = ref(false)
const playingId = ref<string | null>(null)
const deviceId = ref('')
/** false tant que le statut cookie n'a pas été lu — éviter le faux « manquant ». */
const statusReady = ref(false)
const linked = ref(false)

const players = computed(() => devices.list.filter((e: DeviceEntry) =>
  e.state.kind === 'media_player'
  && e.state.available
  && e.descriptor.capabilities.includes('play_url')))

watch(players, (list) => {
  if (!deviceId.value && list[0]) deviceId.value = list[0].descriptor.id
  if (deviceId.value && !list.some((e) => e.descriptor.id === deviceId.value)) {
    deviceId.value = list[0]?.descriptor.id ?? ''
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

onMounted(async () => {
  try { await refreshLink() }
  finally { statusReady.value = true }
})

function fmtDur(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return ''
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

async function runSearch() {
  const q = query.value.trim()
  if (!q) return
  busy.value = true
  playlistId.value = null
  try {
    tracks.value = (await getTransport().ytmusicSearch(q)).tracks
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function loadLiked() {
  busy.value = true
  playlistId.value = null
  try {
    tracks.value = (await getTransport().ytmusicLiked()).tracks
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function loadPlaylists() {
  busy.value = true
  playlistId.value = null
  tracks.value = []
  try {
    playlists.value = (await getTransport().ytmusicPlaylists()).playlists
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function openPlaylist(pl: YtmusicPlaylist) {
  busy.value = true
  playlistId.value = pl.id
  playlistTitle.value = pl.title
  try {
    tracks.value = (await getTransport().ytmusicPlaylist(pl.id)).tracks
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function play(track: YtmusicTrack) {
  if (!deviceId.value) {
    notifications.error(t('ytmusic.noPlayer'))
    return
  }
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
  if (v === 'liked') void loadLiked()
  else if (v === 'playlists') void loadPlaylists()
  else { tracks.value = []; playlists.value = []; playlistId.value = null }
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
          <div class="tabs">
            <button type="button" class="tab" :data-on="tab === 'search' ? '1' : '0'" @click="tab = 'search'">{{ $t('ytmusic.tabSearch') }}</button>
            <button type="button" class="tab" :data-on="tab === 'liked' ? '1' : '0'" @click="tab = 'liked'">{{ $t('ytmusic.tabLiked') }}</button>
            <button type="button" class="tab" :data-on="tab === 'playlists' ? '1' : '0'" @click="tab = 'playlists'">{{ $t('ytmusic.tabPlaylists') }}</button>
          </div>
          <label class="player">
            <span class="muted small">{{ $t('ytmusic.player') }}</span>
            <select v-model="deviceId" class="player__select">
              <option v-if="players.length === 0" value="" disabled>{{ $t('ytmusic.noPlayer') }}</option>
              <option v-for="p in players" :key="p.descriptor.id" :value="p.descriptor.id">{{ p.descriptor.name }}</option>
            </select>
          </label>
        </div>

        <form v-if="tab === 'search'" class="search" @submit.prevent="runSearch">
          <input v-model="query" type="search" class="search__input" :placeholder="$t('ytmusic.searchPlaceholder')" :disabled="busy" />
          <button type="submit" class="pill" data-on="1" :disabled="busy || !query.trim()">{{ $t('ytmusic.search') }}</button>
        </form>

        <div v-if="tab === 'playlists' && !playlistId" class="list">
          <button v-for="pl in playlists" :key="pl.id" type="button" class="row" @click="openPlaylist(pl)">
            <div v-if="pl.artUrl" class="art" :style="{ backgroundImage: `url(${JSON.stringify(pl.artUrl)})` }" />
            <div v-else class="art art--empty"><StrokeIcon name="music" :size="18" /></div>
            <div class="min0">
              <div class="title">{{ pl.title }}</div>
              <div v-if="pl.trackCount != null" class="muted small">{{ $t('ytmusic.tracks', { n: pl.trackCount }, pl.trackCount) }}</div>
            </div>
            <StrokeIcon name="chevron" :size="16" class="chev" />
          </button>
          <p v-if="!busy && playlists.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
        </div>

        <div v-if="playlistId" class="back-row">
          <button type="button" class="pill" @click="playlistId = null; void loadPlaylists()">{{ $t('ytmusic.backPlaylists') }}</button>
          <span class="title">{{ playlistTitle }}</span>
        </div>

        <div v-if="tab !== 'playlists' || playlistId" class="list">
          <div v-for="tr in tracks" :key="tr.videoId" class="row">
            <div v-if="tr.artUrl" class="art" :style="{ backgroundImage: `url(${JSON.stringify(tr.artUrl)})` }" />
            <div v-else class="art art--empty"><StrokeIcon name="music" :size="18" /></div>
            <div class="min0">
              <div class="title">{{ tr.title }}</div>
              <div class="muted small">{{ tr.artists.join(', ') }}<span v-if="fmtDur(tr.durationS)"> · {{ fmtDur(tr.durationS) }}</span></div>
            </div>
            <button type="button" class="pill play" data-on="1"
                    :disabled="!deviceId || playingId === tr.videoId"
                    @click="play(tr)">
              {{ playingId === tr.videoId ? $t('ytmusic.starting') : $t('ytmusic.play') }}
            </button>
          </div>
          <p v-if="!busy && tracks.length === 0 && (tab !== 'search' || query)" class="muted empty">{{ $t('ytmusic.empty') }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 14px; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tab {
  font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line);
  background: transparent; color: var(--muted); cursor: pointer;
}
.tab[data-on='1'] { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
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
.list { display: grid; gap: 2px; }
.row {
  display: flex; align-items: center; gap: 12px; padding: 8px 4px;
  border-bottom: 1px solid var(--line); background: transparent; border-left: 0; border-right: 0; border-top: 0;
  color: inherit; text-align: left; width: 100%; cursor: default; font: inherit;
}
button.row { cursor: pointer; }
.art {
  width: 44px; height: 44px; border-radius: 6px; background-size: cover; background-position: center;
  flex: 0 0 auto; background-color: color-mix(in srgb, var(--muted) 18%, transparent);
}
.art--empty { display: grid; place-items: center; color: var(--muted); }
.title { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.min0 { min-width: 0; flex: 1 1 0; }
.play { flex: 0 0 auto; }
.chev { color: var(--muted); flex: 0 0 auto; }
.back-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.empty { padding: 16px 4px; }
.small { font-size: 12px; }
.count { font-size: 13px; }
</style>
