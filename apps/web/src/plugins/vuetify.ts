import 'vuetify/styles'
import { createVuetify, type ThemeDefinition } from 'vuetify'
import { aliases, strokeIcons } from './icons'
import { DEFAULT_THEME_ID, onAccent, THEME_LIST, type Palette } from '../themes'

// Thèmes Vuetify dérivés des palettes de `src/themes/` (une par variante clair/sombre d'un thème).
//
// Les couleurs de MATIÈRE de la scène 3D (murs, sols, verre, toit, terrain, zones) ne vivent plus
// ici : elles appartiennent au STYLE DE RENDU choisi (`src/three/styles/`), qui n'a rien à voir avec
// le thème ni avec l'apparence claire/sombre. Seule `sceneMedia` reste — c'est un repère POSÉ sur la
// maison, pas une matière — et Three la lit toujours via `--v-theme-sceneMedia` (`readUiTheme`).

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
