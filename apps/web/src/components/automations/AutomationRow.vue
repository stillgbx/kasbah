<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AutomationEntry } from '@kasbah/shared'
import { useAutomationNames } from '../../composables/useAutomationNames'
import { describeAutomation, HEALTH_DOT, triggerIcon } from '../../lib/automations'
import { formatAgo } from '../../lib/format'
import { useAutomationsStore } from '../../stores/automations'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Une automatisation dans la liste. Empreinte FIXE : deux lignes de texte qui défilent si elles
// débordent, une colonne de santé et une colonne d'horaires de largeurs réservées — basculer
// l'interrupteur, perdre un appareil ou voir passer une exécution ne décale rien.
const props = defineProps<{ entry: AutomationEntry; now: number }>()
const emit = defineEmits<{ open: [] }>()
const store = useAutomationsStore()
const { names } = useAutomationNames()
const { t, locale } = useI18n()

const a = computed(() => props.entry.automation)
const status = computed(() => props.entry.status)
const summary = computed(() => describeAutomation(a.value, names, t, locale.value))

const missingTitle = computed(() => {
  const m = status.value.missing.map((x) => (x.kind === 'device' ? names.deviceName(x.id) : x.id))
  const u = status.value.unavailableDeviceIds.map(names.deviceName)
  return [
    m.length ? t('automations.missing', { names: m.join(', ') }) : '',
    u.length ? t('automations.unavailableList', { names: u.join(', ') }) : '',
  ].filter(Boolean).join('\n')
})

const next = computed(() => {
  const at = status.value.nextRunAt
  if (at === undefined) return '—'
  return new Intl.DateTimeFormat(locale.value, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at))
})
const last = computed(() => {
  const run = status.value.lastRun
  return run ? formatAgo(run.at, props.now, locale.value) : '—'
})
const lastFailed = computed(() => status.value.lastRun?.outcome === 'failed' || status.value.lastRun?.outcome === 'partial')
const lastTitle = computed(() => {
  const run = status.value.lastRun
  if (!run) return t('automations.neverRun')
  const head = t(`automations.outcome.${run.outcome}`)
  return run.errors.length ? `${head}\n${run.errors.map((e) => `${e.deviceId ? `${names.deviceName(e.deviceId)} : ` : ''}${e.message}`).join('\n')}` : head
})
</script>

<template>
  <div class="row card" :data-on="a.enabled ? '1' : '0'">
    <button type="button" class="row__main" :aria-label="a.name" @click="emit('open')">
      <span class="icon-square row__icon" :data-on="a.enabled ? '1' : '0'"><StrokeIcon :name="triggerIcon(a.trigger)" :size="18" /></span>
      <span class="row__text">
        <MarqueeText class="row__name" :text="a.name" />
        <MarqueeText class="row__summary muted" :text="summary" />
      </span>
      <span class="row__health" :title="missingTitle || undefined">
        <span class="row__dot" :style="{ background: HEALTH_DOT[status.health] }" />
        <span class="row__health-label" :data-ok="status.health === 'ok' ? '1' : '0'">{{ $t(`automations.health.${status.health}`) }}</span>
      </span>
      <span class="row__times">
        <span :title="$t('automations.nextRun')">{{ next }}</span>
        <span :class="{ 'row__failed': lastFailed }" :title="lastTitle">{{ last }}</span>
      </span>
    </button>
    <!-- hors du bouton de la ligne : basculer n'ouvre pas l'éditeur -->
    <v-switch :model-value="a.enabled" :disabled="store.isBusy(a.id)" hide-details density="compact" class="row__switch"
              :aria-label="$t('automations.enable')" :title="$t('automations.enable')"
              @update:model-value="(v: boolean | null) => store.setEnabled(a.id, v === true)" />
    <StrokeIcon name="chevron" :size="16" class="row__chev" />
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 8px; height: 64px; padding: 0 10px 0 0; box-sizing: border-box; }
.row__main {
  flex: 1 1 0; min-width: 0; height: 100%; display: flex; align-items: center; gap: 12px; padding: 0 0 0 12px;
  border: 0; background: transparent; color: inherit; text-align: left; font: inherit;
}
.row__text { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
/* estompé désactivé : le nom et la phrase seulement, l'interrupteur reste net */
.row[data-on='0'] .row__icon, .row[data-on='0'] .row__text { opacity: .6; }
.row__name { font-size: 15px; font-weight: 600; }
.row__summary { font-size: 12px; }
/* point toujours là ; le mot n'apparaît que s'il y a quelque chose à dire, dans une place réservée */
.row__health { flex: 0 0 auto; width: 11ch; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.row__dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.row__health-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row__health-label[data-ok='1'] { visibility: hidden; }
.row__times {
  flex: 0 0 auto; width: 12ch; display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
  font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap;
}
.row__failed { color: #d24a43; }
.row__switch { flex: 0 0 auto; }
.row__chev { flex: 0 0 auto; color: var(--muted); }
/* téléphone : le nom et la phrase d'abord ; la santé se réduit à son point, les horaires ne tiennent
   plus. Décidé par la largeur de l'écran, jamais par l'état : rien ne bouge en cours d'usage. */
@media (max-width: 600px) {
  .row__health { width: auto; }
  .row__health-label, .row__times, .row__chev { display: none; }
}
</style>
