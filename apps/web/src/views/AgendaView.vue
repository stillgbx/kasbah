<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn, useLocalStorage } from '@vueuse/core'
import { getTransport } from '../api'
import type { AgendaEvent } from '../api/transport'
import PageHeader from '../components/layout/PageHeader.vue'
import AgendaEventDialog from '../components/agenda/AgendaEventDialog.vue'
import AgendaMonth from '../components/agenda/AgendaMonth.vue'
import AgendaTimeGrid from '../components/agenda/AgendaTimeGrid.vue'
import Segmented from '../components/ui/Segmented.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { addDays, AGENDA_MODES, byDay, dayKey, shift, startOfDay, visibleDays, type AgendaMode } from '../lib/agenda'
import { useAgendaStore } from '../stores/agenda'
import { usePluginsStore } from '../stores/plugins'

// Calendar view: the family's Google calendars (`agenda` plugin), read-only. The current month on
// arrival; week and day alongside. What is chosen here (mode, hidden calendars) is a
// preference of THIS device, kept in the browser.

const { t, locale } = useI18n()
const plugins = usePluginsStore()
const agenda = useAgendaStore()

const mode = useLocalStorage<AgendaMode>('kasbah.agenda.mode', 'month')
const hidden = useLocalStorage<string[]>('kasbah.agenda.hidden', [])
const anchor = ref(startOfDay(new Date()))

const now = ref(Date.now())
useIntervalFn(() => { now.value = Date.now() }, 60_000)
const today = computed(() => dayKey(new Date(now.value)))

const enabled = computed(() => plugins.byId.agenda?.enabled === true)
const days = computed(() => visibleDays(mode.value, anchor.value))
const from = computed(() => days.value[0]!.getTime())
const to = computed(() => addDays(days.value[days.value.length - 1]!, 1).getTime())

const events = shallowRef<AgendaEvent[]>([])
const failed = ref(false)
let ticket = 0
async function fetchEvents() {
  if (!enabled.value || !agenda.calendars.length) return
  const mine = ++ticket
  try {
    const res = await getTransport().agendaEvents(from.value, to.value)
    if (mine !== ticket) return
    events.value = res.events
    failed.value = false
  } catch {
    // we keep what is displayed: the grid does not empty out for a failed round trip
    if (mine === ticket) failed.value = true
  }
}

onMounted(async () => {
  if (!plugins.loaded) await plugins.load()
  if (enabled.value) await agenda.load().catch(() => { failed.value = true })
  await fetchEvents()
})
watch([from, to, () => agenda.calendars], fetchEvents)
// the server re-reads the feeds every ten minutes; we come back more often to follow its reads
useIntervalFn(() => {
  void agenda.load().catch(() => {})
  void fetchEvents()
}, 5 * 60_000)

const visible = computed(() => events.value.filter((e) => !hidden.value.includes(e.calendarId)))
const perDay = computed(() => byDay(visible.value, [days.value[0]!, days.value[days.value.length - 1]!]))
const colors = computed(() => new Map(agenda.calendars.map((c) => [c.id, c.color])))
const colorOf = (e: AgendaEvent) => colors.value.get(e.calendarId) ?? 'var(--muted)'

function toggle(id: string) {
  hidden.value = hidden.value.includes(id) ? hidden.value.filter((x) => x !== id) : [...hidden.value, id]
}

const modeOptions = computed(() => AGENDA_MODES.map((m) => ({ value: m, label: t(`agenda.modes.${m}`) })))
const go = (dir: 1 | -1) => { anchor.value = shift(mode.value, anchor.value, dir) }
const goToday = () => { anchor.value = startOfDay(new Date()) }
function pickDay(d: Date) {
  anchor.value = d
  mode.value = 'day'
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const title = computed(() => {
  const a = anchor.value
  if (mode.value === 'month') return capital(new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(a))
  if (mode.value === 'day') return capital(new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(a))
  const first = days.value[0]!
  const last = days.value[6]!
  return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(first, last)
})

const selected = ref<AgendaEvent | null>(null)
const selectedCalendar = computed(() => agenda.calendars.find((c) => c.id === selected.value?.calendarId))
</script>

<template>
  <div class="page">
    <PageHeader />

    <div v-if="!plugins.loaded" class="page__body" />
    <div v-else-if="!enabled || !agenda.calendars.length" class="page__body">
      <div class="card card--soft agenda__empty">
        <StrokeIcon name="calendar" :size="28" class="muted" />
        <p class="muted">{{ enabled ? $t('agenda.noCalendar') : $t('agenda.disabled') }}</p>
        <router-link :to="{ name: 'settings' }" class="pill">{{ $t('agenda.openSettings') }}</router-link>
      </div>
    </div>
    <div v-else class="page__body agenda">
      <div class="agenda__bar">
        <h1 class="agenda__title">{{ title }}</h1>
        <StrokeIcon v-if="failed" name="alert" :size="18" class="agenda__warn" :title="$t('agenda.unavailable')" />
        <button type="button" class="pill agenda__arrow" :title="$t('agenda.prev')" :aria-label="$t('agenda.prev')" @click="go(-1)">
          <StrokeIcon name="back" :size="18" />
        </button>
        <button type="button" class="pill" @click="goToday">{{ $t('agenda.today') }}</button>
        <button type="button" class="pill agenda__arrow" :title="$t('agenda.next')" :aria-label="$t('agenda.next')" @click="go(1)">
          <StrokeIcon name="chevron" :size="18" />
        </button>
        <Segmented v-model="mode" :options="modeOptions" :label="$t('agenda.modesLabel')" />
      </div>
      <div class="agenda__cals">
        <button v-for="c in agenda.calendars" :key="c.id" type="button" class="agenda__cal" :data-on="hidden.includes(c.id) ? '0' : '1'"
                :style="{ '--ev': c.color }" :title="c.error ? $t('agenda.staleOne', { name: c.name }) : $t('agenda.toggle', { name: c.name })"
                :aria-pressed="!hidden.includes(c.id)" @click="toggle(c.id)">
          <StrokeIcon v-if="c.error" name="alert" :size="14" class="agenda__calwarn" />
          <span v-else class="agenda__swatch" />
          <span class="agenda__calname">{{ c.name }}</span>
        </button>
      </div>
      <div class="agenda__view">
        <AgendaMonth v-if="mode === 'month'" :days="days" :month="anchor.getMonth()" :events="perDay" :color-of="colorOf" :today="today" :now="now"
                     @pick-day="pickDay" @pick-event="(e: AgendaEvent) => (selected = e)" />
        <AgendaTimeGrid v-else :key="mode" :days="days" :events="visible" :by-day="perDay" :color-of="colorOf" :today="today" :now="now"
                        @pick-day="pickDay" @pick-event="(e: AgendaEvent) => (selected = e)" />
      </div>
    </div>

    <AgendaEventDialog :event="selected" :calendar="selectedCalendar" @close="selected = null" />
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__body { flex: 1 1 auto; min-height: 0; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); display: flex; flex-direction: column; gap: 12px; }
.agenda__arrow { width: 40px; padding: 0; justify-content: center; flex: 0 0 auto; }
.agenda__bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-width: 0; height: 46px; }
.agenda__bar > .pill, .agenda__bar > .segmented { flex: 0 0 auto; }
/* the title takes the remaining space and is cut: a long month does not push the calendars */
.agenda__title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agenda__warn { flex: 0 0 auto; color: #d38b22; }
/* a fixed-height line: ten calendars scroll sideways rather than adding a row */
.agenda__cals { flex: 0 0 32px; min-width: 0; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
.agenda__cal {
  flex: 0 0 auto; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text);
  display: inline-flex; align-items: center; gap: 7px; font: 500 13px/1 var(--font); cursor: pointer; transition: opacity .15s;
}
.agenda__cal[data-on='0'] { opacity: .45; }
.agenda__cal[data-on='0'] .agenda__swatch { background: transparent; box-shadow: inset 0 0 0 2px var(--ev); }
.agenda__swatch { width: 10px; height: 10px; border-radius: 3px; background: var(--ev); flex: 0 0 auto; }
.agenda__calwarn { color: #d38b22; flex: 0 0 auto; }
.agenda__calname { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agenda__view { flex: 1 1 auto; min-height: 0; }
.agenda__empty { margin: auto; max-width: 460px; padding: 28px; display: grid; justify-items: center; gap: 12px; text-align: center; }
.agenda__empty p { margin: 0; }
</style>
