<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import StrokeIcon from './ui/StrokeIcon.vue'

// Liaison du compte Google (plugin Nest), dans la section du plugin. Le consentement se fait dans un
// onglet Google ; au retour, la page du serveur donne le jeton à coller dans .env, et le plugin
// fonctionne déjà en mémoire — d'où le bouton « Actualiser » pour voir les caméras arriver.
//
// Compte déjà lié, la carte le dit et propose de le relier à nouveau : c'est ce qu'il faut faire
// pour changer les caméras partagées avec Kasbah, le choix se fait dans l'écran de consentement.
const devices = useDevicesStore()
const notifications = useNotificationsStore()
const { t } = useI18n()
const status = computed(() => devices.health?.plugins.nest?.status)
const linked = computed(() => !!status.value && status.value !== 'needs_pairing')
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
  <div class="nest card card--soft">
    <div v-if="linked" class="nest__done"><StrokeIcon name="checkCircle" :size="16" /><span>{{ $t('settings.nest.linked') }}</span></div>
    <p class="muted nest__text">{{ opened ? $t('settings.nest.opened') : $t(linked ? 'settings.nest.relinkHint' : 'settings.nest.instructions') }}</p>
    <div class="nest__actions">
      <button type="button" class="pill" :data-on="linked ? '0' : '1'" :disabled="busy" @click="link">{{ $t(linked ? 'settings.nest.relink' : 'settings.nest.link') }}</button>
      <button v-if="opened" type="button" class="pill" @click="devices.refreshHealth()">{{ $t('settings.nest.refresh') }}</button>
    </div>
  </div>
</template>

<style scoped>
.nest { padding: 14px 16px; display: grid; gap: 10px; justify-items: start; }
.nest__text { margin: 0; font-size: 13px; }
.nest__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.nest__actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
