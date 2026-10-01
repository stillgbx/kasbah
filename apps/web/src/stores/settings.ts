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
/**
 * Combien pèse une « tasse » de croquettes, en grammes. C'est un RÉGLAGE et pas une constante :
 * une mangeoire PetKit compte en volume (elle déclare `settings.factor`, jamais un poids), et le
 * poids dépend des croquettes — leur taille, leur densité. Le seul moyen honnête de l'obtenir est
 * que l'utilisateur pèse une ration une fois.
 *
 * 100 g par défaut, et ce n'est pas une supposition : l'appli du fabricant écrit elle-même
 * « 1/2 (environ 50 g) » pour une demi-tasse. Elle applique donc 10 g par dixième — exactement ce
 * défaut. La valeur affichée garde un « ~ » parce qu'elle dépend des croquettes : c'est
 * l'estimation du fabricant, pas une pesée.
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
  /** '' = automatique (langues du navigateur). */
  const locale = useLocalStorage<string>('kasbah.locale', '')
  const sceneStyle = useLocalStorage<string>('kasbah.sceneStyle', DEFAULT_STYLE_ID)
  const sceneAmbience = useLocalStorage<AmbienceMode>('kasbah.sceneAmbience', 'auto')
  /** Saison du jardin de la vue Maison ; `auto` suit la date. */
  const sceneSeason = useLocalStorage<SeasonMode>('kasbah.sceneSeason', 'auto')
  const sceneQuality = useLocalStorage<RenderQuality>('kasbah.sceneQuality', 'auto')
  /**
   * Comment la maison est PROJETÉE : en perspective, à plat (orthographique, on tourne encore), ou
   * en isométrie (à plat, angles verrouillés, quarts de tour). Un réglage de goût comme le style,
   * pas un budget : il ne suit ni le thème ni la machine.
   */
  const sceneProjection = useLocalStorage<SceneProjection>('kasbah.sceneProjection', 'perspective')
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
  const cupGrams = useLocalStorage<number>('kasbah.cupGrams', CUP_GRAMS_DEFAULT)
  const preferredDark = usePreferredDark()
  const weather = useWeather()
  const house = useHouseStore()
  /**
   * Banc de réglage de la lumière. Deux étages, et c'est voulu :
   *  - ce qui est ENREGISTRÉ vit dans la maison (`house.render.tuning`), parce qu'une lumière se
   *    règle une fois pour toutes les tablettes qui regardent cette maison ;
   *  - ce qui est EN COURS de réglage vit ici, dans un brouillon local, pour qu'on puisse tirer les
   *    curseurs une soirée entière sans rien écrire dans le fichier de la maison.
   * `null` = aucun brouillon, la maison fait foi. C'est ce que rend « Réinitialiser » une fois
   * enregistré, et c'est l'état d'une tablette qui n'a jamais ouvert le banc.
   */
  // Le sérialiseur est DIT : `useLocalStorage` le devine de la valeur par défaut, et une valeur par
  // défaut `null` ne dit rien — le brouillon partait en `[object Object]` et ne survivait pas au
  // rechargement (constaté). `null` reste ici le seul moyen de distinguer « pas de brouillon » d'un
  // brouillon neutre, qui lui est un choix.
  const sceneTuningDraft = useLocalStorage<Partial<SceneTuning> | null>('kasbah.sceneTuning', null, { serializer: StorageSerializers.object })
  /** Ce que la maison porte, ou le neutre : le réglage auquel « Réinitialiser » ne touche pas. */
  const savedSceneTuning = computed(() => resolveTuning(house.house?.render?.tuning))
  /** Ce que la scène applique : le brouillon s'il y en a un, sinon la maison. */
  const sceneTuning = computed(() => (sceneTuningDraft.value ? resolveTuning(sceneTuningDraft.value) : savedSceneTuning.value))
  /** Le brouillon diffère-t-il de ce qui est enregistré (le bouton « Enregistrer » a-t-il quelque chose à dire). */
  const sceneTuningDirty = computed(() => !sameTuning(sceneTuning.value, savedSceneTuning.value))
  /** Le préréglage dont le réglage courant est la copie conforme, s'il y en a un. */
  const sceneTuningPreset = computed(() => TUNING_PRESETS.find((p) => sameTuning(p.tuning, sceneTuning.value))?.id ?? null)
  /** Le banc est-il ouvert sur la vue Maison. Jamais persisté : il s'ouvre depuis les Réglages. */
  const sceneTuningOpen = ref(false)
  /** L'éditeur du relief est-il ouvert sur la vue Maison. Jamais persisté, comme le banc. */
  const reliefEditing = ref(false)
  /** L'onglet de l'éditeur du terrain : le relief (hauteurs) ou le contour (la forme de la parcelle). */
  const terrainTab = ref<'relief' | 'outline'>('relief')
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
  function setSceneSeason(v: SeasonMode) { if (SEASON_MODES.includes(v)) sceneSeason.value = v }
  function setSceneQuality(v: RenderQuality) { if (RENDER_QUALITIES.includes(v)) sceneQuality.value = v }
  function setSceneProjection(v: SceneProjection) { if (SCENE_PROJECTIONS.includes(v)) sceneProjection.value = v }
  function setSceneAssets(v: boolean) { sceneAssets.value = v }
  function setSceneDebug(v: boolean) { sceneDebug.value = v }
  function setSceneTuning(patch: Partial<SceneTuning>) { sceneTuningDraft.value = resolveTuning({ ...sceneTuning.value, ...patch }) }
  /** « Réinitialiser » : retour à ce que le style calcule, sans retouche. Ce qui est enregistré dans la maison reste, jusqu'à un « Enregistrer ». */
  function resetSceneTuning() { sceneTuningDraft.value = { ...NEUTRAL_TUNING } }
  function applySceneTuningPreset(id: string) {
    const p = TUNING_PRESETS.find((x) => x.id === id)
    if (p) sceneTuningDraft.value = { ...p.tuning }
  }
  /** Écrit le réglage courant dans la maison ; le brouillon s'efface, la maison devient la source. */
  async function saveSceneTuning(): Promise<boolean> {
    const ok = await house.saveRenderTuning(sceneTuning.value)
    if (ok) sceneTuningDraft.value = null
    return ok
  }
  function setSceneTuningOpen(v: boolean) { sceneTuningOpen.value = v }
  /** Ouvre (ou ferme) l'éditeur du terrain ; `tab` choisit l'onglet à l'ouverture. */
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
    sceneStyle, sceneAmbience, sceneQuality, sceneProjection, sceneAssets, sceneDebug, sceneTuning, savedSceneTuning, sceneTuningDirty, sceneTuningPreset, sceneTuningOpen, reliefEditing, terrainTab, houseEditing, sceneWeather, sceneCloudCover, sceneVisibilityM, householdSize, cupGrams,
    setAppearance, cycleAppearance, setTheme, setLocale, toggleLocale, applyToVuetify, applyLocale,
    setSceneStyle, setSceneAmbience, setSceneQuality, setSceneProjection, setSceneAssets, setSceneDebug, setSceneTuning, resetSceneTuning, applySceneTuningPreset, saveSceneTuning, setSceneTuningOpen, setReliefEditing, setTerrainTab, setHouseEditing, setSceneWeather, setSceneCloudCover, setSceneVisibilityM, setHouseholdSize, setCupGrams,
    appearances: APPEARANCES, themes: THEME_LIST, locales: LOCALES,
    styles: RENDER_STYLES, ambiences: AMBIENCE_MODES, seasons: SEASON_MODES, sceneSeason, setSceneSeason, qualities: RENDER_QUALITIES, projections: SCENE_PROJECTIONS,
  }
})
