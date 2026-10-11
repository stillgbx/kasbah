<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AutomationEntry } from '@kasbah/shared'
import { useAutomationNames } from '../../composables/useAutomationNames'
import { describeActions, describeTrigger, describeUnless, HEALTH_DOT, triggerIcon } from '../../lib/automations'
import { formatAgo } from '../../lib/format'
import { useAutomationsStore } from '../../stores/automations'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Une automatisation dans la liste, lisible sans l'ouvrir : le nom, puis « Quand », « Alors » et
// « Sauf si » sur trois lignes étiquetées ; à droite, la prochaine exécution, la dernière et son issue,
// et l'état (ce qui manque, ce qui ne répond pas). Empreinte FIXE : chaque ligne est toujours là
// (« — » quand elle n'a rien à dire), chaque texte défile s'il déborde, la colonne de droite a sa
// largeur réservée — basculer, perdre un appareil ou voir passer une exécution ne décale rien.
// La poignée de gauche range la liste : le glissement lui-même est mené par la vue.
const props = defineProps<{ entry: AutomationEntry; now: number; dragged?: boolean }>()
const emit = defineEmits<{ open: []; grab: [ev: PointerEvent] }>()
const store = useAutomationsStore()
const { names } = useAutomationNames()
const { t, locale } = useI18n()

const a = computed(() => props.entry.automation)
const status = computed(() => props.entry.status)
const when = computed(() => describeTrigger(a.value.trigger, names, t, locale.value))
const unless = computed(() => describeUnless(a.value.unless, names, t, locale.value) || '—')
const then = computed(() => describeActions(a.value.actions, names, t))

const next = computed(() => {
  const at = status.value.nextRunAt
  if (at === undefined) return '—'
  return new Intl.DateTimeFormat(locale.value, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at))
})

const lastRun = computed(() => status.value.lastRun)
const last = computed(() => {
  const run = lastRun.value
  if (!run) return t('automations.neverRun')
  const outcome = run.outcome === 'partial' ? t('automations.outcomeShort.partial', run.errors.length) : t(`automations.outcomeShort.${run.outcome}`)
  return `${formatAgo(run.at, props.now, locale.value)} · ${outcome}`
})
const lastTone = computed(() => {
  const o = lastRun.value?.outcome
  return o === 'failed' || o === 'partial' ? 'bad' : o === 'skipped' ? 'muted' : 'ok'
})
const lastTitle = computed(() => {
  const run = lastRun.value
  if (!run?.errors.length) return undefined
  return run.errors.map((e) => `${e.deviceId ? `${names.deviceName(e.deviceId)} : ` : ''}${e.message}`).join('\n')
})

/** L'état en clair : ce qui manque d'abord (la règle ne peut pas marcher), puis ce qui ne répond pas. */
const state = computed(() => {
  const s = status.value
  if (s.health === 'incomplete') {
    const what = s.missing.map((m) => (m.kind === 'device' ? names.deviceName(m.id) : m.id)).join(', ')
    return t('automations.missingShort', { names: what })
  }
  if (s.health === 'unavailable') return t('automations.unavailableShort', { names: s.unavailableDeviceIds.map(names.deviceName).join(', ') })
  return t('automations.health.ok')
})
</script>

<template>
  <div class="row card" :data-on="a.enabled ? '1' : '0'" :data-automation="a.id" :data-dragged="dragged ? '1' : '0'">
    <button type="button" class="row__grip" :title="$t('automations.reorder')" :aria-label="$t('automations.reorder')" @pointerdown="emit('grab', $event)">
      <StrokeIcon name="grip" :size="16" />
    </button>
    <button type="button" class="row__main" :aria-label="a.name" @click="emit('open')">
      <span class="icon-square row__icon" :data-on="a.enabled ? '1' : '0'"><StrokeIcon :name="triggerIcon(a.trigger)" :size="18" /></span>
      <span class="row__text">
        <MarqueeText class="row__name" :text="a.name" />
        <span class="row__line"><span class="row__label">{{ $t('automations.editor.when') }}</span><MarqueeText class="row__value" :text="when" /></span>
        <span class="row__line"><span class="row__label">{{ $t('automations.editor.then') }}</span><MarqueeText class="row__value" :text="then" /></span>
        <span class="row__line"><span class="row__label">{{ $t('automations.editor.unless') }}</span><MarqueeText class="row__value" :text="unless" /></span>
      </span>
      <span class="row__side">
        <span class="row__line"><span class="row__label">{{ $t('automations.row.next') }}</span><span class="row__fact">{{ next }}</span></span>
        <span class="row__line"><span class="row__label">{{ $t('automations.row.last') }}</span><span class="row__fact" :data-tone="lastTone" :title="lastTitle">{{ last }}</span></span>
        <span class="row__line">
          <span class="row__label">{{ $t('automations.row.state') }}</span>
          <span class="row__fact row__state" :data-health="status.health" :title="state">
            <span class="row__dot" :style="{ background: HEALTH_DOT[status.health] }" /><span class="row__state-text">{{ state }}</span>
          </span>
        </span>
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
.row { display: flex; align-items: center; gap: 8px; height: 104px; padding: 0 10px 0 0; box-sizing: border-box; }
.row[data-dragged='1'] { outline: 2px solid var(--accent); opacity: .65; }
.row__grip {
  flex: 0 0 auto; display: grid; place-items: center; width: 28px; height: 28px; margin-left: 6px;
  border: 0; background: none; color: var(--muted); border-radius: 8px; cursor: grab; touch-action: none;
}
.row__grip:hover { background: var(--accent-soft); color: var(--accent); }
.row__grip:active { cursor: grabbing; }
.row__main {
  flex: 1 1 0; min-width: 0; height: 100%; display: flex; align-items: center; gap: 14px; padding: 0 0 0 2px;
  border: 0; background: transparent; color: inherit; text-align: left; font: inherit;
}
.row__icon { align-self: flex-start; margin-top: 12px; }
.row__text { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
/* estompé désactivé : le texte seulement, l'interrupteur reste net */
.row[data-on='0'] .row__icon, .row[data-on='0'] .row__text, .row[data-on='0'] .row__side { opacity: .6; }
.row__name { font-size: 15px; font-weight: 600; margin-bottom: 2px; }
.row__line { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 12px; line-height: 17px; }
/* étiquettes de largeur fixe : les trois valeurs commencent à la même colonne */
.row__label {
  flex: 0 0 auto; width: 7.5ch; color: var(--muted); font-size: 10px; font-weight: 600;
  letter-spacing: .05em; text-transform: uppercase; white-space: nowrap;
}
.row__value { flex: 1 1 0; min-width: 0; }
.row__side { flex: 0 0 auto; width: 30ch; display: flex; flex-direction: column; gap: 3px; }
.row__side .row__label { width: 9ch; }
.row__fact { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.row__fact[data-tone='bad'] { color: #d24a43; }
.row__fact[data-tone='muted'] { color: var(--muted); }
.row__state { display: flex; align-items: center; gap: 6px; }
.row__state[data-health='incomplete'] { color: #d38b22; }
.row__state[data-health='unavailable'] { color: #d24a43; }
.row__state-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.row__dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.row__switch { flex: 0 0 auto; }
.row__chev { flex: 0 0 auto; color: var(--muted); }
/* écran moyen : la colonne de droite se resserre */
@media (max-width: 1100px) {
  .row__side { width: 24ch; }
}
/* téléphone : le nom et les trois lignes d'abord ; les faits de droite ne tiennent plus. Décidé par la
   largeur de l'écran, jamais par l'état : rien ne bouge en cours d'usage. */
@media (max-width: 600px) {
  .row__side, .row__chev { display: none; }
  .row__label { width: 6.5ch; }
}
</style>
