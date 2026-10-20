<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { TeslaStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Setup of the Tesla plugin, in three steps that the Fleet API imposes and that the card unfolds
// in order: put the app's public key on ITS domain (Kasbah is on the LAN, Tesla wants a public
// domain over HTTPS), register that domain with Tesla, link the account. The tokens are kept by
// the server: nothing to copy, as for Enphase.
//
// The three steps are ALWAYS rendered, with their state: a completed step is not removed, it is
// checked. A user coming back to the card must see where they stand, not guess what disappeared.
//
// The card no longer decides when it appears: it lives INSIDE the Tesla plugin section, which the
// user expands — and which opens by itself as long as the server flags a step to do (domain not
// registered, account not linked: it says so through its status).

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

/**
 * Health read from the plugin INVENTORY, not from /api/health: the Settings switch writes the
 * inventory and the server returns it up to date in the same response, so the card appears as
 * soon as the plugin is turned on. `/api/health`, for its part, is only re-read every now and
 * then — the card only showed up after a page reload.
 */
const health = computed(() => plugins.byId.tesla?.health)
const status = ref<TeslaStatus | null>(null)
const busy = ref<'register' | 'link' | 'rotate' | null>(null)
const opened = ref(false)
const copied = ref(false)
/** Two-step key rotation: the old key stops being valid, and the NAS has to be redone. */
const rotateArmed = ref(false)

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().teslaStatus() }
  catch { status.value = null }
  await devices.refreshHealth()
}
onMounted(refresh)
// the inventory lists the plugin even when it is off: it is its STATUS that changes when it is turned on
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

const registration = computed(() => {
  const s = status.value
  if (!s) return ''
  if (s.registered === true) return t('settings.tesla.registered')
  if (s.registered === false) return t('settings.tesla.notRegistered')
  return t('settings.tesla.unverified')
})

async function copyKey() {
  const pem = status.value?.publicKeyPem
  if (!pem) return
  try {
    await navigator.clipboard.writeText(pem)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2500)
  } catch {
    // no clipboard (non-HTTPS page): the text is selectable with one tap, the user copies it
    // themselves
    notifications.error(t('errors.UNKNOWN', { name: 'Tesla', message: 'clipboard unavailable' }))
  }
}

async function register() {
  busy.value = 'register'
  try {
    status.value = await getTransport().teslaRegister()
    if (status.value.registered) notifications.success(t('settings.tesla.registered'))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Tesla', message: (err as Error).message }))
  } finally { busy.value = null }
}

async function rotate() {
  if (!rotateArmed.value) { rotateArmed.value = true; return }
  busy.value = 'rotate'
  try {
    status.value = await getTransport().teslaRotateKey()
    rotateArmed.value = false
    copied.value = false
    notifications.success(t('settings.tesla.rotated'))
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Tesla', message: (err as Error).message }))
  } finally { busy.value = null }
}

async function link() {
  busy.value = 'link'
  try {
    const { url } = await getTransport().teslaAuthUrl()
    window.open(url, '_blank', 'noopener')
    opened.value = true
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Tesla', message: (err as Error).message }))
  } finally { busy.value = null }
}
</script>

<template>
  <div v-if="status" class="tsl card card--soft">
    <p v-if="!status.configured" class="muted tsl__text">{{ $t('settings.tesla.notConfigured', { redirect: status.redirectUri }) }}</p>

    <template v-else>
      <!-- 1. the public key to put on the domain -->
      <div class="tsl__step" :data-done="status.registered === true ? '1' : '0'">
        <div class="tsl__step-head"><StrokeIcon :name="status.registered === true ? 'checkCircle' : 'dots'" :size="16" /><span>{{ $t('settings.tesla.keyStep') }}</span></div>
        <code v-if="status.publicKeyUrl" class="tsl__url">{{ status.publicKeyUrl }}</code>
        <p v-else class="tsl__warn small">{{ $t('settings.tesla.noDomain') }}</p>
        <pre class="tsl__pem">{{ status.publicKeyPem ?? '' }}</pre>
        <div class="tsl__actions">
          <button type="button" class="pill" :disabled="!status.publicKeyPem" @click="copyKey">{{ copied ? $t('settings.tesla.copied') : $t('settings.tesla.copyKey') }}</button>
          <!-- a key taken by another application is not released: a new one is needed. Two steps,
               because the old one immediately stops being valid and the NAS file has to be redone -->
          <button v-if="status.registered === false" type="button" class="pill" :data-on="rotateArmed ? '1' : '0'" :disabled="busy !== null" @click="rotate">
            {{ rotateArmed ? $t('settings.tesla.rotateConfirm') : $t('settings.tesla.rotate') }}
          </button>
        </div>
        <p class="muted small tsl__hint">{{ $t('settings.tesla.keyHint') }}</p>
      </div>

      <!-- 2. registration of the domain -->
      <div class="tsl__step" :data-done="status.registered === true ? '1' : '0'">
        <div class="tsl__step-head"><StrokeIcon :name="status.registered === true ? 'checkCircle' : 'dots'" :size="16" /><span>{{ $t('settings.tesla.registerStep') }}</span></div>
        <div class="tsl__actions">
          <button type="button" class="pill" :data-on="status.registered === true ? '0' : '1'" :disabled="busy !== null || !status.domain" @click="register">
            {{ busy === 'register' ? $t('settings.tesla.registering') : $t('settings.tesla.register') }}
          </button>
          <span class="muted small">{{ registration }}</span>
        </div>
      </div>

      <!-- 3. linking of the account -->
      <div class="tsl__step" :data-done="status.linked ? '1' : '0'">
        <div class="tsl__step-head"><StrokeIcon :name="status.linked ? 'checkCircle' : 'dots'" :size="16" /><span>{{ $t('settings.tesla.linkStep') }}</span></div>
        <div class="tsl__actions">
          <button type="button" class="pill" :data-on="status.linked ? '0' : '1'" :disabled="busy !== null" @click="link">{{ $t('settings.tesla.link') }}</button>
          <button v-if="opened" type="button" class="pill" @click="refresh">{{ $t('settings.tesla.refresh') }}</button>
          <span v-if="status.linked" class="muted small">{{ $t('settings.tesla.linked', { n: status.vehicles.length }, status.vehicles.length) }}</span>
        </div>
        <p v-if="opened && !status.linked" class="muted small tsl__hint">{{ $t('settings.tesla.opened') }}</p>
      </div>

      <p v-if="status.lastError" class="tsl__warn small">{{ status.lastError }}</p>
      <p class="muted small tsl__hint">{{ $t('settings.tesla.budget', { used: status.budget.used, limit: status.budget.limit, min: Math.round(status.pollMs / 60000) }) }}</p>
      <p v-if="!status.tokenFile" class="tsl__warn small">{{ $t('settings.tesla.notStored') }}</p>
    </template>
  </div>
</template>

<style scoped>
.tsl { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.tsl__text { margin: 0; font-size: 13px; }
.tsl__step { width: 100%; display: grid; gap: 8px; }
.tsl__step-head { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
.tsl__step[data-done='1'] .tsl__step-head { color: var(--accent); }
.tsl__url, .tsl__pem {
  width: 100%; margin: 0; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: 400 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all; white-space: pre-wrap; user-select: all; box-sizing: border-box;
}
/* the key always takes the same number of lines: its height is fixed, nothing moves around it */
.tsl__pem { max-height: 9.5em; overflow: auto; }
.tsl__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tsl__hint { margin: 0; }
.tsl__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
