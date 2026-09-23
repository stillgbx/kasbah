<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../../api'
import type { RadioStation } from '../../api/transport'
import { useNotificationsStore } from '../../stores/notifications'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import MusicItemRow from './MusicItemRow.vue'

// Source « Radios » de la page Musique : l'annuaire libre radio-browser (via le plugin `radio`), les
// favorites de la MAISON (gardées par le serveur) et les plus écoutées du pays. Une radio se lance en
// direct sur le lecteur choisi dans le panneau Écoute — la barre du bas la montre comme telle (ni
// curseur, ni piste voisine). Même gabarit que la recherche YouTube Music : rien ne bouge en
// changeant de source.

type Tab = 'favorites' | 'top'

const props = defineProps<{
  /** Le lecteur choisi, s'il peut recevoir un flux (`play_url`). */
  target: DeviceEntry | null
  /** « Ce navigateur » est choisi : la radio n'y joue pas encore. */
  localSelected: boolean
}>()

const { t } = useI18n()
const notifications = useNotificationsStore()

const query = useLocalStorage('kasbah.radio.query', '')
const tab = useLocalStorage<Tab>('kasbah.radio.tab', 'favorites')
const favorites = ref<RadioStation[]>([])
const top = ref<RadioStation[]>([])
const results = ref<RadioStation[] | null>(null)
const busy = ref(false)
const failed = ref(false)
const playingId = ref<string | null>(null)
/** Le formulaire « ajouter une radio par son flux » est ouvert. */
const adding = ref(false)
const customName = ref('')
const customUrl = ref('')
const customBusy = ref(false)
const customValid = computed(() => customName.value.trim().length > 0 && /^https?:\/\/\S+$/i.test(customUrl.value.trim()))

const tabOptions = computed(() => [
  { value: 'favorites' as const, label: t('radio.favorites') },
  { value: 'top' as const, label: t('radio.top') },
])
const favoriteIds = computed(() => new Set(favorites.value.map((s) => s.id)))
const shown = computed(() => results.value ?? (tab.value === 'favorites' ? favorites.value : top.value))
const emptyLabel = computed(() => (failed.value ? t('radio.unavailable') : results.value || tab.value === 'top' ? t('radio.empty') : t('radio.noFavorites')))

function meta(s: RadioStation): string {
  const quality = [s.codec, s.bitrateKbps ? `${s.bitrateKbps} kb/s` : ''].filter(Boolean).join(' ')
  return [s.country, quality, s.tags.slice(0, 3).join(', ')].filter(Boolean).join(' · ')
}
/** La radio joue sur le lecteur choisi : c'est le direct qu'il publie, sous le nom qu'on lui a donné. */
function isPlaying(s: RadioStation): boolean {
  const st = props.target?.state
  if (!st || st.kind !== 'media_player' || st.playback !== 'playing') return false
  return st.nowPlaying?.live === true && st.nowPlaying.title === s.name
}

async function load<T>(call: () => Promise<T>, apply: (v: T) => void) {
  busy.value = true
  try {
    apply(await call())
    failed.value = false
  } catch {
    failed.value = true
  } finally { busy.value = false }
}
const loadFavorites = () => load(() => getTransport().radioFavorites(), (r) => { favorites.value = r.stations })
const loadTop = () => load(() => getTransport().radioTop(), (r) => { top.value = r.stations })

async function runSearch() {
  const q = query.value.trim()
  if (q.length < 2) { results.value = null; return }
  await load(() => getTransport().radioSearch(q), (r) => { results.value = r.stations })
}
function clearSearch() {
  query.value = ''
  results.value = null
}

async function toggleFavorite(s: RadioStation) {
  try {
    const r = favoriteIds.value.has(s.id) ? await getTransport().radioRemoveFavorite(s.id) : await getTransport().radioAddFavorite(s)
    favorites.value = r.stations
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: t('radio.source'), message: (err as Error).message }))
  }
}

function openAdd() {
  tab.value = 'favorites'
  clearSearch()
  adding.value = true
}
function closeAdd() {
  adding.value = false
  customName.value = ''
  customUrl.value = ''
}
async function addCustom() {
  if (!customValid.value || customBusy.value) return
  customBusy.value = true
  try {
    favorites.value = (await getTransport().radioAddCustom({ name: customName.value.trim(), url: customUrl.value.trim() })).stations
    closeAdd()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: t('radio.source'), message: (err as Error).message }))
  } finally { customBusy.value = false }
}

async function play(s: RadioStation) {
  if (props.localSelected) { notifications.error(t('radio.noLocal')); return }
  if (!props.target) { notifications.error(t('ytmusic.noPlayer')); return }
  playingId.value = s.id
  try { await getTransport().radioPlay({ deviceId: props.target.descriptor.id, stationId: s.id }) }
  catch (err) { notifications.error(t('errors.UNKNOWN', { name: t('radio.source'), message: (err as Error).message })) }
  finally { playingId.value = null }
}

watch(tab, (v) => { if (v === 'top' && !top.value.length) void loadTop() })
onMounted(async () => {
  await loadFavorites()
  if (query.value.trim()) await runSearch()
  else if (tab.value === 'top') await loadTop()
})
</script>

<template>
  <div class="radio">
    <form class="search" @submit.prevent="runSearch">
      <div class="search__field">
        <StrokeIcon name="search" :size="18" class="search__icon" />
        <input v-model="query" type="search" class="search__input" :placeholder="$t('radio.searchPlaceholder')" :aria-label="$t('music.search')" />
        <button type="button" class="search__clear" :class="{ 'is-hidden': !query }" :aria-label="$t('music.clear')" :tabindex="query ? 0 : -1" @click="clearSearch">
          <StrokeIcon name="close" :size="14" />
        </button>
      </div>
    </form>
    <!-- la rangée des onglets garde sa place pendant une recherche (grisée) : la liste ne remonte pas -->
    <div class="tabs">
      <div :class="{ 'is-dim': results !== null }">
        <Segmented v-model="tab" dense :options="tabOptions" :label="$t('radio.source')" />
      </div>
      <button type="button" class="pill" :data-on="adding ? '1' : '0'" :aria-expanded="adding" @click="adding ? closeAdd() : openAdd()">
        <StrokeIcon name="plus" :size="16" />
        <span>{{ $t('radio.addCustom') }}</span>
      </button>
    </div>
    <div class="radio__scroll">
      <form v-if="adding" class="custom" @submit.prevent="addCustom">
        <p class="muted custom__hint">{{ $t('radio.customHint') }}</p>
        <div class="custom__fields">
          <input v-model="customName" class="custom__input custom__input--name" type="text" :placeholder="$t('radio.customName')" :aria-label="$t('radio.customName')" maxlength="200">
          <input v-model="customUrl" class="custom__input" type="url" inputmode="url" :placeholder="$t('radio.customUrl')" :aria-label="$t('radio.customUrl')">
          <button type="submit" class="pill" data-on="1" :disabled="!customValid || customBusy">{{ $t('radio.customAdd') }}</button>
          <button type="button" class="pill" @click="closeAdd">{{ $t('radio.customCancel') }}</button>
        </div>
      </form>
      <div v-if="busy && !shown.length" class="list" aria-hidden="true">
        <div v-for="n in 8" :key="n" class="skel-row"><span class="skel skel--art" /><span class="skel skel--line" /></div>
      </div>
      <p v-else-if="!shown.length" class="muted empty" role="status">{{ emptyLabel }}</p>
      <div v-else class="list">
        <div v-for="s in shown" :key="s.id" class="station">
          <MusicItemRow action="play" icon="waves" :art="s.favicon ?? null" :title="s.name" :meta="meta(s)"
                        :busy="playingId === s.id" :disabled="!target && !localSelected" :playing="isPlaying(s)"
                        :play-label="$t('radio.play', { name: s.name })" @play="play(s)" />
          <button type="button" class="star" :data-on="favoriteIds.has(s.id) ? '1' : '0'"
                  :aria-pressed="favoriteIds.has(s.id)" :aria-label="favoriteIds.has(s.id) ? $t('radio.removeFavorite') : $t('radio.addFavorite')"
                  :title="favoriteIds.has(s.id) ? $t('radio.removeFavorite') : $t('radio.addFavorite')" @click="toggleFavorite(s)">
            <StrokeIcon name="star" :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.radio { display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1 1 auto; }
/* même recherche que celle de YouTube Music : changer de source ne déplace rien */
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
.tabs { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.is-dim { opacity: 0.45; pointer-events: none; }
.custom { display: grid; gap: 8px; padding: 12px; margin: 0 0 10px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
.custom__hint { margin: 0; font-size: 12px; }
.custom__fields { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.custom__input { flex: 2 1 260px; min-width: 0; height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface2); color: var(--text); font: inherit; font-size: 14px; outline: 0; }
.custom__input--name { flex: 1 1 160px; }
.custom__input:focus { border-color: var(--accent); }
.radio__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 4px; }
/* en colonnes : une ligne de station est courte, pleine largeur elle laissait surtout du vide */
.list { display: grid; gap: 2px 18px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-content: start; }
.station { display: grid; grid-template-columns: minmax(0, 1fr) 36px; align-items: center; }
.star { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent; color: color-mix(in srgb, var(--muted) 55%, transparent); }
.star:hover { color: var(--text); background: var(--surface2); }
.star[data-on='1'] { color: var(--accent); }
.empty { padding: 16px 4px; }
.skel-row { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 12px; align-items: center; padding: 6px 4px; }
.skel { display: block; border-radius: 8px; background: var(--surface2); animation: skel 1.4s ease-in-out infinite; }
.skel--art { width: 48px; height: 48px; }
.skel--line { height: 10px; width: 50%; }
@keyframes skel { 50% { opacity: 0.5; } }
</style>
