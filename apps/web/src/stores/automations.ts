import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { AutomationBody, AutomationEntry, AutomationRun, ServerMessage } from '@kasbah/shared'
import { ApiRequestError, getTransport } from '../api'
import { t } from '../i18n'
import { useNotificationsStore } from './notifications'

// The house's automations, a mirror of the server: the map is REPLACED on each message
// (`snapshot`, `automations`), never mutated. The status (health, next and last run) is
// computed by the server and pushed with it: the view has no plugin health to query.
//
// The editor's draft does NOT live here: a message arriving while typing would overwrite what
// one is typing. The editor keeps its copy and only calls `save` on saving.

type Entries = Record<string, AutomationEntry>

export const useAutomationsStore = defineStore('automations', () => {
  const entries = shallowRef<Entries>({})
  /** Server order (the file's): a numeric object key ("12") would come before the others. */
  const order = shallowRef<string[]>([])
  /** Toggle, deletion or run in progress, per automation. */
  const busy = ref<Record<string, boolean>>({})
  const saving = ref(false)

  /** FIXED order, arranged by hand (`reorder`): a row that is disabled does not jump elsewhere under the finger. */
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
    if (!order.value.includes(e.automation.id)) order.value = [...order.value, e.automation.id]   // a new one goes at the bottom, as in the file
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

  /** Rereads the list (first opening of the view, before any message). */
  async function load(): Promise<void> {
    try { setAll(await getTransport().getAutomations()) }
    catch (err) { fail(err, t('nav.automations')) }
  }

  /**
   * Creates or replaces. NOT optimistic: the server normalizes the rule and computes its status, it is
   * its answer that we show. Returns the written entry, or `null` on failure (already reported).
   */
  async function save(id: string, body: AutomationBody): Promise<AutomationEntry | null> {
    saving.value = true
    try {
      const e = await getTransport().putAutomation(id, body)
      adopt(e)
      return e
    } catch (err) {
      // the server's detail, not the generic "invalid command" of `errors.INVALID_BODY`
      useNotificationsStore().error(t('automations.toast.saveError', { name: body.name, message: (err as Error).message }))
      return null
    } finally {
      saving.value = false
    }
  }

  /** Enables or disables. Optimistic, with rollback if the server refuses. */
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

  /** Deletes. Optimistic: the row goes away right away, it comes back if the server refuses. */
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

  /** Arranges the list. Optimistic: the order changes right away, it goes back if the server refuses. */
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

  /** Runs the actions right away; returns the report, or `null` if the call failed. */
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
