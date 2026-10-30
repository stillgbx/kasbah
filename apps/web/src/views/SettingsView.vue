<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Color, SRGBColorSpace } from 'three'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import AssistantCard from '../components/settings/AssistantCard.vue'
import MatterCard from '../components/settings/MatterCard.vue'
import McpUsersCard from '../components/settings/McpUsersCard.vue'
import NavOrderCard from '../components/settings/NavOrderCard.vue'
import PushCard from '../components/settings/PushCard.vue'
import ServerUpdateCard from '../components/settings/ServerUpdateCard.vue'
import OriginCalibration from '../components/settings/OriginCalibration.vue'
import PluginSection from '../components/settings/PluginSection.vue'
import PropertyList from '../components/layout/PropertyList.vue'
import ModeSwitch from '../components/property/ModeSwitch.vue'
import Segmented from '../components/ui/Segmented.vue'
import { LOCALE_LABELS } from '../i18n'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { usePluginsStore } from '../stores/plugins'
import { usePropertiesStore } from '../stores/properties'
import { useLocalPluginsStore } from '../stores/localPlugins'
import { browserBluetooth } from '../lib/tens/link'
import { WEATHER_CONDITIONS } from '@kasbah/shared'
import { conditionIcon } from '../lib/weather'
import type { IconName } from '../lib/strokeIcons'
import { useSettingsStore, type Appearance, type SceneWeatherChoice } from '../stores/settings'
import { resolveVariant, type Theme } from '../themes'
import { resolveAmbience, type AmbienceMode } from '../three/core/ambience'
import type { SeasonMode } from '../three/garden/season'
import { backdropColor, groundColor } from '../three/builders/materials'
import type { RenderQuality } from '../three/core/post'
import type { SceneProjection } from '../three/core/cameraFit'
import { styleById, type GradeLook, type RenderStyle } from '../three/styles'

// Settings, in two parts: FIRST the settings, THEN the plugin list, full width
// at the end of the page. The settings fit in three zones — a one-unit stack (appearance, language,
// theme, navigation bar), the 3D rendering on two units because it alone carries enough to fill them, a one-unit
// stack (fullscreen, GPS origin). The active plugins and their sub-items live in
// house.json: they are choices of THE HOUSE, not of the screen, and they take effect without
// restarting the server.
const settings = useSettingsStore()
const plugins = usePluginsStore()
// demo mode: the switch between properties, also here because the phone's rail has no initials pad
const properties = usePropertiesStore()
// LOCAL plugins, for their part, are choices of THIS device (localStorage): the TENS must only exist
// on the browser that talks to it over Bluetooth, never on the landing tablet.
const localPlugins = useLocalPluginsStore()
const bluetooth = browserBluetooth() !== null
/** Plugins in alphabetical order of their displayed name (the id, `_` as a space), not in the server's order. */
const pluginsByName = computed(() => [...plugins.list].sort((a, b) => a.id.replace('_', ' ').localeCompare(b.id.replace('_', ' '))))
const devices = useDevicesStore()
const house = useHouseStore()
const { t } = useI18n()
onMounted(() => { void devices.refreshHealth(); void plugins.load() })
const router = useRouter()

/** Active / implemented in the inventory, plus the device set seen at time T. */
const pluginsStats = computed(() => {
  if (!plugins.loaded) return ''
  const available = plugins.list.filter((p) => p.implemented).length
  const active = plugins.list.filter((p) => p.implemented && p.enabled).length
  return t('settings.pluginsStats', { active, available, n: devices.count }, devices.count)
})

// The light tuning bench does not open HERE: a light can only be judged in front of the house,
// at the time of day it has. The button arms the panel and takes you to the House view, where the
// sliders change the picture under your fingers.
function openTuning() { settings.setReliefEditing(false); settings.setSceneTuningOpen(true); void router.push({ name: 'home' }) }
/** Arming the edit leads to the House view: that is where you adjust, as for the relief. */
function setHouseEditing(on: boolean) { settings.setHouseEditing(on); if (on) void router.push({ name: 'home' }) }
function openRelief() { settings.setSceneTuningOpen(false); settings.setReliefEditing(true); void router.push({ name: 'home' }) }

// `auto` has its own key: "Automatic" (the language's label) lengthened the column by 73 px
// — an `fr` track never goes below the min-content of what it carries (see the style below).
const appearanceOptions = computed(() => settings.appearances.map((a) => ({ value: a, label: t(a === 'auto' ? 'settings.appearanceAuto' : `settings.${a}`) })))
const localeOptions = computed(() => [{ value: '', label: t('settings.auto') }, ...settings.locales.map((l) => ({ value: l as string, label: LOCALE_LABELS[l] }))])
// Preview of a theme: the variant that the appearance ASKS FOR (a dark-only theme therefore shows
// its dark palette even in light appearance, which its badge also says).
function preview(theme: Theme) { return resolveVariant(theme.id, settings.wantDark).palette }
function variantLabel(theme: Theme) { return settings.wantDark ? (theme.darkLabel ?? '') : (theme.lightLabel ?? theme.darkLabel ?? '') }

// Preview of a style: its colors AT THE CHOSEN TIME, so that the tile set shows what
// the scene will render — a night style is not judged on its midday palette.
const renderAmbience = computed(() => resolveAmbience({
  mode: settings.sceneAmbience,
  geo: house.house ? { lat: house.house.origin.lat, lon: house.house.origin.lon } : null,
}))
function stylePreview(style: RenderStyle) {
  const look = style.look(renderAmbience.value)
  const g = look.post.grade
  return {
    sky: graded(backdropColor(look.sky), g),
    ground: graded(groundColor(look.sky), g),
    wall: graded(look.palette.wall, g),
    glass: graded(look.palette.glass, g),
  }
}
/** The calibration of the output pass (`core/post.ts`), in display space: the tile sees what the screen sees. */
function graded(c: Color, g: GradeLook | null | undefined): string {
  if (!g) return c.getStyle()
  const rgb = c.getRGB(new Color(), SRGBColorSpace)
  const v = ([rgb.r, rgb.g, rgb.b] as const).map((x, i) => Math.max(0, g.gain[i]! * (x + g.lift[i]! * (1 - x))) ** (1 / g.gamma[i]!))
  const luma = 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!
  const [r, gg, b] = v.map((x) => Math.min(1, Math.max(0, luma + (x - luma) * g.saturation)))
  return new Color().setRGB(r!, gg!, b!, SRGBColorSpace).getStyle()
}
/** The materials-as-images switch only makes sense for a style that carries a pack. */
const styleHasAssets = computed(() => !!styleById(settings.sceneStyle).assets)
const seasonOptions = computed(() => settings.seasons.map((s) => ({ value: s, label: t(`render.seasons.${s}`) })))
const ambienceOptions = computed(() => settings.ambiences.map((a) => ({ value: a, label: t(`render.ambiences.${a}`) })))
const qualityOptions = computed(() => settings.qualities.map((q) => ({ value: q, label: t(`render.qualities.${q}`) })))
const projectionOptions = computed(() => settings.projections.map((p) => ({ value: p, label: t(`render.projections.${p}`) })))
// Forced weather (debugging): "Real" then the nine conditions of the contract, with the widget's icon.
const weatherChoices = computed<{ value: SceneWeatherChoice; label: string; icon: IconName | null }[]>(() => [
  { value: 'real', label: t('render.weatherReal'), icon: null },
  ...WEATHER_CONDITIONS.map((c) => ({ value: c, label: t(`weather.conditions.${c}`), icon: conditionIcon(c) })),
])
// Visibility is set in steps that mean something (from thick fog to crystal clear), not by the
// meter: a linear slider from 50 to 50,000 would put all the fog on one pixel.
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
/** The dialog for aligning the origin on the photo ("GPS origin" block). */
const calibrating = ref(false)
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
        <!-- left column: this browser's settings, each one unit wide -->
        <div class="stack">
          <section class="card block">
            <div class="block__title">{{ $t('settings.appearance') }}</div>
            <Segmented :model-value="settings.appearance" :options="appearanceOptions" class="w-100" @update:model-value="(v: Appearance) => settings.setAppearance(v)" />
            <!-- Two automatic modes side by side ("System" and "Auto"): the line says which follows
                 what. Always displayed (it does not depend on the chosen mode), so nothing moves. -->
            <div class="muted small">{{ $t('settings.appearanceHint') }}</div>
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
          <!-- the rail's order: a choice of THIS device, like the appearance -->
          <section class="card block">
            <div class="block__title">{{ $t('settings.navOrder') }}</div>
            <div class="muted small">{{ $t('settings.navOrderHint') }}</div>
            <NavOrderCard />
          </section>
        </div>
        <!-- the dense block: two units wide, and its content itself on two columns -->
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
            <!-- second column: the two toggles, which make do with the space they are left -->
            <div class="render__side">
              <div class="auto-row auto-row--default">
                <div class="min0">
                  <div class="auto-row__name">{{ $t('render.assets') }}</div>
                  <!-- the two texts in the same cell: the height is that of the longer one, nothing moves -->
                  <div class="muted small swap">
                    <span :data-on="styleHasAssets ? '1' : '0'" :aria-hidden="!styleHasAssets">{{ $t('render.assetsHint') }}</span>
                    <span :data-on="styleHasAssets ? '0' : '1'" :aria-hidden="styleHasAssets">{{ $t('render.assetsNone') }}</span>
                  </div>
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
              <div class="auto-row auto-row--default">
                <div class="min0">
                  <div class="auto-row__name">{{ $t('render.tuning.title') }}</div>
                  <div class="muted small">{{ $t('render.tuning.hint') }}</div>
                </div>
                <button type="button" class="pill pill--sm" @click="openTuning()">{{ $t('render.tuning.open') }}</button>
              </div>
            </div>
            <!-- the two segmented controls take the block's FULL width: their four labels
                 do not get cut and do not get abbreviated, they ask for more than half a column -->
            <div class="render__full">
              <div class="block__sub">{{ $t('render.ambience') }}</div>
              <Segmented dense :model-value="settings.sceneAmbience" :options="ambienceOptions" class="w-100" @update:model-value="(v: AmbienceMode) => settings.setSceneAmbience(v)" />
              <div class="muted small">{{ $t('render.ambienceHint') }}</div>
              <div class="block__sub">{{ $t('render.season') }}</div>
              <Segmented dense :model-value="settings.sceneSeason" :options="seasonOptions" class="w-100" @update:model-value="(v: SeasonMode) => settings.setSceneSeason(v)" />
              <div class="muted small">{{ $t('render.seasonHint') }}</div>
              <div class="block__sub">{{ $t('render.projection') }}</div>
              <Segmented dense :model-value="settings.sceneProjection" :options="projectionOptions" class="w-100" @update:model-value="(v: SceneProjection) => settings.setSceneProjection(v)" />
              <div class="muted small">{{ $t('render.projectionHint') }}</div>
              <div class="block__sub">{{ $t('render.quality') }}</div>
              <Segmented dense :model-value="settings.sceneQuality" :options="qualityOptions" class="w-100" @update:model-value="(v: RenderQuality) => settings.setSceneQuality(v)" />
              <div class="muted small">{{ $t('render.qualityHint') }}</div>
              <!-- forced weather: debugging only, and scene only (the widget always says the real weather) -->
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
        <!-- right column: what fits on one line -->
        <div class="stack">
          <section v-if="settings.fullscreen.isSupported" class="card block block--row">
            <div class="block__title">{{ $t('settings.fullscreen') }}</div>
            <v-switch :model-value="settings.fullscreen.isFullscreen" @update:model-value="settings.fullscreen.toggle()" />
          </section>
          <!-- approximate survey: openings are adjusted from the House view once armed here,
               never through a floating button on a wall-mounted tablet where a sliding finger must
               not move anything by accident -->
          <section class="card block">
            <div class="block__title">{{ $t('settings.editMode') }}</div>
            <!-- a demo is for looking at: we duplicate it to modify it (the server refuses any write) -->
            <div v-if="properties.isDemo" class="auto-row">
              <div class="min0">
                <div class="auto-row__name">{{ $t('properties.demoReadOnly') }}</div>
                <div class="muted small">{{ $t('properties.demoReadOnlyHint') }}</div>
              </div>
              <button v-if="properties.canCreate" type="button" class="pill pill--sm" :disabled="properties.busy || !!properties.switching" @click="properties.duplicateActive()">{{ $t('properties.duplicateShort') }}</button>
            </div>
            <div v-else class="auto-row">
              <div class="min0">
                <div class="auto-row__name">{{ $t('render.houseEditing') }}</div>
                <div class="muted small">{{ $t('render.houseEditingHint') }}</div>
              </div>
              <v-switch :model-value="settings.houseEditing" hide-details density="compact"
                        @update:model-value="(v: boolean | null) => setHouseEditing(v === true)" />
            </div>
            <!-- the relief and the outline are written to the house file, like the rest of the mode -->
            <div v-if="!properties.isDemo" class="auto-row">
              <div class="min0">
                <div class="auto-row__name">{{ $t('relief.title') }}</div>
                <div class="muted small">{{ $t('relief.hint') }}</div>
              </div>
              <button type="button" class="pill pill--sm" @click="openRelief()">{{ $t('relief.open') }}</button>
            </div>
          </section>
          <section v-if="properties.hasMenu" class="card block">
            <div class="block__title">{{ $t('properties.title') }}</div>
            <ModeSwitch v-if="properties.mode" />
            <PropertyList />
            <div class="muted small">{{ $t(properties.canCreate ? 'properties.hintCreate' : 'properties.hint') }}</div>
          </section>
          <section class="card block">
            <div class="block__title">{{ $t('settings.gps') }}</div>
            <div class="mono">{{ gps }}</div>
            <div class="muted small">{{ houseStats }}</div>
            <!-- like the relief: a demo property does not rewrite its versioned file -->
            <template v-if="!properties.isDemo">
              <button type="button" class="pill pill--sm gps__calibrate" :disabled="!house.house" @click="calibrating = true">{{ $t('settings.calibrate') }}</button>
              <OriginCalibration v-model="calibrating" />
            </template>
          </section>
        </div>
      </div>
      <!-- THIS device's personal devices, before the house's vendors -->
      <section class="card block settings__plugins">
        <div class="block__title">{{ $t('settings.localPlugins') }}</div>
        <p class="muted small plugins__hint">{{ $t('settings.localPluginsHint') }}</p>
        <div class="auto-row">
          <div class="min0">
            <div class="auto-row__name">{{ $t('settings.localTens') }}</div>
            <div class="muted small">{{ bluetooth ? $t('settings.localTensHint') : $t('settings.localUnsupported') }}</div>
          </div>
          <v-switch :model-value="localPlugins.isEnabled('tens')" hide-details density="compact"
                    @update:model-value="(v: boolean | null) => localPlugins.setEnabled('tens', v === true)" />
        </div>
      </section>
      <!-- THIS device's push notifications: the house's alerts and the automations' messages -->
      <section class="card block settings__plugins">
        <div class="block__title">{{ $t('push.title') }}</div>
        <p class="muted small plugins__hint">{{ $t('push.hint') }}</p>
        <PushCard />
      </section>
      <!-- who opens Kasbah through the public address, and connects an assistant (Claude…) to the MCP server -->
      <section class="card block settings__plugins">
        <div class="block__title">{{ $t('mcpUsers.title') }}</div>
        <p class="muted small plugins__hint">{{ $t('mcpUsers.hint') }}</p>
        <McpUsersCard />
      </section>
      <!-- the assistant's Claude plan ("Ask Kasbah"), for the current account -->
      <section class="card block settings__plugins">
        <div class="block__title">{{ $t('assistant.title') }}</div>
        <p class="muted small plugins__hint">{{ $t('assistant.hint') }}</p>
        <AssistantCard />
      </section>
      <!-- the house's devices published on the local network for Alexa, Google Home or Apple Home -->
      <section class="card block settings__plugins">
        <div class="block__title">{{ $t('matter.title') }}</div>
        <p class="muted small plugins__hint">{{ $t('matter.hint') }}</p>
        <MatterCard />
      </section>
      <!-- the server version, and its update by the supervisor (local network only) -->
      <section class="card block settings__plugins">
        <div class="block__title">{{ $t('serverUpdate.title') }}</div>
        <p class="muted small plugins__hint">{{ $t('serverUpdate.hint') }}</p>
        <ServerUpdateCard />
      </section>
      <!-- the vendors close the page: a full-width list, where each row has room to
           say name, status and switch without squeezing -->
      <section class="card block settings__plugins">
        <div class="plugins__head">
          <div class="block__title">{{ $t('settings.plugins') }}</div>
          <div v-if="pluginsStats" class="muted small">{{ pluginsStats }}</div>
        </div>
        <p class="muted small plugins__hint">{{ $t('settings.pluginsHint') }}</p>
        <div class="plugins">
          <PluginSection v-for="p in pluginsByName" :key="p.id" :plugin="p" />
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
.swap { display: grid; }
.swap > * { grid-area: 1 / 1; }
.swap > [data-on='0'] { visibility: hidden; }

.settings { height: 100%; display: flex; flex-direction: column; }
.settings__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); }
/* The settings first, in four units: a one-unit stack, the 3D rendering on two, a one-unit
   stack. STACKS and not grid cells: a grid row aligns on its tallest, and the 3D rendering would
   have dug its height next to each small block. Here each stack flows at its own pace, and the
   page is only as tall as the tallest of the three. */
.settings__blocks { display: grid; grid-template-columns: 1fr; gap: 14px; }
.stack { display: grid; gap: 14px; align-content: start; }
/* 1500 px: the threshold is not a rule of thumb, it is where the 1-2-1 proportions really hold.
   An `fr` track never goes below the min-content of what it carries
   (`../../../doc/6_faq/6_0_pieges-outillage.md`): the left stack asks for 344 (the Automatic /
   Français / English segmented control), so a quarter of the width must be worth at least that.
   Below, the tracks would have warped to 344/492/246 — nothing 1-2-1 anymore — and the right
   column would have been cramped. We stack then, which is more than enough for these blocks. */
@media (min-width: 1500px) {
  .settings__blocks { grid-template-columns: 1fr 2fr 1fr; align-items: start; }
}
/* The plugins next, full width, under the grid. */
.settings__plugins { margin-top: 14px; }
.plugins__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.block { padding: 18px 20px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }   /* bounded column: nothing widens it beyond a phone */
.block--row { grid-template-columns: 1fr auto; align-items: center; }
.block__title { font-weight: 600; font-size: 15px; }
.gps__calibrate { justify-self: start; }
.w-100 { width: 100%; min-width: 0; display: flex; }
.w-100 :deep(.segmented__item) { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; }   /* a phone cuts the label rather than overflowing */
@media (max-width: 599px) {
  .block { padding: 16px 14px; }
  .w-100 :deep(.segmented__item) { flex: 1 1 auto; padding: 0 4px; font-size: 12px; }   /* width fitted to the label */
}
/* Theme selector: each tile shows the palette it would apply (background, card, text,
   accent). Fixed footprint — the variant row is always there, even empty. */
/* The 3D rendering content on two columns: the tiles on one side, the toggles on the other.
   The two segmented controls, for their part, keep the block's FULL width — measured: their
   four labels ask for ~370 px, half a column only offers ~280 and cut them.
   CONTAINER query and not screen: what decides is the block's width, whether it is on
   two units on a large width or full page on a narrow screen. */
.block--wide { container-type: inline-size; }
.render { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.render__side { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-content: start; }
.render__full { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
@container (min-width: 520px) {
  .render { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 18px; align-items: start; }
  .render__full { grid-column: 1 / -1; }
}
/* As many tiles per row as the column holds, instead of two tiles that grow: on a wide screen
   the Theme and 3D rendering blocks get shorter instead of sprawling. Never more
   than THREE: the track does not go below a third of the width. There are six themes as there
   are six styles — 3 + 3 closes, 5 + 1 leaves an orphan. Below, the 130 px floor takes over and
   we fall back to two, including in a one-unit column. */
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
/* Preview of a rendering style: the sky as background, the ground at the bottom, a wall section set on it. */
.preview__ground { position: absolute; inset: auto 0 0 0; height: 40%; }
.preview__wall { position: absolute; left: 22%; right: 34%; bottom: 22%; height: 55%; border-radius: 2px; }
.block__sub { margin-top: 4px; font-size: 12px; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pill--sm { height: 32px; padding: 0 12px; font-size: 13px; gap: 6px; }
/* label and value at fixed width: the slider does not move when the figure changes */
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
