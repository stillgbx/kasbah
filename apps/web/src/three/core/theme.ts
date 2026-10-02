import { Color } from 'three'
import { dayFactor, type SceneAmbience } from './ambience'
import type { ScenePalette } from '../styles/types'

// Les couleurs que la scène emploie viennent de DEUX sources, et c'est voulu :
//
//  - la MATIÈRE (murs, sols, verre, toit, pelouse…) vient du STYLE DE RENDU choisi
//    (`three/styles/`) — elle ne dépend ni du thème de l'app, ni de son mode clair/sombre ;
//  - les REPÈRES posés sur la maison (accent de sélection, onde d'un lecteur, jauges) viennent du
//    thème Vuetify, lus dans les variables CSS `--v-theme-*`. C'est l'arbitrage de l'utilisateur du
//    2026-09-12 : « thémer les points, pastilles, bulles, labels, ondes… les éléments 3d restent ».
//
// `SceneTheme` est le résultat de la fusion des deux, plus l'heure qu'il fait (`night`). Aucun
// consommateur — matériaux, marqueurs, scène — n'a à savoir d'où vient quelle couleur.
//
// Le parseur accepte "r,g,b" (Vuetify 3), "r g b", "rgb(…)" et "#hex".

/** Ce que la scène lit du thème de l'APPLICATION : des repères, jamais de la matière. */
export interface UiTheme {
  /** Fond de l'app : le sol infini s'y fond exactement, la parcelle ne flotte pas. */
  background: Color
  /** Onde du lecteur en diffusion : un bleu propre à la scène, égal au `catMedia` du thème. */
  media: Color
  primary: Color
  secondary: Color
  /** Repères posés sur une mesure : `warning` pour une limite, `success` pour un record. */
  warning: Color
  success: Color
  /** États d'un appareil qui se signale : `info` pour un flux qui sort, `error` pour un appareil muet. */
  info: Color
  error: Color
  onSurface: Color
}

export interface SceneTheme extends UiTheme, ScenePalette {
  /**
   * 0 = plein jour, 1 = nuit noire. À NE PAS confondre avec le mode clair/sombre de l'app : l'interface
   * peut être en thème sombre devant une maison en plein soleil. Ce qui se lit ici, c'est
   * la position du soleil au-dessus de la maison (`core/ambience.ts`).
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

/** Lit le thème de l'app dans les variables CSS (au mount et à chaque changement de thème). */
export function readUiTheme(el: Element = document.documentElement): UiTheme {
  const cs = getComputedStyle(el)
  const get = (name: string) => parseCssColor(cs.getPropertyValue(`--v-theme-${name}`), FALLBACK[name] ?? '#888888')
  return {
    background: get('background'), media: get('sceneMedia'),
    primary: get('primary'), secondary: get('secondary'), onSurface: get('on-surface'),
    warning: get('warning'), success: get('success'), info: get('info'), error: get('error'),
  }
}

/** Thème d'app par défaut (tests, ou avant le premier rendu). */
export function defaultUiTheme(): UiTheme {
  const c = (k: string) => new Color(FALLBACK[k] ?? '#888888')
  return {
    background: c('background'), media: c('sceneMedia'),
    primary: c('primary'), secondary: c('secondary'), onSurface: c('on-surface'),
    warning: c('warning'), success: c('success'), info: c('info'), error: c('error'),
  }
}

/** La fusion : matière du style, repères du thème, heure de l'ambiance. */
export function resolveSceneTheme(ui: UiTheme, palette: ScenePalette, ambience: SceneAmbience): SceneTheme {
  return { ...ui, ...palette, night: 1 - dayFactor(ambience) }
}
