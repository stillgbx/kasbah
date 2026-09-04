<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiRequestError, getTransport } from '../api'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import StrokeIcon from './ui/StrokeIcon.vue'

// Appairage du bridge Hue : visible uniquement quand le plugin est en `needs_pairing`.
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
  <div v-if="status === 'needs_pairing' || result" class="hue card card--soft">
    <div class="hue__title"><StrokeIcon name="link" :size="18" />{{ $t('settings.hue.title') }}</div>
    <p v-if="!result" class="muted hue__text">{{ $t('settings.hue.instructions') }}</p>
    <p v-else class="hue__text hue__key">{{ result }}</p>
    <button v-if="!result" type="button" class="pill" data-on="1" :disabled="busy" @click="pair">{{ busy ? $t('settings.hue.pairing') : $t('settings.hue.pair') }}</button>
  </div>
</template>

<style scoped>
.hue { padding: 14px 16px; display: grid; gap: 10px; justify-items: start; }
.hue__title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.hue__text { margin: 0; font-size: 13px; }
.hue__key { word-break: break-all; font-weight: 500; }
</style>
