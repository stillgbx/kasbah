<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { JournalEntry } from '@kasbah/shared'
import { journalLabel, journalWhen } from '../../lib/journal'

/**
 * Le journal d'un appareil, en liste : pastille de gravité, jour et heure, texte du fabricant et
 * code. Une ligne qui SAIT où elle s'est produite est un bouton (`pick`) : la surface qui l'affiche
 * y emmène la carte ou la scène ; une ligne sans position ne mène nulle part et le dit.
 *
 * La liste a une hauteur BORNÉE (huit lignes) et défile au-delà : la carte qui la porte ne s'étire
 * pas au gré du journal — c'est ce qui la faisait sauter avant. Elle est en MONOSPACE, date à
 * largeur constante : un journal se lit en colonnes, comme un terminal (demande de l'utilisateur).
 */
defineProps<{ entries: readonly JournalEntry[]; active?: number | undefined }>()
const emit = defineEmits<{ pick: [entry: JournalEntry] }>()
const { locale } = useI18n()
</script>

<template>
  <div class="jl">
    <ul v-if="entries.length" class="jl__list">
      <li v-for="e in entries" :key="`${e.at}-${e.code}`" class="jl__row" :data-active="e.at === active ? '1' : '0'">
        <span class="jl__dot" :data-severity="e.severity" :title="$t(`mower.severity.${e.severity}`)" />
        <span class="muted jl__when">{{ journalWhen(e.at, locale) }}</span>
        <button v-if="e.location" type="button" class="jl__text jl__pick" :title="$t('mower.journalLocate')" @click="emit('pick', e)">{{ journalLabel(e) }}</button>
        <span v-else class="jl__text" :title="$t('mower.journalNoLocation')">{{ journalLabel(e) }}</span>
      </li>
    </ul>
    <p v-else class="muted jl__empty">{{ $t('mower.journalEmpty') }}</p>
  </div>
</template>

<style scoped>
/* huit lignes de 24 px, puis défilement : la hauteur ne dépend pas du journal ; monospace, comme un terminal */
.jl { max-height: 192px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.jl__list { margin: 0; padding: 0; list-style: none; display: grid; }
.jl__row { display: grid; grid-template-columns: 10px auto 1fr; align-items: center; gap: 8px; height: 24px; font-size: 12px; min-width: 0; padding: 0 4px; border-radius: 6px; }
.jl__row[data-active='1'] { background: var(--surface2); }
.jl__dot { width: 8px; height: 8px; border-radius: 999px; background: #8a94a6; }
.jl__dot[data-severity='warning'] { background: #d38b22; }
.jl__dot[data-severity='error'] { background: #d24a43; }
.jl__dot[data-severity='fatal'] { background: #d24a43; box-shadow: 0 0 0 2px rgb(210 74 67 / .35); }
.jl__when { white-space: nowrap; font-variant-numeric: tabular-nums; }
.jl__text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; min-width: 0; }
/* une ligne positionnée est un bouton, mais un bouton discret : le texte, souligné au survol */
.jl__pick { padding: 0; border: 0; background: none; color: var(--text); font: inherit; cursor: pointer; }
.jl__pick:hover, .jl__pick:focus-visible { text-decoration: underline; outline: none; }
.jl__empty { margin: 0; font-size: 12px; height: 24px; display: flex; align-items: center; }
</style>
