import { computed, onBeforeUnmount, ref, watch } from 'vue'

/**
 * Wait after the last click before sending a setpoint. A Nest thermostat counts against Google's
 * quota of about ten calls per minute and per account, and each setpoint costs two (the command,
 * then the re-read of what the device kept): five half-degree clicks in a row earned "Rate limited"
 * on the real house. The figure follows the finger at once; ONE command leaves once the clicks are
 * over — the vehicle panel does the same (`VehicleClimate`).
 */
export const SETPOINT_SEND_AFTER_MS = 1200

/**
 * A setpoint being set by repeated clicks: `value` is what to show (the draft, otherwise the
 * device's), `set` moves the draft and (re)starts the wait, and the draft is sent ONCE, then
 * handed over to the store's optimistic state — applied synchronously by `sendCommand`, so the
 * figure does not flicker.
 *
 * `key` is the device: a panel that goes from one device to another keeps this component, and a
 * draft must leave for the device it was made on, not the next one. Unmounting sends what was
 * pending. Switching devices sends it too (`onSwitch: 'send'`) when `send` names the device itself;
 * a control whose command the PARENT routes to the device on screen (`ClimateControl`) would send
 * it to the new device, so it drops it instead (`'drop'`).
 */
export function useSetpointDraft(
  key: () => string, current: () => number, send: (key: string, value: number) => void,
  opts: { onSwitch?: 'send' | 'drop'; delayMs?: number } = {},
) {
  const delayMs = opts.delayMs ?? SETPOINT_SEND_AFTER_MS
  const draft = ref<{ key: string; value: number } | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  const value = computed(() => (draft.value && draft.value.key === key() ? draft.value.value : current()))

  function flush(): void {
    if (timer) { clearTimeout(timer); timer = null }
    const d = draft.value
    draft.value = null
    // back where it started (+ then −): nothing to ask the device
    if (d && !(d.key === key() && d.value === current())) send(d.key, d.value)
  }
  function set(next: number): void {
    if (next === value.value) return
    draft.value = { key: key(), value: next }
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }

  watch(key, () => {
    if (opts.onSwitch !== 'drop') return flush()
    if (timer) { clearTimeout(timer); timer = null }
    draft.value = null
  })
  onBeforeUnmount(flush)
  return { value, set, flush }
}
