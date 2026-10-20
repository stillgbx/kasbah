<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import { useSchoolStore } from '../stores/school'
import StrokeIcon from './ui/StrokeIcon.vue'

// Linking of the TouteMonAnnée account. The site offers no delegated login: identifier and
// password, like MELCloud, and the card says what happens to the password (`intro`). It only lives
// for the duration of the request: cleared here after sending, never written server-side — it is
// the session cookies obtained that last.

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const school = useSchoolStore()
const { t } = useI18n()

const health = computed(() => plugins.byId.toutemonannee?.health)
const busy = ref(false)
const username = ref('')
const password = ref('')

async function refresh() {
  if (!health.value) return
  await school.load()
  await devices.refreshHealth()
}
onMounted(refresh)
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

const data = computed(() => school.data)
const showForm = computed(() => !data.value?.linked || data.value.sessionLost)

async function link() {
  if (!username.value.trim() || !password.value) return
  busy.value = true
  try {
    await school.login(username.value.trim(), password.value)
    // the password has been used, it has no business staying in memory
    password.value = ''
    notifications.success(t('settings.toutemonannee.linked'))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'TouteMonAnnée', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function unlink() {
  busy.value = true
  try {
    await school.logout()
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'TouteMonAnnée', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="data" class="tma card card--soft">
    <template v-if="!showForm">
      <div class="tma__done">
        <StrokeIcon name="checkCircle" :size="16" />
        <span>{{ $t('settings.toutemonannee.linkedAs', { user: data.username }) }}</span>
      </div>
      <ul v-if="data.journals.length" class="tma__list">
        <li v-for="j in data.journals" :key="j.id">
          {{ j.name }}<span v-if="j.years" class="muted"> — {{ j.years }}</span><span v-if="j.students.length" class="muted"> · {{ j.students.join(', ') }}</span>
        </li>
      </ul>
      <div class="tma__actions">
        <router-link :to="{ name: 'school' }" class="pill">{{ $t('settings.toutemonannee.open') }}</router-link>
        <button type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('settings.toutemonannee.unlink') }}</button>
      </div>
    </template>

    <template v-else>
      <p v-if="data.sessionLost" class="tma__warn small">{{ $t('settings.toutemonannee.sessionLost') }}</p>
      <p class="muted tma__text">{{ $t('settings.toutemonannee.intro') }}</p>
      <form class="tma__form" @submit.prevent="link">
        <label class="tma__field">
          <span class="muted small">{{ $t('settings.toutemonannee.username') }}</span>
          <input v-model="username" type="text" autocomplete="username" :disabled="busy" class="tma__input" />
        </label>
        <label class="tma__field">
          <span class="muted small">{{ $t('settings.toutemonannee.password') }}</span>
          <input v-model="password" type="password" autocomplete="current-password" :disabled="busy" class="tma__input" />
        </label>
        <div class="tma__actions">
          <button type="submit" class="pill" data-on="1" :disabled="busy || !username.trim() || !password">
            {{ busy ? $t('settings.toutemonannee.linking') : $t('settings.toutemonannee.link') }}
          </button>
        </div>
      </form>
    </template>

    <p v-if="data.error && !data.sessionLost" class="tma__warn small">{{ data.error }}</p>
  </div>
</template>

<style scoped>
.tma { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.tma__text { margin: 0; font-size: 13px; }
.tma__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.tma__list { margin: 0; padding-left: 18px; font-size: 13px; }
.tma__form { width: 100%; display: grid; gap: 10px; }
.tma__field { display: grid; gap: 4px; }
.tma__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.tma__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tma__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
