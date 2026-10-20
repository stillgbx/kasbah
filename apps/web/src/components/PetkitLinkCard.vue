<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { PetkitStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import { usePluginsStore } from '../stores/plugins'
import StrokeIcon from './ui/StrokeIcon.vue'

// Linking of the PetKit account. Two differences from the Renault and MELCloud cards, and both
// show on screen:
//
//  1. **No password.** The vendor logs in with a code sent by email, valid for ten minutes. Hence a
//     TWO-step form (request, then enter) rather than a single one.
//  2. **A DEDICATED account is needed.** A new login invalidates the previous one: on the main
//     account, this server and the phone would keep logging each other out in a loop. It is a
//     warning, not a preference, and it is displayed BEFORE the form — afterwards, it would be
//     read once the damage is done.
//
// The step reached is local state (`step`) and not a deduction from `status`: the server does not
// know a code was requested, and does not need to — nothing is kept between the two calls.

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const plugins = usePluginsStore()
const { t, d } = useI18n()

const health = computed(() => plugins.byId.petkit?.health)
const status = ref<PetkitStatus | null>(null)
const busy = ref(false)
const email = ref('')
const code = ref('')
const step = ref<'email' | 'code'>('email')

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().petkitStatus() }
  catch { status.value = null }
  await devices.refreshHealth()
}
onMounted(refresh)
watch(() => health.value?.status, (s, prev) => { if (s && s !== prev && s !== 'disabled') void refresh() })

async function askCode() {
  if (!email.value.trim()) return
  busy.value = true
  try {
    await getTransport().petkitRequestCode({ email: email.value.trim() })
    step.value = 'code'
    notifications.success(t('settings.petkit.codeSent'))
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'PetKit', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function link() {
  if (!code.value.trim()) return
  busy.value = true
  try {
    status.value = await getTransport().petkitLogin({ email: email.value.trim(), code: code.value.trim() })
    // the code has been used; it is worthless now anyway
    code.value = ''
    step.value = 'email'
    notifications.success(t('settings.petkit.linked', { n: status.value.devices.length }, status.value.devices.length))
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'PetKit', message: (err as Error).message }))
  } finally { busy.value = false }
}

async function unlink() {
  busy.value = true
  try {
    status.value = await getTransport().petkitLogout()
    await devices.refreshHealth()
  } catch (err) {
    notifications.error(t('errors.UNKNOWN', { name: 'PetKit', message: (err as Error).message }))
  } finally { busy.value = false }
}

/** Session expiry: what will decide the day a new code is requested. */
const expires = computed(() => (status.value?.expiresAt ? d(new Date(status.value.expiresAt), 'long') : null))
</script>

<template>
  <div v-if="status" class="pk card card--soft">
    <template v-if="status.linked">
      <div class="pk__done">
        <StrokeIcon name="checkCircle" :size="16" />
        <span>{{ $t('settings.petkit.linked', { n: status.devices.length }, status.devices.length) }}</span>
      </div>
      <ul v-if="status.devices.length" class="pk__units">
        <li v-for="dev in status.devices" :key="dev.externalId">
          {{ dev.name }}<span class="muted"> — {{ $t(`kinds.${dev.kind}`) }}</span>
        </li>
      </ul>
      <p v-if="expires" class="muted small pk__hint">{{ $t('settings.petkit.expires', { date: expires }) }}</p>
      <div class="pk__actions">
        <button type="button" class="pill" :disabled="busy" @click="unlink">{{ $t('settings.petkit.unlink') }}</button>
      </div>
    </template>

    <template v-else>
      <p class="muted pk__text">{{ $t('settings.petkit.intro') }}</p>
      <p class="pk__warn small">{{ $t('settings.petkit.dedicatedAccount') }}</p>
      <form class="pk__form" @submit.prevent="step === 'email' ? askCode() : link()">
        <label class="pk__field">
          <span class="muted small">{{ $t('settings.petkit.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" inputmode="email" :disabled="busy || step === 'code'" class="pk__input" />
        </label>
        <!-- The code field exists from the start, simply disabled: making it APPEAR
             would move the button under the user's finger just as they are about to press. -->
        <label class="pk__field">
          <span class="muted small">{{ $t('settings.petkit.code') }}</span>
          <input v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12"
                 :disabled="busy || step === 'email'" class="pk__input" />
        </label>
        <div class="pk__actions">
          <button v-if="step === 'email'" type="submit" class="pill" data-on="1" :disabled="busy || !email.trim()">
            {{ busy ? $t('settings.petkit.sending') : $t('settings.petkit.askCode') }}
          </button>
          <template v-else>
            <button type="submit" class="pill" data-on="1" :disabled="busy || !code.trim()">
              {{ busy ? $t('settings.petkit.linking') : $t('settings.petkit.link') }}
            </button>
            <button type="button" class="pill" :disabled="busy" @click="step = 'email'">{{ $t('common.cancel') }}</button>
          </template>
        </div>
      </form>
      <p v-if="step === 'code'" class="muted small pk__hint">{{ $t('settings.petkit.codeHint') }}</p>
    </template>

    <p v-if="status.lastError" class="pk__warn small">{{ status.lastError }}</p>
    <p v-if="status.linked" class="muted small pk__hint">{{ $t('settings.petkit.poll', { min: Math.round(status.pollMs / 60000) }) }}</p>
  </div>
</template>

<style scoped>
.pk { padding: 14px 16px; display: grid; gap: 12px; justify-items: start; }
.pk__text { margin: 0; font-size: 13px; }
.pk__done { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); }
.pk__units { margin: 0; padding-left: 18px; font-size: 13px; }
.pk__form { width: 100%; display: grid; gap: 10px; }
.pk__field { display: grid; gap: 4px; }
.pk__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.pk__input:disabled { opacity: .5; }
.pk__actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pk__hint { margin: 0; }
.pk__warn { margin: 0; color: #d38b22; }
.small { font-size: 12px; }
</style>
