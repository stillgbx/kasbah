<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../../api'
import { ApiRequestError, type SystemVersion, type UpdateStatus, type UpdateStep } from '../../api/transport'
import { useNotificationsStore } from '../../stores/notifications'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Server update, in Settings: the commit in service, those waiting on `origin/main`, and the
// button that asks the supervisor (`scripts/supervisor.mjs`) to apply them. During the update,
// the state is re-read every second and a half; on restart the server goes quiet for a few
// seconds, read failures are then expected and silently ignored. The page reload follows through
// the "A new version of the app is available" banner (`AppUpdateBanner.vue`). Under the public
// address, refused (`LAN_ONLY`): the card says so, without requesting anything.

const POLL_MS = 1500
const MAX_LOG = 60

const notifications = useNotificationsStore()
const { t, locale } = useI18n()

const version = ref<SystemVersion | null>(null)
const status = ref<UpdateStatus | null>(null)
const lanOnly = ref(false)
const checking = ref(false)
let poll: ReturnType<typeof setInterval> | null = null

const updating = computed(() => status.value?.state === 'running')
const available = computed(() => version.value?.available ?? [])
const canUpdate = computed(() => !!version.value?.supervised && available.value.length > 0 && !updating.value && !checking.value)

const short = (sha: string | null | undefined) => (sha ?? '').slice(0, 7)
const when = (d: string | number) => new Date(d).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
const fail = (err: unknown) => notifications.error(t('errors.UNKNOWN', { name: t('serverUpdate.title'), message: (err as Error).message }))

/** The steps to show: the planned ones, plus the rollback if it happened. */
const steps = computed<UpdateStep[]>(() => {
  const s = status.value
  if (!s) return []
  return s.step === 'rollback' || s.rolledBack || (s.state === 'failed' && s.failedStep !== 'fetch' && s.error !== 'interrupted')
    ? [...s.steps, 'rollback']
    : s.steps
})
function stepState(step: UpdateStep): 'done' | 'active' | 'failed' | 'pending' {
  const s = status.value!
  const list = steps.value
  const at = (x: UpdateStep | null) => (x ? list.indexOf(x) : -1)
  if (s.state === 'running') {
    const cur = at(s.step)
    return list.indexOf(step) < cur ? 'done' : list.indexOf(step) === cur ? 'active' : 'pending'
  }
  if (s.state === 'done') return 'done'
  if (step === s.failedStep) return 'failed'
  if (step === 'rollback') return s.rolledBack ? 'done' : 'failed'
  return list.indexOf(step) < at(s.failedStep) ? 'done' : 'pending'
}
const STEP_ICON = { done: 'check', failed: 'alert', pending: 'dots' } as const

async function load(refresh = false) {
  checking.value = true
  try {
    const [v, s] = await Promise.all([getTransport().systemVersion(refresh), getTransport().systemUpdateStatus()])
    version.value = v
    status.value = s.status
    if (s.status?.state === 'running') follow()
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'LAN_ONLY') lanOnly.value = true
    else fail(err)
  } finally { checking.value = false }
}

function follow() {
  if (poll) return
  poll = setInterval(async () => {
    try {
      const s = (await getTransport().systemUpdateStatus()).status
      if (s) status.value = s
      if (s?.state !== 'running') { stop(); await load() }
    } catch { /* the server is restarting: we will re-read on the next turn */ }
  }, POLL_MS)
}
function stop() { if (poll) { clearInterval(poll); poll = null } }

async function start() {
  if (!canUpdate.value) return
  try {
    status.value = (await getTransport().systemUpdate()).status
    notifications.success(t('serverUpdate.started'))
    follow()
  } catch (err) { fail(err) }
}

onMounted(async () => {
  try {
    // a session means the public address: refused there, no point asking
    if ((await getTransport().session()).user) { lanOnly.value = true; return }
  } catch { /* no answer, what follows will say */ }
  await load()
})
onUnmounted(stop)

const failure = computed(() => {
  const s = status.value
  if (s?.state !== 'failed') return null
  if (s.error === 'interrupted') return t('serverUpdate.interrupted')
  return t('serverUpdate.failed', { step: t(`serverUpdate.steps.${s.failedStep ?? 'fetch'}`) })
})
const logText = computed(() => (status.value?.log ?? []).slice(-MAX_LOG).join('\n'))
</script>

<template>
  <div class="su">
    <div v-if="lanOnly" class="muted small">{{ $t('serverUpdate.lanOnly') }}</div>
    <template v-else>
      <div class="su__row">
        <StrokeIcon name="gear" :size="18" class="muted" />
        <div class="min0">
          <div class="muted small">{{ $t('serverUpdate.running') }}</div>
          <div class="su__line">
            <span class="mono">{{ short(version?.running?.sha) || '—' }}</span>
            <span class="su__subject">{{ version?.running?.subject ?? '' }}</span>
          </div>
        </div>
        <button type="button" class="pill su__btn" :disabled="checking || updating" @click="load(true)">{{ $t('serverUpdate.check') }}</button>
        <button type="button" class="pill su__btn" data-on="1" :disabled="!canUpdate" @click="start">{{ $t('serverUpdate.update') }}</button>
      </div>

      <!-- an always-present line: the text changes, the height does not -->
      <div class="small su__summary">
        <template v-if="version?.error">{{ $t('serverUpdate.gitError', { message: version.error }) }}</template>
        <template v-else-if="available.length">{{ $t('serverUpdate.available', { n: available.length }, available.length) }}</template>
        <template v-else-if="version">{{ $t('serverUpdate.upToDate') }}</template>
        <template v-else>{{ $t('common.loading') }}</template>
      </div>
      <ul v-if="available.length" class="su__commits">
        <li v-for="c in available" :key="c.sha" class="su__line">
          <span class="mono">{{ short(c.sha) }}</span>
          <span class="su__subject">{{ c.subject }}</span>
        </li>
      </ul>

      <div v-if="status" class="su__status">
        <div class="su__steps">
          <span v-for="s in steps" :key="s" class="su__step" :data-state="stepState(s)">
            <v-progress-circular v-if="stepState(s) === 'active'" indeterminate size="14" width="2" />
            <StrokeIcon v-else :name="STEP_ICON[stepState(s) as keyof typeof STEP_ICON]" :size="14" />
            {{ $t(`serverUpdate.steps.${s}`) }}
          </span>
        </div>
        <div v-if="updating" class="small">{{ $t('serverUpdate.inProgress') }}</div>
        <div v-else-if="status.state === 'done' && status.finishedAt" class="muted small">{{ $t('serverUpdate.done', { date: when(status.finishedAt) }) }}</div>
        <template v-else-if="failure">
          <div class="small su__error">{{ failure }}</div>
          <div v-if="status.error !== 'interrupted'" class="small">{{ status.rolledBack ? $t('serverUpdate.rolledBack') : $t('serverUpdate.notRolledBack') }}</div>
        </template>
        <div v-if="status.supervisorChanged && !updating" class="small su__warn">{{ $t('serverUpdate.supervisorChanged') }}</div>
        <details v-if="logText && !updating" class="su__log">
          <summary class="small">{{ $t('serverUpdate.log') }}</summary>
          <pre class="mono">{{ status.error }}&#10;{{ logText }}</pre>
        </details>
      </div>

      <div v-if="version && !version.supervised" class="muted small">{{ $t('serverUpdate.notSupervised') }}</div>
    </template>
  </div>
</template>

<style scoped>
/* bounded column: a commit title on one line must not widen the card beyond the screen */
.su { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.su__row { display: flex; align-items: center; gap: 10px; min-height: 40px; }
.su__btn { flex: 0 0 auto; height: 34px; font-size: 13px; }
.su__line { display: flex; gap: 8px; align-items: baseline; min-width: 0; font-size: 14px; }
.su__subject { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.su__summary { line-height: 1.5; min-height: 1.5em; }
.su__commits { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 180px; overflow-y: auto; }
.su__commits .su__line { font-size: 13px; }
.su__status { display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid var(--line); }
.su__steps { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.su__step { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.su__step[data-state='active'] { color: var(--text); font-weight: 500; }
.su__step[data-state='done'] { color: var(--text); }
.su__step[data-state='failed'] { color: #d24a43; }
.su__error { color: #d24a43; }
.su__warn { color: #d38b22; }
.su__log pre { margin: 6px 0 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all; font-size: 11px; }
.su__log summary { cursor: pointer; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.min0 { flex: 1 1 0; min-width: 0; }
.small { font-size: 12px; }
@media (max-width: 520px) {
  .su__row { flex-wrap: wrap; }
  .su__row .min0 { flex-basis: calc(100% - 28px); }
}
</style>
