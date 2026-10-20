<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAgendaStore } from '../stores/agenda'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// The house calendars, in Settings → Plugins → agenda. A calendar is added by its secret iCal
// address (the server reads it right away and rejects anything that is not one), then you pick its
// color, move it up or down (the Calendar view lists them in that order), or remove it. The
// address never comes back from the server: it can only be pasted again.

/** The colors on offer; the server gives an added calendar the next one in the same list. */
const COLORS = ['#3f8cff', '#e5534b', '#2da44e', '#d38b22', '#a371f7', '#1bb3a7', '#db61a2', '#8d96a0']

const agenda = useAgendaStore()
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t, locale } = useI18n()

const health = computed(() => plugins.byId.agenda?.health)
const busy = ref(false)
const url = ref('')
const name = ref('')
const picking = ref<string | null>(null)

onMounted(() => { void agenda.load().catch(() => {}) })
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void agenda.load().catch(() => {}) })

const fail = (err: unknown) => notifications.error(t('errors.UNKNOWN', { name: 'Agenda', message: (err as Error).message }))

async function run(action: () => Promise<void>) {
  busy.value = true
  try {
    await action()
    // the plugin detail ("2 calendars") comes from the inventory: re-read along with health
    await Promise.all([devices.refreshHealth(), plugins.load()])
  } catch (err) { fail(err) }
  finally { busy.value = false }
}

const add = () => run(async () => {
  await agenda.add({ url: url.value.trim(), ...(name.value.trim() ? { name: name.value.trim() } : {}) })
  url.value = ''
  name.value = ''
})
const recolor = (id: string, color: string) => run(async () => {
  picking.value = null
  await agenda.update(id, { color })
})

/** Swaps a calendar with its neighbor (`-1` above, `+1` below). */
const move = (index: number, dir: -1 | 1) => run(async () => {
  const ids = agenda.calendars.map((c) => c.id)
  ;[ids[index], ids[index + dir]] = [ids[index + dir]!, ids[index]!]
  await agenda.reorder(ids)
})

// Removal: first press arms, second confirms, disarms by itself.
const armed = ref<string | null>(null)
let armTimer: ReturnType<typeof setTimeout> | null = null
function remove(id: string) {
  if (armed.value !== id) {
    armed.value = id
    if (armTimer) clearTimeout(armTimer)
    armTimer = setTimeout(() => { armed.value = null }, 5000)
    return
  }
  armed.value = null
  void run(() => agenda.remove(id))
}

const readAt = (ms: number | null) => (ms === null ? t('agenda.neverRead') : t('agenda.lastRead', { time: new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }).format(ms) }))
</script>

<template>
  <div class="ag card card--soft">
    <div v-for="(c, i) in agenda.calendars" :key="c.id" class="ag__cal">
      <div class="ag__row">
        <button type="button" class="ag__swatch" :style="{ background: c.color }" :title="$t('agenda.color', { name: c.name })"
                :aria-label="$t('agenda.color', { name: c.name })" :aria-expanded="picking === c.id" :disabled="busy"
                @click="picking = picking === c.id ? null : c.id" />
        <div class="min0 ag__main">
          <div class="ag__name">{{ c.name }}</div>
          <div class="small" :class="c.error ? 'ag__warn' : 'muted'">{{ c.error ? $t('agenda.readError', { message: c.error }) : readAt(c.fetchedAt) }}</div>
        </div>
        <div v-if="agenda.calendars.length > 1" class="ag__order">
          <button type="button" class="ag__move" :aria-label="$t('agenda.moveUp', { name: c.name })" :disabled="busy || i === 0" @click="move(i, -1)">
            <StrokeIcon name="chevronUp" :size="18" />
          </button>
          <button type="button" class="ag__move" :aria-label="$t('agenda.moveDown', { name: c.name })" :disabled="busy || i === agenda.calendars.length - 1" @click="move(i, 1)">
            <StrokeIcon name="chevronDown" :size="18" />
          </button>
        </div>
        <button type="button" class="pill ag__remove" :data-armed="armed === c.id ? '1' : '0'" :disabled="busy" @click="remove(c.id)">
          <StrokeIcon name="trash" :size="16" />{{ armed === c.id ? $t('agenda.removeConfirm') : $t('agenda.remove') }}
        </button>
      </div>
      <div v-if="picking === c.id" class="ag__palette">
        <button v-for="col in COLORS" :key="col" type="button" class="ag__swatch" :data-on="col === c.color ? '1' : '0'" :style="{ background: col }"
                :aria-label="col" :disabled="busy" @click="recolor(c.id, col)" />
      </div>
    </div>

    <form class="ag__form" @submit.prevent="add">
      <div class="ag__formtitle">{{ $t('agenda.addTitle') }}</div>
      <p class="muted small ag__hint">{{ $t('agenda.urlHint') }}</p>
      <label class="ag__field">
        <span class="muted small">{{ $t('agenda.urlLabel') }}</span>
        <input v-model="url" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="4096" :disabled="busy" class="ag__input"
               placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" />
      </label>
      <label class="ag__field">
        <span class="muted small">{{ $t('agenda.nameLabel') }}</span>
        <input v-model="name" type="text" autocomplete="off" maxlength="80" :disabled="busy" class="ag__input" :placeholder="$t('agenda.namePlaceholder')" />
      </label>
      <div>
        <button type="submit" class="pill" data-on="1" :disabled="busy || !url.trim()">
          <StrokeIcon name="plus" :size="16" />{{ $t('agenda.add') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.ag { padding: 14px 16px; display: grid; gap: 12px; }
.ag__cal { display: grid; gap: 8px; }
.ag__row { display: flex; align-items: center; gap: 12px; }
.ag__main { flex: 1 1 auto; }
.ag__name { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ag__swatch { flex: 0 0 auto; width: 24px; height: 24px; border-radius: 7px; border: 0; cursor: pointer; }
.ag__swatch[data-on='1'] { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text); }
.ag__palette { display: flex; gap: 10px; padding: 4px 0 4px 36px; flex-wrap: wrap; }
/* fixed width: "Remove" and "Confirm removal" take the same space */
.ag__remove { flex: 0 0 auto; width: 190px; justify-content: center; height: 34px; font-size: 13px; }
.ag__order { flex: 0 0 auto; display: flex; gap: 4px; }
/* an arrow with no neighbor stays in place, greyed out: the buttons do not shift */
.ag__move {
  width: 34px; height: 34px; border: 0; border-radius: 10px; background: transparent; color: var(--text);
  display: grid; place-items: center; cursor: pointer;
}
.ag__move:hover:not(:disabled) { background: var(--surface2); }
.ag__move:disabled { opacity: .25; cursor: default; }
.ag__remove[data-armed='1'] { color: #d24a43; border-color: #d24a43; }
.ag__warn { color: #d38b22; }
.ag__form { display: grid; gap: 10px; padding-top: 4px; border-top: 1px solid var(--line); }
.ag__cal + .ag__form, .ag__form:first-child { padding-top: 12px; }
.ag__form:first-child { border-top: 0; padding-top: 0; }
.ag__formtitle { font-size: 14px; font-weight: 600; }
.ag__hint { margin: 0; }
.ag__field { display: grid; gap: 4px; }
.ag__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.ag__input:disabled { opacity: .5; }
.small { font-size: 12px; }
</style>
