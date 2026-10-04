<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTransport } from '../../api'
import type { McpUser } from '../../api/transport'
import { useNotificationsStore } from '../../stores/notifications'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Comptes du serveur MCP (`apps/server/mcp-users.json`), dans Réglages : ceux qui ouvrent la page de
// connexion d'un assistant (Claude sur le téléphone, Claude Desktop…). Le serveur ne rend que les noms.
// Un nom déjà pris dans le formulaire = changer son mot de passe. Le script `mcp-user` reste en secours.

const NAME = /^[\w.@-]{1,64}$/
const MIN_PASSWORD = 8

const notifications = useNotificationsStore()
const { t } = useI18n()

const users = ref<McpUser[]>([])
const loaded = ref(false)
const busy = ref(false)
const name = ref('')
const password = ref('')
const confirm = ref('')
const passwordInput = ref<HTMLInputElement | null>(null)

const existing = computed(() => users.value.some((u) => u.name === name.value.trim()))
const problem = computed(() => {
  const n = name.value.trim()
  if (n && !NAME.test(n)) return t('mcpUsers.badName')
  if (password.value && password.value.length < MIN_PASSWORD) return t('mcpUsers.tooShort', { n: MIN_PASSWORD })
  if (confirm.value && confirm.value !== password.value) return t('mcpUsers.mismatch')
  return null
})
const ready = computed(() => !!name.value.trim() && password.value.length >= MIN_PASSWORD && confirm.value === password.value && !problem.value)

const fail = (err: unknown) => notifications.error(t('errors.UNKNOWN', { name: 'MCP', message: (err as Error).message }))

onMounted(async () => {
  try { users.value = (await getTransport().mcpUsers()).users } catch (err) { fail(err) } finally { loaded.value = true }
})

/** Rend vrai si l'écriture a réussi. */
async function run(action: () => Promise<{ users: McpUser[] }>, done?: string): Promise<boolean> {
  busy.value = true
  try {
    users.value = (await action()).users
    if (done) notifications.success(done)
    return true
  } catch (err) { fail(err); return false }
  finally { busy.value = false }
}

function reset() { name.value = ''; password.value = ''; confirm.value = '' }

async function save() {
  if (!ready.value) return
  const n = name.value.trim()
  const done = existing.value ? t('mcpUsers.changed', { name: n }) : t('mcpUsers.added', { name: n })
  if (await run(() => getTransport().mcpSetUser(n, password.value), done)) reset()
}

/** « Mot de passe » sur une ligne : le formulaire passe en changement pour ce compte. */
async function edit(n: string) {
  name.value = n
  password.value = ''
  confirm.value = ''
  await nextTick()
  passwordInput.value?.focus()
}

// Retrait : premier appui arme, second confirme, on désarme tout seul.
const armed = ref<string | null>(null)
let armTimer: ReturnType<typeof setTimeout> | null = null
function remove(n: string) {
  if (armed.value !== n) {
    armed.value = n
    if (armTimer) clearTimeout(armTimer)
    armTimer = setTimeout(() => { armed.value = null }, 5000)
    return
  }
  armed.value = null
  if (name.value.trim() === n) reset()
  void run(() => getTransport().mcpRemoveUser(n), t('mcpUsers.removed', { name: n }))
}
</script>

<template>
  <div class="mu">
    <div v-for="u in users" :key="u.name" class="mu__row">
      <StrokeIcon name="person" :size="18" class="muted" />
      <div class="mu__name min0">{{ u.name }}</div>
      <button type="button" class="pill mu__btn" :disabled="busy" @click="edit(u.name)">
        <StrokeIcon name="lock" :size="16" />{{ $t('mcpUsers.password') }}
      </button>
      <button type="button" class="pill mu__btn mu__remove" :data-armed="armed === u.name ? '1' : '0'" :disabled="busy" @click="remove(u.name)">
        <StrokeIcon name="trash" :size="16" />{{ armed === u.name ? $t('mcpUsers.removeConfirm') : $t('mcpUsers.remove') }}
      </button>
    </div>
    <div v-if="loaded && !users.length" class="muted small">{{ $t('mcpUsers.none') }}</div>

    <form class="mu__form" @submit.prevent="save">
      <div class="mu__formtitle">{{ existing ? $t('mcpUsers.changeTitle', { name: name.trim() }) : $t('mcpUsers.addTitle') }}</div>
      <div class="mu__fields">
        <label class="mu__field">
          <span class="muted small">{{ $t('mcpUsers.nameLabel') }}</span>
          <input v-model="name" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" :disabled="busy" class="mu__input" />
        </label>
        <label class="mu__field">
          <span class="muted small">{{ $t('mcpUsers.passwordLabel') }}</span>
          <input ref="passwordInput" v-model="password" type="password" autocomplete="new-password" maxlength="200" :disabled="busy" class="mu__input" />
        </label>
        <label class="mu__field">
          <span class="muted small">{{ $t('mcpUsers.confirmLabel') }}</span>
          <input v-model="confirm" type="password" autocomplete="new-password" maxlength="200" :disabled="busy" class="mu__input" />
        </label>
      </div>
      <!-- place réservée : l'avertissement qui apparaît ne pousse pas les boutons -->
      <div class="small mu__problem">{{ problem ?? ' ' }}</div>
      <div class="mu__actions">
        <button type="submit" class="pill" data-on="1" :disabled="busy || !ready">
          <StrokeIcon :name="existing ? 'lock' : 'plus'" :size="16" />{{ existing ? $t('mcpUsers.change') : $t('mcpUsers.add') }}
        </button>
        <button v-if="name || password || confirm" type="button" class="pill" :disabled="busy" @click="reset">{{ $t('mcpUsers.cancel') }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.mu { display: grid; gap: 8px; }
.mu__row { display: flex; align-items: center; gap: 10px; min-height: 40px; }
.mu__name { flex: 1 1 0; font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mu__btn { flex: 0 0 auto; height: 34px; font-size: 13px; }
/* largeur fixe : « Retirer » et « Confirmer le retrait » occupent la même place */
.mu__remove { width: 190px; justify-content: center; }
.mu__remove[data-armed='1'] { color: #d24a43; border-color: #d24a43; }
.mu__form { display: grid; gap: 10px; padding-top: 12px; margin-top: 4px; border-top: 1px solid var(--line); }
.mu__formtitle { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mu__fields { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.mu__field { display: grid; gap: 4px; min-width: 0; }
.mu__input {
  width: 100%; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--line);
  background: var(--surface); color: var(--text); font: inherit; font-size: 13px; box-sizing: border-box;
}
.mu__input:disabled { opacity: .5; }
.mu__problem { color: #d38b22; line-height: 1.5; min-height: 1.5em; margin-top: -4px; }
.mu__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.min0 { min-width: 0; }
.small { font-size: 12px; }
@media (max-width: 520px) {
  .mu__row { flex-wrap: wrap; }
  .mu__name { flex-basis: calc(100% - 28px); }
  .mu__remove { width: auto; }
}
</style>
