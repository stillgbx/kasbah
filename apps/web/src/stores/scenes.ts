import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { roomKey, type PluginSceneEntry, type SceneActivation, type SceneRecallMode, type ServerMessage } from '@kasbah/shared'
import { ApiRequestError, getTransport } from '../api'
import { t } from '../i18n'
import { useNotificationsStore } from './notifications'

// Vendor scenes (Hue scenes…). Same invariant as the devices store: the map is
// REPLACED on each change. The matching with the house is done by room NAME, like
// the auto-placement of devices (`roomKey`): a zone scene belongs to no room and
// goes up to the house level.

type Entries = Record<string, PluginSceneEntry>

/**
 * Activates a scene and turns off its siblings of the same group (mirror of the server's rule).
 * WARNING: TURNING OFF a scene turns nothing else off — without this safeguard, the message
 * "the old scene is inactive" that the bridge sends right after a light scene change
 * erased the activation of the NEW one, arrived in the same batch.
 */
function withActive(entries: Entries, sceneId: string, active: SceneActivation, now: number): Entries {
  const target = entries[sceneId]
  if (!target) return entries
  const next: Entries = {}
  for (const [id, e] of Object.entries(entries)) {
    const sibling = active !== 'inactive' && id !== sceneId
      && e.scene.pluginId === target.scene.pluginId && e.scene.group?.name === target.scene.group?.name
    const value: SceneActivation = id === sceneId ? active : sibling ? 'inactive' : e.state.active
    next[id] = value === e.state.active ? e : { scene: e.scene, state: { active: value, updatedAt: now } }
  }
  return next
}

/** Expected activation of a recall: `off` turns off, the two other modes carry their name. */
const activationFor = (mode: SceneRecallMode): SceneActivation => (mode === 'off' ? 'inactive' : mode)

export const useScenesStore = defineStore('scenes', () => {
  const entries = shallowRef<Entries>({})
  const pending = ref<Record<string, number>>({})
  /** Light scene creation in progress, per group. */
  const creating = ref<Record<string, boolean>>({})

  const list = computed<PluginSceneEntry[]>(() =>
    Object.values(entries.value).sort((a, b) => a.scene.name.localeCompare(b.scene.name)),
  )
  const count = computed(() => list.value.length)

  function setAll(all: PluginSceneEntry[]) {
    const next: Entries = {}
    for (const e of all) next[e.scene.id] = e
    entries.value = next
  }

  function apply(msg: ServerMessage) {
    switch (msg.type) {
      case 'snapshot': setAll(msg.scenes); break
      case 'scenes': setAll(msg.scenes); break
      case 'scene': {
        const e = entries.value[msg.sceneId]
        if (e) entries.value = withActive({ ...entries.value, [msg.sceneId]: { scene: e.scene, state: msg.state } }, msg.sceneId, msg.state.active, msg.state.updatedAt)
        break
      }
    }
  }

  /** Scenes of a room of the house (matched by name). */
  const forRoom = (roomName: string) => list.value.filter(
    (e) => e.scene.group?.kind === 'room' && roomKey(e.scene.group.name) === roomKey(roomName),
  )

  /** Scenes that no room of the house claims: vendor zones and unknown rooms. */
  const forHouse = (roomNames: string[]) => {
    const known = new Set(roomNames.map(roomKey))
    return list.value.filter((e) => !e.scene.group || e.scene.group.kind === 'zone' || !known.has(roomKey(e.scene.group.name)))
  }

  const isPending = (sceneId: string) => (pending.value[sceneId] ?? 0) > 0

  /**
   * Mode played when an off light scene is touched: animated if the vendor set it that way
   * (`autoDynamic`, read from the bridge), static otherwise. The animation button always stays explicit.
   */
  function tapMode(entry: PluginSceneEntry): 'static' | 'dynamic' {
    return entry.scene.dynamic && entry.scene.autoDynamic ? 'dynamic' : 'static'
  }

  /**
   * Light scenes present ELSEWHERE but absent from this group: something to add one from. The
   * vendors do not publish their preset gallery (checked on a Hue bridge: no
   * catalog resource), so the material is what the bridge already carries. A single source per name,
   * preferring the one that has an animated palette: it carries more information to copy.
   */
  const clonableFor = (groupName: string): PluginSceneEntry[] => {
    const key = roomKey(groupName)
    const here = new Set(list.value.filter((e) => e.scene.group && roomKey(e.scene.group.name) === key).map((e) => e.scene.name))
    const byName = new Map<string, PluginSceneEntry>()
    for (const e of list.value) {
      if (here.has(e.scene.name)) continue
      const prev = byName.get(e.scene.name)
      if (!prev || (e.scene.dynamic && !prev.scene.dynamic)) byName.set(e.scene.name, e)
    }
    return [...byName.values()].sort((a, b) => a.scene.name.localeCompare(b.scene.name))
  }

  /** Creates the light scene at the vendor; it then arrives through the `scenes` message. */
  async function createScene(fromSceneId: string, groupName: string): Promise<boolean> {
    const name = entries.value[fromSceneId]?.scene.name ?? fromSceneId
    creating.value = { ...creating.value, [groupName]: true }
    try {
      await getTransport().createScene(fromSceneId, groupName)
      return true
    } catch (err) {
      const n = useNotificationsStore()
      if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name, message: err.message }))
      else n.error(t('errors.UNKNOWN', { name, message: (err as Error).message }))
      return false
    } finally {
      const next = { ...creating.value }
      delete next[groupName]
      creating.value = next
    }
  }

  const isCreating = (groupName: string) => creating.value[groupName] === true

  /**
   * Deletes the light scene AT the vendor: it therefore disappears from its app too. It is removed right
   * away from the display and put back if the vendor refuses.
   */
  async function deleteScene(sceneId: string): Promise<boolean> {
    const entry = entries.value[sceneId]
    if (!entry) return false
    const before = entries.value
    const optimistic = { ...before }
    delete optimistic[sceneId]
    entries.value = optimistic
    try {
      await getTransport().deleteScene(sceneId)
      return true
    } catch (err) {
      if (entries.value === optimistic) entries.value = before
      const n = useNotificationsStore()
      const name = entry.scene.name
      if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name, message: err.message }))
      else n.error(t('errors.UNKNOWN', { name, message: (err as Error).message }))
      return false
    }
  }

  /**
   * ALL the light scenes, grouped BY PLUGIN and arranged by group: it is the management screen
   * ("start animated" setting, deletion). The concept is common to the plugins, the settings are not
   * — one may want animated palettes on the lights and not on another set of devices.
   */
  const scenesByPlugin = computed(() => {
    const acc = new Map<string, PluginSceneEntry[]>()
    for (const e of list.value) {
      const arr = acc.get(e.scene.pluginId)
      if (arr) arr.push(e)
      else acc.set(e.scene.pluginId, [e])
    }
    return [...acc.entries()]
      .map(([pluginId, scenes]) => ({
        pluginId,
        scenes: [...scenes].sort((a, b) =>
          (a.scene.group?.name ?? '').localeCompare(b.scene.group?.name ?? '') || a.scene.name.localeCompare(b.scene.name)),
      }))
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
  })

  /**
   * Writes "start animated" AT the vendor: the setting then applies to all apps.
   * Optimistic, with rollback; the confirmed value comes back through the `scenes` message.
   */
  async function setAutoDynamic(sceneId: string, value: boolean): Promise<boolean> {
    const entry = entries.value[sceneId]
    if (!entry) return false
    const before = entries.value
    const optimistic = { ...before, [sceneId]: { scene: { ...entry.scene, autoDynamic: value }, state: entry.state } }
    entries.value = optimistic
    try {
      await getTransport().updateScene(sceneId, { autoDynamic: value })
      return true
    } catch (err) {
      if (entries.value === optimistic) entries.value = before
      const n = useNotificationsStore()
      const name = entry.scene.name
      if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name, message: err.message }))
      else n.error(t('errors.UNKNOWN', { name, message: (err as Error).message }))
      return false
    }
  }

  /** Recalls a scene. Activates the display right away, rolls back if the bridge refuses. */
  async function recall(sceneId: string, mode: SceneRecallMode = 'static'): Promise<boolean> {
    const entry = entries.value[sceneId]
    if (!entry) return false
    const before = entries.value
    const optimistic = withActive(before, sceneId, activationFor(mode), Date.now())
    entries.value = optimistic
    pending.value = { ...pending.value, [sceneId]: (pending.value[sceneId] ?? 0) + 1 }
    try {
      await getTransport().recallScene(sceneId, { mode })
      return true
    } catch (err) {
      if (entries.value === optimistic) entries.value = before   // nothing more recent has arrived
      const n = useNotificationsStore()
      const name = entry.scene.name
      if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name, message: err.message }))
      else n.error(t('errors.UNKNOWN', { name, message: (err as Error).message }))
      return false
    } finally {
      const left = (pending.value[sceneId] ?? 1) - 1
      const next = { ...pending.value }
      if (left <= 0) delete next[sceneId]; else next[sceneId] = left
      pending.value = next
    }
  }

  return {
    entries, list, count, scenesByPlugin, apply, setAll, forRoom, forHouse, recall, isPending,
    tapMode, setAutoDynamic,
    clonableFor, createScene, isCreating, deleteScene,
  }
})
