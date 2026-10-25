<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiRequestError, getTransport } from '../api'
import type { EnphasePairing, EnphaseTokenStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import Segmented from './ui/Segmented.vue'

// Pairing of the IQ gateway (Enphase plugin). Two routes to the same endpoint: paste a token
// obtained on the vendor's site, or type the account credentials, which are used ONCE to mint a
// token and are not kept.
//
// The token, for its part, is kept by the SERVER: unlike Hue and Nest, there is nothing to copy
// into `.env`, so pairing from any screen is enough and lasts a year. The card says so, and warns
// otherwise (cache disabled).
//
// The card no longer decides when it appears: it lives INSIDE the Enphase plugin section, which
// the user expands — and which opens by itself when the server says the token is expiring or has
// expired.
//
// In account mode the button says "Validate": that links (or refreshes) Enlighten for the charger,
// and only mints a local JWT if it is missing or expiring. A 409 `TOKEN_STILL_VALID` from an older
// server is read as a success, not as a request for replacement.
//
// At the foot of the card, the production history: the server fetches Enphase's once, by itself,
// as soon as the account is linked and nothing is kept yet; afterwards it counts the days itself.
// A strip shows every day since commissioning, complete or not; "Resync" takes again only the days
// that are not, "Take everything again" every one of them.

type Mode = 'account' | 'token'

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const { t, locale } = useI18n()

/** Plugin absent from /api/health = not enabled: the card is not displayed at all. */
const health = computed(() => devices.health?.plugins.enphase)
const status = ref<EnphaseTokenStatus | null>(null)
const mode = ref<Mode>('account')
const user = ref('')
const password = ref('')
const pasted = ref('')
const busy = ref(false)
/** Warning to confirm (token still valid): the next submit will carry `force`. */
const confirming = ref(false)
const done = ref<string | null>(null)

let pending: ReturnType<typeof setTimeout> | null = null
async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().enphaseTokenStatus() }
  catch { status.value = null }
  // a synchronization started by the server (account just linked): read again until it is over
  if (pending) clearTimeout(pending)
  const h = status.value?.history
  pending = h?.syncing || (h?.inverters?.done ?? null) !== null ? setTimeout(() => { void refresh() }, 3000) : null
}
onBeforeUnmount(() => { if (pending) clearTimeout(pending) })
onMounted(refresh)
watch(health, (h, prev) => { if (h && !prev) void refresh() })

/**
 * Time remaining, in DAYS or HOURS. An installer token is only valid for twelve hours: "expires
 * in 0 days" means nothing, whereas "in 11 hours" says what to do. The server, for its part, only
 * counts whole days, so the hour is recomputed here from the expiry.
 */
function remaining(expiresAt: number | undefined, daysLeft: number | undefined): string {
  if (daysLeft !== undefined && daysLeft >= 1) return t('settings.enphase.leftDays', { n: daysLeft }, daysLeft)
  const hours = expiresAt ? Math.floor((expiresAt - Date.now()) / 3_600_000) : 0
  if (hours < 1) return t('settings.enphase.leftSoon')
  return t('settings.enphase.leftHours', { n: hours }, hours)
}

const headline = computed(() => {
  const s = status.value
  if (done.value) return done.value
  if (!s) return ''
  if (s.stage === 'expiring') return t('settings.enphase.expiring', { left: remaining(s.expiresAt, s.daysLeft) })
  if (s.stage === 'expired') return t('settings.enphase.expired')
  if (s.paired) return s.cloudLinked ? t('settings.enphase.paired') : t('settings.enphase.pairedNeedCloud')
  return t('settings.enphase.intro')
})

/** Account: Validate. Pasted token: Pair the gateway / Renew the token. Confirmation only if `force`. */
const action = computed(() => {
  if (confirming.value) return t('settings.enphase.replaceAnyway')
  if (busy.value) return mode.value === 'account' ? t('settings.enphase.validating') : t('settings.enphase.pairing')
  if (mode.value === 'account') return t('settings.enphase.validate')
  return status.value?.paired ? t('settings.enphase.renew') : t('settings.enphase.pair')
})
const canSubmit = computed(() => (mode.value === 'token' ? pasted.value.trim().length > 0 : user.value.trim().length > 0 && password.value.length > 0))

/**
 * Role and expiry date of the token in place. This is what EXPLAINS a short expiry: an installer
 * token is only valid for twelve hours, and the vendor's web form gives no other kind to an
 * account that is also an installer. Without this line, the user can only observe it.
 */
const tokenInfo = computed(() => {
  const s = status.value
  if (!s?.paired || !s.expiresAt) return null
  const role = s.role === 'installer' ? t('settings.enphase.roleInstaller') : t('settings.enphase.roleOwner')
  const date = new Date(s.expiresAt).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
  return t('settings.enphase.tokenInfo', { role, date })
})
const isInstaller = computed(() => status.value?.role === 'installer')

const modes = computed(() => [
  { value: 'account' as Mode, label: t('settings.enphase.modeAccount') },
  { value: 'token' as Mode, label: t('settings.enphase.modeToken') },
])

async function finishOk(r: EnphaseTokenStatus) {
  status.value = r
  done.value = r.cloudLinked
    ? t('settings.enphase.successCloud', { left: remaining(r.expiresAt, r.daysLeft) })
    : t('settings.enphase.success', { left: remaining(r.expiresAt, r.daysLeft) })
  confirming.value = false
  password.value = ''
  pasted.value = ''
  notifications.success(t('settings.enphase.title'))
  await devices.refreshHealth()
}

const syncing = ref(false)
/** "Take everything again": every day, not only the incomplete ones. */
const force = ref(false)

type DayState = 'c' | 'p' | 'm'
/**
 * The strip: one row per month, one cell per day, from commissioning to yesterday. A row always
 * has 31 columns: the first month starts at its day, and a short month leaves its end empty —
 * a given date sits in the same column in every row.
 */
const strip = computed(() => {
  const cov = status.value?.history?.coverage
  if (!cov) return []
  const rows: { key: number; label: string; cells: { day: number; state: DayState }[] }[] = []
  const d = new Date(cov.from)
  for (const ch of cov.days) {
    let row = rows[rows.length - 1]
    const month = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    if (!row || row.key !== month) {
      row = { key: month, label: d.toLocaleDateString(locale.value, { month: 'short', year: '2-digit' }), cells: [] }
      rows.push(row)
    }
    row.cells.push({ day: d.getDate(), state: ch as DayState })
    d.setDate(d.getDate() + 1)
  }
  return rows
})
const stateLabel = (s: DayState) => t(`settings.enphase.history.legend.${s}`)
const dayTitle = (row: { key: number }, day: number, s: DayState) =>
  `${new Date(new Date(row.key).getFullYear(), new Date(row.key).getMonth(), day).toLocaleDateString(locale.value, { dateStyle: 'medium' })} · ${stateLabel(s)}`
/** How many days the button will take again: the incomplete ones, or all of them when forced. */
const toTake = computed(() => {
  const days = status.value?.history?.coverage?.days ?? ''
  return force.value ? days.length : [...days].filter((c) => c !== 'c').length
})
const takeText = computed(() => {
  if (!status.value?.history?.coverage) return ''
  if (force.value) return t('settings.enphase.history.willTakeAll', { n: toTake.value }, toTake.value)
  return toTake.value === 0 ? t('settings.enphase.history.allComplete') : t('settings.enphase.history.willTake', { n: toTake.value }, toTake.value)
})
const fmtDate = (at: number, time = false) =>
  new Date(at).toLocaleString(locale.value, time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' })
/** One line that says where the history stands. Its button keeps its label: only this line changes. */
const historyText = computed(() => {
  const h = status.value?.history
  if (!h) return ''
  if (syncing.value || h.syncing) return t('settings.enphase.history.syncing')
  if (h.syncedAt === null) return t('settings.enphase.history.never')
  return t('settings.enphase.history.synced', {
    days: h.days, since: h.since !== null ? fmtDate(h.since) : '—', at: fmtDate(h.syncedAt, true),
  })
})

/** The inverters' line: their run in progress, or their last synchronization. */
const invertersText = computed(() => {
  const inv = status.value?.history?.inverters
  if (!inv) return ''
  if (inv.done !== null) return t('settings.enphase.history.invertersProgress', { done: inv.done, total: inv.total ?? 0 })
  if (inv.syncedAt === null) return t('settings.enphase.history.invertersNever')
  return t('settings.enphase.history.invertersSynced', { at: fmtDate(inv.syncedAt, true) })
})
const invertersError = computed(() => status.value?.history?.inverters?.error ?? null)

async function resync() {
  syncing.value = true
  try {
    status.value = await getTransport().syncEnphaseHistory(force.value)
    force.value = false
    notifications.success(t('settings.enphase.history.done', { days: status.value.history.days }))
    // the inverters follow on the server, day by day: the card follows their progress
    void refresh()
  } catch (err) {
    await refresh()
    notifications.error(t('errors.UNKNOWN', { name: 'Enphase', message: (err as Error).message }))
  } finally { syncing.value = false }
}

async function submit() {
  if (!canSubmit.value) return
  const body: EnphasePairing = mode.value === 'token'
    ? { token: pasted.value.trim() }
    : { user: user.value.trim(), password: password.value, ...(confirming.value ? { force: true } : {}) }
  busy.value = true
  try {
    const r = await getTransport().pairEnphase(body)
    await finishOk(r)
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'TOKEN_STILL_VALID' && mode.value === 'account') {
      // earlier server: 409 while the cloud is already linked. That is not a replacement.
      await refresh()
      if (status.value) await finishOk(status.value)
    } else if (err instanceof ApiRequestError && err.code === 'TOKEN_STILL_VALID') {
      confirming.value = true
      await refresh()
    } else {
      confirming.value = false
      notifications.error(t('errors.UNKNOWN', { name: 'Enphase', message: (err as Error).message }))
    }
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="status" class="enp card card--soft">
    <p class="muted enp__text">{{ headline }}</p>

    <template v-if="!done">
      <Segmented v-model="mode" :options="modes" dense />
      <!-- BOTH routes are rendered, stacked in the same grid cell and hidden with
           `visibility`: the container therefore takes the height of the TALLER of the two, and
           switching route no longer moves the button. A fixed height in pixels would depend on
           the translation and the width. -->
      <div class="enp__body">
        <div class="enp__stack" :data-on="mode === 'account' ? '1' : '0'">
          <label class="enp__field">
            <span class="muted small">{{ $t('settings.enphase.email') }}</span>
            <input v-model="user" type="email" autocomplete="off" class="enp__input" :placeholder="$t('settings.enphase.emailPlaceholder')">
          </label>
          <label class="enp__field">
            <span class="muted small">{{ $t('settings.enphase.password') }}</span>
            <input v-model="password" type="password" autocomplete="off" class="enp__input" @keydown.enter="submit">
          </label>
          <p class="muted small enp__hint">{{ $t('settings.enphase.passwordHint') }}</p>
        </div>
        <div class="enp__stack" :data-on="mode === 'token' ? '1' : '0'">
          <label class="enp__field">
            <span class="muted small">{{ $t('settings.enphase.token') }}</span>
            <textarea v-model="pasted" rows="3" autocomplete="off" spellcheck="false" class="enp__input enp__input--area" placeholder="eyJraWQiOi..." />
          </label>
          <p class="muted small enp__hint">{{ $t('settings.enphase.tokenHint') }}</p>
        </div>
      </div>

      <!-- The warning is ALWAYS in the DOM, with its text: only its `visibility` toggles.
           Its space is therefore reserved at the real height of the text, whatever the width --
           a fixed height in em overflowed by three lines at 375 px and pushed the button. -->
      <p class="enp__warn small" :data-on="confirming ? '1' : '0'">
        {{ $t('settings.enphase.replaceWarn', { left: remaining(status?.expiresAt, status?.daysLeft) }) }}
      </p>

      <button type="button" class="pill" data-on="1" :disabled="busy || !canSubmit" @click="submit">{{ action }}</button>
    </template>

    <!-- card footer: what you need to know about the token in place, under the controls so that
         its appearance shifts nothing above -->
    <p v-if="tokenInfo" class="muted small enp__hint">{{ tokenInfo }}</p>
    <p v-if="isInstaller" class="enp__warn small">{{ $t('settings.enphase.installerNote') }}</p>
    <p class="muted small enp__hint">
      {{ status?.tokenFile ? $t('settings.enphase.serverKept', { file: status.tokenFile }) : $t('settings.enphase.notStored') }}
    </p>
    <p class="muted small enp__hint">
      {{ status?.cloudLinked
        ? (status.cloudFile ? $t('settings.enphase.cloudLinked', { file: status.cloudFile }) : $t('settings.enphase.cloudLinkedNoFile'))
        : $t('settings.enphase.cloudNeeded') }}
    </p>

    <!-- The production history. The failure line is always there, hidden when nothing failed:
         a refusal does not push the button down. -->
    <div v-if="status.history" class="enp__history">
      <div class="enp__historyTitle">{{ $t('settings.enphase.history.title') }}</div>
      <p class="muted small enp__hint">{{ historyText }}</p>
      <!-- the inverters' days come after the site's, one call per day: their own line, always there -->
      <p class="muted small enp__hint">{{ invertersText || '\u00a0' }}</p>
      <p class="enp__warn small" :data-on="status.history.error || invertersError ? '1' : '0'">
        {{ status.history.error || invertersError ? $t('settings.enphase.history.failed', { message: status.history.error ?? invertersError }) : '\u00a0' }}
      </p>
      <!-- One row per month, one cell per day: where the history is whole, and where it is not. -->
      <div v-if="strip.length" class="strip" role="img" :aria-label="$t('settings.enphase.history.stripLabel')">
        <div v-for="row in strip" :key="row.key" class="strip__row">
          <span class="muted strip__month">{{ row.label }}</span>
          <div class="strip__days">
            <span v-for="c in row.cells" :key="c.day" class="strip__day" :data-s="c.state"
                  :style="{ gridColumn: c.day }" :title="dayTitle(row, c.day, c.state)" />
          </div>
        </div>
        <div class="muted small strip__legend">
          <span v-for="s in (['c', 'p', 'm'] as const)" :key="s" class="strip__key"><i class="strip__day" :data-s="s" />{{ stateLabel(s) }}</span>
        </div>
      </div>
      <div class="enp__resync">
        <button type="button" class="pill" data-on="0"
                :disabled="!status.cloudLinked || syncing || status.history.syncing || (status.history.inverters?.done ?? null) !== null || (!force && toTake === 0 && !!status.history.coverage)"
                @click="resync">
          {{ $t('settings.enphase.history.resync') }}
        </button>
        <v-switch v-model="force" :disabled="!status.cloudLinked" color="primary" density="compact" hide-details inset
                  :label="$t('settings.enphase.history.force')" class="enp__force" />
      </div>
      <!-- what the button will do, always on its own line: switching "everything" changes words only -->
      <p class="muted small enp__hint">{{ takeText || '\u00a0' }}</p>
      <p class="muted small enp__hint">
        {{ status.cloudLinked ? $t('settings.enphase.history.resyncHint') : $t('settings.enphase.history.needsAccount') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.enp { padding: 14px 16px; display: grid; gap: 10px; justify-items: start; }
.enp__text { margin: 0; font-size: 13px; }
/* the two routes occupy the SAME cell: the height is that of the taller one */
.enp__body { width: 100%; display: grid; }
.enp__stack { grid-area: 1 / 1; display: grid; gap: 8px; align-content: start; }
.enp__stack[data-on='0'] { visibility: hidden; pointer-events: none; }
.enp__field { display: grid; gap: 4px; width: 100%; }
.enp__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: 400 13px/1.4 var(--font);
}
.enp__input--area { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.enp__input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.enp__hint { margin: 0; }
/* space held even when invisible: the warning does not push the button when it appears */
.enp__warn { margin: 0; color: #d38b22; }
.enp__warn[data-on='0'] { visibility: hidden; }
.enp__history { display: grid; gap: 8px; justify-items: start; width: 100%; padding-top: 10px; border-top: 1px solid var(--line); }
.enp__historyTitle { font-weight: 600; font-size: 13px; }
.enp__resync { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; }
.enp__force { flex: 0 0 auto; }
/* the switch's label at the card's text size: Vuetify's 16 px stood out among the 13 px lines */
.enp__force :deep(.v-label) { font-size: 13px; }
/* the strip: a month label, then 31 equal columns — a date keeps its column from row to row */
.strip { display: grid; gap: 3px; width: 100%; max-width: 420px; }
.strip__row { display: grid; grid-template-columns: 52px 1fr; align-items: center; gap: 8px; }
.strip__month { font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.strip__days { display: grid; grid-template-columns: repeat(31, minmax(0, 1fr)); gap: 2px; }
.strip__day { display: block; height: 8px; border-radius: 2px; }
.strip__day[data-s='c'] { background: var(--accent); opacity: .8; }
.strip__day[data-s='p'] { background: rgb(var(--v-theme-warning)); }
.strip__day[data-s='m'] { box-shadow: inset 0 0 0 1px var(--line); }
.strip__legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; }
.strip__key { display: inline-flex; align-items: center; gap: 6px; }
.strip__key .strip__day { width: 10px; }
.small { font-size: 12px; }
</style>
