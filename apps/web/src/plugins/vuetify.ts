import 'vuetify/styles'
import { createVuetify, type ThemeDefinition } from 'vuetify'
import { aliases, strokeIcons } from './icons'
import { DEFAULT_THEME_ID, onAccent, THEME_LIST, type Palette } from '../themes'

// Thèmes Vuetify dérivés des palettes de `src/themes/` (une par variante clair/sombre d'un thème).
// Les couleurs de la SCÈNE 3D (scene*) vivent ici : elles ne dépendent PAS du thème choisi (seul
// `sceneMedia` suit) et sont lues via --v-theme-* par Three.js (readVuetifyTheme).

const SCENE_LIGHT = {
  sceneTerrain: '#93bb8c', sceneLawn: '#93bb8c', sceneWater: '#6fb7d6', sceneDriveway: '#b7bbc1', scenePath: '#d9d2c5', sceneBed: '#5f8f5a',
  sceneWall: '#f3f0ea', sceneWallInterior: '#dad4cb', sceneFloor: '#e6e1d8', sceneFloorWood: '#dccbb0', sceneFloorTile: '#e3e4e0',
  sceneFloorCarpet: '#e1d6d6', sceneFloorConcrete: '#d9d8d4', sceneGlass: '#9fd0e8', sceneRoof: '#cbd0d6', sceneTerrace: '#d9d2c5',
  sceneMedia: '#1a73d8',
}
// Sombre = NUIT : parcelle et sols très sombres pour que les lampes portent, murs plus clairs pour
// que la coupe se lise (la face supérieure des murs coupés prend le clair de lune).
const SCENE_DARK = {
  sceneTerrain: '#1f3326', sceneLawn: '#1f3326', sceneWater: '#1d6f8c', sceneDriveway: '#2a2f3a', scenePath: '#3a3e47', sceneBed: '#18291d',
  sceneWall: '#6c7686', sceneWallInterior: '#5a6474', sceneFloor: '#262d3a', sceneFloorWood: '#332d31', sceneFloorTile: '#283039',
  sceneFloorCarpet: '#2c2a38', sceneFloorConcrete: '#272c35', sceneGlass: '#5aa5c8', sceneRoof: '#232936', sceneTerrace: '#3a3e47',
  sceneMedia: '#5aaeff',
}

export function themeName(themeId: string, isDark: boolean): string {
  return `${themeId}${isDark ? 'Dark' : 'Light'}`
}

/** Un thème Vuetify par variante existante : les thèmes sombre-uniquement n'en produisent qu'un. */
function definition(p: Palette, isDark: boolean): ThemeDefinition {
  return {
    dark: isDark,
    colors: {
      primary: p.accent, 'on-primary': onAccent(p), secondary: p.muted,
      background: p.bg, surface: p.surface, 'surface-variant': p.surface2, 'on-surface': p.text, 'on-surface-variant': p.muted,
      'surface-bright': p.bright, 'surface-light': p.surface2,
      error: p.error, warning: p.warning, info: p.info, success: p.success,
      ...(isDark ? SCENE_DARK : SCENE_LIGHT),
      // Seule couleur de scène qui suit le thème : l'onde du lecteur dit la même chose que la
      // pastille Médias, les deux viennent donc de `catMedia`.
      sceneMedia: p.catMedia,
    },
  }
}

export const THEMES: Record<string, ThemeDefinition> = Object.fromEntries(
  THEME_LIST.flatMap((t) => [
    ...(t.light ? [[themeName(t.id, false), definition(t.light, false)]] : []),
    ...(t.dark ? [[themeName(t.id, true), definition(t.dark, true)]] : []),
  ]),
)

export const vuetify = createVuetify({
  theme: { defaultTheme: themeName(DEFAULT_THEME_ID, false), themes: THEMES },
  icons: { defaultSet: 'stroke', aliases, sets: { stroke: strokeIcons } },
  // Les couleurs passent par les props (les jetons CSS sont acceptés tels quels) plutôt que par des
  // surcharges CSS visant les classes internes de Vuetify : voir styles/app.css.
  defaults: {
    VBtn: { rounded: 'pill' },
    VCard: { rounded: 'xl', flat: true },
    VSlider: { thumbSize: 22, trackSize: 6, hideDetails: true, trackFillColor: 'primary', thumbColor: 'primary', trackColor: 'var(--line)' },
    VSwitch: { inset: true, hideDetails: true, color: 'primary', baseColor: 'var(--line)' },
    VChip: { rounded: 'pill' },
  },
})
