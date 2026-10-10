import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { NewPropertyBody, PropertiesResponse, PropertyMode, ServerMessage } from '@kasbah/shared'
import { getTransport } from '../api'
import { useNotificationsStore } from './notifications'
import { t } from '../i18n'
import { writeOnboarding } from '../lib/onboarding'
import { useSettingsStore } from './settings'

// Les PROPRIÉTÉS que l'application sait montrer (maison, appartement). Seul le serveur de
// démonstration en offre plusieurs : les démos (en lecture seule) et celles créées ou dupliquées sur
// ce poste. Basculer recharge l'application entière sur l'autre maison, son parc simulé, ses
// ambiances — rien d'une propriété ne doit survivre dans l'autre.

const SWITCH_TIMEOUT_MS = 30_000
const POLL_MS = 500

export const usePropertiesStore = defineStore('properties', () => {
  const info = ref<PropertiesResponse | null>(null)
  /** Propriété en cours de bascule : le sélecteur l'annonce et refuse un second choix. */
  const switching = ref<string | null>(null)
  /** Propriété du premier snapshot : un snapshot qui en nomme une autre veut dire qu'un écran a basculé. */
  let seen: string | null = null

  const switchable = computed(() => !!info.value?.switchable && info.value.properties.length > 1)
  const active = computed(() => info.value?.properties.find((p) => p.id === info.value?.activeId) ?? null)
  /** La propriété montrée est une démo : elle se regarde, on la duplique pour la modifier. */
  const isDemo = computed(() => !!active.value?.demo)
  /** Le serveur sait créer et dupliquer (serveur sans maison imposée). */
  const canCreate = computed(() => !!info.value?.canCreate)
  /** Démo ou réel ; `null` = maison imposée (`KASBAH_HOUSE_FILE`) ou maquette sans serveur. */
  const mode = computed<PropertyMode | null>(() => info.value?.mode ?? null)
  /** Le menu des propriétés a quelque chose à offrir : en changer, ou en créer une. */
  const hasMenu = computed(() => switchable.value || canCreate.value)
  /** L'assistant « Créer une propriété » est ouvert (une seule boîte, montée par l'application). */
  const creating = ref(false)
  const busy = ref(false)

  async function load() {
    try { info.value = await getTransport().getProperties() }
    catch { info.value = null }   // serveur d'avant la fonction : pas de sélecteur, rien d'autre ne change
    // une démo ne se modifie pas : le mode édition retenu par ce poste n'y a pas cours
    if (isDemo.value) { const settings = useSettingsStore(); settings.setHouseEditing(false); settings.setReliefEditing(false) }
  }

  /** Le serveur redémarre sur l'autre maison : attendre qu'il dise l'avoir ouverte, puis tout recharger. */
  async function reloadWhen(done: (r: PropertiesResponse) => boolean) {
    const deadline = Date.now() + SWITCH_TIMEOUT_MS
    while (Date.now() < deadline) {
      try { if (done(await getTransport().getProperties())) break }
      catch { /* serveur en cours de redémarrage */ }
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    window.location.reload()
  }

  async function select(id: string) {
    if (switching.value || id === info.value?.activeId) return
    switching.value = id
    try {
      await getTransport().selectProperty(id)
      await reloadWhen((r) => r.activeId === id)
    } catch (err) {
      switching.value = null
      useNotificationsStore().error((err as Error).message)
    }
  }

  /** Passe en démo ou en réel : le serveur rouvre la propriété retenue de ce mode, l'app se recharge. */
  async function setMode(next: PropertyMode) {
    if (switching.value || next === mode.value) return
    switching.value = next
    try {
      await getTransport().setPropertyMode(next)
      await reloadWhen((r) => r.mode === next)
    } catch (err) {
      switching.value = null
      useNotificationsStore().error((err as Error).message)
    }
  }

  /** Crée la propriété, puis bascule dessus ; le guide reprend après le rechargement. */
  async function create(body: NewPropertyBody): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    try {
      const id = await getTransport().createProperty(body)
      writeOnboarding({ propertyId: id, step: body.kind === 'apartment' ? 'room' : 'terrain' })
      creating.value = false
      await select(id)
      return true
    } catch (err) {
      useNotificationsStore().error((err as Error).message)
      return false
    } finally { busy.value = false }
  }

  /** Duplique la propriété montrée (une démo) sous « … (copie) », puis bascule sur la copie. */
  async function duplicateActive(): Promise<void> {
    const src = active.value
    if (!src || busy.value) return
    busy.value = true
    try {
      const id = await getTransport().duplicateProperty(src.id, t('properties.copyName', { name: src.name }))
      await select(id)
    } catch (err) {
      useNotificationsStore().error((err as Error).message)
    } finally { busy.value = false }
  }

  function apply(msg: ServerMessage) {
    if (msg.type !== 'snapshot' || !msg.propertyId) return
    if (seen === null) seen = msg.propertyId
    else if (msg.propertyId !== seen) window.location.reload()
  }

  return { info, switching, switchable, active, isDemo, canCreate, mode, hasMenu, creating, busy, load, select, setMode, create, duplicateActive, apply }
})
