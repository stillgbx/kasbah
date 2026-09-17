<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { MelcloudStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Liaison du compte MELCloud. Même situation que Renault, et calquée sur sa carte : le fabricant
// n'offre aucune connexion déléguée, il n'y a que l'identifiant et le mot de passe. La seule façon
// honnête de présenter ce formulaire est de dire ce qu'il advient du mot de passe — c'est `intro`.
//
// Le mot de passe ne vit que le temps de la requête : il n'est pas gardé dans ce composant après
// l'envoi, et le serveur ne l'écrit nulle part (seule la clé de session est conservée).
//
// La liste rendue est celle des MACHINES vues sur le compte ; ce que la maison reçoit, ce sont des
// ZONES de chauffage, et il n'y a aucune raison qu'il y en ait autant. L'installation de référence
// montre une machine (trois Zubadan en cascade derrière un seul régulateur) et deux zones. La carte
// dit les deux nombres, parce que leur écart est exactement ce qui surprend.

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

/** Santé lue dans l'INVENTAIRE des plugins : la carte doit apparaître dès qu'on allume le plugin. */
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
    // le mot de passe a servi, il n'a plus rien à faire en mémoire
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
    <!-- compte lié : on ne redemande rien, on montre ce que le compte contient -->
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

    <!-- compte non lié : le formulaire, précédé de ce qu'il advient du mot de passe -->
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
