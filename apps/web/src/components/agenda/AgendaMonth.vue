<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize } from '@vueuse/core'
import type { AgendaEvent } from '../../api/transport'
import { dayKey } from '../../lib/agenda'

// Le mois : six semaines de sept jours, toujours. Chaque case montre autant d'occurrences que sa
// hauteur en tient, puis « +n autres » — le nombre de lignes se déduit de la taille de la grille,
// pas du contenu : une journée chargée ne pousse jamais ses voisines.

const props = defineProps<{
  days: Date[]
  /** Le mois affiché : les jours d'avant et d'après sont estompés. */
  month: number
  events: Map<string, AgendaEvent[]>
  colorOf: (e: AgendaEvent) => string
  today: string
}>()
const emit = defineEmits<{ pickDay: [day: Date]; pickEvent: [event: AgendaEvent] }>()
const { locale } = useI18n()

const grid = ref<HTMLElement | null>(null)
const { height } = useElementSize(grid)
const HEAD_PX = 28
const LINE_PX = 20
/** Lignes d'événements par case (numéro du jour déduit). */
const lines = computed(() => Math.max(1, Math.floor((height.value / 6 - HEAD_PX - 4) / LINE_PX)))

const weekdays = computed(() => {
  const f = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  return props.days.slice(0, 7).map((d) => f.format(d))
})
const timeFmt = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }))

const cells = computed(() => props.days.map((d) => {
  const key = dayKey(d)
  const list = props.events.get(key) ?? []
  const fits = list.length <= lines.value
  const shown = fits ? list : list.slice(0, lines.value - 1)
  return { d, key, shown, more: list.length - shown.length, out: d.getMonth() !== props.month }
}))

/** Un rendez-vous commencé la veille s'affiche sans heure : on ne lit pas « 22:00 » le lendemain. */
const startsOn = (e: AgendaEvent, key: string) => !e.allDay && dayKey(new Date(e.start)) === key
</script>

<template>
  <div class="month">
    <div class="month__weekdays">
      <div v-for="w in weekdays" :key="w" class="month__weekday muted">{{ w }}</div>
    </div>
    <div ref="grid" class="month__grid">
      <div v-for="c in cells" :key="c.key" class="month__cell" :data-out="c.out ? '1' : '0'" role="button" tabindex="0"
           @click="emit('pickDay', c.d)" @keydown.enter="emit('pickDay', c.d)">
        <div class="month__num" :data-today="c.key === today ? '1' : '0'">{{ c.d.getDate() }}</div>
        <button v-for="e in c.shown" :key="e.id" type="button" class="month__ev" :data-all="e.allDay ? '1' : '0'"
                :style="{ '--ev': colorOf(e) }" :title="e.title || $t('agenda.noTitle')" @click.stop="emit('pickEvent', e)">
          <span v-if="!e.allDay" class="month__dot" />
          <span v-if="startsOn(e, c.key)" class="month__time">{{ timeFmt.format(e.start as number) }}</span>
          <span class="month__title">{{ e.title || $t('agenda.noTitle') }}</span>
        </button>
        <div v-if="c.more" class="month__more muted">{{ $t('agenda.more', { n: c.more }, c.more) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.month { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.month__weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); flex: 0 0 auto; }
.month__weekday { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; padding: 0 8px 8px; }
.month__grid {
  flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-template-rows: repeat(6, minmax(0, 1fr));
  gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden;
}
.month__cell { background: var(--surface); padding: 4px 4px 0; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; cursor: pointer; }
.month__cell:hover { background: color-mix(in srgb, var(--surface) 92%, var(--text)); }
/* hors du mois : la case se fond vers le fond de page, dans les deux thèmes */
.month__cell[data-out='1'] { background: color-mix(in srgb, var(--surface) 45%, var(--bg)); }
.month__cell[data-out='1'] .month__num { color: var(--muted); }
.month__num {
  flex: 0 0 auto; height: 24px; min-width: 24px; align-self: flex-start; margin: 0 0 4px 2px; padding: 0 6px; border-radius: 999px;
  display: grid; place-items: center; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums;
}
.month__num[data-today='1'] { background: var(--accent); color: var(--on-accent); }
.month__ev {
  flex: 0 0 auto; height: 18px; margin-bottom: 2px; padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: var(--text);
  display: flex; align-items: center; gap: 5px; min-width: 0; font: 500 12px/18px var(--font); text-align: left; cursor: pointer;
}
.month__ev:hover { background: color-mix(in srgb, var(--ev) 14%, transparent); }
.month__ev[data-all='1'] { background: color-mix(in srgb, var(--ev) 22%, var(--surface)); box-shadow: inset 3px 0 0 var(--ev); padding-left: 8px; }
.month__dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--ev); }
.month__time { flex: 0 0 auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.month__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.month__more { flex: 0 0 auto; height: 18px; padding: 0 6px; font-size: 12px; line-height: 18px; font-weight: 600; }
</style>
