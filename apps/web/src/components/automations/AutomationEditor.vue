<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SUN_EVENTS, type AutomationBody, type Predicate, type StateTrigger, type SunEvent, type TimeTrigger } from '@kasbah/shared'
import { useAutomationNames } from '../../composables/useAutomationNames'
import {
  blankAction, blankAutomation, blankPredicate, describeAutomation, missingPart, PREDICATE_TYPES, triggerIcon, type ActionDraft,
} from '../../lib/automations'
import { useAutomationsStore } from '../../stores/automations'
import { useNotificationsStore } from '../../stores/notifications'
import { useScenesStore } from '../../stores/scenes'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import ActionEditor from './ActionEditor.vue'
import AddMenu from './AddMenu.vue'
import DayPills from './DayPills.vue'
import PredicateEditor from './PredicateEditor.vue'

// Éditeur d'une automatisation : « Quand », « Alors », « Sauf si ». Le BROUILLON est local — un
// message du serveur qui arrive pendant la frappe ne l'écrase pas — et ne part qu'à
// l'enregistrement. Page entière (`AutomationEditView`) : trois colonnes Quand / Alors / Sauf si.
const props = defineProps<{ id: string; isNew: boolean }>()
const emit = defineEmits<{ close: []; saved: [id: string] }>()
const store = useAutomationsStore()
const scenes = useScenesStore()
const notifications = useNotificationsStore()
const { names } = useAutomationNames()
const { t, locale } = useI18n()

function bodyOf(id: string): AutomationBody {
  const e = store.entries[id]
  if (!e) return blankAutomation()
  const { id: _id, updatedAt: _u, ...body } = e.automation
  return structuredClone(body)
}

const draft = ref<AutomationBody>(bodyOf(props.id))
const saved = ref(JSON.stringify(draft.value))
const dirty = computed(() => JSON.stringify(draft.value) !== saved.value)
const missing = computed(() => missingPart(draft.value))
const summary = computed(() => (missing.value ? '' : describeAutomation(draft.value, names, t, locale.value)))
const exists = computed(() => !!store.entries[props.id])

// ── déclencheur ──────────────────────────────────────────────────────────────────────────────
const trigger = computed(() => draft.value.trigger)
const triggerKind = computed<'clock' | 'sun' | 'state'>(() => (trigger.value.type === 'state' ? 'state' : trigger.value.at.kind))

// Chaque mode garde ce qu'on y a saisi le temps de l'édition (heure → soleil → heure rend l'heure),
// et passer de l'heure au soleil ne change que l'instant : jours et période restent.
let stash: { clock?: TimeTrigger['at']; sun?: TimeTrigger['at']; time?: TimeTrigger; state?: StateTrigger } = {}
function setTriggerKind(k: 'clock' | 'sun' | 'state') {
  const prev = trigger.value
  if (prev.type === 'time') { stash[prev.at.kind] = prev.at; stash.time = prev } else stash.state = prev
  if (k === 'state') {
    draft.value.trigger = stash.state ?? { type: 'state', when: blankPredicate('deviceOn') }
    return
  }
  const at = stash[k] ?? (k === 'sun' ? { kind: 'sun', event: 'dusk' } : { kind: 'clock', time: '07:30' })
  const base = prev.type === 'time' ? prev : stash.time
  draft.value.trigger = base ? { ...base, at } : { type: 'time', at }
}
const triggerOptions = computed(() => [
  { value: 'clock' as const, label: t('automations.trigger.clock') },
  { value: 'sun' as const, label: t('automations.trigger.sun') },
  { value: 'state' as const, label: t('automations.trigger.state') },
])
// L'aube et le crépuscule sont CIVILS (soleil à −6°) : le menu le dit sous leur nom, sinon « après le
// crépuscule » se lit « après son début », qui est le coucher.
const sunItems = computed(() => SUN_EVENTS.map((e) => ({
  value: e, title: t(`automations.sun.${e}`),
  // deux lignes permises : une colonne étroite (zoom 1,5) coupait la précision
  ...(e === 'dawn' || e === 'dusk' ? { subtitle: t(`automations.sunHint.${e}`), lines: 'two' as const } : {}),
})))

function setAt(patch: Record<string, unknown>) {
  const tr = trigger.value
  if (tr.type !== 'time') return
  const at = { ...tr.at, ...patch } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) if (v === '' || v === undefined) delete at[k]
  draft.value.trigger = { ...tr, at: at as typeof tr.at }
}
// Décalage au soleil : un SENS (avant, après) et des minutes. Le sens vit ici tant que le décalage
// est nul, sinon « après » choisi avant de taper le nombre serait perdu.
const initialOffset = trigger.value.type === 'time' && trigger.value.at.kind === 'sun' ? trigger.value.at.offsetMin ?? 0 : 0
const sunDir = ref<'before' | 'after'>(initialOffset > 0 ? 'after' : 'before')
const offsetAbs = computed(() => (trigger.value.type === 'time' && trigger.value.at.kind === 'sun' ? Math.abs(trigger.value.at.offsetMin ?? 0) : 0))
function setOffset(abs: number, dir = sunDir.value) {
  sunDir.value = dir
  const n = Math.min(720, Math.abs(Math.round(abs)))
  setAt({ offsetMin: Number.isFinite(n) && n > 0 ? (dir === 'after' ? n : -n) : undefined })
}
function setDays(days: number[] | undefined) {
  const tr = trigger.value
  if (tr.type !== 'time') return
  const { days: _d, ...rest } = tr
  draft.value.trigger = days ? { ...rest, days } : rest
}
function setRange(which: 'from' | 'to', value: string) {
  const tr = trigger.value
  if (tr.type !== 'time') return
  const { dateRange, ...rest } = tr
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const next = { from: dateRange?.from ?? iso, to: dateRange?.to ?? iso, [which]: value }
  draft.value.trigger = value ? { ...rest, dateRange: next } : rest
}
function setForMin(raw: string) {
  const tr = trigger.value
  if (tr.type !== 'state') return
  const n = Math.round(Number(raw))
  const { forMin: _f, ...rest } = tr
  draft.value.trigger = Number.isFinite(n) && n > 0 ? { ...rest, forMin: Math.min(1440, n) } : rest
}

// ── sauf si, alors ───────────────────────────────────────────────────────────────────────────
const predicateItems = computed(() => PREDICATE_TYPES.map((x) => ({ value: x, title: t(`automations.predicate.${x}`) })))
const actionItems = computed(() => [
  { value: 'command' as const, title: t('automations.action.command') },
  ...(scenes.count ? [{ value: 'recallScene' as const, title: t('automations.action.recallScene') }] : []),
])
const addUnless = (type: Predicate['type']) => { draft.value.unless = [...draft.value.unless, blankPredicate(type)] }
const setUnless = (i: number, p: Predicate) => { draft.value.unless = draft.value.unless.map((x, k) => (k === i ? p : x)) }
const removeUnless = (i: number) => { draft.value.unless = draft.value.unless.filter((_, k) => k !== i) }
const addAction = (type: ActionDraft['type']) => { draft.value.actions = [...draft.value.actions, blankAction(type)] }
const setAction = (i: number, x: ActionDraft) => { draft.value.actions = draft.value.actions.map((y, k) => (k === i ? x : y)) }
const removeAction = (i: number) => { draft.value.actions = draft.value.actions.filter((_, k) => k !== i) }

// ── pied ─────────────────────────────────────────────────────────────────────────────────────
// « Appliquer » enregistre et reste ; « Enregistrer » enregistre puis revient à la liste (directement
// s'il n'y a rien à enregistrer). `pending` dit lequel affiche « Enregistrement… ».
const pending = ref<'apply' | 'save' | null>(null)
async function save(close: boolean) {
  if (missing.value) return
  if (close && !dirty.value && exists.value) return emit('close')
  pending.value = close ? 'save' : 'apply'
  const e = await store.save(props.id, draft.value).finally(() => { pending.value = null })
  if (!e) return
  const { id: _id, updatedAt: _u, ...body } = e.automation
  draft.value = structuredClone(body)
  saved.value = JSON.stringify(draft.value)
  notifications.success(t('automations.toast.saved', { name: e.automation.name }))
  emit('saved', props.id)
  if (close) emit('close')
}

function cancel() {
  if (props.isNew && !exists.value) return emit('close')
  stash = {}
  draft.value = bodyOf(props.id)
  saved.value = JSON.stringify(draft.value)
}

async function runNow() {
  const run = await store.runNow(props.id)
  if (!run) return
  const name = draft.value.name
  if (!run.errors.length) notifications.success(t('automations.toast.ran', { name }))
  else notifications.error(t('automations.toast.ranWithErrors', { name, errors: run.errors.map((e) => `${e.deviceId ? `${names.deviceName(e.deviceId)} : ` : ''}${e.message}`).join(' · ') }))
}

// suppression en deux temps : le premier appui arme, le second (dans les 4 s) confirme
const removeArmed = ref(false)
let disarm: ReturnType<typeof setTimeout> | null = null
async function clickRemove() {
  if (!removeArmed.value) {
    removeArmed.value = true
    disarm = setTimeout(() => { removeArmed.value = false }, 4000)
    return
  }
  if (disarm) clearTimeout(disarm)
  removeArmed.value = false
  if (await store.remove(props.id)) emit('close')
}
onBeforeUnmount(() => { if (disarm) clearTimeout(disarm) })
</script>

<template>
  <div class="edit">
    <header class="edit__head">
      <button type="button" class="crumb" @click="emit('close')"><StrokeIcon name="back" :size="14" /> {{ $t('nav.automations') }}</button>
      <div class="edit__bar">
        <span class="icon-square icon-square--lg" data-on="1"><StrokeIcon :name="triggerIcon(draft.trigger)" :size="22" /></span>
        <input v-model="draft.name" class="edit__name" maxlength="80" :placeholder="$t('automations.editor.namePlaceholder')" :aria-label="$t('automations.editor.name')">
        <div class="edit__actions">
          <!-- place réservée pour une automatisation neuve : les boutons apparaissent sans rien déplacer -->
          <button type="button" class="pill edit__btn" :style="{ visibility: exists ? 'visible' : 'hidden' }" :disabled="dirty || store.isBusy(id)"
                  :title="dirty ? $t('automations.editor.runDirty') : $t('automations.editor.runNowHint')" @click="runNow">
            <StrokeIcon name="play" :size="14" /> {{ $t('automations.editor.runNow') }}
          </button>
          <button type="button" class="pill edit__btn" :class="{ 'edit__btn--armed': removeArmed }" :style="{ visibility: exists ? 'visible' : 'hidden' }"
                  :disabled="store.isBusy(id)" @click="clickRemove">
            {{ removeArmed ? $t('automations.editor.removeConfirm') : $t('automations.editor.remove') }}
          </button>
          <button type="button" class="pill edit__btn" :disabled="store.saving" @click="cancel">{{ $t('common.cancel') }}</button>
          <button type="button" class="pill edit__btn" :disabled="!!missing || store.saving || (!dirty && exists)" @click="save(false)">
            {{ pending === 'apply' ? $t('automations.editor.saving') : $t('automations.editor.apply') }}
          </button>
          <button type="button" class="pill edit__btn" data-on="1" :disabled="!!missing || store.saving" @click="save(true)">
            {{ pending === 'save' ? $t('automations.editor.saving') : $t('automations.editor.save') }}
          </button>
        </div>
      </div>
      <!-- deux lignes réservées pour la phrase, une pour l'indice : rien ne pousse les colonnes -->
      <p class="muted edit__summary">{{ summary || $t('automations.editor.summaryPending') }}</p>
      <p class="edit__hint" :data-warn="missing ? '1' : '0'">{{ missing ? $t(`automations.editor.missing.${missing}`) : (dirty ? $t('automations.editor.unsaved') : '') }}</p>
    </header>

    <!-- trois colonnes qui défilent chacune de leur côté, dans l'ordre où la règle se lit (quand,
         alors, sauf si) : une liste d'exceptions qui s'allonge ne pousse ni le déclencheur ni les actions -->
    <div class="edit__cols">
      <section class="col">
        <div class="section-label">{{ $t('automations.editor.when') }}</div>
        <Segmented dense fill :model-value="triggerKind" :options="triggerOptions" :label="$t('automations.editor.when')" @update:model-value="setTriggerKind" />
        <template v-if="trigger.type === 'time'">
          <div v-if="trigger.at.kind === 'clock'" class="line">
            <span class="muted line__label">{{ $t('automations.trigger.at') }}</span>
            <input type="time" class="field field--time" :value="trigger.at.time" :aria-label="$t('automations.trigger.at')"
                   @change="setAt({ time: ($event.target as HTMLInputElement).value || '07:30' })">
          </div>
          <template v-else>
            <div class="line">
              <input class="field field--num" type="text" inputmode="numeric" enterkeyhint="done" :value="String(offsetAbs)"
                     :aria-label="$t('automations.trigger.offset')" @change="setOffset(Number(($event.target as HTMLInputElement).value))">
              <span class="muted">min</span>
              <v-select class="grow" :model-value="sunDir"
                        :items="[{ value: 'before', title: $t('automations.trigger.before') }, { value: 'after', title: $t('automations.trigger.after') }]"
                        density="compact" variant="outlined" hide-details :aria-label="$t('automations.trigger.offset')"
                        @update:model-value="(v: 'before' | 'after') => setOffset(offsetAbs, v)" />
            </div>
            <v-select :model-value="trigger.at.event" :items="sunItems" item-props :label="$t('automations.trigger.sunEvent')" density="compact" variant="outlined" hide-details
                      @update:model-value="(e: SunEvent) => setAt({ event: e })" />
            <div class="line">
              <label class="pair"><span class="muted">{{ $t('automations.trigger.notBefore') }}</span>
                <input type="time" class="field" :value="trigger.at.notBefore ?? ''" @change="setAt({ notBefore: ($event.target as HTMLInputElement).value })"></label>
              <label class="pair"><span class="muted">{{ $t('automations.trigger.notAfter') }}</span>
                <input type="time" class="field" :value="trigger.at.notAfter ?? ''" @change="setAt({ notAfter: ($event.target as HTMLInputElement).value })"></label>
            </div>
          </template>
          <DayPills :model-value="trigger.days" @update:model-value="setDays" />
          <div class="line">
            <label class="pair"><span class="muted">{{ $t('automations.trigger.periodFrom') }}</span>
              <input type="date" class="field" :value="trigger.dateRange?.from ?? ''" @change="setRange('from', ($event.target as HTMLInputElement).value)"></label>
            <label class="pair"><span class="muted">{{ $t('automations.trigger.periodTo') }}</span>
              <input type="date" class="field" :value="trigger.dateRange?.to ?? ''" @change="setRange('to', ($event.target as HTMLInputElement).value)"></label>
          </div>
        </template>

        <template v-else>
          <PredicateEditor :model-value="trigger.when" @update:model-value="(p: Predicate) => trigger.type === 'state' && (draft.trigger = { ...trigger, when: p })" />
          <div class="line">
            <span class="muted line__label">{{ $t('automations.trigger.for') }}</span>
            <input class="field field--num" type="text" inputmode="numeric" enterkeyhint="done" :value="trigger.forMin ? String(trigger.forMin) : ''"
                   placeholder="0" :aria-label="$t('automations.trigger.for')" @change="setForMin(($event.target as HTMLInputElement).value)">
            <span class="muted">min</span>
          </div>
          <p class="muted hint">{{ $t('automations.trigger.stateHint') }}</p>
        </template>
      </section>

      <section class="col">
        <div class="section-label">{{ $t('automations.editor.then') }}</div>
        <ActionEditor v-for="(x, i) in draft.actions" :key="i" :model-value="x" @update:model-value="(y: ActionDraft) => setAction(i, y)" @remove="removeAction(i)" />
        <AddMenu :label="$t('automations.editor.addAction')" :items="actionItems" @pick="addAction" />
      </section>

      <section class="col">
        <div class="section-label">{{ $t('automations.editor.unless') }}</div>
        <PredicateEditor v-for="(p, i) in draft.unless" :key="i" :model-value="p" negatable removable
                         @update:model-value="(q: Predicate) => setUnless(i, q)" @remove="removeUnless(i)" />
        <AddMenu :label="$t('automations.editor.addCondition')" :items="predicateItems" @pick="addUnless" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.edit { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.edit__head { flex: 0 0 auto; display: grid; gap: 8px; padding: calc(var(--safe-top) + 16px) 24px 12px; }
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; justify-self: start; }
.crumb:hover { color: var(--text); }
.edit__bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.icon-square--lg { width: 44px; height: 44px; border-radius: 12px; flex: none; }
.edit__name {
  flex: 1 1 220px; min-width: 0; height: 40px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: 600 18px/1 var(--font);
}
.edit__actions { display: flex; gap: 8px; flex-wrap: wrap; }
/* boîtes FIXES : « Confirmer », « Enregistrement… » prennent la place du libellé sans rien pousser */
.edit__btn { width: 132px; justify-content: center; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.edit__btn--armed { border-color: var(--error, #e5484d); color: var(--error, #e5484d); }
.edit__summary {
  margin: 0; font-size: 13px; line-height: 17px; height: 34px; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.edit__hint { margin: 0; font-size: 12px; line-height: 16px; min-height: 16px; color: var(--muted); }
.edit__hint[data-warn='1'] { color: #d38b22; }

.edit__cols {
  flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px;
  padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px);
}
.col {
  min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
  padding: 14px; border-radius: var(--radius); background: var(--surface2);
}
/* un champ Vuetify grandit par défaut (`flex: 1 1 auto`) : dans une colonne, il s'étirait en hauteur */
.col > * { flex: 0 0 auto; }
/* téléphone : les cinq boutons en deux rangées de trois, pas une colonne de cinq */
@media (max-width: 600px) {
  .edit__actions { flex: 1 1 100%; }
  .edit__btn { width: calc((100% - 16px) / 3); }
}
/* écran étroit : les colonnes s'empilent et c'est la zone entière qui défile */
@media (max-width: 900px) {
  .edit__cols { grid-template-columns: minmax(0, 1fr); overflow-y: auto; align-content: start; }
  /* `min-height: auto` : avec le 0 du bureau, la grille de hauteur fixe écrasait les rangées et les
     colonnes se chevauchaient */
  .col { overflow: visible; min-height: auto; }
}
.line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.line__label { font-size: 13px; }
.grow { flex: 1 1 0; min-width: 0; }
.pair { flex: 1 1 0; min-width: 0; display: grid; gap: 2px; font-size: 11px; }
.field {
  width: 100%; min-width: 0; height: 36px; box-sizing: border-box; padding: 0 8px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--surface); color: var(--text); font: inherit; font-size: 14px;
  font-variant-numeric: tabular-nums; color-scheme: light dark;
}
.field--time { width: 9ch; flex: 0 0 auto; }
.field--num { width: 6ch; flex: 0 0 auto; text-align: right; }
.hint { margin: 0; font-size: 12px; line-height: 16px; min-height: 32px; }
</style>
