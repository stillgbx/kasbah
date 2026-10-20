import { computed, reactive, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { useIntervalFn, useLocalStorage } from '@vueuse/core'
import { browserBluetooth, requestTens, TensLink, type BleDevice } from '../lib/tens/link'
import {
  checkFrame, intensityFrame, pauseFrame, programFrame, rampSteps, resumeFrame, sessionFlagFrame, startFrame, stopFrame,
  INTENSITY_STEP, type TensBattery, type TensChannels, type TensSession,
} from '../lib/tens/protocol'
import { favoriteKey, INTENSITY_MAX, TENS_FAVORITES, tensProgram, type TensFavorite } from '../lib/tens/programs'

// The TENS (actiTENS mini) driven from THIS browser, over Web Bluetooth. Nothing goes through the
// server: no automation, no scene, no assistant can reach it, and the landing
// tablet knows nothing about it. That is deliberate — we send current into a body.
//
// The intensity has TWO values per channel: the SETPOINT (what the user asks for, which moves on
// click or on the slider) and the ACQUIRED value (the last one the TENS accepted). A single queue
// brings the acquired value closer to the setpoint, one step at a time, all channels combined:
// - the rise goes in steps of 0.5 mA; the descent goes straight to the setpoint;
// - one command at most every 300 ms — faster, the TENS answers "too soon" (0x33);
// - a "too soon" refusal loses nothing: the setpoint stays, the queue retries at the next slot;
// - never beyond INTENSITY_MAX; pause and stop empty the queue before leaving.

/** Minimum spacing between two intensity commands, all channels combined. */
export const RAMP_INTERVAL_MS = 300
/**
 * Refusal codes observed live (`1b c0 7f 02 <command> <code>`): 0x11 on the program when
 * the TENS is not applied (electrodes with no contact), 0x33 on an intensity sent too soon after
 * the previous one — the same value goes through right after.
 */
export const REFUSED_ELECTRODES = 0x11
export const REFUSED_TOO_SOON = 0x33
/** Consecutive "too soon" refusals before giving up the setpoint (≈ 3 s of continuous refusals). */
const TOO_SOON_LIMIT = 10
const refusalCode = (e: unknown) => { const m = /^refused:(\d+)$/.exec((e as Error)?.message ?? ''); return m ? Number(m[1]) : null }
/** The i18n key of a command error, and its raw detail for the refusals we cannot name. */
function describe(e: unknown): { key: string; detail: string | null } {
  const code = refusalCode(e)
  if (code === REFUSED_ELECTRODES) return { key: 'tens.errors.electrodes', detail: null }
  if (code !== null) return { key: 'tens.errors.refused', detail: `code 0x${code.toString(16).padStart(2, '0')}` }
  return { key: 'tens.errors.command', detail: null }
}

/** Gives the TENS time to check the electrodes before sending the program. */
export const CHECK_SETTLE_MS = 1500

export type TensLinkStatus = 'disconnected' | 'connecting' | 'connected'
type Channel = 1 | 2

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const clampIntensity = (v: number) => Math.max(0, Math.min(INTENSITY_MAX, Math.round(v / INTENSITY_STEP) * INTENSITY_STEP))
const readJson = { read: (v: string) => { try { return JSON.parse(v) } catch { return null } }, write: (v: unknown) => JSON.stringify(v) }

export const useTensStore = defineStore('tens', () => {
  const link = shallowRef<TensLink | null>(null)
  const status = ref<TensLinkStatus>('disconnected')
  /** i18n key of the last error, cleared at the next action. */
  const error = ref<string | null>(null)
  /** The raw message that goes with the error (diagnostic: step, reason, refusal code). */
  const errorDetail = ref<string | null>(null)
  const battery = ref<TensBattery | null>(null)
  const session = ref<TensSession | null>(null)
  /** When `session` was received: the countdown is estimated between two notifications (4 s). */
  const sessionAt = ref(0)
  const now = ref(Date.now())
  const busy = ref(false)
  const deviceName = ref<string | null>(null)
  /**
   * The last launch made FROM HERE: the device does not say which program is running, only
   * the session identifier we gave it. Persisted to find the name again after a reload.
   */
  const lastLaunch = useLocalStorage<{ tag: number; program: string; minutes: number; key?: string } | null>('kasbah.tens.lastLaunch', null, { serializer: readJson })
  /**
   * The Web Bluetooth identifier of the TENS, kept at the first connection: the TENS does not announce its
   * name, no picker filter finds it. With it, Connect reaches it without a picker.
   */
  const knownDeviceId = useLocalStorage<string | null>('kasbah.tens.deviceId', null, { serializer: readJson })

  /** The favorites of THIS workstation, in the order of addition; a program comes back there as many times as it has different settings. */
  const favorites = useLocalStorage<TensFavorite[]>('kasbah.tens.favorites', TENS_FAVORITES.map((f) => ({ ...f })), {
    serializer: { read: (v) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a : [] } catch { return [] } }, write: (v) => JSON.stringify(v) },
  })
  /** Is this exact launch (program, duration, channels, intensities) already a favorite? */
  const isFavorite = (fav: TensFavorite) => favorites.value.some((f) => favoriteKey(f) === favoriteKey(fav))
  /** Adds this launch to the favorites, or removes it if it is already there identically. */
  function toggleFavorite(fav: TensFavorite) {
    favorites.value = isFavorite(fav)
      ? favorites.value.filter((f) => favoriteKey(f) !== favoriteKey(fav))
      : [...favorites.value, { ...fav }]
  }

  /** Setpoint per channel (tenths of mA). */
  const target = reactive<Record<Channel, number>>({ 1: 0, 2: 0 })
  /** Last value ACCEPTED by the TENS, per channel. */
  const acquired = reactive<Record<Channel, number>>({ 1: 0, 2: 0 })
  /** Setpoints to restore after a pause (the device resets the channels to 0). */
  let resumeTargets: Record<Channel, number> = { 1: 0, 2: 0 }
  /** Queue generation: incrementing it empties it (pause, stop, disconnection). */
  let queueGen = 0
  let draining = false
  /** Launch generation: stop increments it, and a launch in progress is interrupted before sending the rest. */
  let launchGen = 0
  let nextSlotAt = 0

  const supported = computed(() => browserBluetooth() !== null)
  const connected = computed(() => status.value === 'connected')
  const running = computed(() => session.value?.state === 'running')
  const paused = computed(() => session.value?.state === 'paused')
  const active = computed(() => running.value || paused.value)
  const remainingS = computed(() => {
    const s = session.value
    if (!s) return 0
    const elapsed = s.state === 'running' && connected.value ? Math.floor((now.value - sessionAt.value) / 1000) : 0
    return Math.max(0, s.remainingS - elapsed)
  })
  /** The program in progress, if it was launched from here (otherwise we only know that a session is running). */
  const currentProgram = computed(() => {
    const s = session.value, l = lastLaunch.value
    return s && l && active.value && l.tag === s.sessionTag ? l.program : null
  })
  /** The launch in progress as a favorite key (`favoriteKey`), if it was launched from here. */
  const currentKey = computed(() => (currentProgram.value ? lastLaunch.value?.key ?? null : null))

  useIntervalFn(() => { now.value = Date.now() }, 1000)

  function setSession(s: TensSession) {
    session.value = s
    sessionAt.value = Date.now()
    now.value = sessionAt.value
  }
  /** Changes the state right after the TENS's acknowledgment, without waiting for its notification. */
  function markState(state: TensSession['state']) {
    if (session.value) setSession({ ...session.value, remainingS: remainingS.value, state })
  }
  function zero() { target[1] = target[2] = acquired[1] = acquired[2] = 0 }

  function onSession(s: TensSession) {
    setSession(s)
    if (s.state === 'idle') { queueGen++; zero() }
  }

  function attach(device: BleDevice): TensLink {
    return new TensLink(device, {
      onBattery: (b) => { battery.value = b },
      onSession,
      // disconnected, we no longer know anything about the battery: no stale last value on screen
      onDisconnect: () => { queueGen++; link.value = null; battery.value = null; status.value = 'disconnected' },
    })
  }

  async function open(device: BleDevice) {
    status.value = 'connecting'
    const l = attach(device)
    try {
      await l.open()
      link.value = l
      knownDeviceId.value = device.id
      console.info(`[tens] device "${device.name ?? '(sans nom)'}" id ${device.id}`)
      // the system names an unknown device "Bluetooth 00:30:…": we then keep our own label
      deviceName.value = device.name && !device.name.startsWith('Bluetooth') ? device.name : null
      // a session already in progress (connection resumed): setpoint and acquired start from what it says
      const s = session.value
      if (s && s.state !== 'idle') { acquired[1] = target[1] = s.ch1; acquired[2] = target[2] = s.ch2 } else zero()
      status.value = 'connected'
    } catch (e) {
      l.close()
      status.value = 'disconnected'
      throw e
    }
  }

  function connectFailed(e: unknown) {
    error.value = 'tens.errors.connect'
    errorDetail.value = (e as Error)?.message ?? String(e)
    console.error('[tens] connection', e)
  }

  /** The already authorized device, if the browser can list them (`getDevices`). */
  async function known(): Promise<BleDevice | null> {
    const bt = browserBluetooth()
    if (!bt?.getDevices || !knownDeviceId.value) return null
    try { return (await bt.getDevices()).find((d) => d.id === knownDeviceId.value) ?? null } catch { return null }
  }

  /**
   * The remembered TENS if there is one (and if the browser can find it again), otherwise the picker filtered
   * on "acTENS". `all` opens the full list. It requires a user gesture (a click).
   */
  async function connect(all = false) {
    const bt = browserBluetooth()
    if (!bt) { error.value = 'tens.errors.unsupported'; return }
    error.value = null
    errorDetail.value = null
    const remembered = all ? null : await known()
    let device: BleDevice
    if (remembered) device = remembered
    else {
      try {
        device = await requestTens(bt, all)
      } catch (e) {
        // picker closed (NotFoundError): not an error; the rest is reported
        if ((e as Error)?.name !== 'NotFoundError') connectFailed(e)
        return
      }
    }
    try { await open(device) } catch (e) { connectFailed(e) }
  }

  /** Without a gesture, on opening the page: the remembered TENS, if it is there. Silent if it fails. */
  async function reconnect() {
    if (status.value !== 'disconnected') return
    const d = await known()
    if (d) { try { await open(d) } catch { /* we stay on the Connect button */ } }
  }

  function disconnect() {
    queueGen++
    link.value?.close()
    link.value = null
    battery.value = null
    status.value = 'disconnected'
  }

  async function send(frame: Uint8Array) {
    if (!link.value) throw new Error('disconnected')
    return link.value.send(frame)
  }

  function fail(e: unknown) {
    const d = describe(e)
    error.value = d.key
    errorDetail.value = d.detail
  }

  /** A user action: only one at a time, and any error becomes a message. */
  async function act(fn: () => Promise<void>) {
    if (busy.value || !link.value) return
    busy.value = true
    error.value = null
    errorDetail.value = null
    try { await fn() } catch (e) {
      if ((e as Error).message !== 'aborted') fail(e)
    } finally { busy.value = false }
  }

  /**
   * `targets`: the intensity to reach per channel once the program has started (tenths of mA). The
   * queue climbs there in steps as for a click on +; any gesture replaces it, pause and stop empty it.
   * A channel outside `channels` stays at 0.
   */
  function startProgram(programId: string, minutes: number, channels: TensChannels = 3, targets: Record<Channel, number> = { 1: 0, 2: 0 }) {
    const program = tensProgram(programId)
    if (!program || active.value) return Promise.resolve()
    return act(async () => {
      const gen = ++launchGen
      const tag = Math.floor(Math.random() * 0x100)
      // a stop pressed during the launch must not be followed by a start
      const step = async (frame: Uint8Array) => { if (gen !== launchGen) throw new Error('aborted'); await send(frame) }
      await step(checkFrame(channels))
      await sleep(CHECK_SETTLE_MS)
      for (const seg of program.segments) await step(programFrame(tag, program.segments.length, seg))
      await step(startFrame(Math.round(minutes * 60)))
      const ch1 = channels & 1 ? clampIntensity(targets[1]) : 0, ch2 = channels & 2 ? clampIntensity(targets[2]) : 0
      lastLaunch.value = { tag, program: programId, minutes, key: favoriteKey({ program: programId, minutes, channels, ch1, ch2 }) }
      zero()
      setSession({ state: 'running', reason: 0, sessionTag: tag, remainingS: Math.round(minutes * 60), ch1: 0, ch2: 0 })
      await send(sessionFlagFrame(true)).catch(() => undefined)
      target[1] = ch1; target[2] = ch2
      void drain()
    })
  }

  // ---- the intensity queue ----

  /** Waits for the next free slot (300 ms after the previous one), reserved before waiting. */
  async function slot() {
    const at = Math.max(Date.now(), nextSlotAt)
    nextSlotAt = at + RAMP_INTERVAL_MS
    if (at > Date.now()) await sleep(at - Date.now())
  }

  /** The next step to send, alternating channels so that both advance together. */
  let turn: Channel = 1
  /** `take` hands over to the other channel; without it, we only check whether work remains. */
  function nextStep(take = false): { ch: Channel; value: number } | null {
    for (const ch of [turn, turn === 1 ? 2 : 1] as Channel[]) {
      const value = rampSteps(acquired[ch], target[ch])[0]
      if (value !== undefined) {
        if (take) turn = ch === 1 ? 2 : 1
        return { ch, value }
      }
    }
    return null
  }

  async function drain() {
    if (draining) return
    draining = true
    const gen = queueGen
    let tooSoon = 0
    try {
      while (gen === queueGen && link.value && running.value) {
        if (!nextStep()) break
        await slot()
        if (gen !== queueGen || !link.value) break
        // the setpoint may have moved during the wait: the step is computed at the last moment
        const step = nextStep(true)
        if (!step) break
        try {
          await send(intensityFrame(step.ch, step.value))
          acquired[step.ch] = step.value
          tooSoon = 0
        } catch (e) {
          if (gen !== queueGen) break
          if (refusalCode(e) === REFUSED_TOO_SOON && ++tooSoon < TOO_SOON_LIMIT) continue
          // persistent refusal or other error: the setpoint goes back to what the TENS really
          fail(e)
          target[1] = acquired[1]; target[2] = acquired[2]
          break
        }
      }
    } finally {
      draining = false
    }
    // the queue was emptied during a send: a new setpoint may have arrived in the meantime
    if (gen !== queueGen && nextStep() && running.value) void drain()
  }

  /** New setpoint for a channel (tenths of mA); the queue takes care of it. */
  function setIntensity(channel: Channel, value: number) {
    if (!link.value || !running.value) return
    error.value = null
    errorDetail.value = null
    target[channel] = clampIntensity(value)
    void drain()
  }
  /** +/−: the setpoint moves by one step at each click, even if the TENS has not followed yet. */
  function nudge(channel: Channel, dir: 1 | -1) { setIntensity(channel, target[channel] + dir * INTENSITY_STEP) }

  /** The displayed setpoint; when disconnected, what the device says. */
  const targetOf = (ch: Channel) => (link.value ? target[ch] : acquiredOf(ch))
  /** Where the TENS stands; when disconnected, its last notification. */
  const acquiredOf = (ch: Channel) => (link.value ? acquired[ch] : ch === 1 ? session.value?.ch1 ?? 0 : session.value?.ch2 ?? 0)

  function pause() {
    return act(async () => {
      queueGen++
      resumeTargets = { 1: target[1], 2: target[2] }
      await send(pauseFrame())
      zero()
      markState('paused')
    })
  }

  async function resume() {
    await act(async () => {
      await send(resumeFrame())
      markState('running')
    })
    if (error.value) return
    // the device restarts at 0: the queue climbs each channel back toward its pre-pause setpoint
    target[1] = resumeTargets[1]; target[2] = resumeTargets[2]
    void drain()
  }

  /** Stop goes through even if another action is in progress: it is the button that must be pressable. */
  async function stop() {
    if (!link.value) return
    queueGen++
    launchGen++
    error.value = null
    errorDetail.value = null
    try {
      await send(stopFrame())
      zero()
      markState('idle')
      await send(sessionFlagFrame(false)).catch(() => undefined)
    } catch (e) {
      fail(e)
    }
  }

  return {
    status, error, errorDetail, battery, session, busy, deviceName, lastLaunch, knownDeviceId, favorites, isFavorite, toggleFavorite,
    supported, connected, running, paused, active, remainingS, currentProgram, currentKey,
    connect, reconnect, disconnect, startProgram, setIntensity, nudge, targetOf, acquiredOf, pause, resume, stop,
  }
})
