<script setup lang="ts">
import type { IconName } from '../../lib/strokeIcons'
import ArtThumb from '../ui/ArtThumb.vue'
import PlayButton from '../ui/PlayButton.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Ligne de catalogue : pochette, titre (+ badge explicit), méta, durée / année à droite, et une
// action — ouvrir (artiste, album, playlist : toute la ligne est le bouton) ou jouer (titre : bouton
// play au bout). Mêmes hauteurs partout : la ligne 2 garde sa place même vide (espace insécable).
withDefaults(defineProps<{
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
  busy?: boolean
  disabled?: boolean
  selected?: boolean
  playLabel?: string
}>(), { icon: 'music', round: false, explicit: false, meta: '', dur: '', year: null, busy: false, disabled: false, selected: false, playLabel: undefined })
defineEmits<{ open: []; play: [] }>()
</script>

<template>
  <component :is="action === 'open' ? 'button' : 'div'" :type="action === 'open' ? 'button' : undefined"
             class="row" :class="{ 'row--open': action === 'open' }" :data-selected="selected ? '1' : '0'"
             @click="action === 'open' && $emit('open')">
    <ArtThumb :src="art" :icon="icon" :round="round" />
    <div class="min0">
      <div class="line1">
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
    <PlayButton v-else :disabled="disabled" :busy="busy" :label="playLabel" @click="$emit('play')" />
  </component>
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
.title { flex: 1 1 auto; min-width: 0; font-size: 14px; font-weight: 500; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.line2 { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 12px; }
.meta { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.explicit {
  flex: 0 0 auto; display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 3px;
  border-radius: 3px; border: 1px solid var(--muted); font-size: 10px; font-weight: 700; line-height: 1; color: var(--muted);
}
.dur, .year { flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.1; }
.year { min-width: 2.75rem; text-align: right; }
.chev { color: var(--muted); flex: 0 0 auto; }
</style>
