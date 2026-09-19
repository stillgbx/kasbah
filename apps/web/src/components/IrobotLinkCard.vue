<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { IrobotStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Liaison du compte iRobot. Même forme que la carte Renault — un vrai formulaire, faute d'OAuth —
// mais le propos est différent et mérite d'être dit à l'utilisateur : ici le mot de passe ne sert
// qu'à obtenir le mot de passe LOCAL de chaque robot. Une fois relié, plus rien ne sort du réseau
// de la maison : le robot pousse son état lui-même, sur son propre courtier MQTT.
//
// Pourquoi ce détour plutôt qu'un appui sur le bouton du robot : les Roomba rendaient jadis ce mot
// de passe en local, le firmware du parc ne le fait plus. C'est ce que dit `intro`.
//
// La liste des robots reste AFFICHÉE même quand aucun ne répond sur le réseau : le compte fait foi
// pour l'existence, le réseau seulement pour la joignabilité. Chaque ligne garde donc une place
// fixe, et c'est la pastille qui change — rien ne se déplace quand un robot s'allume ou s'éteint.

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

const health = computed(() => plugins.byId.irobot?.health)
const status = ref<IrobotStatus | null>(null)
const busy = ref(false)
const email = ref('')
const password = ref('')

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().irobotStatus() }
  catch { status.value = null }
  await devices.refreshHealth()
}
onMounted(refresh)
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

async function link() {
  if (!email.value.trim() || !password.value) return
  busy.value = true
  try {
    status.value = await getTransport().irobotLogin({ email: email.value.trim(), password: password.value })
    // le mot de passe a servi, il n'a plus rien à faire en mémoire
    password.value = ''
    notifications.success(t('settings.irobot.linked', { n: status.value.robots.length }, status.value.robots.length))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'iRobot', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function unlink() {
  busy.value = true
  try {
    status.value = await getTransport().irobotLogout()
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'iRobot', message: (err as Error).message }))
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="status" class="irb card card--soft">
    <template v-if="status.linked">
      <div class="irb__done">
        <StrokeIcon name="checkCircle" :size="16" />
        <span>{{ $t('settings.irobot.linked', { n: status.robots.length }, status.robots.length) }}</span>
      </div>
      <ul class="irb__robots">
        <li v-for="r in status.robots" :key="r.blid" class="irb__robot">
          <span class="irb__dot" :data-on="r.connected ? '1' : '0'" />
          <span class="irb__name">{{ r.name ?? $t('settings.irobot.unnamed') }}</span>
          <span class="muted small irb__where">{{ r.connected ? r.ip : $t('settings.irobot.offline') }}</span>
        </li>
      </ul>
      <div class="irb__actions">
        <button type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('settings.irobot.unlink') }}</button>
      </div>
    </template>

    <template v-else>
      <p class="muted irb__text">{{ $t('settings.irobot.intro') }}</p>
      <form class="irb__form" @submit.prevent="link">
        <label class="irb__field">
          <span class="muted small">{{ $t('settings.irobot.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" inputmode="email" :disabled="busy" class="irb__input" />
        </label>
        <label class="irb__field">
          <span class="muted small">{{ $t('settings.irobot.password') }}</span>
          <input v-model="password" type="password" autocomplete="current-password" :disabled="busy" class="irb__input" />
        </label>
        <div class="irb__actions">
          <button type="submit" class="pill" data-on="1" :disabled="busy || !email.trim() || !password">
            {{ busy ? $t('settings.irobot.linking') : $t('settings.irobot.link') }}
          </button>
        </div>
      </form>
    </template>

    <p v-if="status.lastError" class="irb__warn small">{{ status.lastError }}</p>
    <p class="muted small irb__hint">{{ $t('settings.irobot.local') }}</p>
    <p v-if="!status.sessionFile" class="irb__warn small">{{ $t('settings.irobot.notStored') }}</p>
  </div>
</template>

<style scoped>
.irb { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.irb__text { margin: 0; font-size: 13px; }
.irb__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.irb__robots { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; width: 100%; }
/* rangée à gabarit FIXE : la pastille change, la ligne ne bouge pas quand un robot s'allume */
.irb__robot { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 8px; font-size: 13px; }
.irb__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
.irb__dot[data-on='1'] { background: var(--accent); }
.irb__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.irb__where { font-variant-numeric: tabular-nums; }
.irb__form { width: 100%; display: grid; gap: 10px; }
.irb__field { display: grid; gap: 4px; }
.irb__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.irb__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.irb__hint { margin: 0; }
.irb__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
