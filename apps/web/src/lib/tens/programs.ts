// Les programmes de l'actiTENS mini. L'appareil ne connaît pas de « P3 » : l'appli lui envoie la
// FORME du courant, segment par segment (fréquence, largeur d'impulsion, enveloppe, durée). On
// rejoue ici les segments capturés le 2026-09-25, octet pour octet, sans les deux octets que
// `programFrame` ajoute devant (identifiant de séance, nombre de segments).
//
// Corps d'un segment : `<n° de segment> <durée ms LE32> <mode> <fréq c1> <fréq c2> <largeur c1>
// <largeur c2> <enveloppe> <largeur c1> <largeur c2> <enveloppe>` — largeur en dizaines de µs,
// enveloppe 0 plate / 1 montée / 2 descente, mode 1 = balayage de fréquence.

export interface TensProgram {
  id: string
  /** Numéro affiché par l'appli (P1…P12). */
  number: number
  segments: Uint8Array[]
}

const hex = (s: string) => Uint8Array.from(s.split(' ').map((b) => parseInt(b, 16)))

export const TENS_PROGRAMS: TensProgram[] = [
  { id: 'p1', number: 1, segments: [hex('01 00 00 00 00 00 64 64 14 14 00 14 14 00')] },
  { id: 'p2', number: 2, segments: [hex('01 00 00 00 00 00 50 50 0f 0f 00 0f 0f 00')] },
  { id: 'p3', number: 3, segments: [hex('01 00 00 00 00 00 02 02 19 19 00 19 19 00')] },
  { id: 'p4', number: 4, segments: [hex('01 00 00 00 00 00 64 02 14 14 00 14 14 00')] },
  { id: 'p5', number: 5, segments: [
    hex('81 36 42 0f 00 00 64 64 0f 0f 00 0f 0f 00'),
    hex('02 c0 c6 2d 00 00 02 02 14 14 00 14 14 00'),
  ] },
  { id: 'p6', number: 6, segments: [
    hex('01 b8 0b 00 00 00 64 64 0f 0f 00 0f 0f 00'),
    hex('02 b8 0b 00 00 00 02 02 14 14 00 14 14 00'),
  ] },
  { id: 'p7', number: 7, segments: [
    hex('01 fa 00 00 00 00 64 64 0f 0f 00 0f 0f 00'),
    hex('02 fa 00 00 00 00 00 00 00 00 00 00 00 00'),
  ] },
  { id: 'p8', number: 8, segments: [
    hex('01 4c 1d 00 00 01 02 50 14 0a 00 14 0a 00'),
    hex('02 4c 1d 00 00 01 50 02 0a 14 00 0a 14 00'),
  ] },
  // P9 « Relaxation musculaire » : le cycle repos 5 s / montée 2 s / contraction 10 s / descente 1 s.
  // L'appli le précède d'une phase continue pour choisir l'intensité maximale ; ici on lance le
  // cycle directement, l'intensité se règle pendant qu'il tourne.
  { id: 'p9', number: 9, segments: [
    hex('01 88 13 00 00 00 00 00 00 00 00 00 00 00'),
    hex('02 d0 07 00 00 00 32 32 23 23 01 23 23 01'),
    hex('03 10 27 00 00 00 32 32 23 23 00 23 23 00'),
    hex('04 e8 03 00 00 00 32 32 23 23 02 23 23 02'),
  ] },
  { id: 'p10', number: 10, segments: [
    hex('01 e8 03 00 00 00 50 50 0f 0f 01 0f 0f 02'),
    hex('02 e8 03 00 00 00 50 50 0f 0f 02 0f 0f 01'),
  ] },
  { id: 'p11', number: 11, segments: [
    hex('01 c8 00 00 00 00 50 50 0f 0f 01 0f 0f 02'),
    hex('02 c8 00 00 00 00 50 50 0f 0f 02 0f 0f 01'),
  ] },
  { id: 'p12', number: 12, segments: [hex('01 00 00 00 00 00 50 50 06 06 00 06 06 00')] },
]

export const tensProgram = (id: string) => TENS_PROGRAMS.find((p) => p.id === id)

export interface TensFavorite { program: string; minutes: number }

/** Les favoris de départ (un clic, durée comprise, comme dans l'appli) ; modifiables ensuite, par poste. */
export const TENS_FAVORITES: TensFavorite[] = [
  { program: 'p6', minutes: 60 },
  { program: 'p3', minutes: 60 },
]

export const DURATION_MIN = 5
export const DURATION_MAX = 120
export const DURATION_STEP = 5
export const DURATION_DEFAULT = 30

/**
 * Plafond d'intensité côté Kasbah, par canal, en dixièmes de mA (30 mA, choisi par l'utilisateur).
 * Rien ne permet de le dépasser depuis la page : on envoie du courant dans un corps.
 */
export const INTENSITY_MAX = 300
