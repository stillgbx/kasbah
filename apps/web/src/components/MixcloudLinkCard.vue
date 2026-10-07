<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { MixcloudStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Liaison du compte Mixcloud, dans Réglages → Plugins. Un NOM d'utilisateur, rien d'autre : l'API
// publique lit ce que le profil montre (favoris, écoutes, suivis, playlists) sans mot de passe. La
// page Musique offre le même champ tant que rien n'est relié ; ici on peut aussi changer de compte.

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

const health = computed(() => plugins.byId.mixcloud?.health)
const status = ref<MixcloudStatus | null>(null)
const busy = ref(false)
const username = ref('')

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().mixcloudStatus() }
  catch { status.value = null }
}
onMounted(refresh)
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

const fail = (err: unknown) => notifications.error(t('errors.UNKNOWN', { name: 'Mixcloud', message: (err as Error).message }))

async function link() {
  const name = username.value.trim()
  if (!name) return
  busy.value = true
  try {
    status.value = await getTransport().mixcloudSetAccount(name)
    username.value = ''
    await devices.refreshHealth()
  } catch (err) { fail(err) }
  finally { busy.value = false }
}

async function unlink() {
  busy.value = true
  try {
    status.value = await getTransport().mixcloudClearAccount()
    await devices.refreshHealth()
  } catch (err) { fail(err) }
  finally { busy.value = false }
}
</script>

<template>
  <div v-if="status" class="mc card card--soft">
    <p v-if="status.account" class="muted small">{{ $t('settings.musicAccountOf', { user: status.account }) }}</p>
    <div v-if="status.username" class="mc__done">
      <StrokeIcon name="checkCircle" :size="16" />
      <span>{{ $t('settings.mixcloud.linked', { name: `@${status.username}` }) }}</span>
    </div>
    <p class="muted mc__text">{{ $t('mixcloud.linkHint') }}</p>
    <form class="mc__form" @submit.prevent="link">
      <label class="mc__field">
        <span class="muted small">{{ $t('mixcloud.username') }}</span>
        <input v-model="username" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="64"
               :placeholder="status.username ?? ''" :disabled="busy" class="mc__input" />
      </label>
      <div class="mc__actions">
        <button type="submit" class="pill" data-on="1" :disabled="busy || !username.trim()">
          {{ status.username ? $t('settings.mixcloud.change') : $t('mixcloud.link') }}
        </button>
        <button v-if="status.username" type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('mixcloud.unlink') }}</button>
      </div>
    </form>
    <p v-if="status.lastError" class="mc__warn small">{{ status.lastError }}</p>
  </div>
</template>

<style scoped>
.mc { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.mc__text { margin: 0; font-size: 13px; }
.mc__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.mc__form { width: 100%; display: grid; gap: 10px; }
.mc__field { display: grid; gap: 4px; }
.mc__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.mc__input:disabled { opacity: .5; }
.mc__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mc__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
