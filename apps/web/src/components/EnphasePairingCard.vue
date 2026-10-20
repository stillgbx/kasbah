<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().enphaseTokenStatus() }
  catch { status.value = null }
}
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
.small { font-size: 12px; }
</style>
