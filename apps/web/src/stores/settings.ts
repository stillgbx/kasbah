import { computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useFullscreen, useLocalStorage, usePreferredDark } from '@vueuse/core'
import type { ThemeInstance } from 'vuetify'
import { themeName } from '../plugins/vuetify'
import { cssVars, DEFAULT_THEME_ID, resolveVariant, THEME_LIST, type ThemeId } from '../themes'
import { detectLocale, isLocale, LOCALES, type Locale } from '../i18n'

// Préférences persistées (localStorage, préfixe kasbah.) : apparence clair/sombre/système, thème,
// langue. `applyToVuetify`/`applyLocale` sont appelées AVANT le mount (aucun flash de thème/langue).

export const APPEARANCES = ['light', 'dark', 'system'] as const
export type Appearance = (typeof APPEARANCES)[number]

export const useSettingsStore = defineStore('settings', () => {
  const appearance = useLocalStorage<Appearance>('kasbah.appearance', 'system')
  const theme = useLocalStorage<string>('kasbah.theme', DEFAULT_THEME_ID)
  /** '' = automatique (langues du navigateur). */
  const locale = useLocalStorage<string>('kasbah.locale', '')
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
    setAppearance, cycleAppearance, setTheme, setLocale, toggleLocale, applyToVuetify, applyLocale,
    appearances: APPEARANCES, themes: THEME_LIST, locales: LOCALES,
  }
})
