<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { RenaultStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Liaison du compte MY Renault. Contrairement à Tesla et Nest, il n'y a PAS d'OAuth : Gigya ne
// connaît que l'identifiant et le mot de passe. D'où un vrai formulaire ici — et la seule façon
// honnête de le présenter est de dire ce qu'il advient du mot de passe, ce que fait `intro`.
//
// Le mot de passe ne vit que le temps de la requête : il n'est pas gardé dans ce composant après
// l'envoi, et le serveur ne l'écrit nulle part (seul le jeton de session Gigya est conservé).

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

/** Santé lue dans l'INVENTAIRE des plugins : la carte doit apparaître dès qu'on allume le plugin. */
const health = computed(() => plugins.byId.renault?.health)
const status = ref<RenaultStatus | null>(null)
const busy = ref(false)
const email = ref('')
const password = ref('')

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().renaultStatus() }
  catch { status.value = null }
  await devices.refreshHealth()
}
onMounted(refresh)
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

/** Jamais pour un plugin ÉTEINT : /api/health liste aussi ceux-là. */
const visible = computed(() => !!health.value && health.value.status !== 'disabled' && !!status.value)

async function link() {
  if (!email.value.trim() || !password.value) return
  busy.value = true
  try {
    status.value = await getTransport().renaultLogin({ email: email.value.trim(), password: password.value })
    // le mot de passe a servi, il n'a plus rien à faire en mémoire
    password.value = ''
    notifications.success(t('settings.renault.linked', { n: status.value.vehicles.length }, status.value.vehicles.length))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Renault', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function unlink() {
  busy.value = true
  try {
    status.value = await getTransport().renaultLogout()
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Renault', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="visible && status" class="rnl card card--soft">
    <div class="rnl__title"><StrokeIcon name="link" :size="18" />{{ $t('settings.renault.title') }}</div>

    <!-- compte lié : on ne redemande rien, on montre où on en est -->
    <template v-if="status.linked">
      <div class="rnl__done">
        <StrokeIcon name="checkCircle" :size="16" />
        <span>{{ $t('settings.renault.linked', { n: status.vehicles.length }, status.vehicles.length) }}</span>
      </div>
      <ul v-if="status.vehicles.length" class="rnl__cars">
        <li v-for="v in status.vehicles" :key="v.vin">{{ v.name }}</li>
      </ul>
      <div class="rnl__actions">
        <button type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('settings.renault.unlink') }}</button>
      </div>
    </template>

    <!-- compte non lié : le formulaire, précédé de ce qu'il advient du mot de passe -->
    <template v-else>
      <p class="muted rnl__text">{{ $t('settings.renault.intro') }}</p>
      <form class="rnl__form" @submit.prevent="link">
        <label class="rnl__field">
          <span class="muted small">{{ $t('settings.renault.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" inputmode="email" :disabled="busy" class="rnl__input" />
        </label>
        <label class="rnl__field">
          <span class="muted small">{{ $t('settings.renault.password') }}</span>
          <input v-model="password" type="password" autocomplete="current-password" :disabled="busy" class="rnl__input" />
        </label>
        <div class="rnl__actions">
          <button type="submit" class="pill" data-on="1" :disabled="busy || !email.trim() || !password">
            {{ busy ? $t('settings.renault.linking') : $t('settings.renault.link') }}
          </button>
        </div>
      </form>
    </template>

    <p v-if="status.lastError" class="rnl__warn small">{{ status.lastError }}</p>
    <p class="muted small rnl__hint">{{ $t('settings.renault.poll', { min: Math.round(status.pollMs / 60000), rate: status.ratePerHour }) }}</p>
    <p v-if="!status.sessionFile" class="rnl__warn small">{{ $t('settings.renault.notStored') }}</p>
  </div>
</template>

<style scoped>
.rnl { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.rnl__title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.rnl__text { margin: 0; font-size: 13px; }
.rnl__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.rnl__cars { margin: 0; padding-left: 18px; font-size: 13px; }
.rnl__form { width: 100%; display: grid; gap: 10px; }
.rnl__field { display: grid; gap: 4px; }
.rnl__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.rnl__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rnl__hint { margin: 0; }
.rnl__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
