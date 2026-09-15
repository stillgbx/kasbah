import { computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useFullscreen, useLocalStorage, usePreferredDark } from '@vueuse/core'
import type { ThemeInstance } from 'vuetify'
import { themeName } from '../plugins/vuetify'
import { cssVars, DEFAULT_THEME_ID, resolveVariant, THEME_LIST, type ThemeId } from '../themes'
import { detectLocale, isLocale, LOCALES, type Locale } from '../i18n'
import { AMBIENCE_MODES, type AmbienceMode } from '../three/core/ambience'
import { RENDER_QUALITIES, type RenderQuality } from '../three/core/post'
import { DEFAULT_STYLE_ID, RENDER_STYLES } from '../three/styles'

// Préférences persistées (localStorage, préfixe kasbah.) : apparence clair/sombre/système, thème,
// langue. `applyToVuetify`/`applyLocale` sont appelées AVANT le mount (aucun flash de thème/langue).
//
// Les trois réglages de la SCÈNE 3D sont délibérément séparés du thème de l'app : le style dit le
// goût du rendu, l'ambiance l'heure qu'il fait au-dessus de la maison, la qualité le budget de la
// tablette. Aucun des trois ne suit clair/sombre (voir `three/core/ambience.ts`).

export const APPEARANCES = ['light', 'dark', 'system'] as const
export type Appearance = (typeof APPEARANCES)[number]

export const useSettingsStore = defineStore('settings', () => {
  const appearance = useLocalStorage<Appearance>('kasbah.appearance', 'system')
  const theme = useLocalStorage<string>('kasbah.theme', DEFAULT_THEME_ID)
  /** '' = automatique (langues du navigateur). */
  const locale = useLocalStorage<string>('kasbah.locale', '')
  const sceneStyle = useLocalStorage<string>('kasbah.sceneStyle', DEFAULT_STYLE_ID)
  const sceneAmbience = useLocalStorage<AmbienceMode>('kasbah.sceneAmbience', 'auto')
  const sceneQuality = useLocalStorage<RenderQuality>('kasbah.sceneQuality', 'auto')
  const preferredDark = usePreferredDark()

  const themeId = computed<ThemeId>(() => (THEME_LIST.some((t) => t.id === theme.value) ? (theme.value as ThemeId) : DEFAULT_THEME_ID))
  /** Apparence demandée par la tablette ; un thème qui n'a pas cette variante impose la sienne. */
  const wantDark = computed(() => appearance.value === 'dark' || (appearance.value === 'system' && preferredDark.value))
  const variant = computed(() => resolveVariant(themeId.value, wantDark.value))
  const isDark = computed(() => variant.value.isDark)
  const currentTheme = computed(() => themeName(themeId.value, isDark.value))
  const resolvedLocale = computed<Locale>(() => detectLocale(locale.value || null))
  const fullscreen = useFullscreen()

  function setAppearance(v: Appearance) { appearance.value = v }
  function cycleAppearance() { appearance.value = appearance.value === 'system' ? 'light' : appearance.value === 'light' ? 'dark' : 'system' }
  function setTheme(v: string) { theme.value = v }
  function setLocale(v: string) { if (v === '' || isLocale(v)) locale.value = v }
  function setSceneStyle(v: string) { if (RENDER_STYLES.some((st) => st.id === v)) sceneStyle.value = v }
  function setSceneAmbience(v: AmbienceMode) { if (AMBIENCE_MODES.includes(v)) sceneAmbience.value = v }
  function setSceneQuality(v: RenderQuality) { if (RENDER_QUALITIES.includes(v)) sceneQuality.value = v }
  function toggleLocale() { locale.value = resolvedLocale.value === 'fr' ? 'en' : 'fr' }

  /** Applique le thème Vuetify + les jetons CSS de la palette (data-theme, --bg, --accent…) sur <html>. */
  function applyToVuetify(vuetifyTheme: ThemeInstance) {
    const apply = () => {
      vuetifyTheme.change(currentTheme.value)
      const root = document.documentElement
      root.dataset.theme = isDark.value ? 'dark' : 'light'
      root.style.colorScheme = isDark.value ? 'dark' : 'light'
      for (const [name, value] of Object.entries(cssVars(variant.value.palette, isDark.value))) root.style.setProperty(name, value)
    }
    apply()
    watch(currentTheme, apply)
  }

  function applyLocale(i18n: { global: { locale: { value: string } } }) {
    const apply = () => {
      i18n.global.locale.value = resolvedLocale.value
      document.documentElement.lang = resolvedLocale.value
    }
    apply()
    watch(resolvedLocale, apply)
  }

  return {
    appearance, theme, locale, isDark, wantDark, themeId, currentTheme, resolvedLocale, fullscreen,
    sceneStyle, sceneAmbience, sceneQuality,
    setAppearance, cycleAppearance, setTheme, setLocale, toggleLocale, applyToVuetify, applyLocale,
    setSceneStyle, setSceneAmbience, setSceneQuality,
    appearances: APPEARANCES, themes: THEME_LIST, locales: LOCALES,
    styles: RENDER_STYLES, ambiences: AMBIENCE_MODES, qualities: RENDER_QUALITIES,
  }
})
