<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { YtmusicStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Liaison YouTube Music (NON OFFICIEL) : coller le cookie du compte perso, comme un mot de passe
// Renault — il traverse le serveur une fois et vit dans un fichier d'état, jamais dans `.env`.

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

const health = computed(() => plugins.byId.ytmusic?.health)
const status = ref<YtmusicStatus | null>(null)
const busy = ref(false)
const cookie = ref('')

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().ytmusicStatus() }
  catch { status.value = null }
  await devices.refreshHealth()
}
onMounted(refresh)
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

async function link() {
  if (!cookie.value.trim()) return
  busy.value = true
  try {
    status.value = await getTransport().ytmusicPutCookie(cookie.value.trim())
    cookie.value = ''
    notifications.success(t('settings.ytmusic.linked'))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function unlink() {
  busy.value = true
  try {
    status.value = await getTransport().ytmusicClearCookie()
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'YouTube Music', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="status" class="ytm card card--soft">
    <p class="ytm__badge muted small">{{ $t('settings.ytmusic.unofficial') }}</p>

    <template v-if="status.linked">
      <div class="ytm__done">
        <StrokeIcon name="checkCircle" :size="16" />
        <span>{{ $t('settings.ytmusic.linked') }}</span>
      </div>
      <p class="muted small ytm__hint">{{ status.poTokenOk ? $t('settings.ytmusic.poOk', { url: status.poTokenUrl }) : $t('settings.ytmusic.poBad', { url: status.poTokenUrl }) }}</p>
      <div class="ytm__actions">
        <button type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('settings.ytmusic.unlink') }}</button>
      </div>
    </template>

    <template v-else>
      <p class="muted ytm__text">{{ $t('settings.ytmusic.intro') }}</p>
      <form class="ytm__form" @submit.prevent="link">
        <label class="ytm__field">
          <span class="muted small">{{ $t('settings.ytmusic.cookie') }}</span>
          <textarea v-model="cookie" rows="3" :disabled="busy" class="ytm__input" spellcheck="false" autocomplete="off" />
        </label>
        <div class="ytm__actions">
          <button type="submit" class="pill" data-on="1" :disabled="busy || !cookie.trim()">
            {{ busy ? $t('settings.ytmusic.linking') : $t('settings.ytmusic.link') }}
          </button>
        </div>
      </form>
    </template>

    <p v-if="status.lastError" class="ytm__warn small">{{ status.lastError }}</p>
    <p v-if="!status.cookieFile" class="ytm__warn small">{{ $t('settings.ytmusic.notStored') }}</p>
  </div>
</template>

<style scoped>
.ytm { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.ytm__badge { margin: 0; text-transform: uppercase; letter-spacing: 0.04em; }
.ytm__text { margin: 0; font-size: 13px; }
.ytm__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.ytm__form { width: 100%; display: grid; gap: 10px; }
.ytm__field { display: grid; gap: 4px; width: 100%; }
.ytm__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  box-sizing: border-box; resize: vertical; min-height: 4.5em;
}
.ytm__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ytm__hint { margin: 0; }
.ytm__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
