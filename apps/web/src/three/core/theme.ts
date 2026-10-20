import { Color } from 'three'
import { dayFactor, type SceneAmbience } from './ambience'
import type { ScenePalette } from '../styles/types'

// The colors the scene uses come from TWO sources, and that is intended:
//
//  - the MATERIAL (walls, floors, glass, roof, lawn…) comes from the chosen RENDER STYLE
//    (`three/styles/`) — it depends neither on the app theme nor on its light/dark mode;
//  - the MARKERS laid on the house (selection accent, a player's wave, gauges) come from the
//    Vuetify theme, read from the CSS variables `--v-theme-*`. This is the user's ruling of
//    2026-09-12: "theme the dots, badges, bubbles, labels, waves… the 3D elements stay".
//
// `SceneTheme` is the result of merging the two, plus the time of day (`night`). No
// consumer — materials, markers, scene — has to know where which color comes from.
//
// The parser accepts "r,g,b" (Vuetify 3), "r g b", "rgb(…)" and "#hex".

/** What the scene reads from the APPLICATION theme: markers, never material. */
export interface UiTheme {
  /** App background: the infinite ground blends into it exactly, the plot does not float. */
  background: Color
  /** Wave of a player that is streaming: a blue of the scene's own, equal to the theme's `catMedia`. */
  media: Color
  primary: Color
  secondary: Color
  /** Markers laid on a measurement: `warning` for a limit, `success` for a record. */
  warning: Color
  success: Color
  /** States of a device that signals itself: `info` for an outgoing stream, `error` for a silent device. */
  info: Color
  error: Color
  onSurface: Color
}

export interface SceneTheme extends UiTheme, ScenePalette {
  /**
   * 0 = broad daylight, 1 = pitch-dark night. NOT to be confused with the app's light/dark mode: the interface
   * can be in dark theme in front of a house in full sun. What is read here is
   * the position of the sun above the house (`core/ambience.ts`).
   */
  night: number
}

export function parseCssColor(raw: string | null | undefined, fallback: string): Color {
  const s = (raw ?? '').trim()
  if (!s) return new Color(fallback)
  const triplet = /^(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)$/.exec(s)
  if (triplet) return new Color(+triplet[1]! / 255, +triplet[2]! / 255, +triplet[3]! / 255)
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(s)
  if (rgb) return new Color(+rgb[1]! / 255, +rgb[2]! / 255, +rgb[3]! / 255)
  try { return new Color(s) } catch { return new Color(fallback) }
}

const FALLBACK: Record<string, string> = {
  background: '#f6f3ee', sceneMedia: '#1a73d8',
  primary: '#1f6f78', secondary: '#66717f', 'on-surface': '#141a22',
  warning: '#d38b22', success: '#4f7a4a', info: '#3f7fbf', error: '#d24a43',
}

/** Reads the app theme from the CSS variables (on mount and on every theme change). */
export function readUiTheme(el: Element = document.documentElement): UiTheme {
  const cs = getComputedStyle(el)
  const get = (name: string) => parseCssColor(cs.getPropertyValue(`--v-theme-${name}`), FALLBACK[name] ?? '#888888')
  return {
    background: get('background'), media: get('sceneMedia'),
    primary: get('primary'), secondary: get('secondary'), onSurface: get('on-surface'),
    warning: get('warning'), success: get('success'), info: get('info'), error: get('error'),
  }
}

/** Default app theme (tests, or before the first render). */
export function defaultUiTheme(): UiTheme {
  const c = (k: string) => new Color(FALLBACK[k] ?? '#888888')
  return {
    background: c('background'), media: c('sceneMedia'),
    primary: c('primary'), secondary: c('secondary'), onSurface: c('on-surface'),
    warning: c('warning'), success: c('success'), info: c('info'), error: c('error'),
  }
}

/** The merge: material from the style, markers from the theme, time of day from the ambience. */
export function resolveSceneTheme(ui: UiTheme, palette: ScenePalette, ambience: SceneAmbience): SceneTheme {
  return { ...ui, ...palette, night: 1 - dayFactor(ambience) }
}
