import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { StateFor } from '@kasbah/shared'

// Position lue d'un lecteur, avancée localement entre deux relevés. L'appareil ne pousse pas sa
// position : le plugin la relit toutes les deux à dix secondes. Tant que ça joue, on la fait avancer
// ICI à la demi-seconde depuis le dernier relevé reçu (repère local posé quand la position ou le
// morceau change — pas `updatedAt`, qu'un simple changement de volume ferait bouger). Le relevé
// suivant recale sans à-coup visible. Même règle que le panneau appareil (`MediaPlayerControl`).
//
// Une durée n'est une durée que POSITIVE : un lecteur peut en annoncer une absurde pour dire
// « inconnue » (Prime Video : `-0.001`).

/**
 * Marge (s) en pause : un relevé qui s'écarte de moins que ça de la position figée est le bruit du
 * sondage (le dernier date d'avant le geste, jusqu'à 2 s), pas un déplacement — on le laisse passer
 * sans faire reculer le compteur. Au-delà, c'est un vrai saut (transfert, seek) et on le suit.
 */
export const MEDIA_POSITION_SLACK_S = 2.5

export function useMediaPosition(state: Ref<StateFor<'media_player'> | undefined>) {
  const anchor = ref({ pos: 0, at: 0 })
  const now = ref(Date.now())
  const playing = () => state.value?.playback === 'playing'
  /** Position courante d'après le repère local : avance tant que ça joue, figée sinon. */
  const local = () => anchor.value.pos + (playing() ? (Date.now() - anchor.value.at) / 1000 : 0)

  // Un relevé neuf recale le repère — sauf en pause, où un relevé proche est le bruit du sondage :
  // adopter ce vieux chiffre faisait reculer le compteur, qui se repositionnait ensuite.
  watch(() => [state.value?.nowPlaying?.positionS, state.value?.nowPlaying?.title] as const, ([pos, title], old) => {
    const raw = pos ?? 0
    const sameTrack = !!old && old[1] === title
    if (sameTrack && !playing() && Math.abs(raw - anchor.value.pos) < MEDIA_POSITION_SLACK_S) return
    anchor.value = { pos: raw, at: Date.now() }
  }, { immediate: true })
  // Lecture → pause : le compteur s'arrête NET là où il en était, il ne saute pas au dernier relevé.
  // Pause → lecture : il repart d'où il s'était figé.
  watch(() => state.value?.playback, (pb, prev) => {
    if (prev === 'playing' && pb !== 'playing') anchor.value = { pos: local(), at: Date.now() }
    else if (pb === 'playing' && prev !== 'playing') anchor.value = { pos: anchor.value.pos, at: Date.now() }
  })
  let ticker: ReturnType<typeof setInterval> | undefined
  onMounted(() => { ticker = setInterval(() => { if (playing()) now.value = Date.now() }, 500) })
  onBeforeUnmount(() => clearInterval(ticker))

  const duration = computed<number | undefined>(() => {
    const d = state.value?.nowPlaying?.durationS
    return d !== undefined && d > 0 ? d : undefined
  })
  const hasPosition = computed(() => state.value?.nowPlaying?.positionS !== undefined)
  const position = computed<number | undefined>(() => {
    const s = state.value
    if (!s?.nowPlaying) return undefined
    const p = s.playback === 'playing' ? anchor.value.pos + (now.value - anchor.value.at) / 1000 : anchor.value.pos
    return duration.value ? Math.min(p, duration.value) : p
  })
  return { position, duration, hasPosition }
}

/** Tenue minimale (ms) : l'écho optimiste du store arrive aussitôt avec la valeur exacte de la cible. */
export const SEEK_HOLD_MIN_MS = 2_000
/** Tenue maximale (ms) : un lecteur qui ne confirme jamais ne doit pas figer le curseur. */
export const SEEK_HOLD_MAX_MS = 8_000

/**
 * Curseur de position tenu après un déplacement. Un seul geste produit TROIS positions successives
 * dans le store : l'écho optimiste de notre commande (la cible exacte, tout de suite), un sondage
 * encore ancien (le point de départ, jusqu'à 2 s), puis le vrai relevé de l'appareil. La valeur
 * demandée reste donc affichée au moins `SEEK_HOLD_MIN_MS` — l'écho ne compte pas — et jusqu'à ce
 * que le lecteur publie une position PLUS PROCHE de la cible que du point de départ (comparer au
 * départ plutôt qu'à une distance fixe : un déplacement d'une seconde doit aussi tenir face à un
 * relevé stagnant), au plus `SEEK_HOLD_MAX_MS`. `deviceId` : changer de lecteur relâche tout.
 */
export function useSeekHold(published: Ref<number | undefined>, deviceId?: Ref<string | undefined>) {
  const seekDraft = ref<number | null>(null)
  const holding = ref(false)
  let target = 0
  let origin = 0
  let beganAt = 0

  /** Pose la cible (arrondie à la seconde) et rend la valeur à envoyer au lecteur. */
  function beginSeek(v: number): number {
    target = Math.round(v)
    origin = published.value ?? target
    beganAt = Date.now()
    seekDraft.value = target
    holding.value = true
    return target
  }
  function release() {
    holding.value = false
    seekDraft.value = null
  }

  watch(published, (pos) => {
    if (!holding.value || pos === undefined) return
    const heldMs = Date.now() - beganAt
    if (heldMs >= SEEK_HOLD_MAX_MS) return release()
    if (heldMs >= SEEK_HOLD_MIN_MS && Math.abs(pos - target) < Math.abs(pos - origin)) release()
  })
  if (deviceId) watch(deviceId, release)

  return { seekDraft, beginSeek, holding }
}

/** `m:ss` ; vide sans valeur. */
export function formatClock(s: number | undefined | null): string {
  if (s === undefined || s === null || !Number.isFinite(s)) return ''
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
