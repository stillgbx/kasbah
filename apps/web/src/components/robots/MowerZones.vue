<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { CommandInput, StateFor } from '@kasbah/shared'
import { useI18n } from 'vue-i18n'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { zoneRows, type ZoneRow } from '../../lib/siteMap'
import { workAreaLabel } from '../../lib/mowerTask'
import { useSceneZonesStore } from '../../stores/sceneZones'

// A mower's zones, in ONE list: first the whole terrain and the cables, then the work
// zones, finally the exclusions and the rewilding. Each row does what the robot allows —
// mow the zone for an hour (Husqvarna requires a duration), open or close an exclusion. The zones are
// DRAWN in the vendor's app: the API can neither create nor redraw them.
//
// In the House view (`sceneDeviceId`), the list also carries the map PAINTED on the terrain: a
// "On the scene" switch for everything, and each row's pill that shows or hides it
// (filled = shown). A choice specific to the workstation (`stores/sceneZones`).

const props = defineProps<{
  state: StateFor<'mower'>
  workAreas: boolean
  stayOutZones: boolean
  busy: boolean
  /** The robot in the House view: its painted map is adjusted here. */
  sceneDeviceId?: string | undefined
}>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t } = useI18n()
const zones = useSceneZonesStore()

onMounted(() => { if (props.sceneDeviceId) void zones.load(props.sceneDeviceId) })
const map = computed(() => (props.sceneDeviceId ? zones.maps[props.sceneDeviceId] : undefined))
const rows = computed(() => zoneRows(props.state, map.value).filter((r) =>
  // a row only exists if it serves a purpose here: mow, toggle, or be painted
  (r.workAreaId !== undefined && props.workAreas) || (!!r.stayOut && props.stayOutZones) || (!!r.sceneKey && !!props.sceneDeviceId)))
const groups = computed(() => (['base', 'work', 'stayOut'] as const)
  .map((g) => ({ g, rows: rows.value.filter((r) => r.group === g) }))
  .filter((x) => x.rows.length))

const shown = computed(() => !!props.sceneDeviceId && zones.isShown(props.sceneDeviceId))
const hidden = computed(() => (props.sceneDeviceId ? zones.hiddenFor(props.sceneDeviceId) : new Set<string>()))
const hasScene = computed(() => !!props.sceneDeviceId && rows.value.some((r) => r.sceneKey))
const visible = (r: ZoneRow) => !!r.sceneKey && !hidden.value.has(r.sceneKey)

function label(r: ZoneRow): string {
  const area = r.workAreaId !== undefined && r.workAreaId !== 0 ? props.state.workAreas?.find((a) => a.id === r.workAreaId) : undefined
  return area ? workAreaLabel(area, t) : r.label ?? t(r.labelKey ?? '')
}
const disabled = () => !props.state.available || props.busy
const GROUP_TITLES = { base: '', work: 'mower.workAreas', stayOut: 'mower.stayOutZones' } as const
</script>

<template>
  <div class="card card--soft zones">
    <!-- the map painted on the terrain: everything at once, then row by row through the pill -->
    <label v-if="hasScene" class="zones__row zones__scene">
      <span class="zones__name">{{ $t('mower.onScene') }}</span>
      <v-switch :model-value="shown" color="primary" density="compact" hide-details inset :aria-label="$t('mower.onScene')"
                @update:model-value="(v: boolean | null) => zones.setShown(sceneDeviceId!, !!v)" />
    </label>
    <template v-for="grp in groups" :key="grp.g">
      <div v-if="GROUP_TITLES[grp.g]" class="muted zones__k">{{ $t(GROUP_TITLES[grp.g]) }}</div>
      <div v-for="r in grp.rows" :key="r.key" class="zones__row">
        <!-- the pill: the zone's tint on the map; in the House view, it shows or hides it -->
        <button v-if="sceneDeviceId && r.sceneKey" type="button" class="zones__swatch zones__swatch--toggle"
                :data-on="visible(r) ? '1' : '0'" :data-dim="shown ? '0' : '1'" :style="{ '--swatch': r.color }"
                :aria-pressed="visible(r)" :title="$t(visible(r) ? 'mower.hideOnScene' : 'mower.showOnScene', { name: label(r) })"
                @click="zones.toggleEntry(sceneDeviceId, r.sceneKey)" />
        <span v-else class="zones__swatch" :style="{ background: r.color }" aria-hidden="true" />
        <span class="zones__name">{{ label(r) }}</span>
        <span v-if="r.workAreaEnabled === false" class="muted zones__note">{{ $t('mower.areaDisabled') }}</span>
        <span v-if="r.rewilding" class="muted zones__note">{{ $t('mower.rewilding') }}</span>
        <button v-if="r.workAreaId !== undefined && workAreas" type="button" class="pill zones__btn" :disabled="disabled() || r.workAreaEnabled === false"
                @click="emit('command', { type: 'mower.start_in_area', workAreaId: r.workAreaId, durationMin: 60 })">
          <StrokeIcon name="play" :size="14" />{{ $t('mower.startFor') }}
        </button>
        <v-switch v-if="r.stayOut && stayOutZones" :model-value="r.stayOut.enabled" :disabled="disabled()" color="primary" density="compact" hide-details inset
                  :aria-label="$t('mower.stayOutKeepOut', { name: label(r) })"
                  @update:model-value="(v: boolean | null) => emit('command', { type: 'mower.set_stay_out_zone', zoneId: r.stayOut!.id, enabled: !!v })" />
      </div>
    </template>
    <div v-if="stayOutZones && !rows.some((r) => r.group === 'stayOut')" class="muted zones__note">{{ $t('mower.stayOutNone') }}</div>
  </div>
</template>

<style scoped>
.zones { padding: 10px 12px; display: grid; gap: 6px; }
.zones__k { font-size: 11px; margin-top: 6px; }
/* one row = one zone, same height for all: that of the compact switch (40 px) */
.zones__row { display: flex; align-items: center; gap: 10px; min-height: 40px; min-width: 0; }
.zones__scene { border-bottom: 1px solid var(--line); padding-bottom: 4px; cursor: pointer; }
.zones__name { flex: 1 1 auto; min-width: 0; font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zones__note { font-size: 12px; }
.zones__row .zones__note { flex: none; }
.zones__swatch { flex: none; width: 12px; height: 12px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .25); }
/* toggle pill: 24 px to touch, filled when the zone is painted, ringed only otherwise;
   faded as long as the map is not shown — the choice remains, it waits for the switch */
.zones__swatch--toggle {
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: 8px; cursor: pointer;
  background: transparent; box-shadow: inset 0 0 0 2px var(--swatch);
}
.zones__swatch--toggle[data-on='1'] { background: var(--swatch); }
.zones__swatch--toggle[data-dim='1'] { opacity: .45; }
.zones__btn { flex: none; height: 32px; padding: 0 12px; font-size: 13px; gap: 6px; }
.zones__row :deep(.v-switch) { flex: 0 0 auto; }
</style>
