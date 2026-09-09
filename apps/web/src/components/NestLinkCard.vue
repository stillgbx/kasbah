<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import StrokeIcon from './ui/StrokeIcon.vue'

// Liaison du compte Google (plugin Nest) : visible uniquement en `needs_pairing`. Le consentement se
// fait dans un onglet Google ; au retour, la page du serveur donne le jeton à coller dans .env, et le
// plugin fonctionne déjà en mémoire — d'où le bouton « Actualiser » pour voir les caméras arriver.
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const { t } = useI18n()
const status = computed(() => devices.health?.plugins.nest?.status)
const busy = ref(false)
const opened = ref(false)

async function link() {
  busy.value = true
  try {
    const { url } = await getTransport().nestAuthUrl()
    window.open(url, '_blank', 'noopener')
    opened.value = true
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Nest', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="status === 'needs_pairing'" class="nest card card--soft">
    <div class="nest__title"><StrokeIcon name="link" :size="18" />{{ $t('settings.nest.title') }}</div>
    <p class="muted nest__text">{{ opened ? $t('settings.nest.opened') : $t('settings.nest.instructions') }}</p>
    <div class="nest__actions">
      <button type="button" class="pill" data-on="1" :disabled="busy" @click="link">{{ $t('settings.nest.link') }}</button>
      <button v-if="opened" type="button" class="pill" @click="devices.refreshHealth()">{{ $t('settings.nest.refresh') }}</button>
    </div>
  </div>
</template>

<style scoped>
.nest { padding: 14px 16px; display: grid; gap: 10px; justify-items: start; }
.nest__title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.nest__text { margin: 0; font-size: 13px; }
.nest__actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
