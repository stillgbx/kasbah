<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { CommandInput, StateFor } from '@kasbah/shared'
import { useI18n } from 'vue-i18n'
import StrokeIcon from '../ui/StrokeIcon.vue'
import { zoneRows, type ZoneRow } from '../../lib/siteMap'
import { workAreaLabel } from '../../lib/mowerTask'
import { useSceneZonesStore } from '../../stores/sceneZones'

// Les zones d'une tondeuse, en UNE liste : d'abord tout le terrain et les câbles, puis les zones de
// travail, enfin les exclusions et le réensauvagement. Chaque ligne fait ce que le robot permet —
// tondre la zone une heure (Husqvarna exige une durée), ouvrir ou fermer une exclusion. Les zones se
// TRACENT dans l'appli du fabricant : l'API ne sait ni les créer ni les redessiner.
//
// Dans la vue Maison (`sceneDeviceId`), la liste porte aussi la carte PEINTE sur le terrain : un
// interrupteur « Sur la scène » pour tout, et la pastille de chaque ligne qui la montre ou la masque
// (pleine = montrée). Choix propre au poste (`stores/sceneZones`).

const props = defineProps<{
  state: StateFor<'mower'>
  workAreas: boolean
  stayOutZones: boolean
  busy: boolean
  /** Le robot dans la vue Maison : sa carte peinte se règle ici. */
  sceneDeviceId?: string | undefined
}>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t } = useI18n()
const zones = useSceneZonesStore()

onMounted(() => { if (props.sceneDeviceId) void zones.load(props.sceneDeviceId) })
const map = computed(() => (props.sceneDeviceId ? zones.maps[props.sceneDeviceId] : undefined))
const rows = computed(() => zoneRows(props.state, map.value).filter((r) =>
  // une ligne n'existe que si elle sert à quelque chose ici : tondre, basculer, ou se peindre
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
    <!-- la carte peinte sur le terrain : tout d'un coup, puis ligne par ligne par la pastille -->
    <label v-if="hasScene" class="zones__row zones__scene">
      <span class="zones__name">{{ $t('mower.onScene') }}</span>
      <v-switch :model-value="shown" color="primary" density="compact" hide-details inset :aria-label="$t('mower.onScene')"
                @update:model-value="(v: boolean | null) => zones.setShown(sceneDeviceId!, !!v)" />
    </label>
    <template v-for="grp in groups" :key="grp.g">
      <div v-if="GROUP_TITLES[grp.g]" class="muted zones__k">{{ $t(GROUP_TITLES[grp.g]) }}</div>
      <div v-for="r in grp.rows" :key="r.key" class="zones__row">
        <!-- la pastille : la teinte de la zone sur la carte ; dans la vue Maison, elle la montre ou la masque -->
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
/* une ligne = une zone, même hauteur pour toutes : celle de l'interrupteur compact (40 px) */
.zones__row { display: flex; align-items: center; gap: 10px; min-height: 40px; min-width: 0; }
.zones__scene { border-bottom: 1px solid var(--line); padding-bottom: 4px; cursor: pointer; }
.zones__name { flex: 1 1 auto; min-width: 0; font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zones__note { font-size: 12px; }
.zones__row .zones__note { flex: none; }
.zones__swatch { flex: none; width: 12px; height: 12px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .25); }
/* pastille-bascule : 24 px à toucher, pleine quand la zone est peinte, cerclée seulement sinon ;
   pâlie tant que la carte n'est pas montrée — le choix reste, il attend l'interrupteur */
.zones__swatch--toggle {
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: 8px; cursor: pointer;
  background: transparent; box-shadow: inset 0 0 0 2px var(--swatch);
}
.zones__swatch--toggle[data-on='1'] { background: var(--swatch); }
.zones__swatch--toggle[data-dim='1'] { opacity: .45; }
.zones__btn { flex: none; height: 32px; padding: 0 12px; font-size: 13px; gap: 6px; }
.zones__row :deep(.v-switch) { flex: 0 0 auto; }
</style>
