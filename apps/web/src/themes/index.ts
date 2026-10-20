// Interface themes: a theme carries the WHOLE palette (background, surfaces, text, accent,
// category tints), unlike the four "accents" of before that only changed the primary color. A
// theme can exist only in light or only in dark (Synthwave '84).
//
// ADDING A THEME: create `src/themes/<id>.ts` on the model of the others (15 colors per variant),
// then import it and add it to REGISTRY below. Nothing else to touch: the Vuetify themes,
// the CSS variables and the Settings selector are derived from the list.

import { kasbah } from './kasbah'
import { catppuccin } from './catppuccin'
import { dracula } from './dracula'
import { nightOwl } from './night-owl'
import { synthwave84 } from './synthwave84'
import { tokyoNight } from './tokyo-night'

/** The 15 colors of a variant. The rest (outline, shadow, text on accent) is derived from them. */
export interface Palette {
  /** Page background. */
  bg: string
  /** Cards and panels. */
  surface: string
  /** Secondary surfaces: fields, alternate rows, `surface-variant`. */
  surface2: string
  /** Raised surface: hover, selection (`surface-bright`). */
  bright: string
  /** Texte principal. */
  text: string
  /** Secondary text, icons at rest. */
  muted: string
  /** Accent: primary color, selection, switches. */
  accent: string
  error: string
  warning: string
  info: string
  success: string
  /** Tints of the four device categories (disc of the 3D markers, pills). */
  catLight: string
  catCover: string
  catCamera: string
  /** Also used for the wave of the player while streaming (`sceneMedia`). */
  catMedia: string
}

export interface Theme {
  id: string
  /** Name of the theme — a proper name, never translated. */
  label: string
  /** Name of the light variant at its author ("Latte", "Alucard"…), displayed as is. */
  lightLabel?: string
  darkLabel?: string
  light?: Palette
  dark?: Palette
}

const REGISTRY = [kasbah, catppuccin, dracula, nightOwl, synthwave84, tokyoNight] as const satisfies readonly Theme[]

/** `REGISTRY` keeps the literal identifiers (for `ThemeId`), the public list widens them. */
export const THEME_LIST: readonly Theme[] = REGISTRY

export type ThemeId = (typeof REGISTRY)[number]['id']

export const DEFAULT_THEME_ID: ThemeId = 'kasbah'

export function themeById(id: string): Theme {
  return THEME_LIST.find((t) => t.id === id) ?? REGISTRY[0]
}

/**
 * Variant actually applied: a theme that only exists in one appearance imposes it (the light
 * interface goes dark on Synthwave '84 rather than inventing a light palette).
 */
export function resolveVariant(id: string, wantDark: boolean): { palette: Palette, isDark: boolean } {
  const t = themeById(id)
  const dark = wantDark ? (t.dark ?? t.light) : (t.light ?? t.dark)
  // REGISTRY guarantees at least one variant per theme (test `themes.test.ts`).
  return { palette: dark!, isDark: dark === t.dark }
}

/** WCAG relative luminance, to choose the text set ON the accent. */
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
 * Text set on the accent: the more readable of white and the theme background. Derived rather than
 * declared, so that a theme added tomorrow cannot get the direction wrong.
 */
export function onAccent(p: Palette): string {
  return contrast(p.accent, '#ffffff') >= contrast(p.accent, p.bg) ? '#ffffff' : p.bg
}

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`
}

/** The CSS tokens of `styles/tokens.css`, set on `<html>` by the settings store. */
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
