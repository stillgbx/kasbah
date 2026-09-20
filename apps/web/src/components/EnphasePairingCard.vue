<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiRequestError, getTransport } from '../api'
import type { EnphasePairing, EnphaseTokenStatus } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import { useNotificationsStore } from '../stores/notifications'
import Segmented from './ui/Segmented.vue'

// Appairage de la passerelle IQ (plugin Enphase). Deux voies pour la même route : coller un jeton
// obtenu sur le site du fabricant, ou taper les identifiants du compte, qui servent UNE fois à
// frapper un jeton et ne sont pas conservés.
//
// Le jeton, lui, est gardé par le SERVEUR : contrairement à Hue et Nest, il n'y a rien à recopier
// dans `.env`, donc appairer depuis une tablette suffit et tient un an. La carte le dit, et prévient
// dans le cas contraire (cache désactivé).
//
// La carte ne décide plus de son apparition : elle vit DANS la section du plugin Enphase, que
// l'utilisateur déplie — et qui s'ouvre seule quand le serveur dit que le jeton expire ou a expiré.
//
// En mode compte le bouton dit « Valider » : ça lie (ou rafraîchit) Enlighten pour la borne, et
// ne frappe un JWT local que s'il manque ou expire. Un 409 `TOKEN_STILL_VALID` d'un serveur plus
// ancien est lu comme un succès, pas comme une demande de remplacement.

type Mode = 'account' | 'token'

const devices = useDevicesStore()
const notifications = useNotificationsStore()
const { t, locale } = useI18n()

/** Plugin absent de /api/health = non activé : la carte ne s'affiche pas du tout. */
const health = computed(() => devices.health?.plugins.enphase)
const status = ref<EnphaseTokenStatus | null>(null)
const mode = ref<Mode>('account')
const user = ref('')
const password = ref('')
const pasted = ref('')
const busy = ref(false)
/** Avertissement à confirmer (jeton encore valable) : le prochain envoi portera `force`. */
const confirming = ref(false)
const done = ref<string | null>(null)

async function refresh() {
  if (!health.value) return
  try { status.value = await getTransport().enphaseTokenStatus() }
  catch { status.value = null }
}
onMounted(refresh)
watch(health, (h, prev) => { if (h && !prev) void refresh() })

/**
 * Temps restant, en JOURS ou en HEURES. Un jeton d'installateur ne vaut que douze heures : « expire
 * dans 0 jours » ne veut rien dire, alors que « dans 11 heures » dit quoi faire. Le serveur, lui,
 * ne compte qu'en jours pleins, donc l'heure se recalcule ici depuis l'échéance.
 */
function remaining(expiresAt: number | undefined, daysLeft: number | undefined): string {
  if (daysLeft !== undefined && daysLeft >= 1) return t('settings.enphase.leftDays', { n: daysLeft }, daysLeft)
  const hours = expiresAt ? Math.floor((expiresAt - Date.now()) / 3_600_000) : 0
  if (hours < 1) return t('settings.enphase.leftSoon')
  return t('settings.enphase.leftHours', { n: hours }, hours)
}

const headline = computed(() => {
  const s = status.value
  if (done.value) return done.value
  if (!s) return ''
  if (s.stage === 'expiring') return t('settings.enphase.expiring', { left: remaining(s.expiresAt, s.daysLeft) })
  if (s.stage === 'expired') return t('settings.enphase.expired')
  if (s.paired) return s.cloudLinked ? t('settings.enphase.paired') : t('settings.enphase.pairedNeedCloud')
  return t('settings.enphase.intro')
})

/** Compte : Valider. Jeton collé : Appairer / Renouveler. Confirmation seulement si `force`. */
const action = computed(() => {
  if (confirming.value) return t('settings.enphase.replaceAnyway')
  if (busy.value) return mode.value === 'account' ? t('settings.enphase.validating') : t('settings.enphase.pairing')
  if (mode.value === 'account') return t('settings.enphase.validate')
  return status.value?.paired ? t('settings.enphase.renew') : t('settings.enphase.pair')
})
const canSubmit = computed(() => (mode.value === 'token' ? pasted.value.trim().length > 0 : user.value.trim().length > 0 && password.value.length > 0))

/**
 * Rôle et date d'échéance du jeton en place. C'est ce qui EXPLIQUE une échéance courte : un jeton
 * d'installateur ne vaut que douze heures, et le formulaire web du fabricant n'en donne pas d'autre
 * à un compte qui est aussi installateur. Sans cette ligne, l'utilisateur ne peut que constater.
 */
const tokenInfo = computed(() => {
  const s = status.value
  if (!s?.paired || !s.expiresAt) return null
  const role = s.role === 'installer' ? t('settings.enphase.roleInstaller') : t('settings.enphase.roleOwner')
  const date = new Date(s.expiresAt).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })
  return t('settings.enphase.tokenInfo', { role, date })
})
const isInstaller = computed(() => status.value?.role === 'installer')

const modes = computed(() => [
  { value: 'account' as Mode, label: t('settings.enphase.modeAccount') },
  { value: 'token' as Mode, label: t('settings.enphase.modeToken') },
])

async function finishOk(r: EnphaseTokenStatus) {
  status.value = r
  done.value = r.cloudLinked
    ? t('settings.enphase.successCloud', { left: remaining(r.expiresAt, r.daysLeft) })
    : t('settings.enphase.success', { left: remaining(r.expiresAt, r.daysLeft) })
  confirming.value = false
  password.value = ''
  pasted.value = ''
  notifications.success(t('settings.enphase.title'))
  await devices.refreshHealth()
}

async function submit() {
  if (!canSubmit.value) return
  const body: EnphasePairing = mode.value === 'token'
    ? { token: pasted.value.trim() }
    : { user: user.value.trim(), password: password.value, ...(confirming.value ? { force: true } : {}) }
  busy.value = true
  try {
    const r = await getTransport().pairEnphase(body)
    await finishOk(r)
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === 'TOKEN_STILL_VALID' && mode.value === 'account') {
      // serveur antérieur : 409 alors que le cloud est déjà lié. Ce n'est pas un remplacement.
      await refresh()
      if (status.value) await finishOk(status.value)
    } else if (err instanceof ApiRequestError && err.code === 'TOKEN_STILL_VALID') {
      confirming.value = true
      await refresh()
    } else {
      confirming.value = false
      notifications.error(t('errors.UNKNOWN', { name: 'Enphase', message: (err as Error).message }))
    }
  } finally { busy.value = false }
}
</script>

<template>
  <div v-if="status" class="enp card card--soft">
    <p class="muted enp__text">{{ headline }}</p>

    <template v-if="!done">
      <Segmented v-model="mode" :options="modes" dense />
      <!-- Les DEUX voies sont rendues, superposees dans la meme cellule de grille et masquees par
           `visibility` : le conteneur prend donc la hauteur de la PLUS HAUTE des deux, et changer de
           voie ne deplace plus le bouton. Une hauteur fixe en pixels, elle, dependrait de la
           traduction et de la largeur. -->
      <div class="enp__body">
        <div class="enp__stack" :data-on="mode === 'account' ? '1' : '0'">
          <label class="enp__field">
            <span class="muted small">{{ $t('settings.enphase.email') }}</span>
            <input v-model="user" type="email" autocomplete="off" class="enp__input" :placeholder="$t('settings.enphase.emailPlaceholder')">
          </label>
          <label class="enp__field">
            <span class="muted small">{{ $t('settings.enphase.password') }}</span>
            <input v-model="password" type="password" autocomplete="off" class="enp__input" @keydown.enter="submit">
          </label>
          <p class="muted small enp__hint">{{ $t('settings.enphase.passwordHint') }}</p>
        </div>
        <div class="enp__stack" :data-on="mode === 'token' ? '1' : '0'">
          <label class="enp__field">
            <span class="muted small">{{ $t('settings.enphase.token') }}</span>
            <textarea v-model="pasted" rows="3" autocomplete="off" spellcheck="false" class="enp__input enp__input--area" placeholder="eyJraWQiOi..." />
          </label>
          <p class="muted small enp__hint">{{ $t('settings.enphase.tokenHint') }}</p>
        </div>
      </div>

      <!-- L'avertissement est TOUJOURS dans le DOM, avec son texte : seule sa `visibility` bascule.
           Sa place est donc reservee a la hauteur reelle du texte, quelle que soit la largeur --
           une hauteur fixe en em debordait de trois lignes a 375 px et poussait le bouton. -->
      <p class="enp__warn small" :data-on="confirming ? '1' : '0'">
        {{ $t('settings.enphase.replaceWarn', { left: remaining(status?.expiresAt, status?.daysLeft) }) }}
      </p>

      <button type="button" class="pill" data-on="1" :disabled="busy || !canSubmit" @click="submit">{{ action }}</button>
    </template>

    <!-- pied de carte : ce qu'il faut savoir du jeton en place, sous les contrôles pour que son
         apparition ne decale rien au-dessus -->
    <p v-if="tokenInfo" class="muted small enp__hint">{{ tokenInfo }}</p>
    <p v-if="isInstaller" class="enp__warn small">{{ $t('settings.enphase.installerNote') }}</p>
    <p class="muted small enp__hint">
      {{ status?.tokenFile ? $t('settings.enphase.serverKept', { file: status.tokenFile }) : $t('settings.enphase.notStored') }}
    </p>
    <p class="muted small enp__hint">
      {{ status?.cloudLinked
        ? (status.cloudFile ? $t('settings.enphase.cloudLinked', { file: status.cloudFile }) : $t('settings.enphase.cloudLinkedNoFile'))
        : $t('settings.enphase.cloudNeeded') }}
    </p>
  </div>
</template>

<style scoped>
.enp { padding: 14px 16px; display: grid; gap: 10px; justify-items: start; }
.enp__text { margin: 0; font-size: 13px; }
/* les deux voies occupent la MEME cellule : la hauteur est celle de la plus haute */
.enp__body { width: 100%; display: grid; }
.enp__stack { grid-area: 1 / 1; display: grid; gap: 8px; align-content: start; }
.enp__stack[data-on='0'] { visibility: hidden; pointer-events: none; }
.enp__field { display: grid; gap: 4px; width: 100%; }
.enp__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: 400 13px/1.4 var(--font);
}
.enp__input--area { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.enp__input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.enp__hint { margin: 0; }
/* place tenue meme invisible : l'avertissement ne pousse pas le bouton en apparaissant */
.enp__warn { margin: 0; color: #d38b22; }
.enp__warn[data-on='0'] { visibility: hidden; }
.small { font-size: 12px; }
</style>
