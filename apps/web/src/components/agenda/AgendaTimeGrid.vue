<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgendaEvent } from '../../api/transport'
import { dayKey, isPast, layoutDay } from '../../lib/agenda'

// Semaine ou jour : une colonne par jour, les heures qui défilent, les journées entières dans une
// bande de hauteur FIXE au-dessus (deux lignes, puis « +n ») — une semaine chargée ne décale pas
// la grille. On arrive à 7 h, l'heure où la journée de la maison commence.

const props = defineProps<{
  days: Date[]
  events: AgendaEvent[]
  byDay: Map<string, AgendaEvent[]>
  colorOf: (e: AgendaEvent) => string
  today: string
  now: number
}>()
const emit = defineEmits<{ pickDay: [day: Date]; pickEvent: [event: AgendaEvent] }>()
const { locale } = useI18n()

const HOUR_PX = 48
const ALLDAY_LINES = 2
const hours = Array.from({ length: 24 }, (_, h) => h)

const scroller = ref<HTMLElement | null>(null)
onMounted(() => { if (scroller.value) scroller.value.scrollTop = 7 * HOUR_PX })

const headFmt = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: props.days.length === 1 ? 'long' : 'short' }))
const timeFmt = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }))
const hourLabel = (h: number) => timeFmt.value.format(new Date(2000, 0, 1, h))

const cols = computed(() => props.days.map((d) => {
  const key = dayKey(d)
  const allDay = (props.byDay.get(key) ?? []).filter((e) => e.allDay)
  const fits = allDay.length <= ALLDAY_LINES
  const shown = fits ? allDay : allDay.slice(0, ALLDAY_LINES - 1)
  return { d, key, allDay: shown, more: allDay.length - shown.length, placed: layoutDay(props.events, d) }
}))

const nowTop = computed(() => {
  const d = new Date(props.now)
  return (d.getHours() + d.getMinutes() / 60) * HOUR_PX
})
const blockStyle = (p: { startMin: number; endMin: number; col: number; cols: number; event: AgendaEvent }) => ({
  top: `${(p.startMin / 60) * HOUR_PX}px`,
  height: `${((p.endMin - p.startMin) / 60) * HOUR_PX - 2}px`,
  left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
  width: `calc(${100 / p.cols}% - 4px)`,
  '--ev': props.colorOf(p.event),
})
const range = (e: AgendaEvent) => (e.allDay ? '' : `${timeFmt.value.format(e.start)} – ${timeFmt.value.format(e.end)}`)
</script>

<template>
  <div class="tg" :style="{ '--n': days.length }">
    <div class="tg__row tg__head">
      <div />
      <button v-for="c in cols" :key="c.key" type="button" class="tg__day" :data-today="c.key === today ? '1' : '0'" @click="emit('pickDay', c.d)">
        <span class="tg__wd muted">{{ headFmt.format(c.d) }}</span>
        <span class="tg__num">{{ c.d.getDate() }}</span>
      </button>
    </div>
    <div class="tg__row tg__allday">
      <div class="tg__gutter muted">{{ $t('agenda.allDayShort') }}</div>
      <div v-for="c in cols" :key="c.key" class="tg__allcell">
        <button v-for="e in c.allDay" :key="e.id" type="button" class="tg__chip" :data-past="isPast(e, now) ? '1' : '0'" :style="{ '--ev': colorOf(e) }" :title="e.title || $t('agenda.noTitle')" @click="emit('pickEvent', e)">
          {{ e.title || $t('agenda.noTitle') }}
        </button>
        <button v-if="c.more" type="button" class="tg__more muted" @click="emit('pickDay', c.d)">{{ $t('agenda.more', { n: c.more }, c.more) }}</button>
      </div>
    </div>
    <div ref="scroller" class="tg__scroll">
      <div class="tg__row tg__body" :style="{ height: `${24 * HOUR_PX}px` }">
        <div class="tg__hours">
          <div v-for="h in hours" :key="h" class="tg__hour muted" :style="{ top: `${h * HOUR_PX}px` }">{{ h ? hourLabel(h) : '' }}</div>
        </div>
        <div v-for="c in cols" :key="c.key" class="tg__col" :data-today="c.key === today ? '1' : '0'">
          <button v-for="p in c.placed" :key="p.event.id" type="button" class="tg__ev" :data-past="isPast(p.event, now) ? '1' : '0'" :data-short="p.endMin - p.startMin < 45 ? '1' : '0'" :style="blockStyle(p)" :title="p.event.title || $t('agenda.noTitle')" @click="emit('pickEvent', p.event)">
            <span class="tg__evtitle">{{ p.event.title || $t('agenda.noTitle') }}</span>
            <span class="tg__evtime">{{ range(p.event) }}</span>
          </button>
          <div v-if="c.key === today" class="tg__now" :style="{ top: `${nowTop}px` }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tg { height: 100%; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.tg__row { display: grid; grid-template-columns: 56px repeat(var(--n), minmax(0, 1fr)); }
.tg__head { flex: 0 0 auto; border-bottom: 1px solid var(--line); }
.tg__day { border: 0; background: transparent; color: var(--text); padding: 8px 4px; display: flex; flex-direction: column; align-items: center; gap: 2px; cursor: pointer; min-width: 0; }
.tg__wd { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.tg__num { height: 30px; min-width: 30px; padding: 0 6px; border-radius: 999px; display: grid; place-items: center; font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
.tg__day[data-today='1'] .tg__num { background: var(--accent); color: var(--on-accent); }
/* deux lignes de 20 px et leurs marges : hauteur fixe quelle que soit la semaine */
.tg__allday { flex: 0 0 52px; border-bottom: 1px solid var(--line); }
.tg__gutter { font-size: 11px; padding: 6px 6px 0 0; text-align: right; }
.tg__allcell { border-left: 1px solid var(--line); padding: 4px 3px; display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow: hidden; }
.tg__chip {
  flex: 0 0 20px; border: 0; border-radius: 6px; padding: 0 6px; min-width: 0; text-align: left; cursor: pointer;
  background: color-mix(in srgb, var(--ev) 22%, var(--surface)); color: var(--text);
  font: 500 12px/20px var(--font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tg__chip[data-past='1'], .tg__ev[data-past='1'] { opacity: .45; }
.tg__more { flex: 0 0 20px; border: 0; background: transparent; text-align: left; padding: 0 6px; font: 600 12px/20px var(--font); cursor: pointer; }
/* la barre de défilement des heures prend sa largeur aussi en tête : les colonnes restent alignées */
.tg__head, .tg__allday { overflow-y: hidden; scrollbar-gutter: stable; }
.tg__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; }
.tg__body { position: relative; }
.tg__hours { position: relative; }
.tg__hour { position: absolute; right: 6px; transform: translateY(-50%); font-size: 11px; font-variant-numeric: tabular-nums; }
.tg__col {
  position: relative; border-left: 1px solid var(--line); min-width: 0;
  background-image: repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px 48px);
}
.tg__col[data-today='1'] { background-color: color-mix(in srgb, var(--accent) 4%, transparent); }
.tg__ev {
  position: absolute; border: 0; border-radius: 8px; padding: 3px 6px; overflow: hidden; cursor: pointer; text-align: left;
  display: flex; flex-direction: column; align-items: stretch; gap: 1px; min-width: 0;
  background: color-mix(in srgb, var(--ev) 22%, var(--surface)); color: var(--text);
}
/* moins de 45 min : pas la hauteur de deux lignes, titre et heure côte à côte */
.tg__ev[data-short='1'] { flex-direction: row; align-items: center; gap: 6px; padding-block: 0; }
.tg__ev[data-short='1'] .tg__evtitle { flex: 0 1 auto; min-width: 0; }
.tg__ev[data-short='1'] .tg__evtime { flex: 1 1 0; min-width: 0; }
.tg__ev:hover { background: color-mix(in srgb, var(--ev) 32%, var(--surface)); }
.tg__evtitle { font: 600 12px/15px var(--font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tg__evtime { font: 500 11px/14px var(--font); color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tg__now { position: absolute; left: 0; right: 0; height: 2px; background: #d24a43; pointer-events: none; z-index: 1; }
.tg__now::before { content: ''; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: #d24a43; }
</style>
