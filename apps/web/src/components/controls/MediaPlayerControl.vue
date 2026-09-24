<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useLocalStorage } from '@vueuse/core'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import type { MusicRepeat } from '../../api/transport'
import { useMediaPosition, useSeekHold } from '../../composables/useMediaPosition'
import { useMusicSession } from '../../composables/useMusicSession'
import { streamQuality } from '../../lib/streamQuality'
import { useNotificationsStore } from '../../stores/notifications'
import ExplicitBadge from '../ui/ExplicitBadge.vue'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Contrôle d'un lecteur dans le panneau appareil. Règle « rien ne doit bouger » (voir le wiki,
// 4_0_langage-visuel) : le bloc « en cours » a toujours les MÊMES quatre lignes — titre, sous-titre,
// barre, temps — que quelque chose joue ou non. Sans morceau, le titre dit « Rien en diffusion » et le
// sous-titre l'état ; sans durée (radio en direct), la barre et les temps sont invisibles mais gardent
// leur place. Avant, la pause faisait disparaître trois lignes et remontait les touches d'autant.
/** `relayFrom` : nom du lecteur dont cet appareil joue le son (barre de son d'une TV) — voir `lib/audioRouting.ts`. */
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'media_player'>; pending?: boolean; disabled?: boolean; relayFrom?: string }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t } = useI18n()
const volume = ref(props.state.volume)
watch(() => props.state.volume, (v) => { volume.value = v })
const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const fmt = (s?: number) => (s === undefined ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)

// Le TITRE est déjà la grande valeur du panneau : le bloc ne répète rien de ce qu'on voit déjà. Il
// dit, dans l'ordre et sans doublon, l'artiste, l'album (s'il diffère du titre — un single porte le
// nom du morceau) et la source (l'appli). Deux lignes toujours présentes ; une ligne sans contenu
// garde sa hauteur (espace insécable). Sans titre — métadonnées en retard d'une seconde, ou appli qui
// n'en publiera jamais (état `on` de Netflix natif, Prime Video sur une TV Android) — la première
// ligne nomme l'appli.
const details = computed(() => {
  const n = props.state.nowPlaying
  // sans lecture propre mais le son d'un autre : on le dit (« Son de TV Salon ») plutôt que « Rien en diffusion »
  if (!n) return [props.relayFrom ? t('media.relaying', { name: props.relayFrom }) : t('media.nothing')]
  // Sans titre, on nomme l'appli — et rien de plus. Un « … » d'attente y tournait sans fin dès que
  // le titre ne devait jamais venir (appli native d'une TV Android : Prime Video, Netflix), et pour
  // le vrai cas d'attente (changement de morceau, métadonnées en retard d'une seconde) le nom de
  // l'appli est déjà ce qu'on aurait montré ensuite sur cette ligne.
  if (!n.title) return [n.source ?? '']
  const parts = [n.artist, n.album && n.album !== n.title ? n.album : undefined, n.source]
  return parts.filter((p, i, all): p is string => !!p && all.indexOf(p) === i)
})
const NBSP = '\u00a0'
const line1 = computed(() => details.value[0] || NBSP)
const line2 = computed(() => details.value[1] || NBSP)
// Position, durée et curseur tenu : les mêmes règles que la barre de la page Musique
// (`useMediaPosition`, `useSeekHold`) — une durée n'est une durée que positive, la position avance
// localement entre deux relevés et se fige net à la pause, et après un déplacement le curseur reste
// sur la cible tant qu'un vieux sondage la contredit.
const { position, duration, hasPosition } = useMediaPosition(toRef(() => props.state))
const hasDuration = computed(() => duration.value !== undefined)
// Précédent / lecture / suivant n'ont de sens que sur une session chargée (lecture ou pause) : au repos, ou
// appli à l'écran sans canal média (`on`, Netflix), le plugin refuserait — les touches sont grisées, comme
// dans la vue Médias. Le volume, lui, reste réglable.
const loaded = computed(() => props.state.playback === 'playing' || props.state.playback === 'paused')
// Un DIRECT (radio, chaîne d'info) n'a ni piste voisine ni début où revenir : précédent et suivant y
// sont grisés. Ils étaient actifs, et « précédent » coupait le flux pour de bon (le plugin envoyait un
// SEEK à 0 comme sur un morceau) — voir 6_1_pieges-runtime. Lecture / pause et le volume, eux, marchent.
const live = computed(() => props.state.nowPlaying?.live === true)
const skippable = computed(() => loaded.value && !live.value)

// Le flux que Kasbah sert à ce lecteur (lancé depuis la page Musique) : sa qualité, et sa FILE, qui
// pilote précédent / suivant et la répétition — l'enceinte n'a qu'un « fichier » et n'aurait rien à
// sauter. Même rangée de touches que la barre de la page Musique : répéter, précédent, −10 s, lecture,
// +10 s, suivant, stop ; une touche inutilisable (direct, pas de file) reste à sa place, grisée.
const { session, station, step, setRepeat } = useMusicSession(
  toRef(() => props.descriptor.id), toRef(() => props.state), toRef(() => has('play_url')))
// la session survit au morceau (TTL serveur) : elle ne dit plus rien de vrai une fois le lecteur au repos
const ours = computed(() => (loaded.value ? session.value : null))
const queue = computed(() => ours.value?.queue ?? null)
const canPrevious = computed(() => (queue.value ? loaded.value : has('track_skip') && skippable.value))
const canNext = computed(() => (queue.value ? loaded.value && queue.value.index < queue.value.length - 1 : has('track_skip') && skippable.value))
const repeat = computed<MusicRepeat>(() => queue.value?.repeat ?? 'off')
const NEXT_REPEAT: Record<MusicRepeat, MusicRepeat> = { off: 'once', once: 'loop', loop: 'off' }
const repeatLabel = computed(() => t(repeat.value === 'once' ? 'music.repeatOnce' : repeat.value === 'loop' ? 'music.repeatLoop' : 'music.repeatOff'))
// notre flux, ou la radio que le plugin a lancée ici (débit de l'annuaire) — voir lib/streamQuality
const quality = computed(() => streamQuality(t, ours.value?.quality, props.state, loaded.value ? station.value : null))
function failQueue(err: unknown) {
  useNotificationsStore().error(t('errors.UNKNOWN', { name: 'Kasbah', message: (err as Error).message }))
}
function skip(kind: 'next' | 'previous') {
  if (queue.value) step(kind).catch(failQueue)
  else emit('command', { type: kind === 'next' ? 'media_player.next' : 'media_player.previous' })
}

// Curseur de position : valeur locale pendant le glissement, puis `media_player.seek` au relâcher.
// Le curseur n'agit que sur un morceau à durée (un direct n'en a pas) et si l'appareil sait se placer.
const { seekDraft, beginSeek } = useSeekHold(toRef(() => props.state.nowPlaying?.positionS), toRef(() => props.descriptor.id))
const canSeek = computed(() => hasDuration.value && has('seek') && !live.value)
const shownPosition = computed(() => seekDraft.value ?? position.value ?? 0)
function seekEnd(v: number) {
  emit('command', { type: 'media_player.seek', positionS: beginSeek(v) })
}
/** Sauter de quelques secondes depuis la position AFFICHÉE : deux appuis rapides s'additionnent. */
const SEEK_STEP_S = 10
function jump(deltaS: number) {
  const max = duration.value ?? Number.MAX_SAFE_INTEGER
  emit('command', { type: 'media_player.seek', positionS: beginSeek(Math.min(max, Math.max(0, shownPosition.value + deltaS))) })
}

/** La page Musique, sur CE lecteur : même clé que son panneau « Écoute ». */
const router = useRouter()
const musicSession = useLocalStorage('kasbah.music.session', '')
function openInMusic() {
  musicSession.value = props.descriptor.id
  void router.push({ name: 'music' }).catch(() => { /* navigation redondante */ })
}

// Volume par pas de 5, depuis la valeur AFFICHÉE (le curseur peut être en avance sur l'état)
const VOLUME_STEP = 5
function nudgeVolume(delta: number) {
  const v = Math.min(100, Math.max(0, Math.round(volume.value) + delta))
  volume.value = v
  emit('command', { type: 'media_player.set_volume', volume: v })
}
</script>

<template>
  <div>
    <div class="now mb-3">
      <!-- un titre trop long défile doucement plutôt que d'être coupé (MarqueeText) -->
      <div class="now__line1">
        <ExplicitBadge v-if="state.nowPlaying?.explicit" />
        <MarqueeText class="text-subtitle-1 font-weight-medium" :text="line1" />
      </div>
      <MarqueeText class="text-body-2 text-medium-emphasis" :text="line2" />
      <!-- curseur de position et temps : invisibles sans durée (direct), mais l'espace reste réservé -->
      <v-slider class="now__seek" :class="{ 'now--hidden': !hasDuration }"
                :model-value="shownPosition" :min="0" :max="duration ?? 1" :step="1"
                :disabled="disabled || !canSeek" density="compact" hide-details color="primary" track-size="3" thumb-size="12"
                :aria-label="$t('media.seek')"
                @update:model-value="(v: number) => { seekDraft = v }" @end="seekEnd" />
      <!-- les temps s'affichent dès qu'une position est connue, même sans durée (direct, appli native
           d'une TV) : le total reste vide, l'emplacement des deux nombres ne bouge pas -->
      <!-- au milieu des temps, la qualité du flux — le nôtre ou celui d'une radio (vide sinon : la ligne ne bouge pas) -->
      <div class="now__times text-caption text-medium-emphasis">
        <span :class="{ 'now--hidden': !hasPosition && !hasDuration }">{{ fmt(shownPosition) || '0:00' }}</span>
        <span class="now__quality" :title="quality?.hint">{{ quality?.label ?? '' }}</span>
        <span class="now__end" :class="{ 'now--hidden': !hasPosition && !hasDuration }">{{ fmt(duration) }}</span>
      </div>
    </div>
    <!-- même rangée que la barre de la page Musique ; lecture pile au centre, répéter répond à stop -->
    <div class="keys mb-3">
      <v-btn icon class="key--step" :class="{ 'key--on': repeat !== 'off' }" variant="text" size="small" :disabled="disabled || !queue"
             :title="repeatLabel" :aria-label="repeatLabel" :aria-pressed="repeat !== 'off'"
             @click="setRepeat(NEXT_REPEAT[repeat]).catch(failQueue)">
        <v-icon icon="repeat" /><span class="key__step" :class="{ 'now--hidden': repeat === 'off' }" aria-hidden="true">{{ repeat === 'loop' ? '∞' : '1' }}</span>
      </v-btn>
      <v-btn icon="skipPrev" variant="tonal" :disabled="disabled || !canPrevious" :aria-label="$t('media.previous')" @click="skip('previous')" />
      <v-btn icon class="key--step" variant="text" size="small" :disabled="disabled || !loaded || !canSeek"
             :title="$t('media.jumpBack', { seconds: SEEK_STEP_S })" :aria-label="$t('media.jumpBack', { seconds: SEEK_STEP_S })" @click="jump(-SEEK_STEP_S)">
        <v-icon icon="rotateLeft" /><span class="key__step" aria-hidden="true">{{ SEEK_STEP_S }}</span>
      </v-btn>
      <v-btn :icon="state.playback === 'playing' ? 'pause' : 'play'" color="primary" size="large" :disabled="disabled || !loaded"
             @click="emit('command', { type: state.playback === 'playing' ? 'media_player.pause' : 'media_player.play' })" />
      <v-btn icon class="key--step" variant="text" size="small" :disabled="disabled || !loaded || !canSeek"
             :title="$t('media.jumpForward', { seconds: SEEK_STEP_S })" :aria-label="$t('media.jumpForward', { seconds: SEEK_STEP_S })" @click="jump(SEEK_STEP_S)">
        <v-icon icon="rotateRight" /><span class="key__step" aria-hidden="true">{{ SEEK_STEP_S }}</span>
      </v-btn>
      <v-btn icon="skipNext" variant="tonal" :disabled="disabled || !canNext" :aria-label="$t('media.next')" @click="skip('next')" />
      <v-btn icon="stop" variant="text" size="small" :disabled="disabled || !loaded" :aria-label="$t('music.stop')" :title="$t('music.stop')"
             @click="emit('command', { type: 'media_player.stop' })" />
    </div>
    <!-- volume sur UNE ligne qui se lit seule : sourdine, −, curseur, + — le − et le + encadrent le
         curseur qu'ils règlent, la valeur au bout — sans unité, comme les temps du morceau (une bulle sur
         la poignée passait par-dessus les touches de transport). Touches petites pour
         laisser la largeur au curseur. -->
    <div v-if="has('volume')" class="volume__row">
      <v-btn v-if="has('mute')" :icon="state.muted ? 'volumeOff' : 'volume'" variant="text" size="small" :disabled="disabled"
             :aria-label="state.muted ? $t('media.unmute') : $t('media.mute')"
             @click="emit('command', { type: 'media_player.set_mute', muted: !state.muted })" />
      <v-btn icon="minus" variant="text" size="x-small" :disabled="disabled || state.muted || volume <= 0" :aria-label="$t('media.volumeDown')" @click="nudgeVolume(-VOLUME_STEP)" />
      <v-slider v-model="volume" class="flex-grow-1" :min="0" :max="100" :step="1" :disabled="disabled || state.muted"
                hide-details :aria-label="$t('media.volume')"
                @end="(v: number) => emit('command', { type: 'media_player.set_volume', volume: Math.round(v) })" />
      <v-btn icon="plus" variant="text" size="x-small" :disabled="disabled || state.muted || volume >= 100" :aria-label="$t('media.volumeUp')" @click="nudgeVolume(VOLUME_STEP)" />
      <span class="text-caption volume-value">{{ Math.round(volume) }}</span>
    </div>
    <!-- vers la page Musique, sur ce lecteur : même pied que « Réglages » du panneau (libellé, pastille) -->
    <div class="card card--soft to-music">
      <span class="muted">{{ $t('media.musicPageHint') }}</span>
      <button type="button" class="pill" @click="openInMusic">
        <StrokeIcon name="music" :size="16" /> {{ $t('media.openInMusic') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.now--hidden { visibility: hidden; }
/* curseur de position : fin, collé au texte ; la poignée reste petite pour ne pas manger les temps */
.now__line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.now__line1 > :last-child { min-width: 0; flex: 1 1 auto; }
.now__seek { margin-top: 2px; }
/* chiffres à largeur fixe : une valeur qui défile ne fait pas frémir ses voisins */
.now__times { display: grid; grid-template-columns: 5ch minmax(0, 1fr) 5ch; align-items: center; font-variant-numeric: tabular-nums; }
.now__end { text-align: right; }
/* une info de connaisseur, pas de lecture : plus petite et plus pâle que les temps qui l'encadrent */
.now__quality { text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 10px; opacity: .6; letter-spacing: .02em; }
/* sept touches dans les 285 px du panneau : tailles fixées ici (celles de Vuetify débordaient de 32 px),
   réparties d'un bord à l'autre — lecture reste au centre, la rangée étant symétrique */
.keys { display: flex; align-items: center; justify-content: space-between; }
.keys > .v-btn { width: 36px; height: 36px; }
.keys > .v-btn--variant-tonal { width: 40px; height: 40px; }
.keys > .bg-primary { width: 50px; height: 50px; }
/* le pas (« 10 », « 1 », « ∞ ») vit AU CENTRE de la flèche, comme dans la barre de la page Musique */
.key--step :deep(.v-btn__content) { display: grid; }
.key--step :deep(.v-btn__content) > * { grid-area: 1 / 1; place-self: center; }
/* flèche de 26 px pour un chiffre de 8 : les proportions de la barre Musique, le chiffre ne touche pas le trait */
.key--step :deep(.v-icon) { font-size: 26px; width: 26px; height: 26px; }
.key__step { font-size: 8px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
.key--on { background: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-on-primary)); }
.to-music { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; padding: 12px 14px; font-size: 13px; }
.to-music .muted { min-width: 0; }
.to-music .pill { flex: 0 0 auto; }
.volume__row { display: flex; align-items: center; gap: 4px; }
/* largeur fixe (« 100 ») et chiffres à largeur constante : la valeur change sans faire bouger le curseur */
.volume-value { width: 3ch; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
