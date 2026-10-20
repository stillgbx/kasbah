<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SUN_EVENTS, type AutomationBody, type Predicate, type StateTrigger, type SunEvent, type TimeTrigger } from '@kasbah/shared'
import { useAutomationNames } from '../../composables/useAutomationNames'
import {
  blankAction, blankAutomation, blankPredicate, describeAutomation, duplicateBody, missingPart, newAutomationId, PREDICATE_TYPES, triggerIcon, type ActionDraft,
} from '../../lib/automations'
import { useAutomationsStore } from '../../stores/automations'
import { useNotificationsStore } from '../../stores/notifications'
import { useScenesStore } from '../../stores/scenes'
import MarqueeText from '../ui/MarqueeText.vue'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import ActionEditor from './ActionEditor.vue'
import AddMenu from './AddMenu.vue'
import DayPills from './DayPills.vue'
import PredicateEditor from './PredicateEditor.vue'

// Editor of an automation: "When", "Then", "Unless". The DRAFT is local — a server message that
// arrives while typing does not overwrite it — and is only sent on save. Full page
// (`AutomationEditView`): three columns When / Then / Unless.
const props = defineProps<{ id: string; isNew: boolean }>()
const emit = defineEmits<{ close: []; saved: [id: string]; open: [id: string] }>()
const store = useAutomationsStore()
const scenes = useScenesStore()
const notifications = useNotificationsStore()
const { names } = useAutomationNames()
const { t, locale } = useI18n()

function bodyOf(id: string): AutomationBody {
  const e = store.entries[id]
  if (!e) return blankAutomation()
  const { id: _id, updatedAt: _u, byAssistant: _b, ...body } = e.automation
  return structuredClone(body)
}

const draft = ref<AutomationBody>(bodyOf(props.id))
const saved = ref(JSON.stringify(draft.value))
const dirty = computed(() => JSON.stringify(draft.value) !== saved.value)
const missing = computed(() => missingPart(draft.value))
const summary = computed(() => (missing.value ? '' : describeAutomation(draft.value, names, t, locale.value)))
const exists = computed(() => !!store.entries[props.id])
// Written by an assistant (MCP) and not yet reviewed here: "Apply" approves it even without changes.
const byAssistant = computed(() => store.entries[props.id]?.automation.byAssistant)
const assistantNote = computed(() => {
  const b = byAssistant.value
  if (!b) return ''
  const at = new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(b.at))
  return b.user ? t('automations.editor.byAssistantUser', { user: b.user, at }) : t('automations.editor.byAssistant', { at })
})

// ── trigger ──────────────────────────────────────────────────────────────────────────────────
const trigger = computed(() => draft.value.trigger)
const triggerKind = computed<'clock' | 'sun' | 'state'>(() => (trigger.value.type === 'state' ? 'state' : trigger.value.at.kind))

// Each mode keeps what was typed into it for the duration of the edit (time → sun → time gives the
// time back), and going from time to sun only changes the instant: days and period stay.
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
// Dawn and dusk are CIVIL (sun at −6°): the menu says so under their name, otherwise "after dusk"
// reads as "after its start", which is sunset.
const sunItems = computed(() => SUN_EVENTS.map((e) => ({
  value: e, title: t(`automations.sun.${e}`),
  // two lines allowed: a narrow column (zoom 1.5) cut off the precision
  ...(e === 'dawn' || e === 'dusk' ? { subtitle: t(`automations.sunHint.${e}`), lines: 'two' as const } : {}),
})))

function setAt(patch: Record<string, unknown>) {
  const tr = trigger.value
  if (tr.type !== 'time') return
  const at = { ...tr.at, ...patch } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch)) if (v === '' || v === undefined) delete at[k]
  draft.value.trigger = { ...tr, at: at as typeof tr.at }
}
// Sun offset: a DIRECTION (before, after) and minutes. The direction lives here while the offset
// is zero, otherwise "after" chosen before typing the number would be lost.
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
/** Bound of "for at least", that of the schema; 0 or empty = no wait. */
const FOR_MAX = 1440
function setForMin(raw: string) {
  const tr = trigger.value
  if (tr.type !== 'state') return
  const n = Math.round(Number(raw))
  const { forMin: _f, ...rest } = tr
  draft.value.trigger = Number.isFinite(n) && n > 0 ? { ...rest, forMin: Math.min(FOR_MAX, n) } : rest
}
// Text being typed, shown in place of the draft until validation: a server message that redraws
// the page no longer puts the old value back into the field (see ActionEditor).
const forText = ref<string | null>(null)
function commitForMin(e: Event) {
  forText.value = null
  const input = e.target as HTMLInputElement
  setForMin(input.value)
  void nextTick(() => { input.value = trigger.value.type === 'state' && trigger.value.forMin ? String(trigger.value.forMin) : '' })
}

// ── unless, then ─────────────────────────────────────────────────────────────────────────────
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

// ── footer ───────────────────────────────────────────────────────────────────────────────────
// "Apply" saves and stays; "Save" saves then returns to the list (directly if there is nothing to
// save). `pending` says which one shows "Saving…".
const pending = ref<'apply' | 'save' | null>(null)
async function save(close: boolean) {
  if (missing.value) return
  if (close && !dirty.value && exists.value && !byAssistant.value) return emit('close')
  pending.value = close ? 'save' : 'apply'
  const e = await store.save(props.id, draft.value).finally(() => { pending.value = null })
  if (!e) return
  const { id: _id, updatedAt: _u, byAssistant: _b, ...body } = e.automation
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

// Copy of the SAVED version (button greyed out while there are changes), disabled, then opened: it
// is touched up before being enabled.
async function duplicate() {
  const id = newAutomationId()
  const e = await store.save(id, duplicateBody(bodyOf(props.id), t('automations.editor.copyName', { name: draft.value.name })))
  if (!e) return
  notifications.success(t('automations.toast.duplicated', { name: e.automation.name }))
  emit('open', id)
}

// deletion in two steps: the first press arms, the second (within 4 s) confirms
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
          <!-- reserved space for a new automation: the buttons appear without moving anything -->
          <button type="button" class="pill edit__btn" :style="{ visibility: exists ? 'visible' : 'hidden' }" :disabled="dirty || store.isBusy(id)"
                  :title="dirty ? $t('automations.editor.runDirty') : $t('automations.editor.runNowHint')" @click="runNow">
            <StrokeIcon name="play" :size="14" /> {{ $t('automations.editor.runNow') }}
          </button>
          <button type="button" class="pill edit__btn" :style="{ visibility: exists ? 'visible' : 'hidden' }" :disabled="dirty || store.saving"
                  :title="dirty ? $t('automations.editor.duplicateDirty') : $t('automations.editor.duplicateHint')" @click="duplicate">
            <StrokeIcon name="copy" :size="14" /> {{ $t('automations.editor.duplicate') }}
          </button>
          <button type="button" class="pill edit__btn" :class="{ 'edit__btn--armed': removeArmed }" :style="{ visibility: exists ? 'visible' : 'hidden' }"
                  :disabled="store.isBusy(id)" @click="clickRemove">
            {{ removeArmed ? $t('automations.editor.removeConfirm') : $t('automations.editor.remove') }}
          </button>
          <button type="button" class="pill edit__btn" :disabled="store.saving" @click="cancel">{{ $t('common.cancel') }}</button>
          <button type="button" class="pill edit__btn" :disabled="!!missing || store.saving || (!dirty && exists && !byAssistant)" @click="save(false)">
            {{ pending === 'apply' ? $t('automations.editor.saving') : $t('automations.editor.apply') }}
          </button>
          <button type="button" class="pill edit__btn" data-on="1" :disabled="!!missing || store.saving" @click="save(true)">
            {{ pending === 'save' ? $t('automations.editor.saving') : $t('automations.editor.save') }}
          </button>
        </div>
      </div>
      <!-- two lines reserved for the sentence, one for the hint: nothing pushes the columns -->
      <p class="muted edit__summary">{{ summary || $t('automations.editor.summaryPending') }}</p>
      <!-- one line, which scrolls if the hint is too long (phone): it does not push the columns -->
      <MarqueeText class="edit__hint" :data-warn="missing || (!dirty && byAssistant) ? '1' : '0'"
                   :text="missing ? $t(`automations.editor.missing.${missing}`) : (dirty ? $t('automations.editor.unsaved') : assistantNote)" />
    </header>

    <!-- three columns that each scroll on their own, in the order the rule reads (when,
         then, unless): a growing list of exceptions pushes neither the trigger nor the actions -->
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
            <input class="field field--num" type="text" inputmode="numeric" enterkeyhint="done" :value="forText ?? (trigger.forMin ? String(trigger.forMin) : '')"
                   placeholder="0" :aria-label="$t('automations.trigger.for')"
                   @input="forText = ($event.target as HTMLInputElement).value" @change="commitForMin">
            <span class="muted range">{{ $t('automations.editor.forMinRange', { min: 0, max: FOR_MAX }) }}</span>
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
/* FIXED boxes: "Confirm", "Saving…" take the label's place without pushing anything */
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
/* a Vuetify field grows by default (`flex: 1 1 auto`): in a column, it stretched in height */
.col > * { flex: 0 0 auto; }
/* phone: the six buttons in two rows of three, not a column of six */
@media (max-width: 600px) {
  .edit__actions { flex: 1 1 100%; }
  .edit__btn { width: calc((100% - 16px) / 3); }
}
/* narrow screen: the columns stack and the whole area scrolls */
@media (max-width: 900px) {
  .edit__cols { grid-template-columns: minmax(0, 1fr); overflow-y: auto; align-content: start; }
  /* `min-height: auto`: with the desktop's 0, the fixed-height grid squashed the rows and the
     columns overlapped */
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
.range { white-space: nowrap; }
.hint { margin: 0; font-size: 12px; line-height: 16px; min-height: 32px; }
</style>
