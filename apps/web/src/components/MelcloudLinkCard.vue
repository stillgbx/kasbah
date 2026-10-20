<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { MelcloudStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Linking of the MELCloud account. Same situation as Renault, and modeled on its card: the vendor
// offers no delegated login, there is only the identifier and the password. The only honest way
// to present this form is to say what happens to the password — that is `intro`.
//
// The password only lives for the duration of the request: it is not kept in this component after
// sending, and the server writes it nowhere (only the session key is kept).
//
// The list rendered is that of the MACHINES seen on the account; what the house receives are
// heating ZONES, and there is no reason for there to be as many. The reference installation shows
// one machine (three Zubadan in cascade behind a single controller) and two zones. The card states
// both numbers, because their gap is exactly what surprises.

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

/** Health read from the plugin INVENTORY: the card must appear as soon as the plugin is turned on. */
const health = computed(() => plugins.byId.melcloud?.health)
const status = ref<MelcloudStatus | null>(null)
const busy = ref(false)
const email = ref('')
const password = ref('')

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().melcloudStatus() }
  catch { status.value = null }
  await devices.refreshHealth()
}
onMounted(refresh)
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

async function link() {
  if (!email.value.trim() || !password.value) return
  busy.value = true
  try {
    status.value = await getTransport().melcloudLogin({ email: email.value.trim(), password: password.value })
    // the password has been used, it has no business staying in memory
    password.value = ''
    notifications.success(t('settings.melcloud.linked', { n: status.value.devices.length }, status.value.devices.length))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'MELCloud', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function unlink() {
  busy.value = true
  try {
    status.value = await getTransport().melcloudLogout()
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'MELCloud', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="status" class="mel card card--soft">
    <!-- account linked: nothing more is asked, we show what the account contains -->
    <template v-if="status.linked">
      <div class="mel__done">
        <StrokeIcon name="checkCircle" :size="16" />
        <span>{{ $t('settings.melcloud.linked', { n: status.devices.length }, status.devices.length) }}</span>
      </div>
      <ul v-if="status.devices.length" class="mel__units">
        <li v-for="d in status.devices" :key="d.deviceId">
          {{ d.name }}<span v-if="d.buildingName" class="muted"> — {{ d.buildingName }}</span>
        </li>
      </ul>
      <p class="muted small mel__hint">{{ $t('settings.melcloud.zones', { n: status.zoneCount }, status.zoneCount) }}</p>
      <div class="mel__actions">
        <button type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('settings.melcloud.unlink') }}</button>
      </div>
    </template>

    <!-- account not linked: the form, preceded by what happens to the password -->
    <template v-else>
      <p class="muted mel__text">{{ $t('settings.melcloud.intro') }}</p>
      <form class="mel__form" @submit.prevent="link">
        <label class="mel__field">
          <span class="muted small">{{ $t('settings.melcloud.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" inputmode="email" :disabled="busy" class="mel__input" />
        </label>
        <label class="mel__field">
          <span class="muted small">{{ $t('settings.melcloud.password') }}</span>
          <input v-model="password" type="password" autocomplete="current-password" :disabled="busy" class="mel__input" />
        </label>
        <div class="mel__actions">
          <button type="submit" class="pill" data-on="1" :disabled="busy || !email.trim() || !password">
            {{ busy ? $t('settings.melcloud.linking') : $t('settings.melcloud.link') }}
          </button>
        </div>
      </form>
    </template>

    <p v-if="status.lastError" class="mel__warn small">{{ status.lastError }}</p>
    <p v-if="status.linked" class="muted small mel__hint">{{ $t('settings.melcloud.poll', { min: Math.round(status.pollMs / 60000) }) }}</p>
    <p v-if="status.linked" class="muted small mel__hint">{{ $t('settings.melcloud.readOnly') }}</p>
    <p v-if="!status.sessionFile" class="mel__warn small">{{ $t('settings.melcloud.notStored') }}</p>
  </div>
</template>

<style scoped>
.mel { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.mel__text { margin: 0; font-size: 13px; }
.mel__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.mel__units { margin: 0; padding-left: 18px; font-size: 13px; }
.mel__form { width: 100%; display: grid; gap: 10px; }
.mel__field { display: grid; gap: 4px; }
.mel__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.mel__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mel__hint { margin: 0; }
.mel__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
