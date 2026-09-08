import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { pluginSettingsSchema, roomKey, type PluginSceneEntry, type PluginSettings, type SceneActivation, type SceneRecallMode, type ServerMessage } from '@kasbah/shared'
import { ApiRequestError, getTransport } from '../api'
import { t } from '../i18n'
import { useNotificationsStore } from './notifications'

// Scènes des fabricants (scènes Hue…). Même invariant que le store des appareils : la carte est
// REMPLACÉE à chaque changement. Le rapprochement avec la maison se fait par NOM de pièce, comme
// l'auto-placement des appareils (`roomKey`) : une scène de zone n'appartient à aucune pièce et
// remonte au niveau maison.

type Entries = Record<string, PluginSceneEntry>

/**
 * Active une scène et éteint ses sœurs du même groupe (règle miroir de celle du serveur).
 * ATTENTION : ÉTEINDRE une scène n'éteint rien d'autre — sans ce garde-fou, le message
 * « l'ancienne scène est inactive » que le pont envoie juste après un changement d'ambiance
 * effaçait l'activation de la NOUVELLE, arrivée dans le même lot.
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

/** Activation attendue d'un rappel : `off` éteint, les deux autres modes portent leur nom. */
const activationFor = (mode: SceneRecallMode): SceneActivation => (mode === 'off' ? 'inactive' : mode)

export const useScenesStore = defineStore('scenes', () => {
  const entries = shallowRef<Entries>({})
  const pending = ref<Record<string, number>>({})
  /** Réglages par plugin, lus au serveur (pas dans la tablette : ils valent pour toutes). */
  const pluginSettings = shallowRef<Record<string, PluginSettings>>({})

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

  /** Scènes d'une pièce de la maison (rapprochement par nom). */
  const forRoom = (roomName: string) => list.value.filter(
    (e) => e.scene.group?.kind === 'room' && roomKey(e.scene.group.name) === roomKey(roomName),
  )

  /** Scènes qu'aucune pièce de la maison ne réclame : zones du fabricant et pièces inconnues. */
  const forHouse = (roomNames: string[]) => {
    const known = new Set(roomNames.map(roomKey))
    return list.value.filter((e) => !e.scene.group || e.scene.group.kind === 'zone' || !known.has(roomKey(e.scene.group.name)))
  }

  const isPending = (sceneId: string) => (pending.value[sceneId] ?? 0) > 0

  const settingsOf = (pluginId: string): PluginSettings => pluginSettings.value[pluginId] ?? pluginSettingsSchema.parse({})

  async function loadPluginSettings(): Promise<void> {
    try { pluginSettings.value = await getTransport().getPluginSettings() }
    catch { /* réglages indisponibles : les défauts s'appliquent */ }
  }

  /** Défaut du plugin pour les ambiances animées qui apparaîtront (n'affecte pas l'existant). */
  async function setAutoDynamicForNewScenes(pluginId: string, value: boolean): Promise<boolean> {
    const before = pluginSettings.value
    pluginSettings.value = { ...before, [pluginId]: { ...settingsOf(pluginId), autoDynamicForNewScenes: value } }
    try {
      const saved = await getTransport().setPluginSettings(pluginId, { autoDynamicForNewScenes: value })
      pluginSettings.value = { ...pluginSettings.value, [pluginId]: saved }
      return true
    } catch (err) {
      pluginSettings.value = before
      const n = useNotificationsStore()
      if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name: pluginId, message: err.message }))
      else n.error(t('errors.UNKNOWN', { name: pluginId, message: (err as Error).message }))
      return false
    }
  }

  /**
   * Mode joué quand on touche une ambiance éteinte : animé si le fabricant l'a réglée ainsi
   * (`autoDynamic`, lu sur le pont), fixe sinon. Le bouton d'animation reste toujours explicite.
   */
  function tapMode(entry: PluginSceneEntry): 'static' | 'dynamic' {
    return entry.scene.dynamic && entry.scene.autoDynamic ? 'dynamic' : 'static'
  }

  /**
   * Ambiances à palette animée, regroupées PAR PLUGIN : le concept est commun, les réglages non —
   * on peut vouloir les palettes animées sur les lampes et pas sur un autre parc d'appareils.
   */
  const animatedByPlugin = computed(() => {
    const acc = new Map<string, PluginSceneEntry[]>()
    for (const e of list.value) {
      if (!e.scene.dynamic) continue
      const arr = acc.get(e.scene.pluginId)
      if (arr) arr.push(e)
      else acc.set(e.scene.pluginId, [e])
    }
    return [...acc.entries()]
      .map(([pluginId, scenes]) => ({ pluginId, scenes }))
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId))
  })

  /**
   * Écrit « démarrer animée » CHEZ le fabricant : le réglage vaut alors pour toutes les apps.
   * Optimiste, avec retour arrière ; la valeur confirmée revient par le message `scenes`.
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

  /** Rappelle une scène. Active tout de suite l'affichage, revient en arrière si le pont refuse. */
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
      if (entries.value === optimistic) entries.value = before   // rien de plus récent n'est arrivé
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
    entries, list, count, animatedByPlugin, pluginSettings, apply, setAll, forRoom, forHouse, recall, isPending,
    tapMode, setAutoDynamic, settingsOf, loadPluginSettings, setAutoDynamicForNewScenes,
  }
})
