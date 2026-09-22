import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { StateFor } from '@kasbah/shared'

// Position lue d'un lecteur, avancée localement entre deux relevés. L'appareil ne pousse pas sa
// position : le plugin la relit toutes les dix secondes. Tant que ça joue, on la fait avancer ICI
// à la demi-seconde depuis le dernier relevé reçu (repère local posé quand la position ou le
// morceau change — pas `updatedAt`, qu'un simple changement de volume ferait bouger). Le relevé
// suivant recale sans à-coup visible. Même règle que le panneau appareil (`MediaPlayerControl`).
//
// Une durée n'est une durée que POSITIVE : un lecteur peut en annoncer une absurde pour dire
// « inconnue » (Prime Video : `-0.001`).
export function useMediaPosition(state: Ref<StateFor<'media_player'> | undefined>) {
  const anchor = ref({ pos: 0, at: 0 })
  const now = ref(Date.now())
  /** Position courante d'après le repère local : avance tant que ça joue, figée sinon. */
  const local = () => anchor.value.pos + (state.value?.playback === 'playing' ? (Date.now() - anchor.value.at) / 1000 : 0)
  /** Écart au-delà duquel un relevé pendant la pause vaut un vrai déplacement (transfert, seek) et non le bruit du sondage. */
  const PAUSED_REANCHOR_S = 2.5
  // Un relevé neuf recale le repère — sauf en pause, où le relevé date du dernier sondage AVANT le
  // geste (jusqu'à 2 s de retard) : adopter ce vieux chiffre faisait reculer le compteur, qui se
  // repositionnait ensuite. En pause on garde la position locale, et on ne cède au relevé que s'il
  // dit vraiment autre chose (un déplacement).
  watch(() => [state.value?.nowPlaying?.positionS, state.value?.nowPlaying?.title] as const, ([pos], old) => {
    const raw = pos ?? 0
    const sameTrack = old && old[1] === state.value?.nowPlaying?.title
    if (sameTrack && state.value?.playback !== 'playing' && Math.abs(raw - anchor.value.pos) < PAUSED_REANCHOR_S) return
    anchor.value = { pos: raw, at: Date.now() }
  }, { immediate: true })
  // Lecture → pause : le compteur s'arrête NET là où il en était, il ne saute pas au dernier relevé.
  watch(() => state.value?.playback, (pb, prev) => {
    if (prev === 'playing' && pb !== 'playing') anchor.value = { pos: local(), at: Date.now() }
    else if (pb === 'playing' && prev !== 'playing') anchor.value = { pos: anchor.value.pos, at: Date.now() }
  })
  let ticker: ReturnType<typeof setInterval> | undefined
  onMounted(() => { ticker = setInterval(() => { if (state.value?.playback === 'playing') now.value = Date.now() }, 500) })
  onBeforeUnmount(() => clearInterval(ticker))

  const duration = computed<number | undefined>(() => {
    const d = state.value?.nowPlaying?.durationS
    return d !== undefined && d > 0 ? d : undefined
  })
  const hasPosition = computed(() => state.value?.nowPlaying?.positionS !== undefined)
  const position = computed<number | undefined>(() => {
    const s = state.value
    const n = s?.nowPlaying
    if (!s || !n) return undefined
    const p = s.playback === 'playing' ? anchor.value.pos + (now.value - anchor.value.at) / 1000 : anchor.value.pos
    return duration.value ? Math.min(p, duration.value) : p
  })
  return { position, duration, hasPosition }
}

/** `m:ss` ; vide sans valeur. */
export function formatClock(s: number | undefined | null): string {
  if (s === undefined || s === null || !Number.isFinite(s)) return ''
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
