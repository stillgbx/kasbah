import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { CommandInput, DeviceDescriptor, DeviceEntry, DeviceEventKind, DeviceState, HealthResponse, House, ServerMessage } from '@kasbah/shared'
import { ApiRequestError, getTransport, type ConnectionStatus } from '../api'
import { t } from '../i18n'
import { optimisticPatch } from '../lib/optimistic'
import { useNotificationsStore } from './notifications'
import { useScenesStore } from './scenes'
import { useAutomationsStore } from './automations'

// Appareils des plugins : descripteurs + états, connexion push, commandes avec mise à jour
// optimiste et retour arrière. INVARIANT : l'objet d'état d'un appareil est REMPLACÉ (jamais muté)
// à chaque changement → la scène 3D détecte les changements par simple comparaison de référence.

export const useDevicesStore = defineStore('devices', () => {
  const descriptors = shallowRef<Record<string, DeviceDescriptor>>({})
  const states = shallowRef<Record<string, DeviceState>>({})
  const connection = ref<ConnectionStatus>('connecting')
  const pending = ref<Record<string, number>>({})
  /**
   * Position VISÉE d'un ouvrant, tenue hors de l'état. Un fabricant peut ne publier sa position
   * qu'à la FIN de la course (c'est le cas d'une box TaHoma) : pendant les ~20 s de descente il
   * réémet l'ancienne valeur, ce qui ferait sauter le curseur en arrière juste après le geste.
   * On affiche donc la cible jusqu'à ce qu'elle soit atteinte — ou jusqu'à ce que l'appareil dise
   * qu'il s'est arrêté ailleurs, et là le curseur revient à la réalité.
   *
   * `moved` : le serveur a confirmé un mouvement. Sans lui, la première trame (souvent
   * `motion: 'stopped'` avant que ça démarre) effacerait la cible aussitôt posée.
   *
   * `frozen` : cas du `stop`. On ne sait pas où l'ouvrant va s'immobiliser, mais la position de
   * l'état est périmée elle aussi — la relâcher tout de suite ferait revenir le curseur à la
   * position d'AVANT le geste avant de se poser sur la vraie. On gèle donc l'affichage sur la
   * valeur montrée, et la première trame qui arrive la libère, quoi qu'elle dise.
   */
  const targets = ref<Record<string, { position: number; moved: boolean; at: number; frozen?: boolean }>>({})
  const health = ref<HealthResponse | null>(null)
  /** Dernière maison poussée par le serveur (réécriture de house.json) ; le store `house` la suit. */
  const serverHouse = shallowRef<House | null>(null)
  let disconnect: (() => void) | null = null

  const list = computed<DeviceEntry[]>(() =>
    Object.values(descriptors.value)
      .map((descriptor) => ({ descriptor, state: states.value[descriptor.id]! }))
      .filter((e) => e.state)
      .sort((a, b) => a.descriptor.name.localeCompare(b.descriptor.name)),
  )
  const count = computed(() => list.value.length)

  function setEntries(entries: DeviceEntry[]) {
    const d: Record<string, DeviceDescriptor> = {}, s: Record<string, DeviceState> = {}
    for (const e of entries) { d[e.descriptor.id] = e.descriptor; s[e.descriptor.id] = e.state }
    descriptors.value = d
    states.value = s
  }

  /**
   * Une cible n'est jamais tenue indéfiniment : au-delà, l'appareil ne répond plus comme prévu.
   * Mesuré sur l'horloge du CLIENT (`Date.now`) et non sur `state.updatedAt` : ce dernier vient du
   * serveur, et une horloge simulée accélérée (plugin `mock`) fait bondir ses valeurs de plusieurs
   * minutes entre deux trames — la cible était alors jetée dès la première.
   */
  const TARGET_TTL_MS = 90_000

  function setState(id: string, state: DeviceState) {
    if (!descriptors.value[id]) return
    states.value = { ...states.value, [id]: state }
    resolveTarget(id, state)
    if (id in chargeAwaited.value && state.kind === 'vehicle' && (state.charging || !state.pluggedIn)) stopAwaitingCharge(id)
  }

  /**
   * Charge DEMANDÉE, pas encore constatée. Le serveur accuse « Lancer la charge » en quelques
   * secondes (borne forcée, commande à la voiture), mais le courant n'arrive que 20 s à 1 min plus
   * tard, et la voiture ne le dit qu'à sa relecture suivante (constaté le 2026-10-01) : `isPending`
   * seul laisserait le bouton redevenir « Lancer la charge » entre les deux. Tenu ici, dans le store,
   * parce que la vue Véhicules et le panneau de détail montrent la même attente. Levé quand la
   * voiture se dit en charge (ou débranchée), sur un refus, ou au bout de `CHARGE_WAIT_MAX_MS`.
   */
  const CHARGE_WAIT_MAX_MS = 180_000
  const chargeAwaited = ref<Record<string, ReturnType<typeof setTimeout>>>({})
  function stopAwaitingCharge(id: string): void {
    const timer = chargeAwaited.value[id]
    if (timer === undefined) return
    clearTimeout(timer)
    const next = { ...chargeAwaited.value }
    delete next[id]
    chargeAwaited.value = next
  }
  const isChargeRequested = (id: string) => id in chargeAwaited.value

  /** Confronte la cible tenue à l'état qui arrive : atteinte, abandonnée, ou toujours en route. */
  function resolveTarget(id: string, state: DeviceState) {
    const target = targets.value[id]
    if (!target || state.kind !== 'cover') return
    if (target.frozen) { clearTarget(id); return }      // gel levé par la première trame
    // position inconnue : rien ne confirme l'arrivée, la cible reste tenue jusqu'au TTL
    const arrived = state.position !== undefined && Math.abs(state.position - target.position) <= 1
    const moving = state.motion !== 'stopped'
    const stale = Date.now() - target.at > TARGET_TTL_MS
    // arrêté ailleurs APRÈS avoir bougé = ça ne s'est pas passé comme demandé (obstacle, stop,
    // refus du moteur) : on rend la main à la position réelle
    const givenUp = target.moved && !moving && !arrived
    if (arrived || givenUp || stale || !state.available) clearTarget(id)
    else if (moving && !target.moved) targets.value = { ...targets.value, [id]: { ...target, moved: true } }
  }

  function setTarget(id: string, position: number, at: number) {
    targets.value = { ...targets.value, [id]: { position, moved: false, at } }
  }

  function clearTarget(id: string) {
    if (!targets.value[id]) return
    const next = { ...targets.value }
    delete next[id]
    targets.value = next
  }

  /**
   * Position visée d'un ouvrant, ou `undefined` si aucune cible n'est tenue. C'est une SURCOUCHE :
   * l'état reste la source de vérité, l'appelant écrit `targetPosition(id) ?? state.position`.
   */
  const targetPosition = (id: string): number | undefined => targets.value[id]?.position

  // Événements transitoires (sonnette, mouvement) : le store ne cadre ni ne route (affaire de la vue),
  // il relaie à qui s'abonne. La vue Maison écoute pour réagir à un coup de sonnette.
  const deviceEventHandlers = new Set<(deviceId: string, event: DeviceEventKind, at: number) => void>()
  function onDeviceEvent(fn: (deviceId: string, event: DeviceEventKind, at: number) => void) {
    deviceEventHandlers.add(fn)
    return () => { deviceEventHandlers.delete(fn) }
  }

  function applyMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'snapshot': setEntries(msg.devices); break
      case 'devices': setEntries(msg.devices); break
      case 'state': setState(msg.deviceId, msg.state); break
      case 'availability': {
        const next = { ...states.value }
        for (const id of msg.deviceIds) { const prev = next[id]; if (prev) next[id] = { ...prev, available: msg.available } }
        states.value = next
        if (!msg.available) for (const id of msg.deviceIds) clearTarget(id)
        break
      }
      case 'house': serverHouse.value = msg.house; break
      case 'deviceEvent': for (const fn of deviceEventHandlers) fn(msg.deviceId, msg.event, msg.at); break
      case 'error': useNotificationsStore().error(msg.message); break
    }
  }

  function start() {
    if (disconnect) return
    const scenes = useScenesStore()
    const automations = useAutomationsStore()
    disconnect = getTransport().connect({
      // le même flux nourrit les appareils, les scènes des fabricants et les automatisations, chacun son store
      onMessage: (msg) => { applyMessage(msg); scenes.apply(msg); automations.apply(msg) },
      onStatus: (s) => { connection.value = s },
    })
  }

  function stop() { disconnect?.(); disconnect = null }

  async function refreshHealth() {
    try { health.value = await getTransport().getHealth() } catch { health.value = null }
  }

  /** Envoie une commande. Applique tout de suite l'effet attendu, annule si le serveur refuse. */
  async function sendCommand(deviceId: string, command: CommandInput): Promise<boolean> {
    const prev = states.value[deviceId]
    const descriptor = descriptors.value[deviceId]
    if (!prev || !descriptor) return false
    // relevé AVANT le patch optimiste : celui-ci passe `motion` à `stopped`, ce qui fait
    // abandonner la cible en cours par `resolveTarget` — la valeur montrée serait déjà perdue
    const shownBefore = prev.kind === 'cover' ? targetPosition(deviceId) ?? prev.position : undefined
    const patch = optimisticPatch(prev, command)
    if (patch) setState(deviceId, { ...prev, ...patch } as DeviceState)
    // La cible se pose APRÈS le patch optimiste, et l'ordre n'est pas un détail : ce patch écrit
    // `motion: 'closing'` de notre propre chef, et `resolveTarget` y verrait une confirmation de
    // mouvement par le serveur. La première trame réelle (souvent `stopped`, avant que le moteur
    // démarre) passerait alors pour « arrêté ailleurs » et effacerait la cible aussitôt.
    if (prev.kind === 'cover') {
      const aimed = command.type === 'cover.open' ? 100
        : command.type === 'cover.close' ? 0
        : command.type === 'cover.set_position' ? command.position
        // Rappel de la position favorite : la cible est celle que le moteur publie. Sans elle
        // (moteur unidirectionnel), on ne sait pas où il va — rien à viser.
        : command.type === 'cover.preset' ? prev.presetPosition ?? null
        : null                                          // set_tilt : aucune position visée
      // Cible déjà atteinte : rien à tenir, sinon la pastille resterait affichée jusqu'à un
      // prochain état (l'appareil n'en émet aucun, puisque rien ne change).
      if (command.type === 'cover.stop') {
        // sans position montrée (ouvrant inconnu jamais commandé), il n'y a rien à geler
        if (shownBefore !== undefined) targets.value = { ...targets.value, [deviceId]: { position: shownBefore, moved: true, at: Date.now(), frozen: true } }
        else clearTarget(deviceId)
      } else if (aimed === null || (prev.position !== undefined && Math.abs(aimed - prev.position) <= 1)) clearTarget(deviceId)
      else setTarget(deviceId, aimed, Date.now())
    }
    if (command.type === 'vehicle.start_charge' && !isChargeRequested(deviceId)) {
      chargeAwaited.value = { ...chargeAwaited.value, [deviceId]: setTimeout(() => stopAwaitingCharge(deviceId), CHARGE_WAIT_MAX_MS) }
    }
    pending.value = { ...pending.value, [deviceId]: (pending.value[deviceId] ?? 0) + 1 }
    try {
      await getTransport().sendCommand(deviceId, command)
      return true
    } catch (err) {
      stopAwaitingCharge(deviceId)                       // refusée : rien n'est plus attendu
      // retour arrière seulement si aucun état plus récent n'est arrivé entre-temps
      const cur = states.value[deviceId]
      if (cur && cur.updatedAt === prev.updatedAt) setState(deviceId, prev)
      clearTarget(deviceId)                              // commande refusée : plus rien à viser
      const n = useNotificationsStore()
      if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name: descriptor.name, message: err.message }))
      else n.error(t('errors.UNKNOWN', { name: descriptor.name, message: (err as Error).message }))
      return false
    } finally {
      const left = (pending.value[deviceId] ?? 1) - 1
      const next = { ...pending.value }
      if (left <= 0) delete next[deviceId]; else next[deviceId] = left
      pending.value = next
    }
  }

  const isPending = (id: string) => (pending.value[id] ?? 0) > 0

  /**
   * Fait oublier au plugin un appareil qu'il retenait alors qu'il a disparu du réseau (appareil
   * vendu, invité de passage). La liste des appareils revient par le serveur : rien à retirer ici.
   */
  async function forget(deviceId: string): Promise<boolean> {
    const name = descriptors.value[deviceId]?.name ?? deviceId
    try {
      await getTransport().forgetDevice(deviceId)
      return true
    } catch (err) {
      const n = useNotificationsStore()
      if (err instanceof ApiRequestError) n.error(t(`errors.${err.code}`, { name, message: err.message }))
      else n.error(t('errors.UNKNOWN', { name, message: (err as Error).message }))
      return false
    }
  }

  /** Exécute une scène (lot de commandes) ; les appareils inconnus sont ignorés. */
  async function runScene(actions: { deviceId: string; command: CommandInput }[]): Promise<void> {
    await Promise.all(actions.filter((a) => descriptors.value[a.deviceId]).map((a) => sendCommand(a.deviceId, a.command)))
  }

  return {
    descriptors, states, connection, pending, health, serverHouse, list, count, targets,
    start, stop, applyMessage, onDeviceEvent, sendCommand, runScene, isPending, isChargeRequested, forget, refreshHealth, setEntries,
    targetPosition, clearTarget,
  }
})
