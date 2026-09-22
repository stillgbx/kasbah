<script lang="ts">
import type { YtmusicSearchResult } from '../api/transport'

// Dernière recherche servie, gardée AU NIVEAU DU MODULE (donc hors du composant) : aller voir
// l'appareil en 3D puis revenir remonte la vue, et le même terme repartait alors au serveur, donc à
// InnerTube. Le terme sert de clé : dès qu'il change, on redemande. Mémoire du module et non
// `localStorage` — le cache dure ce que dure l'onglet, un rechargement de page redonne des
// résultats frais.
let lastSearch: { query: string; result: YtmusicSearchResult } | null = null
</script>

<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { CommandInput, DeviceEntry } from '@kasbah/shared'
import { getTransport } from '../api'
import type { YtmusicAlbum, YtmusicArtist, YtmusicExplore, YtmusicExploreCategory, YtmusicExploreShelf, YtmusicPlaylist, YtmusicQueue, YtmusicQueueTrack, YtmusicRepeat, YtmusicSession, YtmusicTrack } from '../api/transport'
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
// là pour les suivantes. « Genres » et « Ambiances » ouvrent les « Humeurs et genres » de YouTube
// Music : une grille de pastilles, puis la page d'une catégorie en rangées de tuiles (titres,
// playlists officielles, albums), chaque rangée jouable comme une liste.
//
// File d'attente : elle vit sur le SERVEUR, par lecteur (l'enceinte ne connaît qu'un « fichier » à la
// fois). Jouer un titre d'une liste (album, playlist, likes, résultats) y met la liste entière, à
// partir de ce titre ; « lire ensuite » et « ajouter à la fin » la complètent sans interrompre. La
// barre en tire précédent / suivant et la répétition du titre ; la file s'affiche à la place de la
// zone centrale (touche File de la barre).
//
// Le transfert (bureau → salon) passe par le serveur : il connaît le titre que joue la source, le
// relance sur la cible qui se place à la même position, puis arrête la source. Il n'est possible que
// pour une lecture lancée d'ici (`GET /sessions`) : une appli native sur le Chromecast n'est pas à nous.

defineOptions({ name: 'MusicView' })

type BrowseTab = 'recent' | 'liked' | 'playlists' | 'genres' | 'moods'
type Browse =
  | { kind: 'playlist'; id: string; title: string }
  | { kind: 'album'; id: string; title: string }
  | { kind: 'artist'; id: string; title: string }
  | { kind: 'category'; params: string; title: string }
/** Ordre API InnerTube = pertinence. */
type SectionSort = 'relevance' | 'alpha' | 'date'

const { t, locale } = useI18n()
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
// Le serveur enchaîne tout seul : quand le lecteur change de titre ou d'état, relire les sessions
// tout de suite (titre, file) plutôt qu'au prochain tour de 20 s. Un peu de retard, pour laisser le
// serveur finir de lancer le titre qu'il enchaîne.
let sessionsSoon: ReturnType<typeof setTimeout> | undefined
watch(() => {
  const st = selected.value?.state
  return st?.kind === 'media_player' ? `${st.playback}|${st.nowPlaying?.title ?? ''}` : ''
}, () => {
  clearTimeout(sessionsSoon)
  sessionsSoon = setTimeout(() => { void refreshSessions() }, 800)
})

// ---- file d'attente --------------------------------------------------------------------------------
/** Une liste de plus de titres que la file n'en accepte : on en envoie une fenêtre autour du titre choisi. */
const QUEUE_WINDOW = 1000
const queueOpen = ref(false)
const queue = ref<YtmusicQueue | null>(null)
const queueBusyIndex = ref<number | null>(null)
const queueWaiting = computed(() => (queue.value ? queue.value.items.length - queue.value.index - 1 : 0))
function toQueueTrack(tr: YtmusicTrack): YtmusicQueueTrack {
  return {
    videoId: tr.videoId,
    title: tr.title,
    ...(tr.artists.length ? { artist: tr.artists.join(', ') } : {}),
    ...(tr.artUrl ? { artUrl: tr.artUrl } : {}),
    ...(tr.durationS ? { durationS: tr.durationS } : {}),
    ...(tr.explicit ? { explicit: true } : {}),
  }
}
/** Un titre de la file vu comme un titre du catalogue (barre pendant l'envoi, lignes de la file). */
function fromQueueTrack(qt: YtmusicQueueTrack): YtmusicTrack {
  return {
    videoId: qt.videoId, title: qt.title ?? qt.videoId, artists: qt.artist ? [qt.artist] : [],
    artUrl: qt.artUrl ?? null, durationS: qt.durationS ?? null, ...(qt.explicit ? { explicit: true } : {}),
  }
}
async function loadQueue(): Promise<void> {
  const id = selected.value?.descriptor.id
  if (!id || !selectedSession.value?.queue) {
    queue.value = null
    return
  }
  try { queue.value = await getTransport().ytmusicQueue(id) }
  catch { queue.value = null }
}
// relire la file dès que la session dit qu'elle a bougé (titre suivant, ajout, retrait, répétition)
watch(() => {
  const s = selectedSession.value
  return s?.queue ? `${s.deviceId}|${s.sid}|${s.queue.index}|${s.queue.length}|${s.queue.repeat}` : ''
}, () => { void loadQueue() }, { immediate: true })
// à l'ouverture, amener le titre qui joue sous les yeux
watch(queueOpen, async (open) => {
  if (!open) return
  await loadQueue()
  await nextTick()
  document.querySelector('.queue-list [data-selected="1"]')?.scrollIntoView({ block: 'nearest' })
})
function patchSessionQueue(q: YtmusicQueue) {
  const s = selectedSession.value
  if (!s) return
  queue.value = q
  const next = new Map(ourSessions.value)
  next.set(s.deviceId, { ...s, queue: { length: q.items.length, index: q.index, repeat: q.repeat } })
  ourSessions.value = next
}
/** Suivant / précédent / un titre choisi : le serveur lance le titre, la barre le montre tout de suite. */
async function queueGo(step: 'next' | 'previous' | number) {
  const id = selected.value?.descriptor.id
  if (!id) return
  const target = typeof step === 'number' ? step : step === 'next' && queue.value ? queue.value.index + 1 : null
  const track = target !== null ? queue.value?.items[target] : undefined
  if (track) pendingTrack.value = fromQueueTrack(track)
  if (typeof step === 'number') queueBusyIndex.value = step
  try {
    const api = getTransport()
    const q = step === 'next' ? await api.ytmusicQueueNext(id) : step === 'previous' ? await api.ytmusicQueuePrevious(id) : await api.ytmusicQueueJump(id, step)
    patchSessionQueue(q)
  } catch (err) { fail(err) }
  finally {
    pendingTrack.value = null
    queueBusyIndex.value = null
    void refreshSessions()
  }
}
async function setRepeat(mode: YtmusicRepeat) {
  const id = selected.value?.descriptor.id
  if (!id) return
  try { patchSessionQueue(await getTransport().ytmusicQueueRepeat(id, mode)) }
  catch (err) { fail(err) }
}
async function removeFromQueue(index: number) {
  const id = selected.value?.descriptor.id
  if (!id) return
  try { patchSessionQueue(await getTransport().ytmusicQueueRemove(id, index)) }
  catch (err) { fail(err) }
}
async function clearQueue() {
  const id = selected.value?.descriptor.id
  if (!id) return
  try { patchSessionQueue(await getTransport().ytmusicQueueClear(id)) }
  catch (err) { fail(err) }
}
/** Lire ensuite / ajouter à la fin, sans interrompre. Rien ne joue ici ? Le serveur lance le titre. */
async function addToQueue(track: YtmusicTrack, where: 'next' | 'end') {
  const target = selected.value
  if (!target || !canReceive(target)) {
    notifications.error(t('ytmusic.noPlayer'))
    return
  }
  try {
    const r = await getTransport().ytmusicQueueAdd({ deviceId: target.descriptor.id, tracks: [toQueueTrack(track)], where })
    if (r.started) rememberPlay(track)
    patchSessionQueue(r.queue)
  } catch (err) { fail(err) }
  finally { void refreshSessions() }
}

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
  // une file : c'est elle qui saute, l'enceinte n'a qu'un titre
  if ((cmd.type === 'media_player.next' || cmd.type === 'media_player.previous') && selectedSession.value?.queue) {
    void queueGo(cmd.type === 'media_player.next' ? 'next' : 'previous')
    return
  }
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
/** Se placer dans le morceau : la commande du lecteur suffit, notre flux est un « fichier » pour lui. */
function barSeek(positionS: number) {
  const s = selected.value
  if (s) void devices.sendCommand(s.descriptor.id, { type: 'media_player.seek', positionS: Math.round(positionS) })
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
  // Même terme qu'au dernier passage : on réaffiche, on ne redemande pas.
  if (lastSearch?.query === q) {
    applySearch(lastSearch.result)
    return
  }
  // Vider AVANT d'attendre : garder les résultats de la requête précédente le temps de la nouvelle
  // (plusieurs secondes) laissait croire qu'on n'avait pas cliqué, ou pire, que c'était la réponse.
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
/** Effacer la recherche : retour au parcours. */
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
  else tracks.value = []
}

// ---- humeurs et genres ---------------------------------------------------------------------------
/** Les catégories, dans la langue de l'app (YouTube les nomme) ; relues seulement si la langue change. */
const explore = ref<YtmusicExplore | null>(null)
let exploreLang = ''
const categoryShelves = ref<YtmusicExploreShelf[]>([])
/** Ce qu'on a ouvert DEPUIS une catégorie (une playlist, un album) revient à elle par « Retour ». */
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
 * Pochettes des cartes : la page de YouTube n'en a pas, le serveur les prend dans chaque catégorie
 * (lent la première fois, ~10 s, puis gardé 6 h). Les cartes n'attendent pas : les pochettes y entrent
 * en fondu à leur arrivée, dans un emplacement déjà réservé. Un échec les laisse simplement nues.
 */
const covers = ref<Record<string, string[]>>({})
async function loadCovers(lang: string) {
  try { covers.value = (await getTransport().ytmusicExploreCovers(lang)).covers }
  catch { /* cartes sans pochettes */ }
}
/** Une pochette n'apparaît qu'une fois chargée : jamais de carré vide ni d'image qui se dessine par bandes. */
const coverLoaded = ref<Set<string>>(new Set())
function markCover(url: string) { coverLoaded.value = new Set(coverLoaded.value).add(url) }
/** Genres : « Pour vous » en tête (s'il y en a), puis les genres ; Ambiances : les humeurs et moments. */
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
/** « Masquer explicit » vaut aussi ici ; une rangée vidée par le filtre disparaît. */
const categoryView = computed(() => categoryShelves.value
  .map((sh) => ({ ...sh, tracks: withoutExplicit(sh.tracks), albums: withoutExplicit(sh.albums) }))
  .filter((sh) => sh.tracks.length + sh.playlists.length + sh.albums.length > 0))
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
async function openDetail(next: Browse, load: () => Promise<{ tracks: YtmusicTrack[] }>) {
  if (browse.value?.kind === 'category') backStack.value = [...backStack.value, browse.value]
  busy.value = true
  browse.value = next
  queueOpen.value = false
  try { tracks.value = (await load()).tracks }
  catch (err) { fail(err) }
  finally { busy.value = false }
}
const openPlaylist = (pl: YtmusicPlaylist) => openDetail({ kind: 'playlist', id: pl.id, title: pl.title }, () => getTransport().ytmusicPlaylist(pl.id))
const openAlbum = (al: YtmusicAlbum) => openDetail({ kind: 'album', id: al.id, title: al.title }, () => getTransport().ytmusicAlbum(al.id))
const openArtist = (ar: YtmusicArtist) => openDetail({ kind: 'artist', id: ar.id, title: ar.name }, () => getTransport().ytmusicArtist(ar.id))
function backFromDetail() {
  tracks.value = []
  const prev = backStack.value.at(-1)
  if (prev) {
    // la catégorie d'où l'on vient : ses rangées sont encore en mémoire
    backStack.value = backStack.value.slice(0, -1)
    browse.value = prev
    return
  }
  browse.value = null
  if (!searched.value) void loadBrowseTab()
}

/** Jouer `track` ; la liste d'où il vient (album, playlist, likes, résultats) devient la file, à partir de lui. */
async function play(track: YtmusicTrack, list: YtmusicTrack[] = [track]) {
  const target = selected.value
  if (!target || !canReceive(target)) {
    notifications.error(t('ytmusic.noPlayer'))
    return
  }
  rememberPlay(track)
  playingId.value = track.videoId
  pendingTrack.value = track
  const at = Math.max(0, list.findIndex((x) => x.videoId === track.videoId))
  const from = Math.max(0, Math.min(at - 100, list.length - QUEUE_WINDOW))
  const tracksWindow = list.slice(from, from + QUEUE_WINDOW)
  try {
    const r = await getTransport().ytmusicQueuePlay({ deviceId: target.descriptor.id, tracks: tracksWindow.map(toQueueTrack), startIndex: at - from })
    patchSessionQueue(r.queue)
    void refreshSessions()
  } catch (err) { fail(err) }
  finally {
    playingId.value = null
    pendingTrack.value = null
  }
}

/** Album ou artiste joué d'un geste (sa tuile, sa ligne) : ses titres deviennent la file, depuis le premier. */
const playingCollection = ref<string | null>(null)
async function playCollection(id: string, load: () => Promise<{ tracks: YtmusicTrack[] }>) {
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
/** Une recherche est partie et sa réponse n'est pas là : la zone des résultats montre des squelettes. */
const searching = computed(() => busy.value && searched.value && !browse.value)
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
            <!-- file d'attente du lecteur choisi : ce qui joue, ce qui suit -->
            <template v-if="queueOpen">
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
              <div class="list queue-list">
                <template v-if="queue">
                  <MusicItemRow v-for="(qt, i) in queue.items" :key="`${i}:${qt.videoId}`" action="play" removable :art="qt.artUrl ?? null" :title="qt.title ?? qt.videoId"
                                :explicit="!!qt.explicit" :meta="qt.artist ?? ''" :dur="formatClock(qt.durationS)" :selected="i === queue.index"
                                :disabled="!playTarget" :busy="queueBusyIndex === i" :play-label="$t('ytmusic.play')"
                                @play="queueGo(i)" @remove="removeFromQueue(i)" />
                  <p v-if="queueWaiting <= 0" class="muted empty">{{ $t('music.queueNothingNext') }}</p>
                </template>
                <p v-else class="muted empty">{{ $t('music.queueEmpty') }}</p>
              </div>
            </template>

            <!-- une catégorie (genre, ambiance) : ses rangées de tuiles -->
            <template v-else-if="browse?.kind === 'category'">
              <div class="back-row">
                <button type="button" class="pill" @click="backFromDetail">
                  <StrokeIcon name="back" :size="16" />
                  <span>{{ $t('common.back') }}</span>
                </button>
                <span class="back-row__title">{{ browse.title }}</span>
              </div>
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
                <section v-for="(sh, si) in categoryView" :key="`${si}:${sh.title}`" class="shelf">
                  <div class="shelf__head"><h2 class="section-label">{{ sh.title }}</h2></div>
                  <div class="shelf__row">
                    <MusicTile v-for="tr in sh.tracks" :key="tr.videoId" action="play" :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit" :meta="trackMeta(tr)"
                               :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')" @play="play(tr, sh.tracks)" />
                    <MusicTile v-for="pl in sh.playlists" :key="pl.id" action="open" playable icon="list" :art="pl.artUrl" :title="pl.title"
                               :meta="pl.trackCount != null ? $t('ytmusic.tracks', { n: pl.trackCount }, pl.trackCount) : ''"
                               :disabled="!playTarget" :busy="playingCollection === pl.id" :play-label="$t('music.playAll')" @open="openPlaylist(pl)" @play="playPlaylist(pl)" />
                    <MusicTile v-for="al in sh.albums" :key="al.id" action="open" playable icon="disc" :art="al.artUrl" :title="al.title" :explicit="!!al.explicit"
                               :meta="[albumMeta(al), al.year].filter(Boolean).join(' · ')"
                               :disabled="!playTarget" :busy="playingCollection === al.id" :play-label="$t('music.playAll')" @open="openAlbum(al)" @play="playAlbum(al)" />
                  </div>
                </section>
                <p v-if="categoryView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </template>
            </template>

            <!-- détail : album, artiste, playlist -->
            <template v-else-if="browse">
              <div class="back-row">
                <button type="button" class="pill" @click="backFromDetail">
                  <StrokeIcon name="back" :size="16" />
                  <span>{{ $t('common.back') }}</span>
                </button>
                <span class="back-row__title">{{ browse.title }}</span>
                <button type="button" class="pill back-row__end" data-on="1" :disabled="!playTarget || browseTracksView.length === 0" @click="play(browseTracksView[0]!, browseTracksView)">
                  <StrokeIcon name="play" :size="16" />
                  <span>{{ $t('music.playAll') }}</span>
                </button>
              </div>
              <div class="list">
                <MusicItemRow v-for="tr in browseTracksView" :key="tr.videoId" action="play" queueable :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                              :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null" :selected="recentPlays[0]?.videoId === tr.videoId"
                              :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')"
                              @play="play(tr, browseTracksView)" @play-next="addToQueue(tr, 'next')" @add-end="addToQueue(tr, 'end')" />
                <p v-if="!busy && browseTracksView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </div>
            </template>

            <!-- l'attente : même forme que les résultats à venir, pour que rien ne saute quand ils arrivent -->
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

            <!-- recherche simple : une rangée de tuiles par section -->
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

            <!-- recherche avancée : colonnes classées avec tris -->
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
                                :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null" :selected="recentPlays[0]?.videoId === tr.videoId"
                                :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')"
                                @play="play(tr, tracksView)" @play-next="addToQueue(tr, 'next')" @add-end="addToQueue(tr, 'end')" />
                </div>
              </section>
              <p v-if="searchEmpty" class="muted empty">{{ $t('ytmusic.empty') }}</p>
            </div>

            <!-- parcourir : récents, likes, playlists, genres, ambiances -->
            <template v-else>
              <div class="browse-head">
                <Segmented v-model="browseTab" dense :options="browseOptions" :label="$t('music.browse')" />
              </div>
              <div v-if="browseTab === 'recent'" class="list">
                <MusicItemRow v-for="tr in recentPlays" :key="tr.videoId" action="play" queueable :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                              :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null"
                              :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')"
                              @play="play(tr, [...recentPlays])" @play-next="addToQueue(tr, 'next')" @add-end="addToQueue(tr, 'end')" />
                <p v-if="recentPlays.length === 0" class="muted empty">{{ $t('music.noRecent') }}</p>
              </div>
              <div v-else-if="browseTab === 'liked'" class="list">
                <MusicItemRow v-for="tr in browseTracksView" :key="tr.videoId" action="play" queueable :art="tr.artUrl" :title="tr.title" :explicit="!!tr.explicit"
                              :meta="trackMeta(tr)" :dur="formatClock(tr.durationS)" :year="tr.year ?? null"
                              :disabled="!playTarget" :busy="playingId === tr.videoId" :play-label="$t('ytmusic.play')"
                              @play="play(tr, browseTracksView)" @play-next="addToQueue(tr, 'next')" @add-end="addToQueue(tr, 'end')" />
                <p v-if="!busy && browseTracksView.length === 0" class="muted empty">{{ $t('ytmusic.empty') }}</p>
              </div>
              <!-- genres / ambiances : cartes de taille fixe, dégradé de la couleur de YouTube Music, deux pochettes inclinées -->
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
                    :transfer-mode="transferMode" :can-transfer="canTransfer" :transfer-busy="!!transferBusyId" :queue-open="queueOpen"
                    @command="barCommand" @seek="barSeek" @transfer="transferMode = true" @cancel-transfer="transferMode = false"
                    @repeat="setRepeat" @toggle-queue="queueOpen = !queueOpen" />
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
.back-row__title { min-width: 0; flex: 1 1 auto; font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.back-row__end { flex: 0 0 auto; white-space: nowrap; }

/* attente d'une recherche : des blocs de la taille des tuiles, qui respirent doucement */
.skel { display: block; border-radius: 8px; background: var(--surface2); animation: skel 1.4s ease-in-out infinite; }
.skel-tile { width: 128px; flex: 0 0 auto; display: grid; gap: 6px; }
.skel--art { width: 128px; height: 128px; border-radius: 10px; }
.skel--line { height: 10px; }
.skel--short { width: 60%; }
.skel--label { width: 120px; height: 13px; }
@keyframes skel { 0%, 100% { opacity: .45; } 50% { opacity: .9; } }
@media (prefers-reduced-motion: reduce) { .skel { animation: none; opacity: .6; } }

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

/* genres / ambiances : cartes de taille FIXE (les pochettes arrivent après, dans une place déjà faite).
   Fond : la couleur de YouTube Music assombrie en dégradé — ces couleurs sont pastel (#a4ffa4,
   #cccccc…), en aplat le texte blanc y serait illisible. Même carte dans les deux thèmes : c'est une
   vignette, comme une pochette. */
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
/* deux lignes au plus, à gauche : les pochettes occupent le coin opposé */
.cat__title {
  position: relative; z-index: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  max-width: 62%; font-size: 17px; font-weight: 700; line-height: 1.2; letter-spacing: -.01em; text-shadow: 0 1px 8px rgb(0 0 0 / .35);
}
.cat__art { position: absolute; right: 0; bottom: 0; width: 132px; height: 100%; pointer-events: none; }
.cat__cover {
  position: absolute; width: 76px; height: 76px; border-radius: 6px; object-fit: cover;
  box-shadow: 0 6px 18px rgb(0 0 0 / .45); opacity: 0; transition: opacity .35s ease, transform .3s ease;
}
/* la première pochette devant, penchée vers la droite ; la seconde derrière, en retrait */
.cat__cover--1 { right: -10px; bottom: -12px; transform: rotate(22deg); }
.cat__cover--2 { right: 44px; bottom: -22px; width: 64px; height: 64px; transform: rotate(-10deg); filter: brightness(.85); }
.cat__cover.is-in { opacity: 1; }
.cat:hover .cat__cover--1 { transform: rotate(16deg) translateY(-3px); }
.cat:hover .cat__cover--2 { transform: rotate(-14deg) translateY(-2px); }
@media (prefers-reduced-motion: reduce) { .cat, .cat__cover { transition: none; } }
.cat-skel { height: 108px; border-radius: 12px; }
.empty { padding: 16px 4px; }
</style>
