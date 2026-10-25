import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { StorageSerializers, useFullscreen, useIntervalFn, useLocalStorage, usePreferredDark } from '@vueuse/core'
import type { ThemeInstance } from 'vuetify'
import { themeName } from '../plugins/vuetify'
import { cssVars, DEFAULT_THEME_ID, resolveVariant, THEME_LIST, type ThemeId } from '../themes'
import { detectLocale, isLocale, LOCALES, type Locale } from '../i18n'
import { isDaylight } from '../lib/daylight'
import { useWeather } from '../composables/useWeather'
import { useHouseStore } from './house'
import { AMBIENCE_MODES, type AmbienceMode } from '../three/core/ambience'
import { RENDER_QUALITIES, type RenderQuality } from '../three/core/post'
import { SCENE_PROJECTIONS, type SceneProjection } from '../three/core/cameraFit'
import { DEFAULT_STYLE_ID, RENDER_STYLES } from '../three/styles'
import { NEUTRAL_TUNING, resolveTuning, sameTuning, TUNING_PRESETS, type SceneTuning } from '../three/styles/tuning'
import { SEASON_MODES, type SeasonMode } from '../three/garden/season'
import { WEATHER_CONDITIONS, type WeatherCondition } from '@kasbah/shared'

/** A condition forced in the scene, or `real`: the weather as it is. */
export type SceneWeatherChoice = WeatherCondition | 'real'

// Persisted preferences (localStorage, prefix kasbah.): light/dark/system/auto appearance,
// theme, language. `applyToVuetify`/`applyLocale` are called BEFORE the mount (no flash of theme/language).
//
// The three settings of the 3D SCENE are deliberately separate from the app's theme: the style says
// the taste of the rendering, the ambience the time of day above the house, the quality the machine's
// budget. None of the three follows light/dark (see `three/core/ambience.ts`).

// `system` follows THE DEVICE that is looking (`prefers-color-scheme`), `auto` follows the SUN above the house
// (`lib/daylight.ts`): two automatisms, two sources, hence two entries in the list.
export const APPEARANCES = ['light', 'dark', 'system', 'auto'] as const
export type Appearance = (typeof APPEARANCES)[number]

/** Bounds of the declared household (Water view, French average consumption benchmark): 1 person minimum, 10 maximum. */
/**
 * How much a "cup" of kibble weighs, in grams. It is a SETTING and not a constant:
 * a PetKit feeder counts in volume (it declares `settings.factor`, never a weight), and the
 * weight depends on the kibble — its size, its density. The only honest way to get it is
 * for the user to weigh a portion once.
 *
 * 100 g by default, and that is not a guess: the vendor's app itself writes
 * "1/2 (environ 50 g)" for half a cup. It therefore applies 10 g per tenth — exactly this
 * default. The displayed value keeps a "~" because it depends on the kibble: it is
 * the vendor's estimate, not a weighing.
 */
export const CUP_GRAMS_MIN = 20
export const CUP_GRAMS_MAX = 300
export const CUP_GRAMS_STEP = 5
export const CUP_GRAMS_DEFAULT = 100

export const HOUSEHOLD_SIZE_MIN = 1
export const HOUSEHOLD_SIZE_MAX = 10

export const useSettingsStore = defineStore('settings', () => {
  const appearance = useLocalStorage<Appearance>('kasbah.appearance', 'system')
  const theme = useLocalStorage<string>('kasbah.theme', DEFAULT_THEME_ID)
  /** '' = automatic (browser languages). */
  const locale = useLocalStorage<string>('kasbah.locale', '')
  const sceneStyle = useLocalStorage<string>('kasbah.sceneStyle', DEFAULT_STYLE_ID)
  const sceneAmbience = useLocalStorage<AmbienceMode>('kasbah.sceneAmbience', 'auto')
  /** Season of the House view garden; `auto` follows the date. */
  const sceneSeason = useLocalStorage<SeasonMode>('kasbah.sceneSeason', 'auto')
  const sceneQuality = useLocalStorage<RenderQuality>('kasbah.sceneQuality', 'auto')
  /**
   * How the house is PROJECTED: in perspective, flat (orthographic, one can still rotate), or
   * in isometry (flat, locked angles, quarter turns). A matter of taste like the style,
   * not a budget: it follows neither the theme nor the machine.
   */
  const sceneProjection = useLocalStorage<SceneProjection>('kasbah.sceneProjection', 'perspective')
  /** Materials as images (the style's photo pack) rather than procedural, for the styles that have them. */
  const sceneAssets = useLocalStorage<boolean>('kasbah.sceneAssets', true)
  /** Measurement veil placed over the scene (frames/s, draw calls, passes, shadows). */
  const sceneDebug = useLocalStorage<boolean>('kasbah.sceneDebug', false)
  /**
   * House EDIT mode: the House view shows the openings, which can then be adjusted and
   * dragged on the walls. Armed here and not by a button of the scene — on a tablet placed in
   * the entrance, a sliding finger must not be able to move a window.
   */
  const houseEditing = useLocalStorage<boolean>('kasbah.houseEditing', false)
  /**
   * Weather FORCED in the scene, to watch it under the rain without waiting for it to rain. Only applies
   * in debug (`sceneDebug`) and only touches the scene: widget and Weather view stay on the
   * real weather. `real` = follow the weather.
   */
  const sceneWeather = useLocalStorage<SceneWeatherChoice>('kasbah.sceneWeather', 'real')
  const sceneCloudCover = useLocalStorage<number>('kasbah.sceneCloudCover', 60)
  const sceneVisibilityM = useLocalStorage<number>('kasbah.sceneVisibilityM', 25_000)
  /** Declared household (Water view): compares consumption to the French average — a display preference, never written to house.json. */
  const householdSize = useLocalStorage<number>('kasbah.householdSize', 3)
  const cupGrams = useLocalStorage<number>('kasbah.cupGrams', CUP_GRAMS_DEFAULT)
  /** Order of the rail's views on THIS device (view names, House and Settings excluded); empty = the default order. */
  const navOrder = useLocalStorage<string[]>('kasbah.navOrder', [])
  const preferredDark = usePreferredDark()
  const weather = useWeather()
  const house = useHouseStore()
  /**
   * Light tuning bench. Two tiers, and it is deliberate:
   *  - what is SAVED lives in the house (`house.render.tuning`), because a light is
   *    tuned once for all the screens that look at this house;
   *  - what is BEING tuned lives here, in a local draft, so that one can drag the
   *    sliders a whole evening without writing anything into the house file.
   * `null` = no draft, the house is authoritative. It is what "Reset" gives back once
   * saved, and it is the state of a screen that never opened the bench.
   */
  // The serializer is SPELLED OUT: `useLocalStorage` guesses it from the default value, and a
  // default value of `null` says nothing — the draft went out as `[object Object]` and did not survive
  // the reload (observed). `null` remains here the only way to tell "no draft" from a
  // neutral draft, which is a choice.
  const sceneTuningDraft = useLocalStorage<Partial<SceneTuning> | null>('kasbah.sceneTuning', null, { serializer: StorageSerializers.object })
  /** What the house carries, or the neutral: the setting that "Reset" does not touch. */
  const savedSceneTuning = computed(() => resolveTuning(house.house?.render?.tuning))
  /** What the scene applies: the draft if there is one, otherwise the house. */
  const sceneTuning = computed(() => (sceneTuningDraft.value ? resolveTuning(sceneTuningDraft.value) : savedSceneTuning.value))
  /** Whether the draft differs from what is saved (whether the "Save" button has something to say). */
  const sceneTuningDirty = computed(() => !sameTuning(sceneTuning.value, savedSceneTuning.value))
  /** The preset of which the current setting is the exact copy, if there is one. */
  const sceneTuningPreset = computed(() => TUNING_PRESETS.find((p) => sameTuning(p.tuning, sceneTuning.value))?.id ?? null)
  /** Whether the bench is open on the House view. Never persisted: it opens from Settings. */
  const sceneTuningOpen = ref(false)
  /** Whether the relief editor is open on the House view. Never persisted, like the bench. */
  const reliefEditing = ref(false)
  /** The terrain editor's tab: the relief (heights) or the outline (the shape of the parcel). */
  const terrainTab = ref<'relief' | 'outline'>('relief')
  /** Clock of the "Auto" appearance. The other modes do not read it: nothing recomputes. */
  const clock = ref(new Date())
  useIntervalFn(() => { clock.value = new Date() }, 60_000)

  const themeId = computed<ThemeId>(() => (THEME_LIST.some((t) => t.id === theme.value) ? (theme.value as ThemeId) : DEFAULT_THEME_ID))
  /** Appearance requested by this browser; a theme that does not have this variant imposes its own. */
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
  /** The rail button goes through the list in the order of Settings: light → dark → system → auto. */
  function cycleAppearance() { appearance.value = APPEARANCES[(APPEARANCES.indexOf(appearance.value) + 1) % APPEARANCES.length]! }
  function setTheme(v: string) { theme.value = v }
  function setLocale(v: string) { if (v === '' || isLocale(v)) locale.value = v }
  function setSceneStyle(v: string) { if (RENDER_STYLES.some((st) => st.id === v)) sceneStyle.value = v }
  function setSceneAmbience(v: AmbienceMode) { if (AMBIENCE_MODES.includes(v)) sceneAmbience.value = v }
  function setSceneSeason(v: SeasonMode) { if (SEASON_MODES.includes(v)) sceneSeason.value = v }
  function setSceneQuality(v: RenderQuality) { if (RENDER_QUALITIES.includes(v)) sceneQuality.value = v }
  function setSceneProjection(v: SceneProjection) { if (SCENE_PROJECTIONS.includes(v)) sceneProjection.value = v }
  function setSceneAssets(v: boolean) { sceneAssets.value = v }
  function setSceneDebug(v: boolean) { sceneDebug.value = v }
  function setSceneTuning(patch: Partial<SceneTuning>) { sceneTuningDraft.value = resolveTuning({ ...sceneTuning.value, ...patch }) }
  /** "Reset": back to what the style computes, with no tweak. What is saved in the house stays, until a "Save". */
  function resetSceneTuning() { sceneTuningDraft.value = { ...NEUTRAL_TUNING } }
  function applySceneTuningPreset(id: string) {
    const p = TUNING_PRESETS.find((x) => x.id === id)
    if (p) sceneTuningDraft.value = { ...p.tuning }
  }
  /** Writes the current setting into the house; the draft is cleared, the house becomes the source. */
  async function saveSceneTuning(): Promise<boolean> {
    const ok = await house.saveRenderTuning(sceneTuning.value)
    if (ok) sceneTuningDraft.value = null
    return ok
  }
  function setSceneTuningOpen(v: boolean) { sceneTuningOpen.value = v }
  /** Opens (or closes) the terrain editor; `tab` chooses the tab on opening. */
  function setReliefEditing(v: boolean, tab?: 'relief' | 'outline') { if (tab) terrainTab.value = tab; reliefEditing.value = v }
  function setTerrainTab(v: 'relief' | 'outline') { terrainTab.value = v }
  function setHouseEditing(v: boolean) { houseEditing.value = v }
  function setSceneWeather(v: SceneWeatherChoice) { if (v === 'real' || WEATHER_CONDITIONS.includes(v)) sceneWeather.value = v }
  function setSceneCloudCover(v: number) { if (Number.isFinite(v)) sceneCloudCover.value = Math.min(100, Math.max(0, Math.round(v))) }
  function setSceneVisibilityM(v: number) { if (Number.isFinite(v)) sceneVisibilityM.value = Math.min(50_000, Math.max(50, Math.round(v))) }
  function setCupGrams(v: number) {
    if (Number.isFinite(v)) cupGrams.value = Math.min(CUP_GRAMS_MAX, Math.max(CUP_GRAMS_MIN, Math.round(v / CUP_GRAMS_STEP) * CUP_GRAMS_STEP))
  }
  function setHouseholdSize(v: number) { if (Number.isFinite(v)) householdSize.value = Math.min(HOUSEHOLD_SIZE_MAX, Math.max(HOUSEHOLD_SIZE_MIN, Math.round(v))) }
  function setNavOrder(v: string[]) { navOrder.value = v }
  function toggleLocale() { locale.value = resolvedLocale.value === 'fr' ? 'en' : 'fr' }

  /** Applies the Vuetify theme + the palette's CSS tokens (data-theme, --bg, --accent…) on <html>. */
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
    sceneStyle, sceneAmbience, sceneQuality, sceneProjection, sceneAssets, sceneDebug, sceneTuning, savedSceneTuning, sceneTuningDirty, sceneTuningPreset, sceneTuningOpen, reliefEditing, terrainTab, houseEditing, sceneWeather, sceneCloudCover, sceneVisibilityM, householdSize, cupGrams, navOrder,
    setAppearance, cycleAppearance, setTheme, setLocale, toggleLocale, applyToVuetify, applyLocale,
    setSceneStyle, setSceneAmbience, setSceneQuality, setSceneProjection, setSceneAssets, setSceneDebug, setSceneTuning, resetSceneTuning, applySceneTuningPreset, saveSceneTuning, setSceneTuningOpen, setReliefEditing, setTerrainTab, setHouseEditing, setSceneWeather, setSceneCloudCover, setSceneVisibilityM, setHouseholdSize, setCupGrams, setNavOrder,
    appearances: APPEARANCES, themes: THEME_LIST, locales: LOCALES,
    styles: RENDER_STYLES, ambiences: AMBIENCE_MODES, seasons: SEASON_MODES, sceneSeason, setSceneSeason, qualities: RENDER_QUALITIES, projections: SCENE_PROJECTIONS,
  }
})
