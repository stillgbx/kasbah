// La fin de la phrase, devinée au niveau sonore du micro (détection d'activité vocale à seuil) : la
// personne a parlé, puis se tait depuis `SILENCE_MS` → l'écoute s'arrête seule et l'instruction part.
// Personne ne parle dans les `NO_SPEECH_MS` premières millisecondes → rien entendu.
//
// Le seuil suit le bruit de la pièce : le plancher descend aussitôt au niveau le plus bas entendu et ne
// remonte que lentement, pendant les silences. Une musique de fond constante devient ainsi le plancher,
// et la voix se détache au-dessus ; une parole dès le premier instant n'y reste pas (le plancher
// redescend au premier blanc entre deux mots). Valeurs à régler à l'usage, sur un vrai micro.

/** Silence après la parole avant d'envoyer : plus court coupe les hésitations, plus long fait attendre. */
export const SILENCE_MS = 1000
/** Sans parole jusque-là : rien entendu. */
export const NO_SPEECH_MS = 5000
/** Durée au-dessus du seuil pour compter comme parole (un claquement, une porte n'y suffisent pas). */
const SPEECH_MS = 250
/** La voix doit dépasser le plancher de bruit de ce facteur (≈ +10 dB). */
const FACTOR = 3
/** Seuil minimal (niveau efficace, échantillons entre -1 et 1) : sous lui, c'est du silence. */
const MIN_LEVEL = 0.01
/** Remontée du plancher par seconde de silence (part de l'écart comblée). */
const RISE_PER_S = 0.5

export type VadEvent = 'end' | 'nothing'

/** Niveau efficace d'une trame d'échantillons. */
export function rms(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!
  return frame.length ? Math.sqrt(sum / frame.length) : 0
}

/** Un détecteur par écoute : `push(niveau, ms depuis le début)` rend `end`, `nothing`, ou rien. */
export function createEndpointer() {
  let floor: number | null = null
  let last = 0
  let loudSince: number | null = null
  let quietSince: number | null = null
  let spoke = false
  let done = false

  return {
    push(level: number, at: number): VadEvent | null {
      if (done) return null
      const dt = Math.max(0, at - last) / 1000
      last = at
      const threshold = Math.max((floor ?? 0) * FACTOR, MIN_LEVEL)
      const loud = level > threshold
      // les trames nulles (micro qui s'ouvre) ne disent rien du bruit de la pièce
      if (level > 0) {
        if (floor === null || level < floor) floor = level
        else if (!loud) floor += (level - floor) * Math.min(1, RISE_PER_S * dt)
      }
      if (loud) {
        quietSince = null
        loudSince ??= at
        if (at - loudSince >= SPEECH_MS) spoke = true
      } else {
        loudSince = null
        quietSince ??= at
      }
      if (spoke && quietSince !== null && at - quietSince >= SILENCE_MS) { done = true; return 'end' }
      if (!spoke && at >= NO_SPEECH_MS) { done = true; return 'nothing' }
      return null
    },
  }
}
