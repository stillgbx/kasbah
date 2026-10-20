import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { NewPropertyBody, PropertiesResponse, PropertyMode, ServerMessage } from '@kasbah/shared'
import { getTransport } from '../api'
import { useNotificationsStore } from './notifications'
import { t } from '../i18n'
import { writeOnboarding } from '../lib/onboarding'
import { useSettingsStore } from './settings'

// The PROPERTIES that the application can show (house, apartment). Only the demo server
// offers several: the demos (read-only) and those created or duplicated on
// this workstation. Switching reloads the whole application onto the other house, its simulated device set, its
// light scenes — nothing of one property must survive in the other.

const SWITCH_TIMEOUT_MS = 30_000
const POLL_MS = 500

export const usePropertiesStore = defineStore('properties', () => {
  const info = ref<PropertiesResponse | null>(null)
  /** Property being switched: the selector announces it and refuses a second choice. */
  const switching = ref<string | null>(null)
  /** Property of the first snapshot: a snapshot that names another one means a screen switched. */
  let seen: string | null = null

  const switchable = computed(() => !!info.value?.switchable && info.value.properties.length > 1)
  const active = computed(() => info.value?.properties.find((p) => p.id === info.value?.activeId) ?? null)
  /** The shown property is a demo: it is looked at, it is duplicated to be modified. */
  const isDemo = computed(() => !!active.value?.demo)
  /** The server knows how to create and duplicate (server without an imposed house). */
  const canCreate = computed(() => !!info.value?.canCreate)
  /** Demo or real; `null` = imposed house (`KASBAH_HOUSE_FILE`) or mockup without a server. */
  const mode = computed<PropertyMode | null>(() => info.value?.mode ?? null)
  /** The properties menu has something to offer: switching, or creating one. */
  const hasMenu = computed(() => switchable.value || canCreate.value)
  /** The "Create a property" assistant is open (a single dialog, mounted by the application). */
  const creating = ref(false)
  const busy = ref(false)

  async function load() {
    try { info.value = await getTransport().getProperties() }
    catch { info.value = null }   // server predating the feature: no selector, nothing else changes
    // a demo cannot be modified: the edit mode kept by this workstation does not apply there
    if (isDemo.value) { const settings = useSettingsStore(); settings.setHouseEditing(false); settings.setReliefEditing(false) }
  }

  /** The server restarts on the other house: wait for it to say it opened it, then reload everything. */
  async function reloadWhen(done: (r: PropertiesResponse) => boolean) {
    const deadline = Date.now() + SWITCH_TIMEOUT_MS
    while (Date.now() < deadline) {
      try { if (done(await getTransport().getProperties())) break }
      catch { /* server restarting */ }
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

  /** Switches to demo or real: the server reopens the property kept for this mode, the app reloads. */
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

  /** Creates the property, then switches to it; the guide resumes after the reload. */
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

  /** Duplicates the shown property (a demo) as "… (copy)", then switches to the copy. */
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
