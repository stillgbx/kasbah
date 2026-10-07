<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../api'
import type { ClaudeAccount } from '../api/transport'
import { useNotificationsStore } from '../stores/notifications'
import StrokeIcon from './ui/StrokeIcon.vue'

// Carte du plugin Claude (Réglages → Plugins) : le forfait Claude du compte courant, le sien une fois
// connecté (adresse publique), celui de la maison sur le réseau local. Le jeton vient de
// `claude setup-token` ; le serveur le garde et ne le rend jamais, on ne sait ici que s'il y en a un.

const TOKEN = /^sk-ant-[\w-]{20,500}$/

const notifications = useNotificationsStore()
const { t, d } = useI18n()

const account = ref<ClaudeAccount | null>(null)
const token = ref('')
const busy = ref(false)

const who = computed(() => account.value?.user ?? t('claude.house'))
const ready = computed(() => TOKEN.test(token.value.trim()))
const status = computed(() => {
  const a = account.value
  if (!a) return ''
  if (a.savedAt) return t('claude.saved', { who: who.value, date: d(new Date(a.savedAt), 'long') })
  return `${t('claude.none', { who: who.value })} ${a.user !== null && a.house ? t('claude.fallbackHouse') : t('claude.fallbackServer')}`
})

const fail = (err: unknown) => notifications.error(t('errors.UNKNOWN', { name: 'Claude', message: (err as Error).message }))

onMounted(async () => {
  try { account.value = await getTransport().claudeAccount() } catch (err) { fail(err) }
})

async function save() {
  if (!ready.value) return
  busy.value = true
  try {
    account.value = await getTransport().claudeSetToken(token.value.trim())
    token.value = ''
    notifications.success(t('claude.savedToast'))
  } catch (err) { fail(err) } finally { busy.value = false }
}

// Retrait : premier appui arme, second confirme, on désarme tout seul (comme les comptes).
const armed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | null = null
async function remove() {
  if (!armed.value) {
    armed.value = true
    if (armTimer) clearTimeout(armTimer)
    armTimer = setTimeout(() => { armed.value = false }, 5000)
    return
  }
  armed.value = false
  busy.value = true
  try {
    account.value = await getTransport().claudeClearToken()
    notifications.success(t('claude.removedToast'))
  } catch (err) { fail(err) } finally { busy.value = false }
}
</script>

<template>
  <div class="cl">
    <!-- place réservée : la ligne d'état garde sa hauteur pendant le chargement -->
    <div class="cl__row">
      <StrokeIcon name="sparkle" :size="18" class="muted" />
      <div class="cl__status min0">{{ status || ' ' }}</div>
      <button type="button" class="pill cl__remove" :data-armed="armed ? '1' : '0'" :disabled="busy"
              :style="{ visibility: account?.savedAt ? 'visible' : 'hidden' }" @click="remove">
        <StrokeIcon name="trash" :size="16" />{{ armed ? $t('claude.removeConfirm') : $t('claude.remove') }}
      </button>
    </div>
    <p class="muted small cl__how">{{ $t('claude.howTo') }}</p>
    <form class="cl__form" @submit.prevent="save">
      <label class="cl__field">
        <span class="muted small">{{ $t('claude.tokenLabel') }}</span>
        <input v-model="token" type="password" autocomplete="off" spellcheck="false" maxlength="600" :disabled="busy" class="cl__input" />
      </label>
      <button type="submit" class="pill" data-on="1" :disabled="busy || !ready">
        <StrokeIcon name="lock" :size="16" />{{ $t('claude.save') }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.cl { display: grid; gap: 8px; }
.cl__row { display: flex; align-items: center; gap: 10px; min-height: 40px; }
.cl__status { flex: 1 1 0; font-size: 14px; line-height: 1.4; }
/* largeur fixe : « Retirer le jeton » et « Confirmer le retrait » occupent la même place */
.cl__remove { flex: 0 0 auto; width: 190px; height: 34px; font-size: 13px; justify-content: center; }
.cl__remove[data-armed='1'] { color: #d24a43; border-color: #d24a43; }
.cl__how { margin: 0; line-height: 1.5; }
.cl__form { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.cl__field { display: grid; gap: 4px; flex: 1 1 240px; min-width: 0; }
.cl__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.cl__input:disabled { opacity: .5; }
.min0 { min-width: 0; }
.small { font-size: 12px; }
@media (max-width: 520px) {
  .cl__row { flex-wrap: wrap; }
  .cl__status { flex-basis: calc(100% - 28px); }
  .cl__remove { width: auto; }
}
</style>
