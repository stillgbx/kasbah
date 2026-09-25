import { computed, reactive, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { useIntervalFn, useLocalStorage } from '@vueuse/core'
import { browserBluetooth, requestTens, TensLink, type BleDevice } from '../lib/tens/link'
import {
  checkFrame, intensityFrame, pauseFrame, programFrame, rampSteps, resumeFrame, sessionFlagFrame, startFrame, stopFrame,
  INTENSITY_STEP, type TensBattery, type TensChannels, type TensSession,
} from '../lib/tens/protocol'
import { INTENSITY_MAX, TENS_FAVORITES, tensProgram, type TensFavorite } from '../lib/tens/programs'

// Le TENS (actiTENS mini) piloté depuis CE navigateur, en Web Bluetooth. Rien ne passe par le
// serveur : ni automatisation, ni scène, ni assistant ne peuvent l'atteindre, et la tablette du
// palier n'en sait rien. C'est voulu — on envoie du courant dans un corps.
//
// L'intensité a DEUX valeurs par canal : la CONSIGNE (ce que l'utilisateur demande, qui bouge au
// clic ou au curseur) et la valeur ACQUISE (la dernière que le TENS a acceptée). Une seule file
// rapproche l'acquise de la consigne, un pas à la fois, tous canaux confondus :
// - la montée se fait par paliers de 0,5 mA ; la descente va droit à la consigne ;
// - une commande au plus toutes les 300 ms — plus vite, le TENS répond « trop tôt » (0x33) ;
// - un refus « trop tôt » ne perd rien : la consigne reste, la file retente au créneau suivant ;
// - jamais au-delà de INTENSITY_MAX ; pause et arrêt vident la file avant de partir.

/** Espacement minimal entre deux commandes d'intensité, tous canaux confondus. */
export const RAMP_INTERVAL_MS = 300
/**
 * Codes de refus relevés en direct (`1b c0 7f 02 <commande> <code>`) : 0x11 sur le programme quand
 * le TENS n'est pas posé (électrodes sans contact), 0x33 sur une intensité envoyée trop tôt après
 * la précédente — la même valeur repasse juste après.
 */
export const REFUSED_ELECTRODES = 0x11
export const REFUSED_TOO_SOON = 0x33
/** Refus « trop tôt » d'affilée avant d'abandonner la consigne (≈ 3 s de refus continus). */
const TOO_SOON_LIMIT = 10
const refusalCode = (e: unknown) => { const m = /^refused:(\d+)$/.exec((e as Error)?.message ?? ''); return m ? Number(m[1]) : null }
/** La clé i18n d'une erreur de commande, et son détail brut pour les refus qu'on ne sait pas nommer. */
function describe(e: unknown): { key: string; detail: string | null } {
  const code = refusalCode(e)
  if (code === REFUSED_ELECTRODES) return { key: 'tens.errors.electrodes', detail: null }
  if (code !== null) return { key: 'tens.errors.refused', detail: `code 0x${code.toString(16).padStart(2, '0')}` }
  return { key: 'tens.errors.command', detail: null }
}

/** Laisse au TENS le temps de vérifier les électrodes avant d'envoyer le programme. */
export const CHECK_SETTLE_MS = 1500

export type TensLinkStatus = 'disconnected' | 'connecting' | 'connected'
type Channel = 1 | 2

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const clampIntensity = (v: number) => Math.max(0, Math.min(INTENSITY_MAX, Math.round(v / INTENSITY_STEP) * INTENSITY_STEP))
const readJson = { read: (v: string) => { try { return JSON.parse(v) } catch { return null } }, write: (v: unknown) => JSON.stringify(v) }

export const useTensStore = defineStore('tens', () => {
  const link = shallowRef<TensLink | null>(null)
  const status = ref<TensLinkStatus>('disconnected')
  /** Clé i18n de la dernière erreur, effacée à l'action suivante. */
  const error = ref<string | null>(null)
  /** Le message brut qui accompagne l'erreur (diagnostic : étape, raison, code de refus). */
  const errorDetail = ref<string | null>(null)
  const battery = ref<TensBattery | null>(null)
  const session = ref<TensSession | null>(null)
  /** Quand `session` a été reçue : le compte à rebours s'estime entre deux notifications (4 s). */
  const sessionAt = ref(0)
  const now = ref(Date.now())
  const busy = ref(false)
  const deviceName = ref<string | null>(null)
  /**
   * Le dernier lancement fait D'ICI : l'appareil ne dit pas quel programme tourne, seulement
   * l'identifiant de séance qu'on lui a donné. Persisté pour retrouver le nom après un rechargement.
   */
  const lastLaunch = useLocalStorage<{ tag: number; program: string; minutes: number } | null>('kasbah.tens.lastLaunch', null, { serializer: readJson })
  /**
   * L'identifiant Web Bluetooth du TENS, retenu à la première connexion : le TENS n'annonce pas son
   * nom, aucun filtre du sélecteur ne le trouve. Avec lui, Connecter le rejoint sans sélecteur.
   */
  const knownDeviceId = useLocalStorage<string | null>('kasbah.tens.deviceId', null, { serializer: readJson })

  /** Les favoris de CE poste, un par programme, dans l'ordre d'ajout. */
  const favorites = useLocalStorage<TensFavorite[]>('kasbah.tens.favorites', TENS_FAVORITES.map((f) => ({ ...f })), {
    serializer: { read: (v) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a : [] } catch { return [] } }, write: (v) => JSON.stringify(v) },
  })
  const isFavorite = (program: string) => favorites.value.some((f) => f.program === program)
  /** Ajoute le programme aux favoris avec cette durée, ou l'en retire s'il y est déjà. */
  function toggleFavorite(program: string, minutes: number) {
    favorites.value = isFavorite(program)
      ? favorites.value.filter((f) => f.program !== program)
      : [...favorites.value, { program, minutes }]
  }

  /** Consigne par canal (dixièmes de mA). */
  const target = reactive<Record<Channel, number>>({ 1: 0, 2: 0 })
  /** Dernière valeur ACCEPTÉE par le TENS, par canal. */
  const acquired = reactive<Record<Channel, number>>({ 1: 0, 2: 0 })
  /** Consignes à retrouver après une pause (l'appareil remet les canaux à 0). */
  let resumeTargets: Record<Channel, number> = { 1: 0, 2: 0 }
  /** Génération de la file : l'incrémenter la vide (pause, arrêt, déconnexion). */
  let queueGen = 0
  let draining = false
  /** Génération de lancement : l'arrêt l'incrémente, et un lancement en cours s'interrompt avant d'envoyer la suite. */
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
  /** Le programme en cours, s'il a été lancé d'ici (sinon on sait seulement qu'une séance tourne). */
  const currentProgram = computed(() => {
    const s = session.value, l = lastLaunch.value
    return s && l && active.value && l.tag === s.sessionTag ? l.program : null
  })

  useIntervalFn(() => { now.value = Date.now() }, 1000)

  function setSession(s: TensSession) {
    session.value = s
    sessionAt.value = Date.now()
    now.value = sessionAt.value
  }
  /** Change l'état tout de suite après l'accusé du TENS, sans attendre sa notification. */
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
      // déconnecté, on ne sait plus rien de la batterie : pas de dernière valeur périmée à l'écran
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
      console.info(`[tens] appareil « ${device.name ?? '(sans nom)'} » id ${device.id}`)
      // le système nomme un appareil inconnu « Bluetooth 00:30:… » : on garde alors notre libellé
      deviceName.value = device.name && !device.name.startsWith('Bluetooth') ? device.name : null
      // une séance déjà en cours (reprise de connexion) : consigne et acquis partent de ce qu'il dit
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
    console.error('[tens] connexion', e)
  }

  /** L'appareil déjà autorisé, si le navigateur sait les lister (`getDevices`). */
  async function known(): Promise<BleDevice | null> {
    const bt = browserBluetooth()
    if (!bt?.getDevices || !knownDeviceId.value) return null
    try { return (await bt.getDevices()).find((d) => d.id === knownDeviceId.value) ?? null } catch { return null }
  }

  /**
   * Le TENS retenu s'il y en a un (et si le navigateur sait le retrouver), sinon le sélecteur filtré
   * sur « acTENS ». `all` ouvre la liste complète. Il exige un geste de l'utilisateur (un clic).
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
        // sélecteur fermé (NotFoundError) : pas une erreur ; le reste se dit
        if ((e as Error)?.name !== 'NotFoundError') connectFailed(e)
        return
      }
    }
    try { await open(device) } catch (e) { connectFailed(e) }
  }

  /** Sans geste, à l'ouverture de la page : le TENS retenu, s'il est là. Silencieux s'il échoue. */
  async function reconnect() {
    if (status.value !== 'disconnected') return
    const d = await known()
    if (d) { try { await open(d) } catch { /* on reste sur le bouton Connecter */ } }
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

  /** Une action utilisateur : une seule à la fois, et toute erreur devient un message. */
  async function act(fn: () => Promise<void>) {
    if (busy.value || !link.value) return
    busy.value = true
    error.value = null
    errorDetail.value = null
    try { await fn() } catch (e) {
      if ((e as Error).message !== 'aborted') fail(e)
    } finally { busy.value = false }
  }

  function startProgram(programId: string, minutes: number, channels: TensChannels = 3) {
    const program = tensProgram(programId)
    if (!program || active.value) return Promise.resolve()
    return act(async () => {
      const gen = ++launchGen
      const tag = Math.floor(Math.random() * 0x100)
      // un arrêt pressé pendant le lancement ne doit pas être suivi d'un démarrage
      const step = async (frame: Uint8Array) => { if (gen !== launchGen) throw new Error('aborted'); await send(frame) }
      await step(checkFrame(channels))
      await sleep(CHECK_SETTLE_MS)
      for (const seg of program.segments) await step(programFrame(tag, program.segments.length, seg))
      await step(startFrame(Math.round(minutes * 60)))
      lastLaunch.value = { tag, program: programId, minutes }
      zero()
      setSession({ state: 'running', reason: 0, sessionTag: tag, remainingS: Math.round(minutes * 60), ch1: 0, ch2: 0 })
      await send(sessionFlagFrame(true)).catch(() => undefined)
    })
  }

  // ---- la file des intensités ----

  /** Attend le prochain créneau libre (300 ms après le précédent), réservé avant d'attendre. */
  async function slot() {
    const at = Math.max(Date.now(), nextSlotAt)
    nextSlotAt = at + RAMP_INTERVAL_MS
    if (at > Date.now()) await sleep(at - Date.now())
  }

  /** Le prochain pas à envoyer, en alternant les canaux pour que les deux avancent ensemble. */
  let turn: Channel = 1
  /** `take` passe la main à l'autre canal ; sans lui, on regarde seulement s'il reste du travail. */
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
        // la consigne a pu bouger pendant l'attente : le pas se calcule au dernier moment
        const step = nextStep(true)
        if (!step) break
        try {
          await send(intensityFrame(step.ch, step.value))
          acquired[step.ch] = step.value
          tooSoon = 0
        } catch (e) {
          if (gen !== queueGen) break
          if (refusalCode(e) === REFUSED_TOO_SOON && ++tooSoon < TOO_SOON_LIMIT) continue
          // refus persistant ou autre erreur : la consigne revient à ce que le TENS a vraiment
          fail(e)
          target[1] = acquired[1]; target[2] = acquired[2]
          break
        }
      }
    } finally {
      draining = false
    }
    // la file a été vidée pendant un envoi : une nouvelle consigne a pu arriver entre-temps
    if (gen !== queueGen && nextStep() && running.value) void drain()
  }

  /** Nouvelle consigne pour un canal (dixièmes de mA) ; la file s'en charge. */
  function setIntensity(channel: Channel, value: number) {
    if (!link.value || !running.value) return
    error.value = null
    errorDetail.value = null
    target[channel] = clampIntensity(value)
    void drain()
  }
  /** +/− : la consigne bouge d'un pas à chaque clic, même si le TENS n'a pas encore suivi. */
  function nudge(channel: Channel, dir: 1 | -1) { setIntensity(channel, target[channel] + dir * INTENSITY_STEP) }

  /** La consigne affichée ; hors connexion, ce que dit l'appareil. */
  const targetOf = (ch: Channel) => (link.value ? target[ch] : acquiredOf(ch))
  /** Où en est le TENS ; hors connexion, sa dernière notification. */
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
    // l'appareil repart à 0 : la file remonte chaque canal vers sa consigne d'avant la pause
    target[1] = resumeTargets[1]; target[2] = resumeTargets[2]
    void drain()
  }

  /** L'arrêt passe même si une autre action est en cours : c'est le bouton qu'on doit pouvoir presser. */
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
    supported, connected, running, paused, active, remainingS, currentProgram,
    connect, reconnect, disconnect, startProgram, setIntensity, nudge, targetOf, acquiredOf, pause, resume, stop,
  }
})
