<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../../api'
import type { MusicTrack, PodcastEpisode, PodcastShow } from '../../api/transport'
import { useNotificationsStore } from '../../stores/notifications'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import MusicItemRow from './MusicItemRow.vue'

// "Podcasts" source of the Music page (`podcasts` plugin). Shows are found in the Apple Podcasts
// directory and followed by subscription, per account; "New" merges the latest episodes of the
// subscriptions. An episode plays through the page (`play`), which sends it to the speaker or plays
// it here; it plays alone (a podcast is not an album: the next one is chosen, not chained). A partly
// listened episode resumes where it was left; one listened to the end says so.
// Same template as the other sources: nothing moves when changing source.

type Tab = 'latest' | 'subscriptions'

const props = defineProps<{
  /** The track the chosen player is playing, to flag it in the lists. */
  nowPlaying: { source: string; id: string } | null
  /** It is playing (the dot pulses); when paused, it stays still. */
  pulsing: boolean
  /** The track being sent (hourglass on its row). */
  playingId: string | null
  /** A chosen player can receive a playback. */
  canPlay: boolean
}>()
const emit = defineEmits<{ play: [tracks: MusicTrack[], index: number] }>()

const { t, locale } = useI18n()
const notifications = useNotificationsStore()

const query = useLocalStorage('kasbah.podcasts.query', '')
const tab = useLocalStorage<Tab>('kasbah.podcasts.tab', 'latest')
const searching = ref(false)
/** The show opened (from the search or the subscriptions), with a page of its episodes. */
const opened = ref<PodcastShow | null>(null)
const shows = ref<PodcastShow[]>([])
const episodes = ref<PodcastEpisode[]>([])
const next = ref<number | null>(null)
const busy = ref(false)
const more = ref(false)
const failed = ref(false)
const toggling = ref(false)
/** Adding a feed by its address (a show the directories do not list). */
const adding = ref(false)
const feedUrl = ref('')
const feedBusy = ref(false)
const feedValid = computed(() => /^https?:\/\/\S+$/i.test(feedUrl.value.trim()))

const tabOptions = computed(() => [
  { value: 'latest' as const, label: t('podcasts.tabLatest') },
  { value: 'subscriptions' as const, label: t('podcasts.tabSubscriptions') },
])
/** Episodes on screen: an opened show, or the "New" tab outside search. */
const showsEpisodes = computed(() => !!opened.value || (!searching.value && tab.value === 'latest'))

const fail = (err: unknown) => notifications.error(t('errors.UNKNOWN', { name: 'Podcasts', message: (err as Error).message }))

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
function dateLabel(ms: number | null): string {
  if (!ms) return ''
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(locale.value, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}
function meta(e: PodcastEpisode): string {
  const state = e.resumeS ? t('podcasts.resumeAt', { time: clock(e.resumeS) }) : e.played ? t('podcasts.played') : ''
  // in "New", episodes of every show are mixed: their show is named
  return [state, dateLabel(e.publishedAt), opened.value ? '' : e.showTitle].filter(Boolean).join(' · ')
}
const showMeta = (s: PodcastShow) => [s.author, s.subscribed ? t('podcasts.subscribed') : ''].filter(Boolean).join(' · ')
const isPlaying = (e: PodcastEpisode) => props.nowPlaying?.source === 'podcasts' && props.nowPlaying.id === e.id

function play(e: PodcastEpisode) {
  emit('play', [{
    source: 'podcasts',
    id: e.id,
    title: e.title,
    artist: e.showTitle,
    ...(e.artUrl ? { artUrl: e.artUrl } : {}),
    ...(e.durationS ? { durationS: e.durationS } : {}),
    ...(e.resumeS ? { startS: e.resumeS } : {}),
  }], 0)
}
async function restart(e: PodcastEpisode) {
  try { await getTransport().podcastsForgetResume(e.id) } catch { /* play from the start anyway */ }
  episodes.value = episodes.value.map((x) => (x.id === e.id ? { ...x, resumeS: undefined, played: undefined } : x))
  play({ ...e, resumeS: undefined })
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

async function loadTab() {
  opened.value = null
  episodes.value = []
  shows.value = []
  next.value = null
  if (tab.value === 'latest') return run(() => getTransport().podcastsLatest(), (r) => { episodes.value = r.episodes })
  return run(() => getTransport().podcastsSubscriptions(), (r) => { shows.value = r.shows })
}
function openShow(s: PodcastShow) {
  opened.value = s
  episodes.value = []
  next.value = null
  void run(() => getTransport().podcastsShow(s.id), (r) => { opened.value = r.show; episodes.value = r.episodes; next.value = r.next })
}
/** Back from an opened show: to the search results, or to the tab. */
function back() {
  if (searching.value) { opened.value = null; episodes.value = []; next.value = null; return }
  void loadTab()
}
async function loadMore() {
  const s = opened.value
  if (!s || next.value === null || more.value) return
  more.value = true
  try {
    const page = await getTransport().podcastsShow(s.id, next.value)
    episodes.value = [...episodes.value, ...page.episodes]
    next.value = page.next
  } catch (err) { fail(err) }
  finally { more.value = false }
}
async function toggleSubscription() {
  const s = opened.value
  if (!s || toggling.value) return
  toggling.value = true
  try {
    await getTransport().podcastsSubscribe(s.id, !s.subscribed)
    opened.value = { ...s, subscribed: !s.subscribed }
    shows.value = shows.value.map((x) => (x.id === s.id ? { ...x, subscribed: !s.subscribed } : x))
  } catch (err) { fail(err) }
  finally { toggling.value = false }
}

function closeAdd() {
  adding.value = false
  feedUrl.value = ''
}
async function addFeed() {
  if (!feedValid.value || feedBusy.value) return
  feedBusy.value = true
  try {
    const r = await getTransport().podcastsAddFeed(feedUrl.value.trim())
    closeAdd()
    openShow(r.show)
  } catch (err) {
    // the server says why (not a feed, a local address): it is worth reading
    notifications.error(t('podcasts.addFeedFailed', { message: (err as Error).message }))
  } finally { feedBusy.value = false }
}

async function runSearch() {
  const q = query.value.trim()
  if (q.length < 2) { clearSearch(); return }
  searching.value = true
  opened.value = null
  episodes.value = []
  shows.value = []
  await run(() => getTransport().podcastsSearch(q), (r) => { shows.value = r.shows })
}
function clearSearch() {
  query.value = ''
  if (searching.value) {
    searching.value = false
    void loadTab()
  }
}

watch(tab, () => { if (!searching.value) void loadTab() })
onMounted(() => {
  if (query.value.trim()) void runSearch()
  else void loadTab()
})
</script>

<template>
  <div class="pc">
    <form class="search" @submit.prevent="runSearch">
      <div class="search__field">
        <StrokeIcon name="search" :size="18" class="search__icon" />
        <input v-model="query" type="search" class="search__input" :placeholder="$t('podcasts.searchPlaceholder')" :aria-label="$t('music.search')" />
        <button type="button" class="search__clear" :class="{ 'is-hidden': !query }" :aria-label="$t('music.clear')" :tabindex="query ? 0 : -1" @click="clearSearch">
          <StrokeIcon name="close" :size="14" />
        </button>
      </div>
    </form>
    <!-- tabs: their place kept during a search (greyed out) -->
    <div class="tabs">
      <div :class="{ 'is-dim': searching }">
        <Segmented v-model="tab" dense :options="tabOptions" :label="$t('podcasts.source')" />
      </div>
      <!-- narrow (phone): the icon alone, so the tabs keep their whole width -->
      <button type="button" class="pill add" :data-on="adding ? '1' : '0'" :aria-expanded="adding" :aria-label="$t('podcasts.addFeed')" :title="$t('podcasts.addFeed')"
              @click="adding ? closeAdd() : (adding = true)">
        <StrokeIcon name="plus" :size="16" />
        <span class="add__label">{{ $t('podcasts.addFeed') }}</span>
      </button>
    </div>
    <!-- an opened show: back, its name, and the subscription -->
    <div v-if="opened" class="back-row">
      <button type="button" class="pill" @click="back">
        <StrokeIcon name="back" :size="16" />
        <span>{{ $t('common.back') }}</span>
      </button>
      <span class="back-row__title">{{ opened.title }}</span>
      <button type="button" class="pill back-row__end" :data-on="opened.subscribed ? '1' : '0'" :disabled="toggling" @click="toggleSubscription">
        <StrokeIcon :name="opened.subscribed ? 'check' : 'plus'" :size="16" />
        <!-- both labels take the same cell: the button keeps the width of the longer one, the title does not move -->
        <span class="both">
          <span :class="{ 'is-hidden': !opened.subscribed }">{{ $t('podcasts.subscribed') }}</span>
          <span :class="{ 'is-hidden': opened.subscribed }">{{ $t('podcasts.subscribe') }}</span>
        </span>
      </button>
    </div>

    <div class="pc__scroll">
      <form v-if="adding" class="custom" @submit.prevent="addFeed">
        <p class="muted custom__hint">{{ $t('podcasts.addFeedHint') }}</p>
        <div class="custom__fields">
          <input v-model="feedUrl" class="custom__input" type="url" inputmode="url" :placeholder="$t('podcasts.feedUrl')" :aria-label="$t('podcasts.feedUrl')" maxlength="2048">
          <button type="submit" class="pill" data-on="1" :disabled="!feedValid || feedBusy">{{ $t('podcasts.feedAdd') }}</button>
          <button type="button" class="pill" @click="closeAdd">{{ $t('podcasts.feedCancel') }}</button>
        </div>
      </form>
      <p v-if="tab === 'latest' && !searching && !opened" class="muted small hint">{{ $t('podcasts.latestHint') }}</p>
      <div v-if="busy && !episodes.length && !shows.length" class="list" aria-hidden="true">
        <div v-for="n in 8" :key="n" class="skel-row"><span class="skel skel--art" /><span class="skel skel--line" /></div>
      </div>

      <template v-else-if="showsEpisodes">
        <p v-if="!episodes.length" class="muted empty" role="status">
          {{ failed ? $t('podcasts.unavailable') : opened ? $t('podcasts.noEpisodes') : $t('podcasts.latestEmpty') }}
        </p>
        <div v-else class="list">
          <div v-for="e in episodes" :key="e.id" class="episode" :data-played="e.played && !e.resumeS ? '1' : '0'">
            <MusicItemRow action="play" icon="sourcePodcasts" :art="e.artUrl" :title="e.title" :meta="meta(e)" :dur="durLabel(e.durationS)"
                          :busy="playingId === e.id" :disabled="!canPlay" :selected="isPlaying(e)" :playing="isPlaying(e) && pulsing"
                          :play-label="$t('podcasts.play', { name: e.title })" @play="play(e)" />
            <!-- place always kept: a row with nothing to start over does not shift -->
            <button type="button" class="restart" :class="{ 'is-hidden': !e.resumeS && !e.played }" :tabindex="e.resumeS || e.played ? 0 : -1"
                    :disabled="!canPlay" :aria-label="$t('podcasts.restart')" :title="$t('podcasts.restart')" @click="restart(e)">
              <StrokeIcon name="rotateLeft" :size="16" />
            </button>
          </div>
        </div>
        <div v-if="opened && next !== null" class="more">
          <button type="button" class="pill" :disabled="more" @click="loadMore">{{ $t('podcasts.more') }}</button>
        </div>
      </template>

      <template v-else>
        <p v-if="!shows.length" class="muted empty" role="status">
          {{ failed ? $t('podcasts.unavailable') : searching ? $t('podcasts.noResults') : $t('podcasts.noSubscriptions') }}
        </p>
        <div v-else class="list">
          <MusicItemRow v-for="s in shows" :key="s.id" action="open" icon="sourcePodcasts" :art="s.artUrl" :title="s.title" :meta="showMeta(s)" @open="openShow(s)" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pc { display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1 1 auto; container-type: inline-size; }
.add { flex: 0 0 auto; }
@container (max-width: 520px) { .add__label { display: none; } }
/* same search as the other sources: changing source moves nothing */
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
.back-row { flex: 0 0 auto; display: flex; align-items: center; gap: 12px; min-width: 0; }
.back-row__title { flex: 1 1 auto; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.back-row__end { flex: 0 0 auto; }
.both { display: inline-grid; }
.both > span { grid-area: 1 / 1; }
.is-hidden { visibility: hidden; }
.pc__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }
.hint { margin: 0 4px 8px; }
.small { font-size: 12px; }
/* in columns, like the radios and the mixes */
.list { display: grid; gap: 2px 18px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-content: start; }
.episode { display: grid; grid-template-columns: minmax(0, 1fr) 36px; align-items: center; }
/* listened to the end: the row steps back, still playable */
.episode[data-played='1'] :deep(.title) { color: var(--muted); }
.restart { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); }
.restart:hover:not(:disabled) { color: var(--text); background: var(--surface2); }
.restart.is-hidden { visibility: hidden; }
/* same form as the radios' "Add a station" */
.custom { display: grid; gap: 8px; padding: 12px; margin: 0 0 10px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
.custom__hint { margin: 0; font-size: 12px; }
.custom__fields { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.custom__input { flex: 2 1 260px; min-width: 0; height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); font: inherit; font-size: 14px; outline: 0; }
.custom__input:focus { border-color: var(--accent); }
.more { display: flex; justify-content: center; padding: 12px 0; }
.empty { padding: 16px 4px; }
.skel-row { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 12px; align-items: center; padding: 6px 4px; }
.skel { display: block; border-radius: 8px; background: var(--surface2); animation: skel 1.4s ease-in-out infinite; }
.skel--art { width: 48px; height: 48px; }
.skel--line { height: 10px; width: 50%; }
@keyframes skel { 50% { opacity: 0.5; } }
</style>
