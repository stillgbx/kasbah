import { Color } from 'three'
import type { FloorStyle, ZoneKind } from '@kasbah/shared'

// La scène lit ses couleurs dans les variables CSS de Vuetify (--v-theme-*) : un seul endroit
// définit clair/sombre et palettes. Le parseur accepte "r,g,b" (Vuetify 3), "r g b", "rgb(…)" et "#hex".

export interface SceneTheme {
  background: Color
  wall: Color
  wallInterior: Color
  floor: Color
  floors: Record<FloorStyle, Color>
  glass: Color
  roof: Color
  terrain: Color
  zones: Record<ZoneKind, Color>
  primary: Color
  secondary: Color
  onSurface: Color
  isDark: boolean
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
  background: '#f6f3ee', sceneWall: '#efe9df', sceneWallInterior: '#e6e0d6', sceneFloor: '#d9d2c5', sceneFloorWood: '#c9a276',
  sceneFloorTile: '#d6d9d3', sceneFloorCarpet: '#c4b4b8', sceneFloorConcrete: '#bfbdb8', sceneGlass: '#9fd0e8', sceneRoof: '#8b5e4b',
  sceneTerrain: '#93bb8c', sceneLawn: '#93bb8c', sceneWater: '#6fb7d6', sceneDriveway: '#b7bbc1', scenePath: '#d9d2c5', sceneBed: '#5f8f5a', sceneTerrace: '#d9d2c5',
  primary: '#1f6f78', secondary: '#66717f', 'on-surface': '#141a22',
}

/** Lit le thème courant depuis les variables CSS (appelé au mount et à chaque changement de thème). */
export function readVuetifyTheme(el: Element = document.documentElement): SceneTheme {
  const cs = getComputedStyle(el)
  const get = (name: string) => parseCssColor(cs.getPropertyValue(`--v-theme-${name}`), FALLBACK[name] ?? '#888888')
  const background = get('background')
  const isDark = background.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5
  return {
    background, isDark,
    wall: get('sceneWall'), wallInterior: get('sceneWallInterior'),
    floor: get('sceneFloor'),
    floors: { wood: get('sceneFloorWood'), tile: get('sceneFloorTile'), carpet: get('sceneFloorCarpet'), concrete: get('sceneFloorConcrete') },
    glass: get('sceneGlass'), roof: get('sceneRoof'), terrain: get('sceneTerrain'),
    zones: { lawn: get('sceneLawn'), pool: get('sceneWater'), driveway: get('sceneDriveway'), path: get('scenePath'), bed: get('sceneBed'), terrace: get('sceneTerrace'), other: get('sceneDriveway') },
    primary: get('primary'), secondary: get('secondary'), onSurface: get('on-surface'),
  }
}

/** Thème par défaut (tests, ou avant le premier rendu). */
export function defaultSceneTheme(): SceneTheme {
  const c = (k: string) => new Color(FALLBACK[k] ?? '#888888')
  return {
    background: c('background'), isDark: false, wall: c('sceneWall'), wallInterior: c('sceneWallInterior'), floor: c('sceneFloor'),
    floors: { wood: c('sceneFloorWood'), tile: c('sceneFloorTile'), carpet: c('sceneFloorCarpet'), concrete: c('sceneFloorConcrete') },
    glass: c('sceneGlass'), roof: c('sceneRoof'), terrain: c('sceneTerrain'),
    zones: { lawn: c('sceneLawn'), pool: c('sceneWater'), driveway: c('sceneDriveway'), path: c('scenePath'), bed: c('sceneBed'), terrace: c('sceneTerrace'), other: c('sceneDriveway') },
    primary: c('primary'), secondary: c('secondary'), onSurface: c('on-surface'),
  }
}
