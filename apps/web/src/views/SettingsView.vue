<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import PluginSection from '../components/settings/PluginSection.vue'
import Segmented from '../components/ui/Segmented.vue'
import { LOCALE_LABELS } from '../i18n'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useScenesStore } from '../stores/scenes'
import { usePluginsStore } from '../stores/plugins'
import { WEATHER_CONDITIONS } from '@kasbah/shared'
import { conditionIcon } from '../lib/weather'
import type { IconName } from '../lib/strokeIcons'
import { useSettingsStore, type Appearance, type SceneWeatherChoice } from '../stores/settings'
import { resolveVariant, type Theme } from '../themes'
import { resolveAmbience, type AmbienceMode } from '../three/core/ambience'
import { backdropColor, groundColor } from '../three/builders/materials'
import type { RenderQuality } from '../three/core/post'
import { styleById, type RenderStyle } from '../three/styles'

// Réglages : apparence, langue, thème, origine GPS (colonne gauche) ; plugins (droite). Les
// plugins actifs et leurs sous-items vivent dans house.json : ce sont des choix de LA MAISON, pas
// de la tablette, et ils prennent effet sans redémarrer le serveur.
const settings = useSettingsStore()
const plugins = usePluginsStore()
const scenes = useScenesStore()
const devices = useDevicesStore()
const house = useHouseStore()
const { t } = useI18n()
onMounted(() => { void devices.refreshHealth(); void plugins.load() })

// Suppression d'une ambiance : premier appui arme, second confirme, et on désarme tout seul.
const armed = ref<string | null>(null)
let armTimer: ReturnType<typeof setTimeout> | null = null
function arm(sceneId: string) {
  armed.value = sceneId
  if (armTimer) clearTimeout(armTimer)
  armTimer = setTimeout(() => { armed.value = null }, 5000)
}
function confirmDelete(sceneId: string) {
  armed.value = null
  if (armTimer) clearTimeout(armTimer)
  void scenes.deleteScene(sceneId)
}

const appearanceOptions = computed(() => settings.appearances.map((a) => ({ value: a, label: t(`settings.${a}`) })))
const localeOptions = computed(() => [{ value: '', label: t('settings.auto') }, ...settings.locales.map((l) => ({ value: l as string, label: LOCALE_LABELS[l] }))])
// Aperçu d'un thème : la variante que l'apparence DEMANDE (un thème sombre-uniquement montre donc
// sa palette sombre même en apparence claire, ce que dit aussi son badge).
function preview(theme: Theme) { return resolveVariant(theme.id, settings.wantDark).palette }
function variantLabel(theme: Theme) { return settings.wantDark ? (theme.darkLabel ?? '') : (theme.lightLabel ?? theme.darkLabel ?? '') }

// Aperçu d'un style : ses couleurs À L'HEURE CHOISIE, pour que le jeu de tuiles montre bien ce que
// la scène va rendre — un style de nuit ne se juge pas sur sa palette de midi.
const renderAmbience = computed(() => resolveAmbience({
  mode: settings.sceneAmbience,
  geo: house.house ? { lat: house.house.origin.lat, lon: house.house.origin.lon } : null,
}))
function stylePreview(style: RenderStyle) {
  const look = style.look(renderAmbience.value)
  return {
    sky: backdropColor(look.sky).getStyle(),
    ground: groundColor(look.sky).getStyle(),
    wall: look.palette.wall.getStyle(),
    glass: look.palette.glass.getStyle(),
  }
}
/** Le switch des matières en images n'a de sens que pour un style qui porte un pack. */
const styleHasAssets = computed(() => !!styleById(settings.sceneStyle).assets)
const ambienceOptions = computed(() => settings.ambiences.map((a) => ({ value: a, label: t(`render.ambiences.${a}`) })))
const qualityOptions = computed(() => settings.qualities.map((q) => ({ value: q, label: t(`render.qualities.${q}`) })))
// Météo forcée (débogage) : « Réelle » puis les neuf conditions du contrat, avec l'icône du widget.
const weatherChoices = computed<{ value: SceneWeatherChoice; label: string; icon: IconName | null }[]>(() => [
  { value: 'real', label: t('render.weatherReal'), icon: null },
  ...WEATHER_CONDITIONS.map((c) => ({ value: c, label: t(`weather.conditions.${c}`), icon: conditionIcon(c) })),
])
// La visibilité se règle par paliers qui veulent dire quelque chose (du brouillard épais au grand
// beau), pas au mètre : un curseur linéaire de 50 à 50 000 mettrait tout le brouillard sur un pixel.
const VISIBILITY_STEPS = [100, 200, 400, 800, 1500, 3000, 6000, 12_000, 25_000, 50_000] as const
const visibilityStep = computed(() => {
  const v = settings.sceneVisibilityM
  let best = 0
  VISIBILITY_STEPS.forEach((s, i) => { if (Math.abs(s - v) < Math.abs(VISIBILITY_STEPS[best]! - v)) best = i })
  return best
})
const visibilityLabel = computed(() => (settings.sceneVisibilityM >= 1000 ? `${settings.sceneVisibilityM / 1000} km` : `${settings.sceneVisibilityM} m`))

const gps = computed(() => {
  const o = house.house?.origin
  return o ? `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)} · alt ${o.alt} m · ${t('settings.gpsHeading')} ${o.heading}°` : ''
})
const houseStats = computed(() => {
  const h = house.house
  return h ? t('settings.houseStats', { levels: h.levels.length, rooms: h.rooms.length, devices: h.devices.length }) : ''
})
</script>

<template>
  <div class="settings">
    <PageHeader />
    <div class="settings__scroll">
      <div class="settings__cols">
        <div class="col">
          <section class="card block">
            <div class="block__title">{{ $t('settings.appearance') }}</div>
            <Segmented :model-value="settings.appearance" :options="appearanceOptions" class="w-100" @update:model-value="(v: Appearance) => settings.setAppearance(v)" />
          </section>
          <section class="card block">
            <div class="block__title">{{ $t('settings.language') }}</div>
            <Segmented :model-value="settings.locale" :options="localeOptions" class="w-100" @update:model-value="(v: string) => settings.setLocale(v)" />
          </section>
          <section class="card block">
            <div class="block__title">{{ $t('settings.theme') }}</div>
            <div class="themes">
              <button v-for="th in settings.themes" :key="th.id" type="button" class="theme" :data-on="settings.themeId === th.id ? '1' : '0'"
                      :aria-pressed="settings.themeId === th.id" @click="settings.setTheme(th.id)">
                <span class="preview" :style="{ background: preview(th).bg }">
                  <span class="preview__card" :style="{ background: preview(th).surface }">
                    <span class="preview__bar" :style="{ background: preview(th).text }" />
                    <span class="preview__bar preview__bar--short" :style="{ background: preview(th).muted }" />
                  </span>
                  <span class="preview__dot" :style="{ background: preview(th).accent }" />
                </span>
                <span class="theme__name">{{ th.label }}</span>
                <span class="theme__variant">{{ th.light ? variantLabel(th) : $t('settings.themeDarkOnly') }}</span>
              </button>
            </div>
          </section>
          <section class="card block">
            <div class="block__title">{{ $t('render.title') }}</div>
            <div class="themes">
              <button v-for="st in settings.styles" :key="st.id" type="button" class="theme" :data-on="settings.sceneStyle === st.id ? '1' : '0'"
                      :aria-pressed="settings.sceneStyle === st.id" @click="settings.setSceneStyle(st.id)">
                <span class="preview" :style="{ background: stylePreview(st).sky }">
                  <span class="preview__ground" :style="{ background: stylePreview(st).ground }" />
                  <span class="preview__wall" :style="{ background: stylePreview(st).wall }" />
                  <span class="preview__dot" :style="{ background: stylePreview(st).glass }" />
                </span>
                <span class="theme__name">{{ $t(st.labelKey) }}</span>
              </button>
            </div>
            <div class="auto-row auto-row--default">
              <div class="min0">
                <div class="auto-row__name">{{ $t('render.assets') }}</div>
                <div class="muted small">{{ $t(styleHasAssets ? 'render.assetsHint' : 'render.assetsNone') }}</div>
              </div>
              <v-switch :model-value="settings.sceneAssets && styleHasAssets" :disabled="!styleHasAssets" hide-details density="compact"
                        @update:model-value="(v: boolean | null) => settings.setSceneAssets(v === true)" />
            </div>
            <div class="block__sub">{{ $t('render.ambience') }}</div>
            <Segmented :model-value="settings.sceneAmbience" :options="ambienceOptions" class="w-100" @update:model-value="(v: AmbienceMode) => settings.setSceneAmbience(v)" />
            <div class="muted small">{{ $t('render.ambienceHint') }}</div>
            <div class="block__sub">{{ $t('render.quality') }}</div>
            <Segmented :model-value="settings.sceneQuality" :options="qualityOptions" class="w-100" @update:model-value="(v: RenderQuality) => settings.setSceneQuality(v)" />
            <div class="muted small">{{ $t('render.qualityHint') }}</div>
            <div class="auto-row auto-row--default">
              <div class="min0">
                <div class="auto-row__name">{{ $t('render.debug') }}</div>
                <div class="muted small">{{ $t('render.debugHint') }}</div>
              </div>
              <v-switch :model-value="settings.sceneDebug" hide-details density="compact"
                        @update:model-value="(v: boolean | null) => settings.setSceneDebug(v === true)" />
            </div>
            <!-- météo forcée : débogage seulement, et scène seulement (le widget dit toujours le vrai temps) -->
            <template v-if="settings.sceneDebug">
              <div class="block__sub">{{ $t('render.weather') }}</div>
              <div class="chips">
                <button v-for="w in weatherChoices" :key="w.value" type="button" class="pill pill--sm" :data-on="settings.sceneWeather === w.value ? '1' : '0'"
                        @click="settings.setSceneWeather(w.value)">
                  <StrokeIcon v-if="w.icon" :name="w.icon" :size="16" />{{ w.label }}
                </button>
              </div>
              <div class="slider-row" :data-off="settings.sceneWeather === 'real' ? '1' : '0'">
                <div class="slider-row__label">{{ $t('weather.cloudCover') }}</div>
                <v-slider :model-value="settings.sceneCloudCover" :min="0" :max="100" :step="5" :disabled="settings.sceneWeather === 'real'" hide-details density="compact"
                          @update:model-value="(v: number) => settings.setSceneCloudCover(v)" />
                <div class="slider-row__value">{{ settings.sceneCloudCover }} %</div>
              </div>
              <div class="slider-row" :data-off="settings.sceneWeather === 'real' ? '1' : '0'">
                <div class="slider-row__label">{{ $t('weather.visibility') }}</div>
                <v-slider :model-value="visibilityStep" :min="0" :max="VISIBILITY_STEPS.length - 1" :step="1" :disabled="settings.sceneWeather === 'real'" hide-details density="compact"
                          @update:model-value="(v: number) => settings.setSceneVisibilityM(VISIBILITY_STEPS[v] ?? 25_000)" />
                <div class="slider-row__value">{{ visibilityLabel }}</div>
              </div>
              <div class="muted small">{{ $t('render.weatherHint') }}</div>
            </template>
          </section>
          <section class="card block">
            <div class="block__title">{{ $t('settings.gps') }}</div>
            <div class="mono">{{ gps }}</div>
            <div class="muted small">{{ houseStats }}</div>
          </section>
          <section v-for="g in scenes.scenesByPlugin" :key="g.pluginId" class="card block">
            <div class="block__head">
              <div class="block__title">{{ $t('settings.scenes') }}</div>
              <div class="muted small plugin-tag">{{ g.pluginId.replace('_', ' ') }}</div>
            </div>
            <div class="auto-row auto-row--default">
              <div class="min0">
                <div class="auto-row__name">{{ $t('settings.sceneAutoDynamicNew') }}</div>
                <div class="muted small">{{ $t('settings.sceneAutoDynamicNewHint') }}</div>
              </div>
              <v-switch :model-value="plugins.byId[g.pluginId]?.autoDynamicForNewScenes === true" hide-details density="compact"
                        @update:model-value="(v: boolean | null) => plugins.setAutoDynamicForNewScenes(g.pluginId, v === true)" />
            </div>
            <div class="muted small">{{ $t('settings.sceneAutoDynamicHint') }}</div>
            <div class="auto-rows">
              <div v-for="e in g.scenes" :key="e.scene.id" class="auto-row">
                <div class="min0">
                  <div class="auto-row__name">{{ e.scene.name }}</div>
                  <div class="muted small">{{ e.scene.group?.name ?? '—' }}</div>
                </div>
                <v-switch :model-value="e.scene.autoDynamic" :disabled="!e.scene.dynamic" hide-details density="compact"
                          :title="e.scene.dynamic ? $t('settings.sceneAutoDynamic') : $t('settings.sceneNoPalette')"
                          @update:model-value="(v: boolean | null) => scenes.setAutoDynamic(e.scene.id, v === true)" />
                <!-- destructif et visible depuis l'app du fabricant : deux temps, jamais un seul appui -->
                <v-btn v-if="armed === e.scene.id" color="error" variant="flat" size="small" class="del-confirm"
                       @click="confirmDelete(e.scene.id)">
                  {{ $t('scenes.deleteConfirm') }}
                </v-btn>
                <v-btn v-else icon variant="text" size="small" color="error" class="del"
                       :title="$t('scenes.delete')" :aria-label="$t('scenes.delete')" @click="arm(e.scene.id)">
                  <StrokeIcon name="trash" :size="16" />
                </v-btn>
              </div>
            </div>
          </section>
          <section v-if="settings.fullscreen.isSupported" class="card block block--row">
            <div class="block__title">{{ $t('settings.fullscreen') }}</div>
            <v-switch :model-value="settings.fullscreen.isFullscreen" @update:model-value="settings.fullscreen.toggle()" />
          </section>
        </div>
        <div class="col">
          <section class="card block">
            <div class="block__title">{{ $t('settings.plugins') }}</div>
            <p class="muted small plugins__hint">{{ $t('settings.pluginsHint') }}</p>
            <div class="plugins">
              <PluginSection v-for="p in plugins.list" :key="p.id" :plugin="p" />
              <div v-if="!plugins.loaded" class="muted small">{{ $t('common.loading') }}</div>
            </div>
          </section>
          <p class="muted small about">{{ $t('settings.about', { version: '0.2.0', house: house.house?.name ?? '—' }) }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-tag { text-transform: capitalize; }
.auto-rows { display: grid; gap: 2px; margin-top: 8px; }
.auto-row { display: flex; align-items: center; gap: 12px; padding: 4px 0; border-top: 1px solid var(--line); }
.auto-row--default { border-top: 0; margin-bottom: 4px; }
.del { flex: 0 0 auto; color: var(--muted); }
.del:hover { color: rgb(var(--v-theme-error)); }
.del-confirm { flex: 0 0 auto; }
.auto-row__name { font-size: 14px; font-weight: 500; }
.min0 { flex: 1 1 0; min-width: 0; }

.settings { height: 100%; display: flex; flex-direction: column; }
.settings__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
.settings__cols { display: grid; grid-template-columns: minmax(280px, 420px) 1fr; gap: 16px; align-items: start; }
.col { display: grid; gap: 14px; }
.block { padding: 18px 20px; display: grid; gap: 12px; }
.block--row { grid-template-columns: 1fr auto; align-items: center; }
.block__title { font-weight: 600; font-size: 15px; }
.block__head { display: flex; justify-content: space-between; align-items: baseline; }
.w-100 { width: 100%; display: flex; }
.w-100 :deep(.segmented__item) { flex: 1 1 0; }
/* Sélecteur de thème : chaque tuile montre la palette qu'elle appliquerait (fond, carte, texte,
   accent). Empreinte fixe — la ligne de variante est toujours là, même vide. */
.themes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.theme { display: grid; gap: 4px; padding: 8px; border-radius: var(--radius-sm); text-align: left; cursor: pointer;
         border: 1px solid var(--line); background: transparent; transition: border-color .15s, background .15s; }
.theme[data-on='1'] { border-color: var(--accent); background: var(--accent-soft); }
.theme__name { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.theme__variant { font-size: 11px; color: var(--muted); min-height: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview { position: relative; display: block; height: 46px; border-radius: 8px; overflow: hidden; border: 1px solid var(--line); }
.preview__card { position: absolute; inset: 7px; border-radius: 5px; padding: 6px; display: grid; gap: 4px; align-content: start; }
.preview__bar { height: 4px; width: 66%; border-radius: 2px; }
.preview__bar--short { width: 38%; }
.preview__dot { position: absolute; right: 6px; bottom: 6px; width: 13px; height: 13px; border-radius: 50%; }
/* Aperçu d'un style de rendu : le ciel en fond, le sol en bas, un pan de mur posé dessus. */
.preview__ground { position: absolute; inset: auto 0 0 0; height: 40%; }
.preview__wall { position: absolute; left: 22%; right: 34%; bottom: 22%; height: 55%; border-radius: 2px; }
.block__sub { margin-top: 4px; font-size: 12px; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pill--sm { height: 32px; padding: 0 12px; font-size: 13px; gap: 6px; }
/* libellé et valeur à largeur fixe : le curseur ne bouge pas quand le chiffre change */
.slider-row { display: grid; grid-template-columns: 88px 1fr 56px; align-items: center; gap: 10px; }
.slider-row__label { font-size: 12px; color: var(--muted); }
.slider-row__value { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.slider-row[data-off='1'] { opacity: .5; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.small { font-size: 12px; }
.plugins { display: grid; gap: 4px; }
.plugins__hint { margin: -4px 0 0; }
.min0 { min-width: 0; flex: 1 1 0; }
.about { margin: 0 4px; }
@media (max-width: 900px) { .settings__cols { grid-template-columns: 1fr; } }
</style>
