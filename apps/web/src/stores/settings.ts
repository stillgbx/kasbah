import { computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useFullscreen, useLocalStorage, usePreferredDark } from '@vueuse/core'
import type { ThemeInstance } from 'vuetify'
import { ACCENTS, accentColor, themeName, type AccentId } from '../plugins/vuetify'
import { detectLocale, isLocale, LOCALES, type Locale } from '../i18n'

// Préférences persistées (localStorage, préfixe kasbah.) : apparence clair/sombre/système, accent,
// langue. `applyToVuetify`/`applyLocale` sont appelées AVANT le mount (aucun flash de thème/langue).

export const APPEARANCES = ['light', 'dark', 'system'] as const
export type Appearance = (typeof APPEARANCES)[number]

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`
}

export const useSettingsStore = defineStore('settings', () => {
  const appearance = useLocalStorage<Appearance>('kasbah.appearance', 'system')
  const accent = useLocalStorage<AccentId>('kasbah.accent', 'teal')
  /** '' = automatique (langues du navigateur). */
  const locale = useLocalStorage<string>('kasbah.locale', '')
  const preferredDark = usePreferredDark()

  const isDark = computed(() => appearance.value === 'dark' || (appearance.value === 'system' && preferredDark.value))
  const accentId = computed<AccentId>(() => (ACCENTS.some((a) => a.id === accent.value) ? accent.value : 'teal'))
  const currentTheme = computed(() => themeName(accentId.value, isDark.value))
  const resolvedLocale = computed<Locale>(() => detectLocale(locale.value || null))
  const fullscreen = useFullscreen()

  function setAppearance(v: Appearance) { appearance.value = v }
  function cycleAppearance() { appearance.value = appearance.value === 'system' ? 'light' : appearance.value === 'light' ? 'dark' : 'system' }
  function setAccent(v: AccentId) { accent.value = v }
  function setLocale(v: string) { if (v === '' || isLocale(v)) locale.value = v }
  function toggleLocale() { locale.value = resolvedLocale.value === 'fr' ? 'en' : 'fr' }

  /** Applique le thème Vuetify + les variables CSS des jetons (data-theme, --accent…) sur <html>. */
  function applyToVuetify(theme: ThemeInstance) {
    const apply = () => {
      theme.change(currentTheme.value)
      const root = document.documentElement
      root.dataset.theme = isDark.value ? 'dark' : 'light'
      root.style.colorScheme = isDark.value ? 'dark' : 'light'
      const a = accentColor(accentId.value, isDark.value)
      root.style.setProperty('--accent', a)
      root.style.setProperty('--accent-soft', hexToRgba(a, isDark.value ? 0.18 : 0.12))
      root.style.setProperty('--on-accent', isDark.value ? '#0b1118' : '#ffffff')
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
    appearance, accent, locale, isDark, accentId, currentTheme, resolvedLocale, fullscreen,
    setAppearance, cycleAppearance, setAccent, setLocale, toggleLocale, applyToVuetify, applyLocale,
    appearances: APPEARANCES, accents: ACCENTS, locales: LOCALES,
  }
})
