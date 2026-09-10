<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import MarqueeText from '../ui/MarqueeText.vue'

// Contrôle d'un lecteur dans le panneau appareil. Règle « rien ne doit bouger » (voir le wiki,
// 4_0_langage-visuel) : le bloc « en cours » a toujours les MÊMES quatre lignes — titre, sous-titre,
// barre, temps — que quelque chose joue ou non. Sans morceau, le titre dit « Rien en lecture » et le
// sous-titre l'état ; sans durée (radio en direct), la barre et les temps sont invisibles mais gardent
// leur place. Avant, la pause faisait disparaître trois lignes et remontait les touches d'autant.
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'media_player'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t } = useI18n()
const volume = ref(props.state.volume)
watch(() => props.state.volume, (v) => { volume.value = v })
const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const fmt = (s?: number) => (s === undefined ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)

// Le TITRE est déjà la grande valeur du panneau : le bloc ne répète rien de ce qu'on voit déjà. Il
// dit, dans l'ordre et sans doublon, l'artiste, l'album (s'il diffère du titre — un single porte le
// nom du morceau) et la source (l'appli). Deux lignes toujours présentes ; une ligne sans contenu
// garde sa hauteur (espace insécable). Métadonnées pas encore reçues (changement de morceau) : un
// « … » qui pulse doucement sur la première ligne, la source seule sur la seconde. Appli à l'écran
// sans canal média (`on`, Netflix natif) : le titre n'arrivera jamais, on nomme l'appli sans attendre.
const onScreen = computed(() => props.state.playback === 'on')
const waiting = computed(() => !!props.state.nowPlaying && !props.state.nowPlaying.title && !onScreen.value)
const details = computed(() => {
  const n = props.state.nowPlaying
  if (!n) return [t('media.nothing')]
  if (!n.title) return onScreen.value ? [n.source ?? ''] : ['…', n.source ?? '']
  const parts = [n.artist, n.album && n.album !== n.title ? n.album : undefined, n.source]
  return parts.filter((p, i, all): p is string => !!p && all.indexOf(p) === i)
})
const NBSP = '\u00a0'
const line1 = computed(() => details.value[0] || NBSP)
const line2 = computed(() => details.value[1] || NBSP)
const hasDuration = computed(() => !!props.state.nowPlaying?.durationS)
// Précédent / lecture / suivant n'ont de sens que sur une session chargée (lecture ou pause) : au repos, ou
// appli à l'écran sans canal média (`on`, Netflix), le plugin refuserait — les touches sont grisées, comme
// dans la vue Médias. Le volume, lui, reste réglable.
const loaded = computed(() => props.state.playback === 'playing' || props.state.playback === 'paused')

// Position : l'appareil ne la pousse pas, le plugin la relit toutes les dix secondes. Entre deux
// relevés, on la fait avancer ICI à la seconde tant que ça joue, à partir du dernier relevé reçu
// (repère local, posé quand la position ou le morceau change — pas `updatedAt`, qu'un simple
// changement de volume ferait bouger). Le relevé suivant recale, sans à-coup visible.
const anchor = ref({ pos: 0, at: 0 })
watch(() => [props.state.nowPlaying?.positionS, props.state.nowPlaying?.title, props.state.playback] as const,
  () => { anchor.value = { pos: props.state.nowPlaying?.positionS ?? 0, at: Date.now() } }, { immediate: true })
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => { ticker = setInterval(() => { if (props.state.playback === 'playing') now.value = Date.now() }, 500) })
onBeforeUnmount(() => clearInterval(ticker))
const position = computed<number | undefined>(() => {
  const n = props.state.nowPlaying
  if (!n) return undefined
  const p = props.state.playback === 'playing' ? anchor.value.pos + (now.value - anchor.value.at) / 1000 : (n.positionS ?? 0)
  return n.durationS ? Math.min(p, n.durationS) : p
})
// Curseur de position : valeur locale pendant le glissement, puis `media_player.seek` au relâcher.
// Le curseur n'agit que sur un morceau à durée (un direct n'en a pas) et si l'appareil sait se placer.
const seekDraft = ref<number | null>(null)
const canSeek = computed(() => hasDuration.value && has('seek'))
const shownPosition = computed(() => seekDraft.value ?? position.value ?? 0)
function seekEnd(v: number) {
  seekDraft.value = null
  emit('command', { type: 'media_player.seek', positionS: Math.round(v) })
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
      <MarqueeText class="text-subtitle-1 font-weight-medium" :class="{ 'now__waiting': waiting }" :text="line1" />
      <MarqueeText class="text-body-2 text-medium-emphasis" :text="line2" />
      <!-- curseur de position et temps : invisibles sans durée (direct), mais l'espace reste réservé -->
      <v-slider class="now__seek" :class="{ 'now--hidden': !hasDuration }"
                :model-value="shownPosition" :min="0" :max="state.nowPlaying?.durationS || 1" :step="1"
                :disabled="disabled || !canSeek" density="compact" hide-details color="primary" track-size="3" thumb-size="12"
                :aria-label="$t('media.seek')"
                @update:model-value="(v: number) => { seekDraft = v }" @end="seekEnd" />
      <div class="now__times d-flex justify-space-between text-caption text-medium-emphasis" :class="{ 'now--hidden': !hasDuration }">
        <span>{{ fmt(shownPosition) || '0:00' }}</span><span>{{ fmt(state.nowPlaying?.durationS) || '0:00' }}</span>
      </div>
    </div>
    <div class="d-flex align-center justify-center ga-3 mb-3">
      <v-btn v-if="has('track_skip')" icon="skipPrev" variant="tonal" size="large" :disabled="disabled || !loaded" @click="emit('command', { type: 'media_player.previous' })" />
      <v-btn :icon="state.playback === 'playing' ? 'pause' : 'play'" color="primary" size="x-large" :disabled="disabled || !loaded"
             @click="emit('command', { type: state.playback === 'playing' ? 'media_player.pause' : 'media_player.play' })" />
      <v-btn v-if="has('track_skip')" icon="skipNext" variant="tonal" size="large" :disabled="disabled || !loaded" @click="emit('command', { type: 'media_player.next' })" />
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
  </div>
</template>

<style scoped>
.now--hidden { visibility: hidden; }
/* curseur de position : fin, collé au texte ; la poignée reste petite pour ne pas manger les temps */
.now__seek { margin-top: 2px; }
/* repère d'attente : respiration lente de l'opacité, rien ne se déplace */
.now__waiting { animation: now-waiting 1.6s ease-in-out infinite; }
@keyframes now-waiting { 0%, 100% { opacity: .35; } 50% { opacity: .9; } }
@media (prefers-reduced-motion: reduce) { .now__waiting { animation: none; opacity: .6; } }
/* chiffres à largeur fixe : une valeur qui défile ne fait pas frémir ses voisins */
.now__times { font-variant-numeric: tabular-nums; }
.volume__row { display: flex; align-items: center; gap: 4px; }
/* largeur fixe (« 100 ») et chiffres à largeur constante : la valeur change sans faire bouger le curseur */
.volume-value { width: 3ch; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
