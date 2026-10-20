<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { IrobotStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Linking of the iRobot account. Same shape as the Renault card — a real form, for lack of OAuth —
// but the point is different and worth telling the user: here the password is only used to obtain
// the LOCAL password of each robot. Once linked, nothing leaves the house network anymore: the
// robot pushes its state itself, on its own MQTT broker.
//
// Why this detour rather than pressing the button on the robot: Roombas used to hand out this
// password locally, the firmware of the device set no longer does. That is what `intro` says.
//
// The list of robots stays DISPLAYED even when none answers on the network: the account is the
// authority on existence, the network only on reachability. Each row therefore keeps a fixed
// place, and it is the pill that changes — nothing moves when a robot turns on or off.

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

const health = computed(() => plugins.byId.irobot?.health)
const status = ref<IrobotStatus | null>(null)
const busy = ref(false)
const email = ref('')
const password = ref('')

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().irobotStatus() }
  catch { status.value = null }
  await devices.refreshHealth()
}
onMounted(refresh)
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

async function link() {
  if (!email.value.trim() || !password.value) return
  busy.value = true
  try {
    status.value = await getTransport().irobotLogin({ email: email.value.trim(), password: password.value })
    // the password has been used, it has no business staying in memory
    password.value = ''
    notifications.success(t('settings.irobot.linked', { n: status.value.robots.length }, status.value.robots.length))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'iRobot', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function unlink() {
  busy.value = true
  try {
    status.value = await getTransport().irobotLogout()
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'iRobot', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="status" class="irb card card--soft">
    <template v-if="status.linked">
      <div class="irb__done">
        <StrokeIcon name="checkCircle" :size="16" />
        <span>{{ $t('settings.irobot.linked', { n: status.robots.length }, status.robots.length) }}</span>
      </div>
      <ul class="irb__robots">
        <li v-for="r in status.robots" :key="r.blid" class="irb__robot">
          <span class="irb__dot" :data-on="r.connected ? '1' : '0'" />
          <span class="irb__name">{{ r.name ?? $t('settings.irobot.unnamed') }}</span>
          <span class="muted small irb__where">{{ r.connected ? r.ip : $t('settings.irobot.offline') }}</span>
        </li>
      </ul>
      <div class="irb__actions">
        <button type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('settings.irobot.unlink') }}</button>
      </div>
    </template>

    <template v-else>
      <p class="muted irb__text">{{ $t('settings.irobot.intro') }}</p>
      <form class="irb__form" @submit.prevent="link">
        <label class="irb__field">
          <span class="muted small">{{ $t('settings.irobot.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" inputmode="email" :disabled="busy" class="irb__input" />
        </label>
        <label class="irb__field">
          <span class="muted small">{{ $t('settings.irobot.password') }}</span>
          <input v-model="password" type="password" autocomplete="current-password" :disabled="busy" class="irb__input" />
        </label>
        <div class="irb__actions">
          <button type="submit" class="pill" data-on="1" :disabled="busy || !email.trim() || !password">
            {{ busy ? $t('settings.irobot.linking') : $t('settings.irobot.link') }}
          </button>
        </div>
      </form>
    </template>

    <p v-if="status.lastError" class="irb__warn small">{{ status.lastError }}</p>
    <p class="muted small irb__hint">{{ $t('settings.irobot.local') }}</p>
    <p v-if="!status.sessionFile" class="irb__warn small">{{ $t('settings.irobot.notStored') }}</p>
  </div>
</template>

<style scoped>
.irb { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.irb__text { margin: 0; font-size: 13px; }
.irb__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.irb__robots { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; width: 100%; }
/* FIXED-template row: the pill changes, the row does not move when a robot turns on or off */
.irb__robot { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; font-size: 13px; }
.irb__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
.irb__dot[data-on='1'] { background: var(--accent); }
.irb__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.irb__where { font-variant-numeric: tabular-nums; }
.irb__form { width: 100%; display: grid; gap: 10px; }
.irb__field { display: grid; gap: 4px; }
.irb__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.irb__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.irb__hint { margin: 0; }
.irb__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
