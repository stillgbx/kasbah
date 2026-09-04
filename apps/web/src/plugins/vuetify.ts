import 'vuetify/styles'
import { createVuetify, type ThemeDefinition } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'

// Thèmes Vuetify dérivés des jetons (styles/tokens.css) : 2 apparences × 4 accents. Les couleurs de
// la SCÈNE 3D (scene*) vivent ici aussi et sont lues via --v-theme-* par Three.js (readVuetifyTheme).

export const ACCENTS = [
  { id: 'teal', light: '#1f6f78', dark: '#4fb3bd' },
  { id: 'terracotta', light: '#c2582d', dark: '#e8865f' },
  { id: 'indigo', light: '#3f4fbf', dark: '#8b96f0' },
  { id: 'moss', light: '#4f7a4a', dark: '#8cc27f' },
] as const
export type AccentId = (typeof ACCENTS)[number]['id']

const SCENE_LIGHT = {
  sceneTerrain: '#93bb8c', sceneLawn: '#93bb8c', sceneWater: '#6fb7d6', sceneDriveway: '#b7bbc1', scenePath: '#d9d2c5', sceneBed: '#5f8f5a',
  sceneWall: '#f3f0ea', sceneWallInterior: '#dad4cb', sceneFloor: '#e6e1d8', sceneFloorWood: '#dccbb0', sceneFloorTile: '#e3e4e0',
  sceneFloorCarpet: '#e1d6d6', sceneFloorConcrete: '#d9d8d4', sceneGlass: '#9fd0e8', sceneRoof: '#cbd0d6', sceneTerrace: '#d9d2c5',
}
const SCENE_DARK = {
  sceneTerrain: '#2f4a33', sceneLawn: '#2f4a33', sceneWater: '#24607a', sceneDriveway: '#353a44', scenePath: '#474a52', sceneBed: '#24392a',
  sceneWall: '#4a5464', sceneWallInterior: '#3d4656', sceneFloor: '#343b49', sceneFloorWood: '#3f3d44', sceneFloorTile: '#363e4a',
  sceneFloorCarpet: '#3a3a48', sceneFloorConcrete: '#353b45', sceneGlass: '#5aa5c8', sceneRoof: '#272e3b', sceneTerrace: '#474a52',
}

function light(accent: string): ThemeDefinition {
  return {
    dark: false,
    colors: {
      primary: accent, 'on-primary': '#ffffff', secondary: '#66717f',
      background: '#e9edf1', surface: '#ffffff', 'surface-variant': '#f2f5f8', 'on-surface': '#141a22', 'on-surface-variant': '#66717f',
      'surface-bright': '#ffffff', 'surface-light': '#f2f5f8',
      error: '#d24a43', warning: '#d38b22', info: '#3f7fbf', success: '#4f7a4a',
      ...SCENE_LIGHT,
    },
  }
}
function dark(accent: string): ThemeDefinition {
  return {
    dark: true,
    colors: {
      primary: accent, 'on-primary': '#0b1118', secondary: '#8d9ab0',
      background: '#0d1420', surface: '#161e2d', 'surface-variant': '#1d2839', 'on-surface': '#e8edf3', 'on-surface-variant': '#8d9ab0',
      'surface-bright': '#243044', 'surface-light': '#1d2839',
      error: '#e57373', warning: '#e0a24a', info: '#7fb3e6', success: '#8cc27f',
      ...SCENE_DARK,
    },
  }
}

export const THEMES: Record<string, ThemeDefinition> = Object.fromEntries(
  ACCENTS.flatMap((a) => [[`${a.id}Light`, light(a.light)], [`${a.id}Dark`, dark(a.dark)]]),
)

export function themeName(accent: AccentId, isDark: boolean): string {
  return `${accent}${isDark ? 'Dark' : 'Light'}`
}

export function accentColor(accent: AccentId, isDark: boolean): string {
  const a = ACCENTS.find((x) => x.id === accent) ?? ACCENTS[0]
  return isDark ? a.dark : a.light
}

export const vuetify = createVuetify({
  theme: { defaultTheme: 'tealLight', themes: THEMES },
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  defaults: {
    VBtn: { rounded: 'pill' },
    VCard: { rounded: 'xl', flat: true },
    VSlider: { thumbSize: 22, trackSize: 6, hideDetails: true },
    VSwitch: { inset: true, hideDetails: true, color: 'primary' },
    VChip: { rounded: 'pill' },
  },
})
