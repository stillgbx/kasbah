import 'vuetify/styles'
import { createVuetify, type ThemeDefinition } from 'vuetify'
import { aliases, strokeIcons } from './icons'
import { DEFAULT_THEME_ID, onAccent, THEME_LIST, type Palette } from '../themes'

// Vuetify themes derived from the palettes of `src/themes/` (one per light/dark variant of a theme).
//
// The MATERIAL colors of the 3D scene (walls, floors, glass, roof, terrain, zones) no longer live
// here: they belong to the chosen RENDER STYLE (`src/three/styles/`), which has nothing to do with
// the theme nor with the light/dark appearance. Only `sceneMedia` remains — it is a reference mark PLACED on the
// house, not a material — and Three still reads it through `--v-theme-sceneMedia` (`readUiTheme`).

export function themeName(themeId: string, isDark: boolean): string {
  return `${themeId}${isDark ? 'Dark' : 'Light'}`
}

/** One Vuetify theme per existing variant: dark-only themes produce just one. */
function definition(p: Palette, isDark: boolean): ThemeDefinition {
  return {
    dark: isDark,
    colors: {
      primary: p.accent, 'on-primary': onAccent(p), secondary: p.muted,
      background: p.bg, surface: p.surface, 'surface-variant': p.surface2, 'on-surface': p.text, 'on-surface-variant': p.muted,
      'surface-bright': p.bright, 'surface-light': p.surface2,
      error: p.error, warning: p.warning, info: p.info, success: p.success,
      // Only scene color that follows the theme: the player's wave says the same thing as the
      // Media pill, so both come from `catMedia`.
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
  // Colors go through props (CSS tokens are accepted as is) rather than through CSS
  // overrides targeting Vuetify's internal classes: see styles/app.css.
  defaults: {
    VBtn: { rounded: 'pill' },
    VCard: { rounded: 'xl', flat: true },
    VSlider: { thumbSize: 22, trackSize: 6, hideDetails: true, trackFillColor: 'primary', thumbColor: 'primary', trackColor: 'var(--line)' },
    VSwitch: { inset: true, hideDetails: true, color: 'primary', baseColor: 'var(--line)' },
    VChip: { rounded: 'pill' },
  },
})
