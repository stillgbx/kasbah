// Thèmes de l'interface : un thème porte TOUTE la palette (fond, surfaces, texte, accent, teintes
// des catégories), contrairement aux quatre « accents » d'avant qui ne changeaient que la couleur
// primaire. Un thème peut n'exister qu'en clair ou qu'en sombre (Synthwave '84).
//
// AJOUTER UN THÈME : créer `src/themes/<id>.ts` sur le modèle des autres (15 couleurs par variante),
// puis l'importer et l'ajouter à REGISTRY ci-dessous. Rien d'autre à toucher : les thèmes Vuetify,
// les variables CSS et le sélecteur des Réglages se dérivent de la liste.

import { kasbah } from './kasbah'
import { catppuccin } from './catppuccin'
import { dracula } from './dracula'
import { nightOwl } from './night-owl'
import { synthwave84 } from './synthwave84'
import { tokyoNight } from './tokyo-night'

/** Les 15 couleurs d'une variante. Le reste (contour, ombre, texte sur accent) en est dérivé. */
export interface Palette {
  /** Fond de page. */
  bg: string
  /** Cartes et panneaux. */
  surface: string
  /** Surfaces secondaires : champs, lignes alternées, `surface-variant`. */
  surface2: string
  /** Surface élevée : survol, sélection (`surface-bright`). */
  bright: string
  /** Texte principal. */
  text: string
  /** Texte secondaire, icônes au repos. */
  muted: string
  /** Accent : couleur primaire, sélection, interrupteurs. */
  accent: string
  error: string
  warning: string
  info: string
  success: string
  /** Teintes des quatre catégories d'appareils (disque des marqueurs 3D, pastilles). */
  catLight: string
  catCover: string
  catCamera: string
  /** Sert aussi à l'onde du lecteur en diffusion (`sceneMedia`). */
  catMedia: string
}

export interface Theme {
  id: string
  /** Nom du thème — un nom propre, jamais traduit. */
  label: string
  /** Nom de la déclinaison claire chez son auteur (« Latte », « Alucard »…), affiché tel quel. */
  lightLabel?: string
  darkLabel?: string
  light?: Palette
  dark?: Palette
}

const REGISTRY = [kasbah, catppuccin, dracula, nightOwl, synthwave84, tokyoNight] as const satisfies readonly Theme[]

/** `REGISTRY` garde les identifiants littéraux (pour `ThemeId`), la liste publique les élargit. */
export const THEME_LIST: readonly Theme[] = REGISTRY

export type ThemeId = (typeof REGISTRY)[number]['id']

export const DEFAULT_THEME_ID: ThemeId = 'kasbah'

export function themeById(id: string): Theme {
  return THEME_LIST.find((t) => t.id === id) ?? REGISTRY[0]
}

/**
 * Variante réellement appliquée : un thème qui n'existe que dans une apparence l'impose (l'interface
 * en clair passe en sombre sur Synthwave '84 plutôt que d'inventer une palette claire).
 */
export function resolveVariant(id: string, wantDark: boolean): { palette: Palette, isDark: boolean } {
  const t = themeById(id)
  const dark = wantDark ? (t.dark ?? t.light) : (t.light ?? t.dark)
  // REGISTRY garantit au moins une variante par thème (test `themes.test.ts`).
  return { palette: dark!, isDark: dark === t.dark }
}

/** Luminance relative WCAG, pour choisir le texte posé SUR l'accent. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return 0.5
  const lin = (c: string) => {
    const v = parseInt(c, 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(m[1]!) + 0.7152 * lin(m[2]!) + 0.0722 * lin(m[3]!)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Texte posé sur l'accent : le plus lisible entre le blanc et le fond du thème. Dérivé plutôt que
 * déclaré, pour qu'un thème ajouté demain ne puisse pas se tromper de sens.
 */
export function onAccent(p: Palette): string {
  return contrast(p.accent, '#ffffff') >= contrast(p.accent, p.bg) ? '#ffffff' : p.bg
}

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`
}

/** Les jetons CSS de `styles/tokens.css`, posés sur `<html>` par le store des réglages. */
export function cssVars(p: Palette, isDark: boolean): Record<string, string> {
  return {
    '--bg': p.bg,
    '--surface': p.surface,
    '--surface2': p.surface2,
    '--text': p.text,
    '--muted': p.muted,
    '--line': rgba(p.text, isDark ? 0.08 : 0.09),
    '--shadow': isDark ? '0 8px 30px rgba(0, 0, 0, 0.35)' : '0 8px 30px rgba(20, 26, 34, 0.08)',
    '--accent': p.accent,
    '--accent-soft': rgba(p.accent, isDark ? 0.18 : 0.12),
    '--on-accent': onAccent(p),
    '--cat-light': p.catLight,
    '--cat-cover': p.catCover,
    '--cat-camera': p.catCamera,
    '--cat-media': p.catMedia,
    '--cat-other': p.muted,
  }
}
