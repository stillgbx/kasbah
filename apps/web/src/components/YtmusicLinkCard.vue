<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { YtmusicStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Liaison YouTube Music (NON OFFICIEL) : coller le cookie OU l'importer via yt-dlp
// `--cookies-from-browser` sur la machine qui héberge Kasbah (pas la tablette).

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

const health = computed(() => plugins.byId.ytmusic?.health)
const status = ref<YtmusicStatus | null>(null)
const busy = ref(false)
const cookie = ref('')
const browser = ref('chrome')

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().ytmusicStatus() }
  catch { status.value = null }
  if (status.value?.browsers?.length && !status.value.browsers.includes(browser.value)) {
    browser.value = status.value.browsers[0]!
  }
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

async function importBrowser() {
  busy.value = true
  try {
    status.value = await getTransport().ytmusicImportCookieFromBrowser(browser.value)
    notifications.success(t('settings.ytmusic.imported'))
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

    <template v-if="status.linked && !status.cookieExpired">
      <div class="ytm__done">
        <StrokeIcon name="checkCircle" :size="16" />
        <span>{{ $t('settings.ytmusic.linked') }}</span>
      </div>
      <p class="muted small ytm__hint">{{ status.poTokenOk ? $t('settings.ytmusic.poOk', { url: status.poTokenUrl }) : $t('settings.ytmusic.poBad', { url: status.poTokenUrl }) }}</p>
      <p class="muted small ytm__steps">{{ $t('settings.ytmusic.renewHint') }}</p>
      <div class="ytm__actions">
        <button type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('settings.ytmusic.unlink') }}</button>
      </div>
    </template>

    <template v-else>
      <p v-if="status.cookieExpired" class="ytm__warn">{{ $t('settings.ytmusic.expired') }}</p>

      <section class="ytm__block">
        <h3 class="ytm__title">{{ $t('settings.ytmusic.pasteTitle') }}</h3>
        <p class="muted small ytm__steps">{{ $t('settings.ytmusic.pasteHowTo') }}</p>
        <form class="ytm__form" @submit.prevent="link">
          <label class="ytm__field">
            <span class="muted small">{{ $t('settings.ytmusic.cookie') }}</span>
            <textarea v-model="cookie" rows="3" :disabled="busy" class="ytm__input" spellcheck="false" autocomplete="off" />
          </label>
          <div class="ytm__actions">
            <button type="submit" class="pill" :disabled="busy || !cookie.trim()">
              {{ busy ? $t('settings.ytmusic.linking') : $t('settings.ytmusic.link') }}
            </button>
          </div>
        </form>
      </section>

      <section class="ytm__block">
        <h3 class="ytm__title">{{ $t('settings.ytmusic.importTitle') }}</h3>
        <p class="muted small ytm__steps">{{ $t('settings.ytmusic.importSteps') }}</p>
        <div class="ytm__import">
          <label class="ytm__field">
            <span class="muted small">{{ $t('settings.ytmusic.browser') }}</span>
            <select v-model="browser" class="ytm__select" :disabled="busy">
              <option v-for="b in (status.browsers?.length ? status.browsers : ['chrome', 'edge', 'firefox'])" :key="b" :value="b">{{ b }}</option>
            </select>
          </label>
          <button type="button" class="pill" data-on="1" :disabled="busy" @click="importBrowser">
            {{ busy ? $t('settings.ytmusic.importing') : $t('settings.ytmusic.importBrowser') }}
          </button>
        </div>
      </section>
    </template>

    <p v-if="status.lastError" class="ytm__warn small">{{ status.lastError }}</p>
    <p v-if="!status.cookieFile" class="ytm__warn small">{{ $t('settings.ytmusic.notStored') }}</p>
  </div>
</template>

<style scoped>
.ytm { padding: 14px 16px; display: grid; gap: 12px; justify-items: stretch; }
.ytm__badge { margin: 0; text-transform: uppercase; letter-spacing: 0.04em; }
.ytm__block { display: grid; gap: 8px; padding-top: 4px; border-top: 1px solid var(--line); }
.ytm__block:first-of-type { border-top: 0; padding-top: 0; }
.ytm__title { margin: 0; font-size: 13px; font-weight: 600; }
.ytm__steps { margin: 0; font-size: 12px; white-space: pre-line; line-height: 1.45; }
.ytm__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.ytm__form, .ytm__import { width: 100%; display: grid; gap: 10px; }
.ytm__field { display: grid; gap: 4px; width: 100%; }
.ytm__input, .ytm__select {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 12px;
  box-sizing: border-box;
}
.ytm__input { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; min-height: 4.5em; }
.ytm__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ytm__hint { margin: 0; }
.ytm__warn { margin: 0; color: #d38b22; font-size: 13px; }
.small { font-size: 12px; }
</style>
