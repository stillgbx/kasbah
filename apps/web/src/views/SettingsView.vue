<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginHealth } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import HuePairingCard from '../components/HuePairingCard.vue'
import Segmented from '../components/ui/Segmented.vue'
import { LOCALE_LABELS } from '../i18n'
import { accentColor } from '../plugins/vuetify'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useScenesStore } from '../stores/scenes'
import { useSettingsStore, type Appearance } from '../stores/settings'

// Réglages : apparence, langue, accent, origine GPS (colonne gauche) ; plugins et clés .env (droite).
const settings = useSettingsStore()
const scenes = useScenesStore()
const devices = useDevicesStore()
const house = useHouseStore()
const { t } = useI18n()
onMounted(() => { void devices.refreshHealth(); void scenes.loadPluginSettings() })

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
const plugins = computed(() => Object.entries(devices.health?.plugins ?? {}).sort(([a], [b]) => a.localeCompare(b)))
const DOT: Record<PluginHealth['status'], string> = { ok: 'var(--accent)', degraded: '#d38b22', needs_pairing: '#d38b22', error: '#d24a43', not_implemented: 'var(--muted)', disabled: 'var(--muted)' }
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
            <div class="block__title">{{ $t('settings.accent') }}</div>
            <div class="swatches">
              <button v-for="a in settings.accents" :key="a.id" type="button" class="swatch" :data-on="settings.accentId === a.id ? '1' : '0'"
                      :style="{ background: accentColor(a.id, settings.isDark) }" :title="$t(`settings.accents.${a.id}`)" :aria-label="$t(`settings.accents.${a.id}`)" @click="settings.setAccent(a.id)" />
            </div>
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
              <v-switch :model-value="scenes.settingsOf(g.pluginId).autoDynamicForNewScenes" hide-details density="compact"
                        @update:model-value="(v: boolean | null) => scenes.setAutoDynamicForNewScenes(g.pluginId, v === true)" />
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
            <div class="block__head"><div class="block__title">{{ $t('settings.plugins') }}</div><div class="muted small">{{ $t('settings.keys') }}</div></div>
            <HuePairingCard />
            <div class="plugins">
              <div v-for="[id, h] in plugins" :key="id" class="plugin">
                <div class="min0">
                  <div class="plugin__name">{{ id.replace('_', ' ') }}</div>
                  <div class="plugin__keys mono muted">{{ h.keys?.length ? h.keys.join('  ') : $t('settings.noKeys') }}</div>
                </div>
                <div class="plugin__status muted">
                  <span class="dot" :style="{ background: DOT[h.status] }" />{{ $t(`settings.pluginStatus.${h.status}`) }}<span v-if="h.deviceCount"> · {{ $t('settings.devicesCount', { n: h.deviceCount }, h.deviceCount) }}</span>
                </div>
              </div>
              <div v-if="plugins.length === 0" class="muted small">{{ $t('common.loading') }}</div>
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
.swatches { display: flex; gap: 12px; }
.swatch { width: 34px; height: 34px; border-radius: 50%; border: 0; outline: 3px solid transparent; outline-offset: 3px; transition: outline-color .15s; }
.swatch[data-on='1'] { outline-color: var(--accent); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.small { font-size: 12px; }
.plugins { display: grid; gap: 4px; }
.plugin { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.plugin:last-child { border-bottom: 0; }
.min0 { min-width: 0; flex: 1 1 0; }
.plugin__name { font-weight: 500; font-size: 14px; text-transform: capitalize; }
.plugin__keys { font-size: 11px; white-space: pre-wrap; }
.plugin__status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.about { margin: 0 4px; }
@media (max-width: 900px) { .settings__cols { grid-template-columns: 1fr; } }
</style>
