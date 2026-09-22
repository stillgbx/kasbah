<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import { formatClock, useMediaPosition } from '../../composables/useMediaPosition'
import { deviceIcon } from '../../lib/deviceIcons'
import ArtThumb from '../ui/ArtThumb.vue'
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
const props = defineProps<{
  entry: DeviceEntry | null
  name: string
  session: { durationS: number | null; title?: string | null; artist?: string | null; artUrl?: string | null } | null
  pending: { title: string; artists: string[]; artUrl: string | null } | null
  transferMode: boolean
  canTransfer: boolean
  transferBusy: boolean
}>()
const emit = defineEmits<{ command: [cmd: CommandInput]; seek: [positionS: number]; transfer: []; cancelTransfer: [] }>()
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

const NBSP = '\u00a0'
/**
 * Une URL n'est pas un titre, ni l'identifiant hexadécimal d'une session du proxy : l'enceinte les
 * affiche le temps que les métadonnées arrivent — ou pour de bon quand le serveur a redémarré et ne
 * sait plus ce qu'elle joue.
 */
const looksLikeUrl = (v: string | undefined) => !!v && (/^(https?:\/\/|[a-z0-9.-]+\/api\/)/i.test(v) || /^[0-9a-f]{24}$/i.test(v.trim()))
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

// ---- position ------------------------------------------------------------------------------------
const { position: rawPosition, duration: deviceDuration, hasPosition } = useMediaPosition(toRef(() => state.value))
const duration = computed(() => deviceDuration.value ?? ours.value?.durationS ?? undefined)
const hasDuration = computed(() => duration.value !== undefined && duration.value !== null)
const position = computed<number | undefined>(() => {
  if (rawPosition.value === undefined) return undefined
  return duration.value ? Math.min(rawPosition.value, duration.value) : rawPosition.value
})
// Curseur : valeur locale pendant le glissement, puis `seek`. Après le relâcher, elle reste affichée
// tant que le lecteur n'a pas publié une position NOUVELLE — sinon le curseur revenait au dernier
// relevé, d'avant le geste, avant de rejoindre la position demandée.
const seekDraft = ref<number | null>(null)
const holding = ref(false)
watch(() => state.value?.nowPlaying?.positionS, () => { if (holding.value) { holding.value = false; seekDraft.value = null } })
watch(() => props.entry?.descriptor.id, () => { holding.value = false; seekDraft.value = null })
const canSeek = computed(() => hasDuration.value && !live.value && loaded.value && has('seek'))
const shownPosition = computed(() => seekDraft.value ?? position.value ?? 0)
function seekEnd(v: number) {
  holding.value = true
  emit('seek', Math.round(v))
}

// ---- volume : sourdine, −, curseur, +, valeur — comme la carte du panneau appareil ------------------
const VOLUME_STEP = 5
const volume = ref(state.value?.volume ?? 0)
watch(() => state.value?.volume, (v) => { volume.value = v ?? 0 })
function setVolume(v: number) {
  const next = Math.min(100, Math.max(0, Math.round(v)))
  volume.value = next
  emit('command', { type: 'media_player.set_volume', volume: next })
}
const volumeOk = computed(() => available.value && has('volume') && !state.value?.muted)
</script>

<template>
  <div class="bar" :data-empty="entry ? '0' : '1'">
    <!-- le morceau -->
    <div class="bar__track">
      <ArtThumb :key="art ?? 'none'" :src="art" :size="56" icon="music" class="bar__art" />
      <div class="bar__titles">
        <MarqueeText class="bar__title" :text="title" />
        <MarqueeText class="bar__sub muted" :text="subtitle" />
      </div>
    </div>

    <!-- transport + position, au centre de l'écran -->
    <div class="bar__center">
      <div class="bar__keys">
        <!-- emplacement vide qui répond à la touche stop : la rangée est symétrique, lecture est pile au centre -->
        <span class="key key--ghost" aria-hidden="true" />
        <button type="button" class="key" :disabled="!available || !has('track_skip') || !skippable"
                :title="$t('media.previous')" :aria-label="$t('media.previous')"
                @click="emit('command', { type: 'media_player.previous' })">
          <StrokeIcon name="skipPrev" :size="18" />
        </button>
        <button type="button" class="key key--main" :disabled="!!pending || !available || !loaded" :aria-busy="pending ? 'true' : undefined"
                :title="pending ? $t('ytmusic.starting') : state?.playback === 'playing' ? $t('common.pause') : $t('media.play')"
                :aria-label="pending ? $t('ytmusic.starting') : state?.playback === 'playing' ? $t('common.pause') : $t('media.play')"
                @click="emit('command', { type: state?.playback === 'playing' ? 'media_player.pause' : 'media_player.play' })">
          <v-progress-circular v-if="pending" indeterminate :size="22" :width="2" color="currentColor" />
          <StrokeIcon v-else :name="state?.playback === 'playing' ? 'pause' : 'play'" :size="20" />
        </button>
        <button type="button" class="key" :disabled="!available || !has('track_skip') || !skippable"
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
        <v-slider v-model="volume" class="bar__volume-slider" :min="0" :max="100" :step="1" :disabled="!volumeOk"
                  density="compact" hide-details color="primary" track-size="4" thumb-size="14" :aria-label="$t('media.volume')"
                  @end="(v: number) => setVolume(v)" />
        <button type="button" class="key key--tiny" :disabled="!volumeOk || volume >= 100" :aria-label="$t('media.volumeUp')" :title="$t('media.volumeUp')" @click="setVolume(volume + VOLUME_STEP)">
          <StrokeIcon name="plus" :size="14" />
        </button>
        <span class="pct muted">{{ has('volume') ? Math.round(volume) : '' }}</span>
      </div>
      <div class="bar__device">
        <span class="icon-square" :data-on="loaded ? '1' : '0'">
          <StrokeIcon :name="entry ? deviceIcon(entry.descriptor, entry.state) : 'speaker'" :size="18" />
        </span>
        <MarqueeText class="bar__device-name" :text="name || NBSP" />
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
.bar__title { font-size: 15px; font-weight: 600; line-height: 1.25; }
.bar__sub { font-size: 12.5px; line-height: 1.25; }

.bar__center { display: grid; gap: 2px; justify-items: center; min-width: 0; width: var(--center-w); }
.bar__keys { display: flex; align-items: center; gap: 8px; }
.key {
  display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .35; cursor: default; }
.key--main { width: 46px; height: 46px; border-radius: 999px; border-color: transparent; background: var(--accent); color: var(--on-accent); }
.key--main:hover:not(:disabled) { background: var(--accent); color: var(--on-accent); filter: brightness(1.06); }
.key--main:disabled[aria-busy='true'] { opacity: .85; }
.key--ghost { visibility: hidden; }
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
.bar__device-name { min-width: 0; width: 80px; font-size: 13px; font-weight: 500; }
/* largeur FIXE : « Transférer », « Annuler » et « Transfert… » se relaient dans la même touche sans
   décaler le volume ni le lecteur ; un libellé trop long est coupé */
.pill--transfer { height: 36px; width: 124px; padding: 0 12px; font-size: 13px; flex: 0 0 auto; justify-content: center; }
.pill--transfer span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar[data-empty='1'] .bar__title { color: var(--muted); }
</style>
