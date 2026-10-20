<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { RenaultStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Linking of the MY Renault account. Unlike Tesla and Nest, there is NO OAuth: Gigya only knows
// the identifier and the password. Hence a real form here — and the only honest way to present it
// is to say what happens to the password, which is what `intro` does.
//
// The card no longer decides when it appears: it lives INSIDE the plugin section, which the user
// expands (or which opens by itself when the server flags an action to take). With the account
// linked, it therefore no longer has to impose itself at the top of Settings — which it did, with
// nothing to ask.
//
// The password only lives for the duration of the request: it is not kept in this component after
// sending, and the server writes it nowhere (only the Gigya session token is kept).

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

/** Health read from the plugin INVENTORY: the card must appear as soon as the plugin is turned on. */
const health = computed(() => plugins.byId.renault?.health)
const status = ref<RenaultStatus | null>(null)
const busy = ref(false)
const email = ref('')
const password = ref('')

/**
 * The last charge wake-up, said in one sentence. A refusal is not necessarily a failure: Renault
 * answers "a command is already pending" when you write too fast — hence three labels, and the
 * alert tint reserved for the two that deserve a look.
 */
const WAKE_KEY = { sent: 'wakeSent', deferred: 'wakeDeferred', failed: 'wakeFailed' } as const

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().renaultStatus() }
  catch { status.value = null }
  await devices.refreshHealth()
}
onMounted(refresh)
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

async function link() {
  if (!email.value.trim() || !password.value) return
  busy.value = true
  try {
    status.value = await getTransport().renaultLogin({ email: email.value.trim(), password: password.value })
    // the password has been used, it has no business staying in memory
    password.value = ''
    notifications.success(t('settings.renault.linked', { n: status.value.vehicles.length }, status.value.vehicles.length))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Renault', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function unlink() {
  busy.value = true
  try {
    status.value = await getTransport().renaultLogout()
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Renault', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="status" class="rnl card card--soft">
    <!-- account linked: nothing more is asked, we show where things stand -->
    <template v-if="status.linked">
      <div class="rnl__done">
        <StrokeIcon name="checkCircle" :size="16" />
        <span>{{ $t('settings.renault.linked', { n: status.vehicles.length }, status.vehicles.length) }}</span>
      </div>
      <ul v-if="status.vehicles.length" class="rnl__cars">
        <li v-for="v in status.vehicles" :key="v.vin">{{ v.name }}</li>
      </ul>
      <div class="rnl__actions">
        <button type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('settings.renault.unlink') }}</button>
      </div>
    </template>

    <!-- account not linked: the form, preceded by what happens to the password -->
    <template v-else>
      <p class="muted rnl__text">{{ $t('settings.renault.intro') }}</p>
      <form class="rnl__form" @submit.prevent="link">
        <label class="rnl__field">
          <span class="muted small">{{ $t('settings.renault.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" inputmode="email" :disabled="busy" class="rnl__input" />
        </label>
        <label class="rnl__field">
          <span class="muted small">{{ $t('settings.renault.password') }}</span>
          <input v-model="password" type="password" autocomplete="current-password" :disabled="busy" class="rnl__input" />
        </label>
        <div class="rnl__actions">
          <button type="submit" class="pill" data-on="1" :disabled="busy || !email.trim() || !password">
            {{ busy ? $t('settings.renault.linking') : $t('settings.renault.link') }}
          </button>
        </div>
      </form>
    </template>

    <p v-if="status.lastWake" class="small" :class="status.lastWake.result === 'sent' ? 'muted' : 'rnl__warn'">
      {{ $t(`settings.renault.${WAKE_KEY[status.lastWake.result]}`, { detail: status.lastWake.detail ?? '' }) }}
    </p>
    <p v-if="status.lastError" class="rnl__warn small">{{ status.lastError }}</p>
    <p class="muted small rnl__hint">{{ $t('settings.renault.poll', { min: Math.round(status.pollMs / 60000), rate: status.ratePerHour }) }}</p>
    <p v-if="!status.sessionFile" class="rnl__warn small">{{ $t('settings.renault.notStored') }}</p>
  </div>
</template>

<style scoped>
.rnl { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.rnl__text { margin: 0; font-size: 13px; }
.rnl__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.rnl__cars { margin: 0; padding-left: 18px; font-size: 13px; }
.rnl__form { width: 100%; display: grid; gap: 10px; }
.rnl__field { display: grid; gap: 4px; }
.rnl__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.rnl__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rnl__hint { margin: 0; }
.rnl__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
