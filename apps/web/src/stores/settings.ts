import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useFullscreen, useIntervalFn, useLocalStorage, usePreferredDark } from '@vueuse/core'
import type { ThemeInstance } from 'vuetify'
import { themeName } from '../plugins/vuetify'
import { cssVars, DEFAULT_THEME_ID, resolveVariant, THEME_LIST, type ThemeId } from '../themes'
import { detectLocale, isLocale, LOCALES, type Locale } from '../i18n'
import { isDaylight } from '../lib/daylight'
import { useWeather } from '../composables/useWeather'
import { useHouseStore } from './house'
import { AMBIENCE_MODES, type AmbienceMode } from '../three/core/ambience'
import { RENDER_QUALITIES, type RenderQuality } from '../three/core/post'
import { DEFAULT_STYLE_ID, RENDER_STYLES } from '../three/styles'
import { WEATHER_CONDITIONS, type WeatherCondition } from '@kasbah/shared'

/** Une condition forcée dans la scène, ou `real` : la météo telle qu'elle est. */
export type SceneWeatherChoice = WeatherCondition | 'real'

// Préférences persistées (localStorage, préfixe kasbah.) : apparence clair/sombre/système/auto,
// thème, langue. `applyToVuetify`/`applyLocale` sont appelées AVANT le mount (aucun flash de thème/langue).
//
// Les trois réglages de la SCÈNE 3D sont délibérément séparés du thème de l'app : le style dit le
// goût du rendu, l'ambiance l'heure qu'il fait au-dessus de la maison, la qualité le budget de la
// tablette. Aucun des trois ne suit clair/sombre (voir `three/core/ambience.ts`).

// `system` suit L'APPAREIL qui regarde (`prefers-color-scheme`), `auto` suit le SOLEIL au-dessus de la maison
// (`lib/daylight.ts`) : deux automatismes, deux sources, d'où deux entrées dans la liste.
export const APPEARANCES = ['light', 'dark', 'system', 'auto'] as const
export type Appearance = (typeof APPEARANCES)[number]

/** Bornes du foyer déclaré (vue Eau, repère de consommation moyenne française) : 1 personne au minimum, 10 au maximum. */
export const HOUSEHOLD_SIZE_MIN = 1
export const HOUSEHOLD_SIZE_MAX = 10

export const useSettingsStore = defineStore('settings', () => {
  const appearance = useLocalStorage<Appearance>('kasbah.appearance', 'system')
  const theme = useLocalStorage<string>('kasbah.theme', DEFAULT_THEME_ID)
  /** '' = automatique (langues du navigateur). */
  const locale = useLocalStorage<string>('kasbah.locale', '')
  const sceneStyle = useLocalStorage<string>('kasbah.sceneStyle', DEFAULT_STYLE_ID)
  const sceneAmbience = useLocalStorage<AmbienceMode>('kasbah.sceneAmbience', 'auto')
  const sceneQuality = useLocalStorage<RenderQuality>('kasbah.sceneQuality', 'auto')
  /** Matières en images (pack photo du style) plutôt que procédurales, pour les styles qui en ont. */
  const sceneAssets = useLocalStorage<boolean>('kasbah.sceneAssets', true)
  /** Voile de mesure posé sur la scène (images/s, appels de dessin, passes, ombres). */
  const sceneDebug = useLocalStorage<boolean>('kasbah.sceneDebug', false)
  /**
   * Mode ÉDITION de la maison : la vue Maison montre les ouvertures, qu'on peut alors régler et
   * glisser sur les murs. Armé ici et non par un bouton de la scène — sur une tablette posée dans
   * l'entrée, un doigt qui glisse ne doit pas pouvoir déplacer une fenêtre.
   */
  const houseEditing = useLocalStorage<boolean>('kasbah.houseEditing', false)
  /**
   * Météo FORCÉE dans la scène, pour la regarder sous la pluie sans attendre qu'il pleuve. Ne vaut
   * qu'en débogage (`sceneDebug`) et ne touche que la scène : widget et vue Météo restent sur la
   * vraie météo. `real` = suivre la météo.
   */
  const sceneWeather = useLocalStorage<SceneWeatherChoice>('kasbah.sceneWeather', 'real')
  const sceneCloudCover = useLocalStorage<number>('kasbah.sceneCloudCover', 60)
  const sceneVisibilityM = useLocalStorage<number>('kasbah.sceneVisibilityM', 25_000)
  /** Foyer déclaré (vue Eau) : compare la consommation à la moyenne française — préférence d'affichage, jamais écrite dans house.json. */
  const householdSize = useLocalStorage<number>('kasbah.householdSize', 3)
  const preferredDark = usePreferredDark()
  const weather = useWeather()
  const house = useHouseStore()
  /** Horloge de l'apparence « Auto ». Les autres modes ne la lisent pas : rien ne recalcule. */
  const clock = ref(new Date())
  useIntervalFn(() => { clock.value = new Date() }, 60_000)

  const themeId = computed<ThemeId>(() => (THEME_LIST.some((t) => t.id === theme.value) ? (theme.value as ThemeId) : DEFAULT_THEME_ID))
  /** Apparence demandée par la tablette ; un thème qui n'a pas cette variante impose la sienne. */
  const wantDark = computed(() => {
    if (appearance.value === 'light' || appearance.value === 'dark') return appearance.value === 'dark'
    if (appearance.value === 'system') return preferredDark.value
    const origin = house.house?.origin
    return !isDaylight({
      now: clock.value,
      sunrise: weather.live.value?.sunrise,
      sunset: weather.live.value?.sunset,
      geo: origin ? { lat: origin.lat, lon: origin.lon } : null,
    })
  })
  const variant = computed(() => resolveVariant(themeId.value, wantDark.value))
  const isDark = computed(() => variant.value.isDark)
  const currentTheme = computed(() => themeName(themeId.value, isDark.value))
  const resolvedLocale = computed<Locale>(() => detectLocale(locale.value || null))
  const fullscreen = useFullscreen()

  function setAppearance(v: Appearance) { appearance.value = v }
  /** Le bouton du rail parcourt la liste dans l'ordre des Réglages : clair → sombre → système → auto. */
  function cycleAppearance() { appearance.value = APPEARANCES[(APPEARANCES.indexOf(appearance.value) + 1) % APPEARANCES.length]! }
  function setTheme(v: string) { theme.value = v }
  function setLocale(v: string) { if (v === '' || isLocale(v)) locale.value = v }
  function setSceneStyle(v: string) { if (RENDER_STYLES.some((st) => st.id === v)) sceneStyle.value = v }
  function setSceneAmbience(v: AmbienceMode) { if (AMBIENCE_MODES.includes(v)) sceneAmbience.value = v }
  function setSceneQuality(v: RenderQuality) { if (RENDER_QUALITIES.includes(v)) sceneQuality.value = v }
  function setSceneAssets(v: boolean) { sceneAssets.value = v }
  function setSceneDebug(v: boolean) { sceneDebug.value = v }
  function setHouseEditing(v: boolean) { houseEditing.value = v }
  function setSceneWeather(v: SceneWeatherChoice) { if (v === 'real' || WEATHER_CONDITIONS.includes(v)) sceneWeather.value = v }
  function setSceneCloudCover(v: number) { if (Number.isFinite(v)) sceneCloudCover.value = Math.min(100, Math.max(0, Math.round(v))) }
  function setSceneVisibilityM(v: number) { if (Number.isFinite(v)) sceneVisibilityM.value = Math.min(50_000, Math.max(50, Math.round(v))) }
  function setHouseholdSize(v: number) { if (Number.isFinite(v)) householdSize.value = Math.min(HOUSEHOLD_SIZE_MAX, Math.max(HOUSEHOLD_SIZE_MIN, Math.round(v))) }
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
    sceneStyle, sceneAmbience, sceneQuality, sceneAssets, sceneDebug, houseEditing, sceneWeather, sceneCloudCover, sceneVisibilityM, householdSize,
    setAppearance, cycleAppearance, setTheme, setLocale, toggleLocale, applyToVuetify, applyLocale,
    setSceneStyle, setSceneAmbience, setSceneQuality, setSceneAssets, setSceneDebug, setHouseEditing, setSceneWeather, setSceneCloudCover, setSceneVisibilityM, setHouseholdSize,
    appearances: APPEARANCES, themes: THEME_LIST, locales: LOCALES,
    styles: RENDER_STYLES, ambiences: AMBIENCE_MODES, qualities: RENDER_QUALITIES,
  }
})
