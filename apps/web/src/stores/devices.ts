import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { CommandInput, DeviceDescriptor, DeviceEntry, DeviceEventKind, DeviceState, HealthResponse, House, ServerMessage } from '@kasbah/shared'
import { ApiRequestError, getTransport, type ConnectionStatus } from '../api'
import { t } from '../i18n'
import { optimisticPatch } from '../lib/optimistic'
import { useNotificationsStore } from './notifications'
import { useScenesStore } from './scenes'
import { useAutomationsStore } from './automations'
import { useShoppingStore } from './shopping'
import { usePropertiesStore } from './properties'
import { useAppUpdateStore } from './appUpdate'

// Plugin devices: descriptors + states, push connection, commands with optimistic update
// and rollback. INVARIANT: a device's state object is REPLACED (never mutated)
// on each change → the 3D scene detects changes by a simple reference comparison.

export const useDevicesStore = defineStore('devices', () => {
  const descriptors = shallowRef<Record<string, DeviceDescriptor>>({})
  const states = shallowRef<Record<string, DeviceState>>({})
  const connection = ref<ConnectionStatus>('connecting')
  const pending = ref<Record<string, number>>({})
  /**
   * TARGETED position of a cover, held outside the state. A vendor may only publish its position
   * at the END of the travel (as with a TaHoma box): during the ~20 s of descent it
   * re-emits the old value, which would make the slider jump backward right after the gesture.
   * We therefore display the target until it is reached — or until the device says
   * it stopped elsewhere, and then the slider goes back to reality.
   *
   * `moved`: the server confirmed a movement. Without it, the first frame (often
   * `motion: 'stopped'` before it starts) would erase the target as soon as it is set.
   *
   * `frozen`: the case of `stop`. We do not know where the cover will come to rest, but the
   * state's position is stale too — releasing it right away would make the slider go back to the
   * position from BEFORE the gesture before settling on the real one. We therefore freeze the display on the
   * shown value, and the first frame that arrives releases it, whatever it says.
   */
  const targets = ref<Record<string, { position: number; moved: boolean; at: number; frozen?: boolean }>>({})
  const health = ref<HealthResponse | null>(null)
  /** Last house pushed by the server (rewrite of house.json); the `house` store follows it. */
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
   * A target is never held indefinitely: beyond that, the device no longer answers as expected.
   * Measured on the CLIENT clock (`Date.now`) and not on `state.updatedAt`: the latter comes from the
   * server, and an accelerated simulated clock (`mock` plugin) makes its values jump by several
   * minutes between two frames — the target was then thrown away from the first one.
   */
  const TARGET_TTL_MS = 90_000

  function setState(id: string, state: DeviceState) {
    if (!descriptors.value[id]) return
    states.value = { ...states.value, [id]: state }
    resolveTarget(id, state)
    if (id in chargeAwaited.value && state.kind === 'vehicle' && (state.charging || !state.pluggedIn)) stopAwaitingCharge(id)
  }

  /**
   * Charge REQUESTED, not yet observed. The server acknowledges "Start charging" within a few
   * seconds (charger forced, command to the car), but the current only arrives 20 s to 1 min
   * later, and the car only says so on its next reading (observed on 2026-10-01): `isPending`
   * alone would let the button become "Start charging" again between the two. Held here, in the store,
   * because the Vehicles view and the detail panel show the same wait. Lifted when the
   * car says it is charging (or unplugged), on a refusal, or after `CHARGE_WAIT_MAX_MS`.
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

  /** Compares the held target with the incoming state: reached, given up, or still on its way. */
  function resolveTarget(id: string, state: DeviceState) {
    const target = targets.value[id]
    if (!target || state.kind !== 'cover') return
    if (target.frozen) { clearTarget(id); return }      // freeze lifted by the first frame
    // unknown position: nothing confirms the arrival, the target stays held until the TTL
    const arrived = state.position !== undefined && Math.abs(state.position - target.position) <= 1
    const moving = state.motion !== 'stopped'
    const stale = Date.now() - target.at > TARGET_TTL_MS
    // stopped elsewhere AFTER having moved = it did not go as requested (obstacle, stop,
    // motor refusal): we hand back to the real position
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
   * Targeted position of a cover, or `undefined` if no target is held. It is an OVERLAY:
   * the state remains the source of truth, the caller writes `targetPosition(id) ?? state.position`.
   */
  const targetPosition = (id: string): number | undefined => targets.value[id]?.position

  // Transient events (doorbell, movement): the store neither frames nor routes (the view's business),
  // it relays to whoever subscribes. The House view listens to react to a doorbell ring.
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
    const properties = usePropertiesStore()
    const appUpdate = useAppUpdateStore()
    const shopping = useShoppingStore()
    disconnect = getTransport().connect({
      // the same stream feeds the devices, the vendors' scenes, the automations and the shopping list, each its own
      // store; the snapshot's property says whether another screen switched away from the demo house
      onMessage: (msg) => { properties.apply(msg); appUpdate.apply(msg); applyMessage(msg); scenes.apply(msg); automations.apply(msg); shopping.apply(msg) },
      onStatus: (s) => { connection.value = s },
    })
  }

  function stop() { disconnect?.(); disconnect = null }

  async function refreshHealth() {
    try { health.value = await getTransport().getHealth() } catch { health.value = null }
  }

  /** Sends a command. Applies the expected effect right away, cancels if the server refuses. */
  async function sendCommand(deviceId: string, command: CommandInput): Promise<boolean> {
    const prev = states.value[deviceId]
    const descriptor = descriptors.value[deviceId]
    if (!prev || !descriptor) return false
    // read BEFORE the optimistic patch: the latter sets `motion` to `stopped`, which makes
    // `resolveTarget` abandon the current target — the shown value would already be lost
    const shownBefore = prev.kind === 'cover' ? targetPosition(deviceId) ?? prev.position : undefined
    const patch = optimisticPatch(prev, command)
    if (patch) setState(deviceId, { ...prev, ...patch } as DeviceState)
    // The target is set AFTER the optimistic patch, and the order is not a detail: this patch writes
    // `motion: 'closing'` on its own, and `resolveTarget` would see in it a confirmation of
    // movement by the server. The first real frame (often `stopped`, before the motor
    // starts) would then pass for "stopped elsewhere" and erase the target right away.
    if (prev.kind === 'cover') {
      const aimed = command.type === 'cover.open' ? 100
        : command.type === 'cover.close' ? 0
        : command.type === 'cover.set_position' ? command.position
        // Recall of the favorite position: the target is the one the motor publishes. Without it
        // (one-way motor), we do not know where it goes — nothing to aim at.
        : command.type === 'cover.preset' ? prev.presetPosition ?? null
        : null                                          // set_tilt: no targeted position
      // Target already reached: nothing to hold, otherwise the pill would stay displayed until a
      // next state (the device emits none, since nothing changes).
      if (command.type === 'cover.stop') {
        // without a shown position (unknown cover never commanded), there is nothing to freeze
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
      stopAwaitingCharge(deviceId)                       // refused: nothing is awaited anymore
      // rollback only if no more recent state has arrived in the meantime
      const cur = states.value[deviceId]
      if (cur && cur.updatedAt === prev.updatedAt) setState(deviceId, prev)
      clearTarget(deviceId)                              // command refused: nothing left to aim at
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
   * Makes the plugin forget a device it was retaining although it has disappeared from the network (device
   * sold, passing guest). The device list comes back through the server: nothing to remove here.
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

  /** Runs a scene (batch of commands); unknown devices are ignored. */
  async function runScene(actions: { deviceId: string; command: CommandInput }[]): Promise<void> {
    await Promise.all(actions.filter((a) => descriptors.value[a.deviceId]).map((a) => sendCommand(a.deviceId, a.command)))
  }

  return {
    descriptors, states, connection, pending, health, serverHouse, list, count, targets,
    start, stop, applyMessage, onDeviceEvent, sendCommand, runScene, isPending, isChargeRequested, forget, refreshHealth, setEntries,
    targetPosition, clearTarget,
  }
})
