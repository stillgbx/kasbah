<script setup lang="ts">
import { useDebounceFn, useMediaQuery } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  DEFAULT_LIGHTSYNC_SETTINGS, LIGHTSYNC_EFFECTS, LIGHTSYNC_PRESET_IDS, LIGHTSYNC_PRESETS,
  type LightSyncEffect, type LightSyncPalette, type LightSyncPreset, type LightSyncSettings, type LightSyncSettingsPatch,
} from '@kasbah/shared'
import type { MusicLightSync, MusicLightSyncRoom } from '../../api'
import { randomHarmony, type Harmony } from '../../lib/colorHarmony'
import type { IconName } from '../../lib/strokeIcons'
import { useScenesStore } from '../../stores/scenes'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Settings of the room lights in rhythm with the music, opened from the arrow next to the bulb of
// the Listening panel. Every change is sent (debounced) and applied by the server to the running
// lights: there is no "Save". The settings are the ROOM's (two speakers of a room share them).
//
// Layout: effect, mood and brightness first, colours last — switching the colour source only
// changes the end of the box, nothing above it moves.
//
// This browser has no place in the house: `rooms` is given for it, and the box opens on the choice
// of its room. Until one is chosen, the switch and the settings (the room's) are out of reach.

const props = defineProps<{ status: MusicLightSync; name: string; rooms?: MusicLightSyncRoom[] }>()
const emit = defineEmits<{ toggle: [on: boolean]; change: [patch: LightSyncSettingsPatch]; room: [roomId: string] }>()
const open = defineModel<boolean>({ required: true })
const { t } = useI18n()
const scenes = useScenesStore()
const phone = useMediaQuery('(max-width: 599px)')

const EFFECT_ICONS: Record<LightSyncEffect, IconName> = { pulse: 'pulse', wave: 'waves', spectrum: 'layers', strobe: 'bolt', breathe: 'moon' }
type Source = LightSyncPalette['source']

/** Local copy: the box answers at once, the server follows. */
const local = ref<LightSyncSettings>({ ...DEFAULT_LIGHTSYNC_SETTINGS })
/** Last hand-picked colours, kept while another source is shown. */
const custom = ref<string[]>(['#ff5a0d', '#8c1fff'])
const picked = ref(0)
/** Rule of the last random draw, shown under the colours (and never drawn twice in a row). */
const harmony = ref<Harmony | null>(null)

watch(open, (v) => {
  if (!v) return
  // a plain copy: `structuredClone` refuses Vue's reactive proxies
  local.value = JSON.parse(JSON.stringify(props.status.settings ?? DEFAULT_LIGHTSYNC_SETTINGS)) as LightSyncSettings
  const p = local.value.palette
  custom.value = p.source === 'custom' ? [...p.colors] : (props.status.palette ?? custom.value).slice(0, 5)
  if (custom.value.length < 2) custom.value = ['#ff5a0d', '#8c1fff']
  picked.value = 0
  harmony.value = null
}, { immediate: true })

let pending: LightSyncSettingsPatch = {}
const flush = useDebounceFn(() => {
  const patch = pending
  pending = {}
  emit('change', patch)
}, 150)
function change(patch: LightSyncSettingsPatch) {
  local.value = { ...local.value, ...patch }
  pending = { ...pending, ...patch }
  void flush()
}

const effectOptions = computed(() => LIGHTSYNC_EFFECTS.map((e) => ({ value: e, icon: EFFECT_ICONS[e], label: t(`music.lightSyncPanel.effects.${e}`), hint: t(`music.lightSyncPanel.effectHints.${e}`) })))
const sourceOptions = computed(() => (['preset', 'scene', 'custom', 'cover'] as const).map((value) => ({ value, label: t(`music.lightSyncPanel.sources.${value}`) })))
const source = computed<Source>({
  get: () => local.value.palette.source,
  set: (s) => {
    if (s === local.value.palette.source) return
    if (s === 'preset') change({ palette: { source: 'preset', preset: 'warm' } })
    else if (s === 'custom') change({ palette: { source: 'custom', colors: [...custom.value] } })
    else if (s === 'cover') change({ palette: { source: 'cover' } })
    // a scene: only once one is chosen (the list may be empty)
    else if (roomScenes.value[0]) change({ palette: { source: 'scene', sceneId: roomScenes.value[0].scene.id } })
    else local.value = { ...local.value, palette: { source: 'scene', sceneId: '' } }
  },
})

const roomScenes = computed(() => (props.status.room ? scenes.forRoom(props.status.room.name) : []))
const preview = (colors: readonly string[]) => (colors.length === 0 ? 'var(--surface2)' : colors.length === 1 ? colors[0]! : `linear-gradient(90deg, ${colors.join(', ')})`)
const isPreset = (id: LightSyncPreset) => local.value.palette.source === 'preset' && local.value.palette.preset === id
const isScene = (id: string) => local.value.palette.source === 'scene' && local.value.palette.sceneId === id

function setCustom(colors: string[]) {
  custom.value = colors
  change({ palette: { source: 'custom', colors: [...colors] } })
}
function pickColor(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return
  const next = [...custom.value]
  next[picked.value] = hex.toLowerCase()
  setCustom(next)
}
function addColor() {
  if (custom.value.length >= 5) return
  setCustom([...custom.value, custom.value[custom.value.length - 1]!])
  picked.value = custom.value.length - 1
}
function randomize() {
  const draw = randomHarmony(custom.value.length, harmony.value ?? undefined)
  harmony.value = draw.method
  picked.value = 0
  setCustom(draw.colors)
}
function removeColor() {
  if (custom.value.length <= 2) return
  const next = custom.value.filter((_, i) => i !== picked.value)
  picked.value = Math.min(picked.value, next.length - 1)
  setCustom(next)
}

const showProblem = computed(() => props.status.on && !!props.status.problem)
/** A browser whose room is not chosen yet: nothing to switch or set before. */
const noRoom = computed(() => !!props.rooms && !props.status.room)
const subtitle = computed(() => [props.name, props.status.room?.name, props.status.area].filter(Boolean).join(' · '))
</script>

<template>
  <v-dialog v-model="open" max-width="460" scrollable :fullscreen="phone" :content-class="phone ? undefined : 'lightsync-top'">
    <div class="card box" :data-phone="phone ? '1' : '0'">
      <div class="box__head">
        <div class="min0">
          <h2 class="box__title">{{ $t('music.lightSync') }}</h2>
          <div class="muted box__sub">{{ subtitle }}</div>
        </div>
        <v-switch :model-value="status.on" :disabled="noRoom" color="primary" density="compact" hide-details inset class="box__switch"
                  :aria-label="$t('music.lightSync')" @update:model-value="(v: boolean | null) => emit('toggle', !!v)" />
        <button type="button" class="box__close" :title="$t('common.close')" :aria-label="$t('common.close')" @click="open = false">
          <StrokeIcon name="close" :size="18" />
        </button>
      </div>
      <div class="box__body">
        <section v-if="rooms" class="sec">
          <div class="section-label">{{ $t('music.lightSyncPanel.room') }}</div>
          <div class="chips" role="radiogroup" :aria-label="$t('music.lightSyncPanel.room')">
            <button v-for="r in rooms" :key="r.id" type="button" class="chip" role="radio" :data-on="status.room?.id === r.id ? '1' : '0'"
                    :aria-checked="status.room?.id === r.id ? 'true' : 'false'" :title="r.area" @click="emit('room', r.id)">
              <StrokeIcon name="light" :size="16" class="chip__icon" />
              <span class="chip__label">{{ r.name }}</span>
            </button>
          </div>
          <p class="muted hint">{{ rooms.length ? $t('music.lightSyncPanel.roomHint') : $t('music.lightSyncPanel.noRoom') }}</p>
        </section>
        <!-- reserved line: why the lights are not following, while it is being retried -->
        <div class="problem">
          <p class="problem__what" :title="showProblem ? $t(`music.lightSyncProblem.${status.problem}`) : undefined">{{ showProblem ? $t(`music.lightSyncProblem.${status.problem}`) : '' }}</p>
          <!-- the server's own words (bridge reason, ffmpeg error): readable without the logs -->
          <p class="problem__detail" :title="showProblem ? status.problemDetail : undefined">{{ showProblem ? status.problemDetail ?? '' : '' }}</p>
        </div>
        <!-- before the room of this browser is chosen, the settings are the room's: out of reach -->
        <div class="settings" :data-off="noRoom ? '1' : '0'" :inert="noRoom">
        <!-- the colours being played, cover included once known -->
        <div class="strip" :style="{ background: preview(status.palette ?? []) }" :title="$t('music.lightSyncPanel.current')" />

        <section class="sec">
          <div class="section-label">{{ $t('music.lightSyncPanel.effect') }}</div>
          <div class="effects" role="radiogroup" :aria-label="$t('music.lightSyncPanel.effect')">
            <button v-for="e in effectOptions" :key="e.value" type="button" class="tile" role="radio"
                    :aria-checked="local.effect === e.value ? 'true' : 'false'" :data-on="local.effect === e.value ? '1' : '0'"
                    :title="e.hint" @click="change({ effect: e.value })">
              <StrokeIcon :name="e.icon" :size="20" />
              <span class="tile__label">{{ e.label }}</span>
            </button>
          </div>
          <!-- one reserved line: the hint of the chosen effect -->
          <p class="muted hint">{{ $t(`music.lightSyncPanel.effectHints.${local.effect}`) }}</p>
        </section>

        <section class="sec">
          <div class="section-label">{{ $t('music.lightSyncPanel.mood') }}</div>
          <v-slider class="slider" :model-value="local.energy" :min="0" :max="1" :step="0.05" color="primary" density="compact" hide-details
                    :aria-label="$t('music.lightSyncPanel.mood')" @update:model-value="(v: number) => change({ energy: v })" />
          <div class="ends muted"><span>{{ $t('music.lightSyncPanel.calm') }}</span><span>{{ $t('music.lightSyncPanel.energetic') }}</span></div>
        </section>

        <section class="sec">
          <div class="row-label">
            <span class="section-label">{{ $t('music.lightSyncPanel.brightness') }}</span>
            <span class="muted pct">{{ Math.round(local.brightness * 100) }} %</span>
          </div>
          <v-slider class="slider" :model-value="local.brightness" :min="0.1" :max="1" :step="0.05" color="primary" density="compact" hide-details
                    :aria-label="$t('music.lightSyncPanel.brightness')" @update:model-value="(v: number) => change({ brightness: v })" />
        </section>

        <section class="sec">
          <div class="section-label">{{ $t('music.lightSyncPanel.colors') }}</div>
          <Segmented v-model="source" dense fill :options="sourceOptions" :label="$t('music.lightSyncPanel.colors')" />

          <!-- only the chosen panel takes room: the box is anchored at the top, so switching source
               only moves its bottom edge (reserving the colour picker's height left an empty
               space and a scrollbar on the other sources) -->
          <div class="sources">
          <div class="source chips" :data-on="source === 'preset' ? '1' : '0'" :inert="source !== 'preset'">
            <button v-for="id in LIGHTSYNC_PRESET_IDS" :key="id" type="button" class="chip" :data-on="isPreset(id) ? '1' : '0'"
                    :aria-pressed="isPreset(id) ? 'true' : 'false'" @click="change({ palette: { source: 'preset', preset: id } })">
              <span class="chip__swatch" :style="{ background: preview(LIGHTSYNC_PRESETS[id]) }" />
              <span class="chip__label">{{ $t(`music.lightSyncPanel.presets.${id}`) }}</span>
            </button>
          </div>

          <div class="source chips" :data-on="source === 'scene' ? '1' : '0'" :inert="source !== 'scene'">
            <p v-if="roomScenes.length === 0" class="muted hint">{{ $t('music.lightSyncPanel.noScene') }}</p>
            <button v-for="e in roomScenes" :key="e.scene.id" type="button" class="chip" :data-on="isScene(e.scene.id) ? '1' : '0'"
                    :aria-pressed="isScene(e.scene.id) ? 'true' : 'false'" @click="change({ palette: { source: 'scene', sceneId: e.scene.id } })">
              <span class="chip__swatch" :style="{ background: preview(e.scene.swatches) }" />
              <span class="chip__label">{{ e.scene.name }}</span>
            </button>
          </div>

          <div class="source custom" :data-on="source === 'custom' ? '1' : '0'" :inert="source !== 'custom'">
            <div class="dots">
              <button v-for="(c, i) in custom" :key="i" type="button" class="dot" :data-on="picked === i ? '1' : '0'" :style="{ background: c }"
                      :aria-label="$t('music.lightSyncPanel.colorN', { n: i + 1 })" :aria-pressed="picked === i ? 'true' : 'false'" @click="picked = i" />
              <button type="button" class="dot dot--act" :disabled="custom.length >= 5" :title="$t('music.lightSyncPanel.addColor')"
                      :aria-label="$t('music.lightSyncPanel.addColor')" @click="addColor">
                <StrokeIcon name="plus" :size="16" />
              </button>
              <button type="button" class="dot dot--act" :disabled="custom.length <= 2" :title="$t('music.lightSyncPanel.removeColor')"
                      :aria-label="$t('music.lightSyncPanel.removeColor')" @click="removeColor">
                <StrokeIcon name="minus" :size="16" />
              </button>
              <button type="button" class="dot dot--act dot--random" :title="$t('music.lightSyncPanel.random')"
                      :aria-label="$t('music.lightSyncPanel.random')" @click="randomize">
                <StrokeIcon name="sparkle" :size="16" />
              </button>
            </div>
            <!-- reserved line: the rule behind the last random draw -->
            <p class="muted harmony" :title="harmony ? $t(`music.lightSyncPanel.harmonies.${harmony}`) : undefined">{{ harmony ? $t('music.lightSyncPanel.harmonyUsed', { rule: $t(`music.lightSyncPanel.harmonies.${harmony}`) }) : '' }}</p>
            <v-color-picker :model-value="custom[picked]" mode="hsl" :modes="['hsl']" hide-inputs width="100%" elevation="0" class="bg-transparent"
                            @update:model-value="(h: string) => pickColor(h)" />
          </div>

          <p class="source muted hint" :data-on="source === 'cover' ? '1' : '0'" :inert="source !== 'cover'">{{ $t('music.lightSyncPanel.coverHint') }}</p>
          </div>
        </section>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.box { width: 100%; padding: 18px 20px 20px; display: grid; gap: 12px; box-shadow: var(--shadow); max-height: 85vh; grid-template-rows: auto minmax(0, 1fr); }
.box[data-phone='1'] { max-height: none; height: 100%; border-radius: 0; padding-top: calc(var(--safe-top, 0px) + 14px); }
.box__head { display: flex; align-items: center; gap: 8px; }
.min0 { min-width: 0; flex: 1 1 auto; }
.box__title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.3; }
.box__sub { font-size: 13px; margin-top: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.box__switch { flex: 0 0 auto; }
.box__close { flex: 0 0 auto; width: 32px; height: 32px; margin-right: -6px; border: 0; border-radius: 10px; background: transparent; color: var(--muted); display: grid; place-items: center; }
.box__close:hover { background: var(--surface2); color: var(--text); }
.box__body { overflow-y: auto; overscroll-behavior: contain; display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; align-content: start; margin-right: -8px; padding-right: 8px; }
.strip { height: 8px; border-radius: 999px; }
.settings { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; min-width: 0; transition: opacity .15s; }
.settings[data-off='1'] { opacity: .35; }
.chip__icon { flex: 0 0 auto; color: var(--muted); }
.chip[data-on='1'] .chip__icon { color: var(--accent); }
/* one line, always reserved: the warning appears without pushing anything */
.problem { margin-bottom: -10px; display: grid; min-width: 0; }
.problem p { margin: 0; height: 1.4em; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.problem__what { font-size: 12.5px; color: rgb(var(--v-theme-warning)); }
.problem__detail { font-size: 11.5px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.sec { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-width: 0; }
/* five tiles on one row when they fit; narrower (phone zoomed in) they wrap rather than cut their
   names — the height depends on the width only, never on a choice */
.effects { display: grid; grid-template-columns: repeat(auto-fit, minmax(66px, 1fr)); gap: 6px; }
.tile {
  min-width: 0; height: 64px; display: grid; place-items: center; align-content: center; gap: 4px; padding: 0 4px;
  border: 1px solid var(--line); border-radius: 12px; background: transparent; color: var(--muted);
}
.tile:hover { color: var(--text); background: var(--surface2); }
.tile[data-on='1'] { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
.tile__label { font-size: 11px; font-weight: 500; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* two lines kept for every hint: the sliders below never move */
.hint { margin: 0; font-size: 12.5px; line-height: 1.4; min-height: calc(2 * 1.4em); }
/* the thumb overhangs both ends of the track: room kept for it */
.slider { margin-inline: 12px; }
.ends { display: flex; justify-content: space-between; font-size: 12px; padding-inline: 4px; }
.row-label { display: flex; align-items: baseline; justify-content: space-between; }
.pct { font-size: 12.5px; font-variant-numeric: tabular-nums; }
.sources { display: grid; grid-template-columns: minmax(0, 1fr); }
.source { grid-area: 1 / 1; align-self: start; min-width: 0; }
.source[data-on='0'] { display: none; }
.chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
.chip {
  min-width: 0; height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 10px;
  border: 1px solid var(--line); border-radius: 10px; background: transparent; color: var(--text); text-align: left;
}
.chip:hover { background: var(--surface2); }
.chip[data-on='1'] { border-color: var(--accent); background: var(--accent-soft); }
.chip__swatch { flex: 0 0 auto; width: 28px; height: 18px; border-radius: 6px; }
.chip__label { min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.custom { display: grid; gap: 10px; }
.dots { display: flex; gap: 8px; flex-wrap: wrap; }
.dot { width: 34px; height: 34px; border-radius: 999px; border: 2px solid transparent; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .15); padding: 0; }
.dot[data-on='1'] { border-color: var(--text); }
.dot--act { display: grid; place-items: center; background: transparent; color: var(--muted); border: 1px dashed var(--line); box-shadow: none; }
.dot--act:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.dot--act:disabled { opacity: .35; }
.dot--random { margin-left: auto; }
/* one line, always: a long rule name on a phone must not push the picker down on a click */
.harmony { margin: -4px 0 0; font-size: 12.5px; height: 1.4em; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>

<style>
/* the dialog is teleported: not reachable from the scoped block. Anchored at the top, not centred:
   a change of the box's height (colour source) leaves everything above in place */
.v-dialog > .v-overlay__content.lightsync-top { align-self: flex-start; margin-top: 7.5vh; }
</style>
