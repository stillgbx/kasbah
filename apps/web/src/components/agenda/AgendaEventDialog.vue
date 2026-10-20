<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgendaCalendar, AgendaEvent } from '../../api/transport'
import { addDays, fromKey } from '../../lib/agenda'
import StrokeIcon from '../ui/StrokeIcon.vue'

// An occurrence's sheet: when, where, in which calendar, and what its description says. Read-only,
// like the whole calendar for now.

const props = defineProps<{ event: AgendaEvent | null; calendar: AgendaCalendar | undefined }>()
const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n()

const when = computed(() => {
  const e = props.event
  if (!e) return ''
  const day = new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  if (e.allDay) {
    const start = fromKey(e.start)
    const last = addDays(fromKey(e.end), -1)
    return last > start ? t('agenda.range', { start: day.format(start), end: day.format(last) }) : `${day.format(start)} · ${t('agenda.allDay')}`
  }
  const time = new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' })
  const sameDay = new Date(e.start).toDateString() === new Date(e.end).toDateString()
  return sameDay
    ? `${day.format(e.start)} · ${time.format(e.start)} – ${time.format(e.end)}`
    : t('agenda.range', { start: `${day.format(e.start)} ${time.format(e.start)}`, end: `${day.format(e.end)} ${time.format(e.end)}` })
})
</script>

<template>
  <v-dialog :model-value="!!event" max-width="480" @update:model-value="(v: boolean) => { if (!v) emit('close') }">
    <div v-if="event" class="card ev">
      <div class="ev__head">
        <span class="ev__swatch" :style="{ background: calendar?.color ?? 'var(--muted)' }" />
        <h2 class="ev__title">{{ event.title || $t('agenda.noTitle') }}</h2>
        <button type="button" class="ev__close" :title="$t('agenda.close')" :aria-label="$t('agenda.close')" @click="emit('close')">
          <StrokeIcon name="close" :size="18" />
        </button>
      </div>
      <div class="ev__line"><StrokeIcon name="clock" :size="16" class="muted" /><span>{{ when }}</span></div>
      <div v-if="event.location" class="ev__line"><StrokeIcon name="pin" :size="16" class="muted" /><span>{{ event.location }}</span></div>
      <div v-if="calendar" class="ev__line"><StrokeIcon name="calendar" :size="16" class="muted" /><span>{{ calendar.name }}</span></div>
      <p v-if="event.description" class="ev__desc">{{ event.description }}</p>
    </div>
  </v-dialog>
</template>

<style scoped>
.ev { padding: 18px 20px 20px; display: grid; gap: 10px; box-shadow: var(--shadow); }
.ev__head { display: flex; align-items: flex-start; gap: 12px; }
.ev__swatch { flex: 0 0 auto; width: 14px; height: 14px; border-radius: 4px; margin-top: 5px; }
.ev__title { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 18px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.ev__close { flex: 0 0 auto; width: 32px; height: 32px; margin: -4px -6px 0 0; border: 0; border-radius: 10px; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
.ev__close:hover { background: var(--surface2); color: var(--text); }
.ev__line { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; }
.ev__line :deep(svg) { flex: 0 0 auto; margin-top: 2px; }
.ev__desc { margin: 4px 0 0; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--surface2); font-size: 13px; white-space: pre-line; overflow-wrap: anywhere; max-height: 40vh; overflow-y: auto; }
</style>
