<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { TeslaStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Mise en route du plugin Tesla, en trois pas que la Fleet API impose et que la carte déroule dans
// l'ordre : poser la clé publique de l'application sur SON domaine (Kasbah est sur le LAN, Tesla
// veut un domaine public en HTTPS), enregistrer ce domaine auprès de Tesla, lier le compte. Les
// jetons sont gardés par le serveur : rien à recopier, comme pour Enphase.
//
// Les trois pas sont TOUJOURS rendus, avec leur état : un pas fait n'est pas retiré, il est coché.
// Un utilisateur qui revient sur la carte doit voir où il en est, pas deviner ce qui a disparu.

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t } = useI18n()

/**
 * Santé lue dans l'INVENTAIRE des plugins, pas dans /api/health : l'interrupteur des Réglages
 * écrit l'inventaire et le serveur le rend à jour dans la même réponse, donc la carte apparaît dès
 * qu'on allume le plugin. `/api/health`, lui, n'est relu que de loin en loin — la carte n'arrivait
 * qu'après un rechargement de la page.
 */
const health = computed(() => plugins.byId.tesla?.health)
const status = ref<TeslaStatus | null>(null)
const busy = ref<'register' | 'link' | 'rotate' | null>(null)
const opened = ref(false)
const copied = ref(false)
/** Rotation de la clé en deux temps : l'ancienne clé cesse de valoir, et le NAS est à refaire. */
const rotateArmed = ref(false)

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().teslaStatus() }
  catch { status.value = null }
  await devices.refreshHealth()
}
onMounted(refresh)
// l'inventaire liste le plugin même éteint : c'est son STATUT qui change quand on l'allume
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

/**
 * Visible tant que la mise en route demande quelque chose, et juste après une liaison pour la
 * montrer. Jamais pour un plugin ÉTEINT : /api/health liste aussi ceux-là, et un fabricant qu'on
 * n'a pas coché n'a pas à réclamer ses clés.
 */
const visible = computed(() => !!health.value && health.value.status !== 'disabled' && !!status.value
  && (!status.value.linked || status.value.registered === false || opened.value))

const registration = computed(() => {
  const s = status.value
  if (!s) return ''
  if (s.registered === true) return t('settings.tesla.registered')
  if (s.registered === false) return t('settings.tesla.notRegistered')
  return t('settings.tesla.unverified')
})

async function copyKey() {
  const pem = status.value?.publicKeyPem
  if (!pem) return
  try {
    await navigator.clipboard.writeText(pem)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2500)
  } catch {
    // pas de presse-papiers (page hors HTTPS) : le texte est sélectionnable d'un tap, l'utilisateur copie lui-même
    notifications.error(t('errors.UNKNOWN', { name: 'Tesla', message: 'clipboard unavailable' }))
  }
}

async function register() {
  busy.value = 'register'
  try {
    status.value = await getTransport().teslaRegister()
    if (status.value.registered) notifications.success(t('settings.tesla.registered'))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Tesla', message: (err as Error).message }))
  } finally { busy.value = null }
}

async function rotate() {
  if (!rotateArmed.value) { rotateArmed.value = true; return }
  busy.value = 'rotate'
  try {
    status.value = await getTransport().teslaRotateKey()
    rotateArmed.value = false
    copied.value = false
    notifications.success(t('settings.tesla.rotated'))
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Tesla', message: (err as Error).message }))
  } finally { busy.value = null }
}

async function link() {
  busy.value = 'link'
  try {
    const { url } = await getTransport().teslaAuthUrl()
    window.open(url, '_blank', 'noopener')
    opened.value = true
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'Tesla', message: (err as Error).message }))
  } finally { busy.value = null }
}
</script>

<template>
  <div v-if="visible && status" class="tsl card card--soft">
    <div class="tsl__title"><StrokeIcon name="link" :size="18" />{{ $t('settings.tesla.title') }}</div>

    <p v-if="!status.configured" class="muted tsl__text">{{ $t('settings.tesla.notConfigured', { redirect: status.redirectUri }) }}</p>

    <template v-else>
      <!-- 1. la clé publique à poser sur le domaine -->
      <div class="tsl__step" :data-done="status.registered === true ? '1' : '0'">
        <div class="tsl__step-head"><StrokeIcon :name="status.registered === true ? 'checkCircle' : 'dots'" :size="16" /><span>{{ $t('settings.tesla.keyStep') }}</span></div>
        <code v-if="status.publicKeyUrl" class="tsl__url">{{ status.publicKeyUrl }}</code>
        <p v-else class="tsl__warn small">{{ $t('settings.tesla.noDomain') }}</p>
        <pre class="tsl__pem">{{ status.publicKeyPem ?? '' }}</pre>
        <div class="tsl__actions">
          <button type="button" class="pill" :disabled="!status.publicKeyPem" @click="copyKey">{{ copied ? $t('settings.tesla.copied') : $t('settings.tesla.copyKey') }}</button>
          <!-- une clé prise par une autre application ne se libère pas : il en faut une neuve. Deux temps,
               parce que l'ancienne cesse aussitôt de valoir et que le fichier du NAS est à refaire -->
          <button v-if="status.registered === false" type="button" class="pill" :data-on="rotateArmed ? '1' : '0'" :disabled="busy !== null" @click="rotate">
            {{ rotateArmed ? $t('settings.tesla.rotateConfirm') : $t('settings.tesla.rotate') }}
          </button>
        </div>
        <p class="muted small tsl__hint">{{ $t('settings.tesla.keyHint') }}</p>
      </div>

      <!-- 2. l'enregistrement du domaine -->
      <div class="tsl__step" :data-done="status.registered === true ? '1' : '0'">
        <div class="tsl__step-head"><StrokeIcon :name="status.registered === true ? 'checkCircle' : 'dots'" :size="16" /><span>{{ $t('settings.tesla.registerStep') }}</span></div>
        <div class="tsl__actions">
          <button type="button" class="pill" :data-on="status.registered === true ? '0' : '1'" :disabled="busy !== null || !status.domain" @click="register">
            {{ busy === 'register' ? $t('settings.tesla.registering') : $t('settings.tesla.register') }}
          </button>
          <span class="muted small">{{ registration }}</span>
        </div>
      </div>

      <!-- 3. la liaison du compte -->
      <div class="tsl__step" :data-done="status.linked ? '1' : '0'">
        <div class="tsl__step-head"><StrokeIcon :name="status.linked ? 'checkCircle' : 'dots'" :size="16" /><span>{{ $t('settings.tesla.linkStep') }}</span></div>
        <div class="tsl__actions">
          <button type="button" class="pill" :data-on="status.linked ? '0' : '1'" :disabled="busy !== null" @click="link">{{ $t('settings.tesla.link') }}</button>
          <button v-if="opened" type="button" class="pill" @click="refresh">{{ $t('settings.tesla.refresh') }}</button>
          <span v-if="status.linked" class="muted small">{{ $t('settings.tesla.linked', { n: status.vehicles.length }, status.vehicles.length) }}</span>
        </div>
        <p v-if="opened && !status.linked" class="muted small tsl__hint">{{ $t('settings.tesla.opened') }}</p>
      </div>

      <p v-if="status.lastError" class="tsl__warn small">{{ status.lastError }}</p>
      <p class="muted small tsl__hint">{{ $t('settings.tesla.budget', { used: status.budget.used, limit: status.budget.limit, min: Math.round(status.pollMs / 60000) }) }}</p>
      <p v-if="!status.tokenFile" class="tsl__warn small">{{ $t('settings.tesla.notStored') }}</p>
    </template>
  </div>
</template>

<style scoped>
.tsl { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.tsl__title { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.tsl__text { margin: 0; font-size: 13px; }
.tsl__step { width: 100%; display: grid; gap: 8px; }
.tsl__step-head { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
.tsl__step[data-done='1'] .tsl__step-head { color: var(--accent); }
.tsl__url, .tsl__pem {
  width: 100%; margin: 0; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: 400 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all; white-space: pre-wrap; user-select: all; box-sizing: border-box;
}
/* la clé fait toujours le même nombre de lignes : sa hauteur est fixe, rien ne bouge autour */
.tsl__pem { max-height: 9.5em; overflow: auto; }
.tsl__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tsl__hint { margin: 0; }
.tsl__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
