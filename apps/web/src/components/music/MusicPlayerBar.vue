<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import type { YtmusicRepeat, YtmusicStreamQuality } from '../../api/transport'
import { formatClock, useMediaPosition, useSeekHold } from '../../composables/useMediaPosition'
import { deviceIcon } from '../../lib/deviceIcons'
import ArtThumb from '../ui/ArtThumb.vue'
import ExplicitBadge from '../ui/ExplicitBadge.vue'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Lecteur en bas de la page Musique : ce que joue la SESSION choisie (un lecteur Cast / Sonos), et
// ses touches. Trois colonnes : le morceau à gauche, le transport et la position au CENTRE de
// l'écran, le volume et le lecteur à droite. Règle « rien ne bouge » : mêmes zones et même hauteur
// que quelque chose joue ou non ; sans durée, curseur et temps sont invisibles mais gardent leur
// place ; une touche sans capacité reste à sa place, grisée.
//
// `session` : le flux que NOUS servons à ce lecteur — un « fichier » de taille connue pour lui, donc
// la position est la sienne. Titre, artiste, pochette et durée viennent de la session quand il y en a
// une : l'enceinte, elle, publie parfois l'URL du flux ou le nom de l'appli le temps que les
// métadonnées arrivent, et pas toujours la durée. `pending` : titre
// en cours d'envoi (résolution yt-dlp : quelques secondes) — il s'affiche tout de suite, la touche
// centrale tourne, l'enceinte rattrape ensuite.
//
// La FILE du lecteur (`session.queue`) pilote précédent / suivant — l'enceinte n'a qu'un « fichier »
// et n'aurait rien à sauter — et la répétition du titre, dans l'emplacement qui répond à stop.
const props = defineProps<{
  entry: DeviceEntry | null
  name: string
  session: {
    durationS: number | null
    title?: string | null
    artist?: string | null
    artUrl?: string | null
    quality?: YtmusicStreamQuality | null
    queue?: { length: number; index: number; repeat: YtmusicRepeat } | null
  } | null
  pending: { title: string; artists: string[]; artUrl: string | null; explicit?: boolean } | null
  transferMode: boolean
  canTransfer: boolean
  transferBusy: boolean
  /** La file s'affiche dans la zone centrale de la page. */
  queueOpen: boolean
}>()
const emit = defineEmits<{
  command: [cmd: CommandInput]; seek: [positionS: number]; transfer: []; cancelTransfer: []
  repeat: [mode: YtmusicRepeat]; toggleQueue: []
}>()
const { t } = useI18n()

const state = computed<StateFor<'media_player'> | undefined>(() =>
  props.entry?.state.kind === 'media_player' ? props.entry.state : undefined)
const has = (c: string) => !!props.entry?.descriptor.capabilities.includes(c as never)
const available = computed(() => !!state.value?.available)
const loaded = computed(() => state.value?.playback === 'playing' || state.value?.playback === 'paused')
const live = computed(() => state.value?.nowPlaying?.live === true)
const skippable = computed(() => loaded.value && !live.value)
// La session proxy survit au morceau (TTL serveur) : après un arrêt ou un rechargement de la page,
// elle ne dit plus rien de vrai tant que le lecteur n'a rien de chargé — sinon la barre montrait une
// pochette et une durée pour « Rien ne joue ».
const ours = computed(() => (loaded.value ? props.session : null))

// ---- file et répétition ----------------------------------------------------------------------------
const queue = computed(() => ours.value?.queue ?? null)
// Précédent reste possible au premier titre : il ramène au début du morceau.
const canPrevious = computed(() => available.value && (queue.value ? loaded.value : has('track_skip') && skippable.value))
const canNext = computed(() => available.value && (queue.value ? loaded.value && queue.value.index < queue.value.length - 1 : has('track_skip') && skippable.value))
/** Titres qui attendent après le courant : pastille sur la touche File (le retour d'un « ajouter » sans toast). */
const waiting = computed(() => (queue.value ? Math.max(0, queue.value.length - queue.value.index - 1) : 0))
const repeat = computed<YtmusicRepeat>(() => queue.value?.repeat ?? 'off')
const NEXT_REPEAT: Record<YtmusicRepeat, YtmusicRepeat> = { off: 'once', once: 'loop', loop: 'off' }
const repeatLabel = computed(() => t(repeat.value === 'once' ? 'music.repeatOnce' : repeat.value === 'loop' ? 'music.repeatLoop' : 'music.repeatOff'))

const NBSP = '\u00a0'
/**
 * Une URL n'est pas un titre, ni l'identifiant hexadécimal d'une session du proxy : l'enceinte les
 * affiche le temps que les métadonnées arrivent — ou pour de bon quand le serveur a redémarré et ne
 * sait plus ce qu'elle joue.
 */
const looksLikeUrl = (v: string | undefined) => !!v && (/^(https?:\/\/|[a-z0-9.-]+\/api\/)/i.test(v) || /^[0-9a-f]{24}(\.[a-z0-9]{2,4})?$/i.test(v.trim()))
const art = computed(() => {
  if (props.pending) return props.pending.artUrl
  const n = state.value?.nowPlaying
  return n ? n.artUrl ?? ours.value?.artUrl ?? null : null
})
const title = computed(() => {
  if (props.pending) return props.pending.title
  const n = state.value?.nowPlaying
  if (!props.entry) return t('music.noSession')
  if (!n) return t('music.nothing')
  if (ours.value?.title) return ours.value.title
  return (looksLikeUrl(n.title) ? undefined : n.title) || n.source || t('media.playing')
})
const subtitle = computed(() => {
  if (props.pending) return props.pending.artists.join(', ') || t('ytmusic.starting')
  const s = state.value
  const n = s?.nowPlaying
  if (!s) return NBSP
  if (!n) return s.available ? t(`media.${s.playback}`) : t('common.unavailable')
  // notre flux : l'artiste du catalogue, sans le nom de l'appli réceptrice
  if (ours.value?.title) return ours.value.artist || NBSP
  const parts = [n.artist, n.album && n.album !== n.title ? n.album : undefined, n.source]
  return parts.filter((p, i, all): p is string => !!p && !looksLikeUrl(p) && all.indexOf(p) === i).join(' · ') || NBSP
})

// ---- qualité du flux ----------------------------------------------------------------------------
// Ce que l'enceinte reçoit de NOUS (toujours du MP3 à débit constant : c'est ce qui donne au flux
// une taille, donc une durée et un déplacement), et en info-bulle ce que YouTube nous a donné pour
// le produire. Une ligne, sous le nom du lecteur : on veut pouvoir juger la chaîne d'un coup d'œil,
// pas ouvrir le journal du serveur.
const MIME_LABELS: Record<string, string> = { 'audio/mpeg': 'MP3', 'audio/mp4': 'AAC', 'audio/webm': 'Opus', 'audio/ogg': 'Opus' }
const quality = computed(() => ours.value?.quality ?? null)
const qualityLine = computed(() => {
  const q = quality.value
  if (!q) return NBSP
  const label = MIME_LABELS[q.mime] ?? q.mime
  return q.bitrateKbps ? `${label} ${q.bitrateKbps}${NBSP}kb/s` : label
})
const qualityHint = computed(() => {
  const q = quality.value
  if (!q) return undefined
  const parts = [
    ...(q.sampleRateHz ? [`${q.sampleRateHz / 1000}${NBSP}kHz`] : []),
    ...(q.channels ? [q.channels === 2 ? t('music.stereo') : `${q.channels} ch`] : []),
  ]
  if (q.lengthBytes) parts.push(t('music.megabytes', { size: (q.lengthBytes / 1_000_000).toFixed(1) }))
  if (q.source) {
    const src = [q.source.ext?.toUpperCase(), q.source.abrKbps ? `${q.source.abrKbps}${NBSP}kb/s` : null].filter(Boolean).join(' ')
    if (src) parts.push(t('music.streamSource', { format: src }))
  }
  return parts.join(' · ')
})

// ---- position ------------------------------------------------------------------------------------
const { position: rawPosition, duration: deviceDuration, hasPosition } = useMediaPosition(toRef(() => state.value))
const duration = computed(() => deviceDuration.value ?? ours.value?.durationS ?? undefined)
const hasDuration = computed(() => duration.value !== undefined && duration.value !== null)
const position = computed<number | undefined>(() => {
  if (rawPosition.value === undefined) return undefined
  return duration.value ? Math.min(rawPosition.value, duration.value) : rawPosition.value
})
// Curseur : valeur locale pendant le glissement, puis tenu jusqu'à un relevé proche de la cible —
// sinon un vieux sondage faisait rebondir le pouce (clic → ancienne position → cible).
const { seekDraft, beginSeek } = useSeekHold(
  toRef(() => state.value?.nowPlaying?.positionS),
  toRef(() => props.entry?.descriptor.id),
)
const canSeek = computed(() => hasDuration.value && !live.value && loaded.value && has('seek'))
const shownPosition = computed(() => seekDraft.value ?? position.value ?? 0)
function seekEnd(v: number) {
  emit('seek', beginSeek(v))
}
/**
 * Sauter de quelques secondes : même chemin qu'un déplacement au curseur (le pouce est « tenu » sur
 * la cible tant qu'un vieux relevé la contredit), en partant de la position AFFICHÉE — deux appuis
 * rapides doivent s'additionner, pas se répéter sur un relevé qui n'a pas encore bougé.
 */
const SEEK_STEP_S = 10
function jump(deltaS: number) {
  const max = duration.value ?? Number.MAX_SAFE_INTEGER
  emit('seek', beginSeek(Math.min(max, Math.max(0, shownPosition.value + deltaS))))
}

// ---- volume : sourdine, −, curseur, +, valeur — comme la carte du panneau appareil ------------------
const VOLUME_STEP = 5
// Le réglage part à l'enceinte AU FIL du glissement : on entend ce qu'on règle sans relâcher.
// Pas à chaque pixel pour autant — un envoi au plus toutes les VOLUME_THROTTLE_MS, puis la valeur
// finale au relâché. Le relevé de l'appareil est ignoré tant que le pouce est tenu, sinon un
// sondage en retard ferait sauter le curseur sous le doigt.
const VOLUME_THROTTLE_MS = 200
const volume = ref(state.value?.volume ?? 0)
const sliding = ref(false)
let volumeSentAt = 0
let volumeTimer: ReturnType<typeof setTimeout> | undefined
watch(() => state.value?.volume, (v) => { if (!sliding.value) volume.value = v ?? 0 })
function sendVolume(v: number) {
  volumeSentAt = Date.now()
  emit('command', { type: 'media_player.set_volume', volume: v })
}
function setVolume(v: number) {
  const next = Math.min(100, Math.max(0, Math.round(v)))
  volume.value = next
  clearTimeout(volumeTimer)
  volumeTimer = undefined
  sendVolume(next)
}
function slideVolume(v: number) {
  sliding.value = true
  volume.value = Math.min(100, Math.max(0, Math.round(v)))
  if (volumeTimer) return // un envoi est déjà programmé : il prendra la dernière valeur
  const wait = VOLUME_THROTTLE_MS - (Date.now() - volumeSentAt)
  if (wait <= 0) { sendVolume(volume.value); return }
  volumeTimer = setTimeout(() => { volumeTimer = undefined; sendVolume(volume.value) }, wait)
}
function endVolume(v: number) {
  sliding.value = false
  setVolume(v)
}
onBeforeUnmount(() => clearTimeout(volumeTimer))
const volumeOk = computed(() => available.value && has('volume') && !state.value?.muted)

/**
 * Marqué par le service qui a lancé le titre (l'enceinte ne le dit jamais). Il suit la MÊME source
 * que le titre et la pochette : pendant l'envoi c'est le catalogue qui parle, sinon l'état du
 * lecteur. Sans ça, le badge arrivait en retard sur un titre explicit, et RESTAIT sur le suivant
 * jusqu'à ce que le flux démarre vraiment — alors que titre et pochette avaient déjà changé.
 */
const explicit = computed(() => (props.pending
  ? props.pending.explicit === true
  : state.value?.nowPlaying?.explicit === true))
</script>

<template>
  <div class="bar" :data-empty="entry ? '0' : '1'">
    <!-- le morceau -->
    <div class="bar__track">
      <ArtThumb :key="art ?? 'none'" :src="art" :size="56" icon="music" class="bar__art" />
      <div class="bar__titles">
        <div class="bar__line1">
          <MarqueeText class="bar__title" :text="title" />
          <ExplicitBadge v-if="explicit" />
        </div>
        <MarqueeText class="bar__sub muted" :text="subtitle" />
      </div>
      <!-- au bout du morceau, pas à droite : volume, lecteur et transfert remplissent déjà cette colonne à 1280 px -->
      <button type="button" class="key key--small key--queue" :data-on="queueOpen ? '1' : '0'" :disabled="!entry"
              :title="queueOpen ? $t('music.queueHide') : $t('music.queueShow')" :aria-label="queueOpen ? $t('music.queueHide') : $t('music.queueShow')"
              :aria-pressed="queueOpen" @click="emit('toggleQueue')">
        <StrokeIcon name="list" :size="16" />
        <!-- posée sur le coin : elle n'élargit rien quand elle apparaît -->
        <span class="key__badge" :class="{ 'bar--hidden': !waiting }" :title="$t('music.queueWaiting', { n: waiting }, waiting)">{{ waiting > 99 ? '99+' : waiting }}</span>
      </button>
    </div>

    <!-- transport + position, au centre de l'écran -->
    <div class="bar__center">
      <div class="bar__keys">
        <!-- répéter répond à la touche stop : la rangée est symétrique, lecture est pile au centre.
             Le pas (« 1 » une fois, « ∞ » en boucle) vit au centre des flèches, comme les sauts de 10 s. -->
        <button type="button" class="key key--repeat" :data-on="repeat !== 'off' ? '1' : '0'" :disabled="!available || !queue"
                :title="repeatLabel" :aria-label="repeatLabel" :aria-pressed="repeat !== 'off'"
                @click="emit('repeat', NEXT_REPEAT[repeat])">
          <StrokeIcon name="repeat" :size="24" />
          <span class="key__step" :class="{ 'bar--hidden': repeat === 'off' }" aria-hidden="true">{{ repeat === 'loop' ? '∞' : '1' }}</span>
        </button>
        <button type="button" class="key" :disabled="!canPrevious"
                :title="$t('media.previous')" :aria-label="$t('media.previous')"
                @click="emit('command', { type: 'media_player.previous' })">
          <StrokeIcon name="skipPrev" :size="18" />
        </button>
        <button type="button" class="key key--jump" :disabled="!available || !canSeek"
                :title="$t('media.jumpBack', { seconds: SEEK_STEP_S })" :aria-label="$t('media.jumpBack', { seconds: SEEK_STEP_S })"
                @click="jump(-SEEK_STEP_S)">
          <StrokeIcon name="rotateLeft" :size="24" />
          <span class="key__step" aria-hidden="true">{{ SEEK_STEP_S }}</span>
        </button>
        <button type="button" class="key key--main" :disabled="!!pending || !available || !loaded" :aria-busy="pending ? 'true' : undefined"
                :title="pending ? $t('ytmusic.starting') : state?.playback === 'playing' ? $t('common.pause') : $t('media.play')"
                :aria-label="pending ? $t('ytmusic.starting') : state?.playback === 'playing' ? $t('common.pause') : $t('media.play')"
                @click="emit('command', { type: state?.playback === 'playing' ? 'media_player.pause' : 'media_player.play' })">
          <v-progress-circular v-if="pending" indeterminate :size="22" :width="2" color="currentColor" />
          <StrokeIcon v-else :name="state?.playback === 'playing' ? 'pause' : 'play'" :size="20" />
        </button>
        <button type="button" class="key key--jump" :disabled="!available || !canSeek"
                :title="$t('media.jumpForward', { seconds: SEEK_STEP_S })" :aria-label="$t('media.jumpForward', { seconds: SEEK_STEP_S })"
                @click="jump(SEEK_STEP_S)">
          <StrokeIcon name="rotateRight" :size="24" />
          <span class="key__step" aria-hidden="true">{{ SEEK_STEP_S }}</span>
        </button>
        <button type="button" class="key" :disabled="!canNext"
                :title="$t('media.next')" :aria-label="$t('media.next')"
                @click="emit('command', { type: 'media_player.next' })">
          <StrokeIcon name="skipNext" :size="18" />
        </button>
        <button type="button" class="key" :disabled="!available || !loaded"
                :title="$t('music.stop')" :aria-label="$t('music.stop')"
                @click="emit('command', { type: 'media_player.stop' })">
          <StrokeIcon name="stop" :size="16" />
        </button>
      </div>
      <!-- invisible sans durée ni position (rien en cours), mais l'espace reste -->
      <div class="bar__seek" :class="{ 'bar--hidden': !hasDuration && !hasPosition }">
        <span class="time">{{ formatClock(shownPosition) || '0:00' }}</span>
        <v-slider :class="{ 'bar--hidden': !hasDuration }" :model-value="shownPosition" :min="0" :max="duration ?? 1" :step="1"
                  :disabled="!available || !canSeek" density="compact" hide-details color="primary" track-size="4" thumb-size="16"
                  :aria-label="$t('media.seek')"
                  @update:model-value="(v: number) => { seekDraft = v }" @end="seekEnd" />
        <span class="time time--end">{{ formatClock(duration ?? undefined) }}</span>
      </div>
    </div>

    <!-- volume + lecteur -->
    <div class="bar__right">
      <div class="bar__volume">
        <button type="button" class="key key--small" :disabled="!available || !has('mute')"
                :data-on="state?.muted ? '1' : '0'"
                :title="state?.muted ? $t('media.unmute') : $t('media.mute')" :aria-label="state?.muted ? $t('media.unmute') : $t('media.mute')"
                @click="emit('command', { type: 'media_player.set_mute', muted: !state?.muted })">
          <StrokeIcon :name="state?.muted ? 'volumeOff' : 'volume'" :size="16" />
        </button>
        <button type="button" class="key key--tiny" :disabled="!volumeOk || volume <= 0" :aria-label="$t('media.volumeDown')" :title="$t('media.volumeDown')" @click="setVolume(volume - VOLUME_STEP)">
          <StrokeIcon name="minus" :size="14" />
        </button>
        <v-slider :model-value="volume" class="bar__volume-slider" :min="0" :max="100" :step="1" :disabled="!volumeOk"
                  density="compact" hide-details color="primary" track-size="4" thumb-size="14" :aria-label="$t('media.volume')"
                  @update:model-value="slideVolume" @end="endVolume" />
        <button type="button" class="key key--tiny" :disabled="!volumeOk || volume >= 100" :aria-label="$t('media.volumeUp')" :title="$t('media.volumeUp')" @click="setVolume(volume + VOLUME_STEP)">
          <StrokeIcon name="plus" :size="14" />
        </button>
        <span class="pct muted">{{ has('volume') ? Math.round(volume) : '' }}</span>
      </div>
      <div class="bar__device">
        <span class="icon-square" :data-on="loaded ? '1' : '0'">
          <StrokeIcon :name="entry ? deviceIcon(entry.descriptor, entry.state) : 'speaker'" :size="18" />
        </span>
        <div class="bar__device-text">
          <MarqueeText class="bar__device-name" :text="name || NBSP" />
          <!-- emplacement gardé même sans flux à nous : la colonne ne bouge pas quand la lecture part -->
          <span class="bar__quality muted" :title="qualityHint">{{ qualityLine }}</span>
        </div>
      </div>
      <!-- Transférer devient Annuler le temps de choisir la cible : une seule touche, une seule place -->
      <button v-if="transferMode" type="button" class="pill pill--transfer" data-on="1" :disabled="transferBusy" @click="emit('cancelTransfer')">
        <StrokeIcon name="close" :size="16" />
        <span>{{ transferBusy ? $t('music.transferring') : $t('common.cancel') }}</span>
      </button>
      <button v-else type="button" class="pill pill--transfer" :disabled="!canTransfer"
              :title="canTransfer ? $t('music.transferTo') : $t('music.transferUnavailable')"
              @click="emit('transfer')">
        <StrokeIcon name="move" :size="16" />
        <span>{{ $t('music.transfer') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.bar {
  flex: 0 0 auto;
  height: 92px;
  display: grid;
  /* La colonne centrale est au milieu de l'ÉCRAN, pas de la barre : la barre commence après le rail,
     l'aile gauche est donc plus courte que la droite d'une demi-largeur de rail. Un « 1fr 1fr » aurait
     centré sur la page et le bouton lecture aurait paru décalé à droite. */
  /* La colonne centrale s'élargit avec l'écran (curseur de temps plus facile et plus précis) : à
     1280 px elle vaut 340, ce que l'aile droite tolère encore ; à 1920 px, 640. */
  --center-w: clamp(320px, calc(100vw - 940px), 640px);
  --bar-gap: 18px;
  grid-template-columns: calc(50% - var(--rail-w) / 2 - var(--center-w) / 2 - var(--bar-gap)) var(--center-w) minmax(0, 1fr);
  align-items: center;
  gap: var(--bar-gap);
  padding: 0 24px calc(var(--safe-bottom) + 0px);
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.bar__track { display: flex; align-items: center; gap: 14px; min-width: 0; }
.bar__art { border-radius: 8px; overflow: hidden; }
.bar__titles { min-width: 0; flex: 1 1 auto; display: grid; gap: 2px; }
.bar__line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.bar__title { min-width: 0; flex: 1 1 auto; font-size: 15px; font-weight: 600; line-height: 1.25; }
.bar__sub { font-size: 12.5px; line-height: 1.25; }

.bar__center { display: grid; gap: 2px; justify-items: center; min-width: 0; width: var(--center-w); }
/* Les touches de transport GRANDISSENT avec l'écran : à 1280 la rangée frôle déjà la zone du volume,
   à 1920 elle a de la place. Plafonné par la hauteur de la barre (92 px) : touche + curseur de
   position doivent y tenir. Le double (76 px) ne rentre ni dans l'une ni dans l'autre. */
.bar__keys {
  /* Largeur = celle de la colonne centrale, touches CENTRÉES dedans : quand la rangée déborde (écran
     étroit), elle déborde des DEUX côtés à égalité et la touche lecture reste au centre exact de
     l'écran. Sans ça la rangée partait du bord gauche de la colonne et lecture glissait à droite. */
  display: flex; align-items: center; justify-content: center; gap: 8px; width: var(--center-w);
  /* La HAUTEUR de la barre (92 px) borne la hauteur des touches : la colonne centrale empile la
     rangée et le curseur de position, et 42 px (lecture 50) est ce qui tient dans 88. On agit donc
     sur la LARGEUR — des touches oblongues, plus faciles à viser au doigt sans grandir la barre.
     Cette largeur suit l'écran, car l'espace libre entre le morceau (à gauche) et le volume (à
     droite) est ce qui la borne : ~376 px à 1280, ~682 px à 1920. */
  --key: 42px;
  --key-w: clamp(42px, calc(5.2vw - 24px), 84px);
  --key-main: calc(var(--key) * 1.1);
}
.key {
  display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
/* taille pilotée par la rangée, icône comprise : un seul réglage à changer */
.bar__keys .key { flex: 0 0 auto; width: var(--key-w); height: var(--key); border-radius: calc(var(--key) * .3); }
/* l'icône se règle sur la HAUTEUR : en pourcentage des deux côtés, elle s'étirerait avec la touche */
.bar__keys .key svg { height: 46%; width: auto; }
.bar__keys .key--jump svg, .bar__keys .key--repeat svg { height: 62%; }
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .35; cursor: default; }
.key--main { width: 46px; height: 46px; border-radius: 999px; border-color: transparent; background: var(--accent); color: var(--on-accent); }
.bar__keys .key--main { width: var(--key-main); height: var(--key-main); border-radius: 999px; }
.bar__keys .key--main svg { height: 44%; }
.key--main:hover:not(:disabled) { background: var(--accent); color: var(--on-accent); filter: brightness(1.06); }
.key--main:disabled[aria-busy='true'] { opacity: .85; }
.key--queue { position: relative; flex: 0 0 auto; }
.key__badge {
  position: absolute; top: -4px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
  background: var(--accent); color: var(--on-accent); font-size: 10px; font-weight: 700; line-height: 16px; text-align: center;
  font-variant-numeric: tabular-nums; pointer-events: none;
}
.key--queue[data-on='1'] .key__badge { background: var(--on-accent); color: var(--accent); }
/* le pas vit AU CENTRE de la flèche (même case de grille), comme sur les lecteurs de podcast */
.key--jump > *, .key--repeat > * { grid-area: 1 / 1; }
.key__step {
  /* assez petit pour NE PAS toucher la flèche : à 10 px sur une flèche de 22 les deux chiffres
     remplissaient le cercle bord à bord et l'ensemble devenait une tache */
  font-size: calc(var(--key) * .2); font-weight: 600; line-height: 1; letter-spacing: -.02em; font-variant-numeric: tabular-nums;
}
.key--small { width: 32px; height: 32px; border-radius: 10px; border-color: transparent; }
.key--tiny { width: 28px; height: 28px; border-radius: 8px; border-color: transparent; }
.key[data-on='1'] { background: var(--accent); color: var(--on-accent); }
.bar__seek { width: var(--center-w); display: grid; grid-template-columns: 4ch 1fr 4ch; align-items: center; gap: 8px; min-width: 0; }
.time { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.time--end { text-align: right; }
.bar--hidden { visibility: hidden; }

.bar__right { display: flex; align-items: center; gap: 14px; min-width: 0; width: 100%; justify-content: flex-end; }
.bar__volume { display: flex; align-items: center; gap: 2px; flex: 1 1 auto; min-width: 180px; max-width: 300px; }
.bar__volume-slider { flex: 1 1 auto; min-width: 90px; }
.pct { width: 3ch; font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
.bar__device { display: flex; align-items: center; gap: 8px; min-width: 0; }
.bar__device-text { display: grid; gap: 1px; min-width: 0; }
.bar__device-name { min-width: 0; width: 96px; font-size: 13px; font-weight: 500; }
/* discret : ce que sert le proxy, en dessous du nom, sur une ligne qui ne déborde jamais */
.bar__quality { width: 96px; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
/* largeur FIXE : « Transférer », « Annuler » et « Transfert… » se relaient dans la même touche sans
   décaler le volume ni le lecteur ; un libellé trop long est coupé */
.pill--transfer { height: 36px; width: 124px; padding: 0 12px; font-size: 13px; flex: 0 0 auto; justify-content: center; }
.pill--transfer span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar[data-empty='1'] .bar__title { color: var(--muted); }
</style>
