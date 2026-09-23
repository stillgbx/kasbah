<script setup lang="ts">
import type { IconName } from '../../lib/strokeIcons'
import ArtThumb from '../ui/ArtThumb.vue'
import PulseDot from '../ui/PulseDot.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import ArtPlay from './ArtPlay.vue'

// Ligne de catalogue : pochette, titre (+ badge explicit), méta, durée / année à droite, et une
// action — ouvrir (artiste, album, playlist : toute la ligne s'ouvre) ou jouer (titre). La lecture est
// un cercle au milieu de la pochette ; une ligne qui s'ouvre peut aussi se jouer (`playable`). Mêmes
// hauteurs partout : la ligne 2 garde sa place même vide (espace insécable).
// Un titre peut aussi rejoindre la file (`queueable` : lire ensuite, ajouter à la fin) ou en sortir
// (`removable`) : petites touches à droite. Lecture et touches n'apparaissent qu'au SURVOL de la
// ligne (toujours là sur un écran tactile, qui n'en a pas) ; leur place est gardée — rien ne bouge.
// La racine est un `div` : un bouton de lecture ne peut pas vivre dans un `<button>`.
// `artless` (titres d'un album : la même pochette partout) : pas de vignette ; comme sur YouTube
// Music, le numéro devient ▶ au survol, et toucher la ligne (écran tactile) lance le titre.
const props = withDefaults(defineProps<{
  art: string | null
  icon?: IconName
  round?: boolean
  title: string
  explicit?: boolean
  meta?: string
  /** Colonne fixe à droite de la méta (durée d'un titre). */
  dur?: string
  /** Dernière colonne (année). */
  year?: string | null
  action: 'open' | 'play'
  /** Une ligne qui s'ouvre (album, artiste) peut aussi se jouer d'un geste. */
  playable?: boolean
  busy?: boolean
  disabled?: boolean
  selected?: boolean
  playLabel?: string
  queueable?: boolean
  removable?: boolean
  /** Rang dans la file (1, 2…) : colonne fixe devant la pochette. */
  position?: number | null
  /** Sans vignette : le numéro porte la lecture, la ligne entière se joue. */
  artless?: boolean
  /** Le titre joue en ce moment sur le lecteur choisi : un point pulse devant lui (place toujours gardée). */
  playing?: boolean
}>(), { icon: 'music', round: false, explicit: false, meta: '', dur: '', year: null, busy: false, disabled: false, selected: false, playLabel: undefined, queueable: false, removable: false, playable: false, position: null, artless: false, playing: false })
const emit = defineEmits<{ open: []; play: []; playNext: []; addEnd: []; remove: [] }>()
const playsOnRow = () => props.artless && props.action === 'play'
function activate() {
  if (props.action === 'open') emit('open')
  else if (playsOnRow() && !props.disabled && !props.busy) emit('play')
}
</script>

<template>
  <div class="row" :class="{ 'row--open': action === 'open' || (artless && action === 'play' && !disabled), 'row--artless': artless }" :data-selected="selected ? '1' : '0'"
       :role="action === 'open' || playsOnRow() ? 'button' : undefined" :tabindex="action === 'open' || playsOnRow() ? 0 : undefined"
       :aria-label="playsOnRow() ? playLabel : undefined"
       @click="activate" @keydown.enter.self="activate" @keydown.space.self.prevent="activate">
    <span v-if="position != null && !artless" class="pos" :class="{ 'pos--long': position > 999 }">#{{ position }}</span>
    <!-- sans vignette : le numéro, qui laisse place à ▶ au survol (et au sablier pendant l'envoi) -->
    <span v-if="artless" class="pos pos--play" :class="{ 'pos--long': (position ?? 0) > 999 }" :aria-busy="busy ? 'true' : undefined">
      <span class="pos__n">{{ position != null ? `#${position}` : '' }}</span>
      <v-progress-circular v-if="busy" class="pos__icon" indeterminate :size="16" :width="2" color="currentColor" />
      <StrokeIcon v-else class="pos__icon" name="play" :size="16" :stroke-width="2" />
    </span>
    <div v-if="!artless" class="row__art" :class="{ 'row__art--round': round }">
      <ArtThumb :src="art" :icon="icon" :round="round" />
      <ArtPlay v-if="action === 'play' || playable" :size="30" :disabled="disabled" :busy="busy" :label="playLabel" @click="$emit('play')" />
    </div>
    <div class="min0">
      <div class="line1">
        <!-- sur une ligne de titre seulement : sa place est gardée éteinte, le titre ne saute pas quand il s'allume -->
        <PulseDot v-if="action === 'play'" :on="playing" class="now" />
        <div class="title">{{ title }}</div>
        <span v-if="explicit" class="explicit" :title="$t('ytmusic.explicit')">E</span>
      </div>
      <div class="line2">
        <div class="meta muted">{{ meta || '\u00a0' }}</div>
        <span v-if="dur" class="dur muted">{{ dur }}</span>
        <span class="year muted">{{ year || '\u00a0' }}</span>
      </div>
    </div>
    <StrokeIcon v-if="action === 'open'" name="chevron" :size="16" class="chev" />
    <template v-else>
      <template v-if="queueable">
        <button type="button" class="mini" :disabled="disabled" :title="$t('music.playNext')" :aria-label="$t('music.playNext')" @click.stop="$emit('playNext')">
          <StrokeIcon name="queueNext" :size="18" />
        </button>
        <button type="button" class="mini" :disabled="disabled" :title="$t('music.addToQueue')" :aria-label="$t('music.addToQueue')" @click.stop="$emit('addEnd')">
          <StrokeIcon name="queueAdd" :size="18" />
        </button>
      </template>
      <!-- le titre qui joue ne sort pas de la file : sa touche garde sa place, invisible -->
      <button v-if="removable" type="button" class="mini" :class="{ 'is-hidden': selected }" :disabled="selected" :tabindex="selected ? -1 : 0"
              :title="$t('music.queueRemove')" :aria-label="$t('music.queueRemove')" @click.stop="$emit('remove')">
        <StrokeIcon name="close" :size="16" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.row {
  display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; padding: 8px 4px;
  border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent;
  color: inherit; text-align: left; font: inherit; cursor: default;
}
.row--open { cursor: pointer; }
.row--open:hover { background: var(--surface2); }
.row[data-selected='1'] { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.min0 { min-width: 0; flex: 1 1 0; display: grid; gap: 2px; }
.line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
/* le titre ne prend que sa place : le « E » le suit, au lieu d'être rejeté au bout de la ligne */
.title { flex: 0 1 auto; min-width: 0; font-size: 14px; font-weight: 500; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line2 { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 12px; }
.meta { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.explicit {
  flex: 0 0 auto; display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 3px;
  border-radius: 3px; border: 1px solid var(--muted); font-size: 10px; font-weight: 700; line-height: 1; color: var(--muted);
}
.dur, .year { flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.1; }
.year { min-width: 2.75rem; text-align: right; }
.chev { color: var(--muted); flex: 0 0 auto; }
.mini {
  flex: 0 0 auto; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 10px;
  background: transparent; color: var(--muted); transition: background .15s, color .15s;
}
.mini:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); }
.mini:disabled { opacity: .35; }
.is-hidden { visibility: hidden; }
.now { color: var(--accent); }
.row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
/* rang dans la file : largeur fixe EN PIXELS (jusqu'à #999) — en `ch` elle suivait la graisse, et la
   ligne en cours (numéro en gras) décalait sa pochette d'un pixel */
.pos { flex: 0 0 auto; width: 38px; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.pos--long { font-size: 10.5px; }
.row[data-selected='1'] .pos { color: var(--accent); font-weight: 600; }
/* sans vignette : la case du numéro prend la hauteur de la vignette (44 px), la ligne garde la sienne */
.pos--play { display: grid; place-items: center end; height: 44px; }
.pos--play > * { grid-area: 1 / 1; }
.pos__icon { opacity: 0; color: var(--text); }
.pos--play[aria-busy='true'] .pos__n { opacity: 0; }
.pos--play[aria-busy='true'] .pos__icon { opacity: 1; }
@media (hover: hover) {
  .row--artless:hover .pos__n { opacity: 0; }
  .row--artless:hover .pos__icon { opacity: 1; }
}
.row__art { position: relative; flex: 0 0 auto; border-radius: 8px; overflow: hidden; }
.row__art--round { border-radius: 999px; }
/* lecture et touches de file : au survol de la ligne seulement, place gardée ; pendant l'envoi le sablier reste */
@media (hover: hover) {
  .row :deep(.art-play), .row .mini { opacity: 0; }
  .row:hover :deep(.art-play), .row:focus-within :deep(.art-play), .row :deep(.art-play[aria-busy='true']),
  .row:hover .mini:not(:disabled), .row:focus-within .mini:not(:disabled) { opacity: 1; }
  .row:hover .mini:disabled { opacity: .35; }
}
</style>
