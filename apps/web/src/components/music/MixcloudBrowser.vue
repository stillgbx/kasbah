<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../../api'
import type { MixcloudList, MixcloudMix, MixcloudPage, MixcloudStatus, MixcloudUser, MusicTrack } from '../../api/transport'
import { useNotificationsStore } from '../../stores/notifications'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import MusicItemRow from './MusicItemRow.vue'

// Source « Mixcloud » de la page Musique (plugin `mixcloud`). Le compte se relie par son NOM
// d'utilisateur (l'API publique ne demande rien d'autre) ; les listes sont celles du profil —
// nouveautés des comptes suivis, favoris, écoutes, ses mix, ses playlists, ses suivis — et la
// recherche. Jouer un mix passe par la page (`play`), qui sait l'envoyer à l'enceinte ou le lire
// ici ; la liste d'où il vient devient la file. Un mix écouté en partie se reprend où on l'a laissé.
// Même gabarit que les autres sources : rien ne bouge en changeant de source.

type Tab = MixcloudList | 'playlists' | 'following'
/** Ce qu'on regarde dans l'onglet : la liste elle-même, ou une playlist / un compte ouverts depuis lui. */
type Drill = { kind: 'playlist'; key: string; name: string } | { kind: 'user'; username: string; name: string } | null

const props = defineProps<{
  /** La piste que joue le lecteur choisi, pour la signaler dans les listes. */
  nowPlaying: { source: string; id: string } | null
  /** Elle joue (le point pulse) ; en pause, il reste immobile. */
  pulsing: boolean
  /** La piste en cours d'envoi (sablier sur sa ligne). */
  playingId: string | null
  /** Un lecteur choisi peut recevoir une lecture. */
  canPlay: boolean
}>()
const emit = defineEmits<{ play: [tracks: MusicTrack[], index: number] }>()

const { t } = useI18n()
const notifications = useNotificationsStore()

const status = ref<MixcloudStatus | null>(null)
const ready = ref(false)
const usernameInput = ref('')
const linking = ref(false)

const query = useLocalStorage('kasbah.mixcloud.query', '')
const tab = useLocalStorage<Tab>('kasbah.mixcloud.tab', 'feed')
const drill = ref<Drill>(null)
const mixes = ref<MixcloudMix[]>([])
const next = ref<string | null>(null)
const playlists = ref<{ key: string; name: string }[]>([])
const users = ref<MixcloudUser[]>([])
const searching = ref(false)
const busy = ref(false)
const more = ref(false)
const failed = ref(false)

const linked = computed(() => !!status.value?.username)
const tabOptions = computed(() => [
  { value: 'feed' as const, label: t('mixcloud.tabFeed') },
  { value: 'favorites' as const, label: t('mixcloud.tabFavorites') },
  { value: 'listens' as const, label: t('mixcloud.tabListens') },
  { value: 'uploads' as const, label: t('mixcloud.tabUploads') },
  { value: 'playlists' as const, label: t('mixcloud.tabPlaylists') },
  { value: 'following' as const, label: t('mixcloud.tabFollowing') },
])
/** On montre des mix (et pas une liste de playlists ou de comptes). */
const showsMixes = computed(() => searching.value || !!drill.value || (tab.value !== 'playlists' && tab.value !== 'following'))

const fail = (err: unknown) => notifications.error(t('errors.UNKNOWN', { name: 'Mixcloud', message: (err as Error).message }))

function durLabel(s: number | null): string {
  if (!s) return ''
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h ? t('music.durHourMin', { h, m }) : t('music.durMin', { m })
}
function clock(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}
function meta(m: MixcloudMix): string {
  const head = m.resumeS ? t('mixcloud.resumeAt', { time: clock(m.resumeS) }) : m.user.name
  return [head, m.resumeS ? m.user.name : '', m.tags.slice(0, 2).join(', ')].filter(Boolean).join(' · ')
}
const isPlaying = (m: MixcloudMix) => props.nowPlaying?.source === 'mixcloud' && props.nowPlaying.id === m.key

/** Un mix comme piste du lecteur commun ; sa reprise part avec lui. */
function toTrack(m: MixcloudMix, withResume: boolean): MusicTrack {
  return {
    source: 'mixcloud',
    id: m.key,
    title: m.name,
    artist: m.user.name,
    ...(m.artUrl ? { artUrl: m.artUrl } : {}),
    ...(m.durationS ? { durationS: m.durationS } : {}),
    ...(withResume && m.resumeS ? { startS: m.resumeS } : {}),
  }
}
function play(m: MixcloudMix) {
  const list = mixes.value
  const at = Math.max(0, list.findIndex((x) => x.key === m.key))
  // seule la piste lancée reprend : les suivantes de la file partent du début
  emit('play', list.map((x, i) => toTrack(x, i === at)), at)
}
async function restart(m: MixcloudMix) {
  try { await getTransport().mixcloudForgetResume(m.key) } catch { /* rejouer du début quand même */ }
  mixes.value = mixes.value.map((x) => (x.key === m.key ? { ...x, resumeS: undefined } : x))
  play({ ...m, resumeS: undefined })
}

async function run<T>(call: () => Promise<T>, apply: (v: T) => void) {
  busy.value = true
  try {
    apply(await call())
    failed.value = false
  } catch (err) {
    failed.value = true
    if (!(err as { status?: number }).status || (err as { status: number }).status >= 500) fail(err)
  } finally { busy.value = false }
}
const setPage = (p: MixcloudPage) => { mixes.value = p.items; next.value = p.next }

async function loadTab() {
  drill.value = null
  mixes.value = []
  next.value = null
  const current = tab.value
  if (current === 'playlists') return run(() => getTransport().mixcloudPlaylists(), (r) => { playlists.value = r.playlists })
  if (current === 'following') return run(() => getTransport().mixcloudFollowing(), (r) => { users.value = r.users })
  return run(() => getTransport().mixcloudList(current), setPage)
}
function openPlaylist(p: { key: string; name: string }) {
  drill.value = { kind: 'playlist', key: p.key, name: p.name }
  mixes.value = []
  void run(() => getTransport().mixcloudPlaylist(p.key), setPage)
}
function openUser(u: MixcloudUser) {
  drill.value = { kind: 'user', username: u.username, name: u.name }
  mixes.value = []
  void run(() => getTransport().mixcloudUserMixes(u.username), setPage)
}
async function loadMore() {
  const cursor = next.value
  if (!cursor || more.value) return
  more.value = true
  try {
    const d = drill.value
    const q = query.value.trim()
    const api = getTransport()
    const page = searching.value ? await api.mixcloudSearch(q, cursor)
      : d?.kind === 'playlist' ? await api.mixcloudPlaylist(d.key, cursor)
        : d?.kind === 'user' ? await api.mixcloudUserMixes(d.username, cursor)
          : await api.mixcloudList(tab.value as MixcloudList, cursor)
    mixes.value = [...mixes.value, ...page.items]
    next.value = page.next
  } catch (err) { fail(err) }
  finally { more.value = false }
}

async function runSearch() {
  const q = query.value.trim()
  if (q.length < 2) { clearSearch(); return }
  searching.value = true
  drill.value = null
  mixes.value = []
  await run(() => getTransport().mixcloudSearch(q), setPage)
}
function clearSearch() {
  query.value = ''
  if (searching.value) {
    searching.value = false
    void loadTab()
  }
}

async function link() {
  const name = usernameInput.value.trim()
  if (!name || linking.value) return
  linking.value = true
  try {
    status.value = await getTransport().mixcloudSetAccount(name)
    usernameInput.value = ''
    await loadTab()
  } catch (err) { fail(err) }
  finally { linking.value = false }
}
async function unlink() {
  try { status.value = await getTransport().mixcloudClearAccount() } catch (err) { fail(err) }
}

watch(tab, () => { if (linked.value && !searching.value) void loadTab() })
onMounted(async () => {
  try { status.value = await getTransport().mixcloudStatus() } catch { status.value = null }
  ready.value = true
  if (!linked.value) return
  if (query.value.trim()) await runSearch()
  else await loadTab()
})
</script>

<template>
  <div class="mc">
    <p v-if="!ready" class="muted empty">{{ $t('common.loading') }}</p>

    <!-- relier : un nom d'utilisateur, rien d'autre -->
    <form v-else-if="!linked" class="link" @submit.prevent="link">
      <h2 class="link__title">{{ $t('mixcloud.linkTitle') }}</h2>
      <p class="muted link__hint">{{ $t('mixcloud.linkHint') }}</p>
      <div class="link__row">
        <input v-model="usernameInput" class="field" type="text" autocomplete="username" autocapitalize="off" spellcheck="false"
               :placeholder="$t('mixcloud.username')" :aria-label="$t('mixcloud.username')" maxlength="64">
        <button type="submit" class="pill" data-on="1" :disabled="!usernameInput.trim() || linking">{{ $t('mixcloud.link') }}</button>
      </div>
    </form>

    <template v-else>
      <form class="search" @submit.prevent="runSearch">
        <div class="search__field">
          <StrokeIcon name="search" :size="18" class="search__icon" />
          <input v-model="query" type="search" class="search__input" :placeholder="$t('mixcloud.searchPlaceholder')" :aria-label="$t('music.search')" />
          <button type="button" class="search__clear" :class="{ 'is-hidden': !query }" :aria-label="$t('music.clear')" :tabindex="query ? 0 : -1" @click="clearSearch">
            <StrokeIcon name="close" :size="14" />
          </button>
        </div>
      </form>
      <!-- onglets et compte : même rangée, sa place gardée pendant une recherche (grisée) -->
      <div class="tabs">
        <div :class="{ 'is-dim': searching }">
          <Segmented v-model="tab" dense :options="tabOptions" :label="$t('mixcloud.source')" />
        </div>
        <button type="button" class="pill account" :title="$t('mixcloud.unlink')" @click="unlink">
          <StrokeIcon name="linkOff" :size="16" />
          <span>{{ $t('mixcloud.account', { name: `@${status?.username}` }) }}</span>
        </button>
      </div>
      <!-- « Retour » d'une playlist ou d'un compte ouverts, place gardée hors recherche -->
      <div v-if="drill && !searching" class="back-row">
        <button type="button" class="pill" @click="loadTab">
          <StrokeIcon name="back" :size="16" />
          <span>{{ $t('common.back') }}</span>
        </button>
        <span class="back-row__title">{{ drill.kind === 'user' ? $t('mixcloud.mixes', { name: drill.name }) : drill.name }}</span>
      </div>

      <div class="mc__scroll">
        <p v-if="tab === 'feed' && !searching && !drill" class="muted small hint">{{ $t('mixcloud.feedHint') }}</p>
        <div v-if="busy && !mixes.length && showsMixes" class="list" aria-hidden="true">
          <div v-for="n in 8" :key="n" class="skel-row"><span class="skel skel--art" /><span class="skel skel--line" /></div>
        </div>

        <template v-else-if="showsMixes">
          <p v-if="!mixes.length" class="muted empty" role="status">{{ failed ? $t('mixcloud.unavailable') : $t('mixcloud.empty') }}</p>
          <div v-else class="list">
            <div v-for="m in mixes" :key="m.key" class="mix">
              <MusicItemRow action="play" icon="sourceMixcloud" :art="m.artUrl" :title="m.name" :meta="meta(m)" :dur="durLabel(m.durationS)"
                            :busy="playingId === m.key" :disabled="!canPlay" :selected="isPlaying(m)" :playing="isPlaying(m) && pulsing"
                            :play-label="$t('mixcloud.play', { name: m.name })" @play="play(m)" />
              <!-- place toujours gardée : une ligne sans reprise ne se décale pas -->
              <button type="button" class="restart" :class="{ 'is-hidden': !m.resumeS }" :tabindex="m.resumeS ? 0 : -1"
                      :disabled="!canPlay" :aria-label="$t('mixcloud.restart')" :title="$t('mixcloud.restart')" @click="restart(m)">
                <StrokeIcon name="rotateLeft" :size="16" />
              </button>
            </div>
          </div>
          <div v-if="next" class="more">
            <button type="button" class="pill" :disabled="more" @click="loadMore">{{ $t('mixcloud.more') }}</button>
          </div>
        </template>

        <template v-else-if="tab === 'playlists'">
          <p v-if="!busy && !playlists.length" class="muted empty" role="status">{{ failed ? $t('mixcloud.unavailable') : $t('mixcloud.empty') }}</p>
          <div class="list">
            <MusicItemRow v-for="p in playlists" :key="p.key" action="open" icon="list" :art="null" :title="p.name" @open="openPlaylist(p)" />
          </div>
        </template>

        <template v-else>
          <p v-if="!busy && !users.length" class="muted empty" role="status">{{ failed ? $t('mixcloud.unavailable') : $t('mixcloud.empty') }}</p>
          <div class="list">
            <MusicItemRow v-for="u in users" :key="u.username" action="open" icon="person" round :art="u.artUrl" :title="u.name" :meta="`@${u.username}`" @open="openUser(u)" />
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mc { display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1 1 auto; }
/* même recherche que les autres sources : changer de source ne déplace rien */
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
.search__clear.is-hidden { visibility: hidden; }
.tabs { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.tabs > div { min-width: 0; overflow-x: auto; }
.is-dim { opacity: 0.45; pointer-events: none; }
.account { flex: 0 0 auto; white-space: nowrap; max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
.back-row { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; }
.back-row__title { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }
.hint { margin: 0 4px 8px; }
.small { font-size: 12px; }
/* en colonnes, comme les radios : une ligne de mix est courte */
.list { display: grid; gap: 2px 18px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-content: start; }
.mix { display: grid; grid-template-columns: minmax(0, 1fr) 36px; align-items: center; }
.restart { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); }
.restart:hover:not(:disabled) { color: var(--text); background: var(--surface2); }
.restart.is-hidden { visibility: hidden; }
.more { display: flex; justify-content: center; padding: 12px 0; }
.empty { padding: 16px 4px; }
.link { display: grid; gap: 10px; max-width: 560px; padding: 20px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
.link__title { margin: 0; font-size: 17px; }
.link__hint { margin: 0; font-size: 13px; }
.link__row { display: flex; gap: 8px; align-items: center; }
.field { flex: 1 1 auto; min-width: 0; height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); font: inherit; outline: 0; }
.field:focus { border-color: var(--accent); }
.skel-row { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 12px; align-items: center; padding: 6px 4px; }
.skel { display: block; border-radius: 8px; background: var(--surface2); animation: skel 1.4s ease-in-out infinite; }
.skel--art { width: 48px; height: 48px; }
.skel--line { height: 10px; width: 50%; }
@keyframes skel { 50% { opacity: 0.5; } }
</style>
