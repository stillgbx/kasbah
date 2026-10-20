<script setup lang="ts">
import { nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { JournalEntry } from '@kasbah/shared'
import { journalLabel, journalWhen } from '../../lib/journal'

/**
 * A device's log, as a list: severity pill, day and time, vendor text and
 * code. A row that KNOWS where it happened is a button (`pick`): the surface that displays it
 * takes the map or the scene there; a row without a position leads nowhere and says so.
 *
 * The list has a BOUNDED height (eight rows) and scrolls beyond: the card that carries it does not
 * stretch with the log — that is what made it jump before. It is in MONOSPACE, date at
 * constant width: a log is read in columns, like a terminal (user request).
 */
const props = defineProps<{ entries: readonly JournalEntry[]; active?: number | undefined }>()
const emit = defineEmits<{ pick: [entry: JournalEntry] }>()
const { t, locale } = useI18n()

/** The tooltip says EVERYTHING: the text that the row cuts off, and what a click will do (or why it will do nothing). */
const titleOf = (e: JournalEntry) => `${journalLabel(e)}\n${t(e.location ? 'mower.journalLocate' : 'mower.journalNoLocation')}`

/** The active row — chosen here, or by a pin touched in the scene — comes into view. */
const rows: Record<number, HTMLElement | null> = {}
watch(() => props.active, (at) => {
  if (at === undefined) return
  void nextTick(() => rows[at]?.scrollIntoView({ block: 'nearest' }))
})
</script>

<template>
  <div class="jl">
    <ul v-if="entries.length" class="jl__list">
      <li v-for="e in entries" :key="`${e.at}-${e.code}`" :ref="(el) => { rows[e.at] = el as HTMLElement | null }"
          class="jl__row" :data-active="e.at === active ? '1' : '0'" :title="titleOf(e)">
        <span class="jl__dot" :data-severity="e.severity" :title="$t(`mower.severity.${e.severity}`)" />
        <span class="muted jl__when">{{ journalWhen(e.at, locale) }}</span>
        <button v-if="e.location" type="button" class="jl__text jl__pick" @click="emit('pick', e)">{{ journalLabel(e) }}</button>
        <span v-else class="jl__text">{{ journalLabel(e) }}</span>
      </li>
    </ul>
    <p v-else class="muted jl__empty">{{ $t('mower.journalEmpty') }}</p>
  </div>
</template>

<style scoped>
/* eight rows of 24 px, then scrolling: the height does not depend on the log; monospace, like a terminal */
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
/* a positioned row is a button, but a discreet button: the text, underlined on hover */
.jl__pick { padding: 0; border: 0; background: none; color: var(--text); font: inherit; cursor: pointer; }
.jl__pick:hover, .jl__pick:focus-visible { text-decoration: underline; outline: none; }
.jl__empty { margin: 0; font-size: 12px; height: 24px; display: flex; align-items: center; }
</style>
