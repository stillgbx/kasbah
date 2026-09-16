<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import PluginSection from '../components/settings/PluginSection.vue'
import Segmented from '../components/ui/Segmented.vue'
import { LOCALE_LABELS } from '../i18n'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
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

// Réglages, en deux temps : D'ABORD les réglages, ENSUITE la liste des plugins, pleine largeur
// en fin de page. Les réglages tiennent en trois zones — une pile d'une unité (apparence, langue,
// thème), le Rendu 3D sur deux unités parce que lui seul porte assez pour les remplir, une pile
// d'une unité (plein écran, origine GPS). Les plugins actifs et leurs sous-items vivent dans
// house.json : ce sont des choix de LA MAISON, pas de la tablette, et ils prennent effet sans
// redémarrer le serveur.
const settings = useSettingsStore()
const plugins = usePluginsStore()
const devices = useDevicesStore()
const house = useHouseStore()
const { t } = useI18n()
onMounted(() => { void devices.refreshHealth(); void plugins.load() })

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
      <div class="settings__blocks">
        <!-- colonne de gauche : les réglages de la tablette, chacun sur une unité de large -->
        <div class="stack">
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
        </div>
        <!-- le bloc dense : deux unités de large, et son contenu lui-même sur deux colonnes -->
        <section class="card block block--wide">
          <div class="block__title">{{ $t('render.title') }}</div>
          <div class="render">
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
            <!-- seconde colonne : les deux bascules, qui se contentent de la place qu'on leur laisse -->
            <div class="render__side">
              <div class="auto-row auto-row--default">
                <div class="min0">
                  <div class="auto-row__name">{{ $t('render.assets') }}</div>
                  <div class="muted small">{{ $t(styleHasAssets ? 'render.assetsHint' : 'render.assetsNone') }}</div>
                </div>
                <v-switch :model-value="settings.sceneAssets && styleHasAssets" :disabled="!styleHasAssets" hide-details density="compact"
                          @update:model-value="(v: boolean | null) => settings.setSceneAssets(v === true)" />
              </div>
              <div class="auto-row auto-row--default">
                <div class="min0">
                  <div class="auto-row__name">{{ $t('render.debug') }}</div>
                  <div class="muted small">{{ $t('render.debugHint') }}</div>
                </div>
                <v-switch :model-value="settings.sceneDebug" hide-details density="compact"
                          @update:model-value="(v: boolean | null) => settings.setSceneDebug(v === true)" />
              </div>
            </div>
            <!-- les deux segmentés reprennent TOUTE la largeur du bloc : leurs quatre libellés ne
                 se coupent pas et ne s'abrègent pas, ils demandent plus qu'une demi-colonne -->
            <div class="render__full">
              <div class="block__sub">{{ $t('render.ambience') }}</div>
              <Segmented dense :model-value="settings.sceneAmbience" :options="ambienceOptions" class="w-100" @update:model-value="(v: AmbienceMode) => settings.setSceneAmbience(v)" />
              <div class="muted small">{{ $t('render.ambienceHint') }}</div>
              <div class="block__sub">{{ $t('render.quality') }}</div>
              <Segmented dense :model-value="settings.sceneQuality" :options="qualityOptions" class="w-100" @update:model-value="(v: RenderQuality) => settings.setSceneQuality(v)" />
              <div class="muted small">{{ $t('render.qualityHint') }}</div>
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
            </div>
          </div>
        </section>
        <!-- colonne de droite : ce qui tient en une ligne -->
        <div class="stack">
          <section v-if="settings.fullscreen.isSupported" class="card block block--row">
            <div class="block__title">{{ $t('settings.fullscreen') }}</div>
            <v-switch :model-value="settings.fullscreen.isFullscreen" @update:model-value="settings.fullscreen.toggle()" />
          </section>
          <section class="card block">
            <div class="block__title">{{ $t('settings.gps') }}</div>
            <div class="mono">{{ gps }}</div>
            <div class="muted small">{{ houseStats }}</div>
          </section>
        </div>
      </div>
      <!-- les fabricants ferment la page : une liste pleine largeur, où chaque ligne a la place de
           dire nom, statut et interrupteur sans se serrer -->
      <section class="card block settings__plugins">
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
</template>

<style scoped>
.auto-row { display: flex; align-items: center; gap: 12px; padding: 4px 0; }
.auto-row--default { margin-bottom: 4px; }
.auto-row__name { font-size: 14px; font-weight: 500; }
.min0 { flex: 1 1 0; min-width: 0; }

.settings { height: 100%; display: flex; flex-direction: column; }
.settings__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); }
/* Les réglages d'abord, en quatre unités : une pile d'une unité, le Rendu 3D sur deux, une pile
   d'une unité. Des PILES et non des cellules de grille : une rangée de grille s'aligne sur son
   plus grand, et le Rendu 3D aurait creusé sa hauteur à côté de chaque petit bloc. Ici chaque pile
   coule à son rythme, et la page ne fait que la hauteur de la plus haute des trois. */
.settings__blocks { display: grid; grid-template-columns: 1fr; gap: 14px; }
.stack { display: grid; gap: 14px; align-content: start; }
/* 1500 px : le seuil n'est pas choisi au doigt mouillé, c'est celui où les proportions 1-2-1
   tiennent vraiment. Une piste `fr` ne descend jamais sous le min-content de ce qu'elle porte
   (`../../../doc/6_faq/6_0_pieges-outillage.md`) : la pile de gauche en réclame 344 (le segmenté
   Automatique / Français / English), donc un quart de la largeur doit valoir au moins ça. En
   dessous, les pistes se seraient déformées en 344/492/246 — plus rien de 1-2-1 — et la colonne
   de droite aurait été à l'étroit. On empile alors, ce qui suffit largement à ces blocs. */
@media (min-width: 1500px) {
  .settings__blocks { grid-template-columns: 1fr 2fr 1fr; align-items: start; }
}
/* Les plugins ensuite, pleine largeur, sous la grille. */
.settings__plugins { margin-top: 14px; }
.block { padding: 18px 20px; display: grid; gap: 12px; }
.block--row { grid-template-columns: 1fr auto; align-items: center; }
.block__title { font-weight: 600; font-size: 15px; }
.w-100 { width: 100%; display: flex; }
.w-100 :deep(.segmented__item) { flex: 1 1 0; }
/* Sélecteur de thème : chaque tuile montre la palette qu'elle appliquerait (fond, carte, texte,
   accent). Empreinte fixe — la ligne de variante est toujours là, même vide. */
/* Le contenu du Rendu 3D sur deux colonnes : les tuiles d'un côté, les bascules de l'autre.
   Les deux segmentés, eux, gardent TOUTE la largeur du bloc — mesuré : leurs quatre libellés
   demandent ~370 px, une demi-colonne n'en offre que ~280 et les coupait.
   Requête de CONTENEUR et non d'écran : ce qui décide, c'est la largeur du bloc, qu'il soit sur
   deux unités en grande largeur ou pleine page sur une tablette étroite. */
.block--wide { container-type: inline-size; }
.render { display: grid; gap: 12px; }
.render__side { display: grid; gap: 12px; align-content: start; }
.render__full { display: grid; gap: 12px; }
@container (min-width: 520px) {
  .render { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 18px; align-items: start; }
  .render__full { grid-column: 1 / -1; }
}
/* Autant de tuiles par rangée que la colonne en porte, au lieu de deux tuiles qui grossissent :
   sur un large écran les blocs Thème et Rendu 3D raccourcissent au lieu de s'étaler. Jamais plus
   de TROIS : la piste ne descend pas sous le tiers de la largeur. Il y a six thèmes comme six
   styles — 3 + 3 se ferme, 5 + 1 laisse une orpheline. En dessous, le plancher de 130 px reprend
   la main et on retombe à deux, y compris dans une colonne d'une seule unité. */
.themes { display: grid; grid-template-columns: repeat(auto-fit, minmax(max(130px, (100% - 20px) / 3), 1fr)); gap: 10px; }
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
.about { margin: 4px 4px 0; }
</style>
