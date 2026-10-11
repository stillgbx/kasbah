import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { AutomationBody, AutomationEntry, AutomationRun, ServerMessage } from '@kasbah/shared'
import { ApiRequestError, getTransport } from '../api'
import { t } from '../i18n'
import { useNotificationsStore } from './notifications'

// Automatisations de la maison, miroir du serveur : la carte est REMPLACÉE à chaque message
// (`snapshot`, `automations`), jamais mutée. Le statut (santé, prochaine et dernière exécution) est
// calculé par le serveur et poussé avec elle : la vue n'a aucune santé de plugin à interroger.
//
// Le brouillon de l'éditeur ne vit PAS ici : un message qui arrive pendant la frappe écraserait ce
// qu'on tape. L'éditeur garde sa copie et n'appelle `save` qu'à l'enregistrement.

type Entries = Record<string, AutomationEntry>

export const useAutomationsStore = defineStore('automations', () => {
  const entries = shallowRef<Entries>({})
  /** Ordre du serveur (celui du fichier) : une clé d'objet numérique (« 12 ») passerait devant les autres. */
  const order = shallowRef<string[]>([])
  /** Bascule, suppression ou exécution en cours, par automatisation. */
  const busy = ref<Record<string, boolean>>({})
  const saving = ref(false)

  /** Ordre FIXE, rangé à la main (`reorder`) : une ligne qu'on désactive ne saute pas ailleurs sous le doigt. */
  const list = computed<AutomationEntry[]>(() => order.value.flatMap((id) => entries.value[id] ?? []))

  function setAll(all: AutomationEntry[]) {
    const next: Entries = {}
    for (const e of all) next[e.automation.id] = e
    entries.value = next
    order.value = all.map((e) => e.automation.id)
  }

  function apply(msg: ServerMessage) {
    if (msg.type === 'snapshot' || msg.type === 'automations') setAll(msg.automations)
  }

  function adopt(e: AutomationEntry) {
    entries.value = { ...entries.value, [e.automation.id]: e }
    if (!order.value.includes(e.automation.id)) order.value = [...order.value, e.automation.id]   // une neuve va en bas, comme dans le fichier
  }

  const isBusy = (id: string) => busy.value[id] === true
  function setBusy(id: string, on: boolean) {
    const next = { ...busy.value }
    if (on) next[id] = true
    else delete next[id]
    busy.value = next
  }

  function fail(err: unknown, name: string) {
    const n = useNotificationsStore()
    if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name, message: err.message }))
    else n.error(t('errors.UNKNOWN', { name, message: (err as Error).message }))
  }

  /** Relit la liste (première ouverture de la vue, avant tout message). */
  async function load(): Promise<void> {
    try { setAll(await getTransport().getAutomations()) }
    catch (err) { fail(err, t('nav.automations')) }
  }

  /**
   * Crée ou remplace. PAS optimiste : le serveur normalise la règle et calcule son statut, c'est sa
   * réponse qu'on montre. Rend l'entrée écrite, ou `null` en cas d'échec (déjà signalé).
   */
  async function save(id: string, body: AutomationBody): Promise<AutomationEntry | null> {
    saving.value = true
    try {
      const e = await getTransport().putAutomation(id, body)
      adopt(e)
      return e
    } catch (err) {
      // le détail du serveur, pas le « commande invalide » générique d'`errors.INVALID_BODY`
      useNotificationsStore().error(t('automations.toast.saveError', { name: body.name, message: (err as Error).message }))
      return null
    } finally {
      saving.value = false
    }
  }

  /** Active ou désactive. Optimiste, avec retour arrière si le serveur refuse. */
  async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const entry = entries.value[id]
    if (!entry) return false
    const before = entries.value
    const optimistic = { ...before, [id]: { automation: { ...entry.automation, enabled }, status: entry.status } }
    entries.value = optimistic
    setBusy(id, true)
    try {
      adopt(await getTransport().setAutomationEnabled(id, enabled))
      return true
    } catch (err) {
      if (entries.value === optimistic) entries.value = before
      fail(err, entry.automation.name)
      return false
    } finally {
      setBusy(id, false)
    }
  }

  /** Supprime. Optimiste : la ligne part tout de suite, elle revient si le serveur refuse. */
  async function remove(id: string): Promise<boolean> {
    const entry = entries.value[id]
    if (!entry) return false
    const before = entries.value
    const optimistic = { ...before }
    delete optimistic[id]
    entries.value = optimistic
    setBusy(id, true)
    try {
      await getTransport().deleteAutomation(id)
      return true
    } catch (err) {
      if (entries.value === optimistic) entries.value = before
      fail(err, entry.automation.name)
      return false
    } finally {
      setBusy(id, false)
    }
  }

  /** Range la liste. Optimiste : l'ordre change tout de suite, il revient si le serveur refuse. */
  async function reorder(ids: string[]): Promise<boolean> {
    const before = order.value
    order.value = ids
    try {
      setAll(await getTransport().setAutomationOrder(ids))
      return true
    } catch (err) {
      if (order.value === ids) order.value = before
      fail(err, t('nav.automations'))
      return false
    }
  }

  /** Exécute les actions tout de suite ; rend le compte rendu, ou `null` si l'appel a échoué. */
  async function runNow(id: string): Promise<AutomationRun | null> {
    const entry = entries.value[id]
    if (!entry) return null
    setBusy(id, true)
    try {
      return await getTransport().runAutomation(id)
    } catch (err) {
      fail(err, entry.automation.name)
      return null
    } finally {
      setBusy(id, false)
    }
  }

  return { entries, list, busy, saving, apply, load, save, setEnabled, remove, reorder, runNow, isBusy }
})
