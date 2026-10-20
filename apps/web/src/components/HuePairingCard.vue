<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiRequestError, getTransport } from '../api'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import StrokeIcon from './ui/StrokeIcon.vue'

// Pairing of the Hue bridge, in the plugin section. It used to show only in `needs_pairing`; now
// that it lives in a panel that can be expanded, it ALSO says where an already-paired bridge
// stands, and lets you redo it — the key is in .env, and that is the only way to get a new one if
// that one is lost.
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const { t } = useI18n()
const status = computed(() => devices.health?.plugins.hue?.status)
const busy = ref(false)
const result = ref<string | null>(null)

async function pair() {
  busy.value = true
  result.value = null
  try {
    const r = await getTransport().pairHue()
    result.value = t('settings.hue.success', { key: r.appKey })
    notifications.success(t('settings.hue.title'))
    await devices.refreshHealth()
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'LINK_BUTTON_NOT_PRESSED') notifications.error(t('settings.hue.buttonNotPressed'))
    else notifications.error(t('errors.UNKNOWN', { name: 'Hue', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div class="hue card card--soft">
    <!-- a fresh key is to be copied into .env: it comes before everything else -->
    <p v-if="result" class="hue__text hue__key">{{ result }}</p>
    <template v-else-if="status === 'needs_pairing'">
      <p class="muted hue__text">{{ $t('settings.hue.instructions') }}</p>
      <button type="button" class="pill" data-on="1" :disabled="busy" @click="pair">{{ busy ? $t('settings.hue.pairing') : $t('settings.hue.pair') }}</button>
    </template>
    <template v-else>
      <div class="hue__done"><StrokeIcon name="checkCircle" :size="16" /><span>{{ $t('settings.hue.paired') }}</span></div>
      <p class="muted hue__text">{{ $t('settings.hue.repairHint') }}</p>
      <button type="button" class="pill" :disabled="busy" @click="pair">{{ busy ? $t('settings.hue.pairing') : $t('settings.hue.repair') }}</button>
    </template>
  </div>
</template>

<style scoped>
.hue { padding: 14px 16px; display: grid; gap: 10px; justify-items: start; }
.hue__text { margin: 0; font-size: 13px; }
.hue__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.hue__key { word-break: break-all; font-weight: 500; }
</style>
